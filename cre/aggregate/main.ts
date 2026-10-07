// cre/aggregate/main.ts
import {
  HTTPCapability, HTTPClient, Runner, bytesToBase64, consensusIdenticalAggregation,
  decodeJson, handler, handlerInTee, ok, text, type HTTPPayload, type NodeRuntime,
  type Runtime, type TeeRuntime,
} from '@chainlink/cre-sdk';
import { z } from 'zod';
import { runPipeline, type CreContext, type EscrowAccount, type ReceivedEnvelope } from '../../shared/src/index.ts';

const configSchema = z.object({
  // Not z.string().url(): it rejects valid URLs in the CRE runtime (config validation fails in simulate).
  platformUrl: z.string().regex(/^https?:\/\/[^\s/]+/),
  // Solana JSON-RPC endpoint (devnet) for the escrow read; no API key, so no secret.
  solanaRpcUrl: z.string().regex(/^https?:\/\/[^\s/]+/),
  // campaign_escrow program id (base58).
  programId: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/),
  // Task 8.13: run decrypt/validate/aggregate/sign in a Confidential Workflow enclave (handlerInTee).
  // Off by default; the regular DON handler below is unchanged.
  confidential: z.boolean().optional(),
});
type Config = z.infer<typeof configSchema>;

const http = new HTTPClient();

/** Node-mode GET returning the raw body text; all nodes must see identical bytes (F11: <= 25 KB). */
const getText = (node: NodeRuntime<Config>, url: string, headerName: string, headerValue: string): string => {
  const res = http.sendRequest(node, { url, method: 'GET', headers: { [headerName]: headerValue } }).result();
  if (!ok(res)) throw new Error(`GET ${url} -> HTTP ${res.statusCode}`);
  return text(res);
};

/** JSON-RPC getAccountInfo body for the escrow PDA (base64 data, confirmed commitment). */
const accountInfoBody = (address: string) =>
  JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getAccountInfo', params: [address, { encoding: 'base64', commitment: 'confirmed' }] });

/**
 * Normalize a getAccountInfo response to EscrowAccount (or null when the account doesn't exist). Drops the
 * per-node fields (context.slot, rentEpoch) so every node's observation is byte-identical before consensus.
 */
const parseAccountInfo = (address: string, body: string): EscrowAccount | null => {
  const r = JSON.parse(body) as {
    error?: { message?: string };
    result?: { value: { owner: string; lamports: number | string; data: [string, string] } | null };
  };
  if (r.error || !r.result) throw new Error(`getAccountInfo: ${r.error?.message ?? 'no result'}`);
  const v = r.result.value;
  if (!v) return null;
  if (v.data[1] !== 'base64') throw new Error('getAccountInfo: unexpected data encoding');
  return { address, owner: v.owner, lamports: String(v.lamports), data: v.data[0] };
};

/** Node-mode escrow read; returns the normalized account as JSON ("null" when absent). */
const getEscrowAccount = (node: NodeRuntime<Config>, address: string): string => {
  const res = http.sendRequest(node, {
    url: node.config.solanaRpcUrl, method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: bytesToBase64(new TextEncoder().encode(accountInfoBody(address))),
  }).result();
  if (!ok(res)) throw new Error(`Solana RPC HTTP ${res.statusCode}`);
  return JSON.stringify(parseAccountInfo(address, text(res)));
};

const postReports = (node: NodeRuntime<Config>, url: string, token: string, payload: string): string => {
  const res = http.sendRequest(node, {
    url, method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: bytesToBase64(new TextEncoder().encode(payload)),
    cacheSettings: { store: false },
  }).result();
  if (!ok(res)) throw new Error(`POST reports -> HTTP ${res.statusCode}`);
  return 'stored'; // normalized ack so every node agrees (server dedupes by reportHash)
};

const onAggregate = (runtime: Runtime<Config>, payload: HTTPPayload): string => {
  const { campaignId } = decodeJson(payload.input) as { campaignId: string };
  if (!/^[0-9a-f]{64}$/.test(campaignId)) throw new Error('bad campaignId');
  const cfg = runtime.config;
  // 3 secret fetches (quota 5, F11). Secrets are read in DON mode and passed into node mode as arguments.
  const envelopeSk = runtime.getSecret({ id: 'ENVELOPE_X25519_SK' }).result().value;
  const reportSk = runtime.getSecret({ id: 'REPORT_ED25519_SK' }).result().value;
  const platformToken = runtime.getSecret({ id: 'CRE_PLATFORM_TOKEN' }).result().value;
  const auth = `Bearer ${platformToken}`;
  const get = (url: string, h: string, v: string) =>
    runtime.runInNodeMode(getText, consensusIdenticalAggregation<string>())(url, h, v).result();

  const base = `${cfg.platformUrl}/api/cre/campaigns/${campaignId}`;
  const context = JSON.parse(get(`${base}/context`, 'Authorization', auth)) as CreContext;

  // Envelopes in pages of 10 (one envelope < 1 KB, consensus observation limit 25 KB).
  const envelopes: ReceivedEnvelope[] = [];
  for (let page = 1; ; page++) {
    const p = JSON.parse(get(`${base}/envelopes?page=${page}`, 'Authorization', auth)) as { total: number; pageSize: number; items: ReceivedEnvelope[] };
    envelopes.push(...p.items);
    if (page * p.pageSize >= p.total || p.items.length === 0) break;
    if (page >= 10) throw new Error('too many envelope pages'); // stays within 15 HTTP calls/run
  }

  // context.escrowTxRef is the escrow PDA address; runPipeline checks owner/address/campaign id.
  const escrow = JSON.parse(
    runtime.runInNodeMode(getEscrowAccount, consensusIdenticalAggregation<string>())(context.escrowTxRef).result(),
  ) as EscrowAccount | null;

  const { settlement, research } = runPipeline({
    context, escrow, programId: cfg.programId, envelopes,
    envelopeSecretKey: envelopeSk, reportSecretKey: reportSk, nowIso: runtime.now().toISOString(),
  });
  runtime.log(`campaign ${campaignId}: accepted=${settlement.acceptedCount} rejected=${JSON.stringify(settlement.rejectionCounts)} reportHash=${settlement.reportHash}`);

  const ack = runtime
    .runInNodeMode(postReports, consensusIdenticalAggregation<string>())(
      `${base}/reports`, platformToken, JSON.stringify({ settlement, research }),
    )
    .result();
  // The report hash goes on-chain on Solana: settle verifies CRE's signature over it and emits it in `Settled`.
  return JSON.stringify({ campaignId, acceptedCount: settlement.acceptedCount, reportHash: settlement.reportHash, ack });
};

/**
 * Task 8.13 — Confidential Workflow variant. Everything that touches plaintext answers or private keys runs inside the
 * enclave: the 3 secrets are released by the Vault DON into the enclave, the platform and Solana RPC calls go out from
 * the enclave (no node-mode consensus on ciphertext pages), and runPipeline decrypts, validates, aggregates and signs
 * there. Only the outputs that already leave CRE in the regular design (aggregates, payout list, rejection counts,
 * signed reports) leave the enclave.
 * No runtime.log() inside the enclave except the same non-sensitive counts the DON path logs (simulation evidence).
 */
const onAggregateInTee = (runtime: TeeRuntime<Config>, payload: HTTPPayload): string => {
  const { campaignId } = decodeJson(payload.input) as { campaignId: string };
  if (!/^[0-9a-f]{64}$/.test(campaignId)) throw new Error('bad campaignId');
  const cfg = runtime.config;
  const envelopeSk = runtime.getSecret({ id: 'ENVELOPE_X25519_SK' }).result().value;
  const reportSk = runtime.getSecret({ id: 'REPORT_ED25519_SK' }).result().value;
  const platformToken = runtime.getSecret({ id: 'CRE_PLATFORM_TOKEN' }).result().value;

  const send = (url: string, init: { method: 'GET' | 'POST'; headers: Record<string, string>; body?: string }) => {
    const res = http.sendRequest(runtime, {
      url, method: init.method, headers: init.headers,
      ...(init.body !== undefined ? { body: bytesToBase64(new TextEncoder().encode(init.body)), cacheSettings: { store: false } } : {}),
    }).result();
    if (!ok(res)) throw new Error(`${init.method} ${url} -> HTTP ${res.statusCode}`);
    return text(res);
  };
  const auth = { Authorization: `Bearer ${platformToken}` };

  const base = `${cfg.platformUrl}/api/cre/campaigns/${campaignId}`;
  const context = JSON.parse(send(`${base}/context`, { method: 'GET', headers: auth })) as CreContext;
  const envelopes: ReceivedEnvelope[] = [];
  for (let page = 1; ; page++) {
    const p = JSON.parse(send(`${base}/envelopes?page=${page}`, { method: 'GET', headers: auth })) as { total: number; pageSize: number; items: ReceivedEnvelope[] };
    envelopes.push(...p.items);
    if (page * p.pageSize >= p.total || p.items.length === 0) break;
    if (page >= 10) throw new Error('too many envelope pages');
  }
  const escrow = parseAccountInfo(context.escrowTxRef, send(cfg.solanaRpcUrl, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: accountInfoBody(context.escrowTxRef),
  }));

  const { settlement, research } = runPipeline({
    context, escrow, programId: cfg.programId, envelopes,
    envelopeSecretKey: envelopeSk, reportSecretKey: reportSk, nowIso: runtime.now().toISOString(),
  });
  runtime.log(`[TEE] campaign ${campaignId}: accepted=${settlement.acceptedCount} rejected=${JSON.stringify(settlement.rejectionCounts)} reportHash=${settlement.reportHash}`);

  send(`${base}/reports`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...auth },
    body: JSON.stringify({ settlement, research }),
  });
  return JSON.stringify({ campaignId, acceptedCount: settlement.acceptedCount, reportHash: settlement.reportHash, ack: 'stored', tee: true });
};

const initWorkflow = (config: Config) => [
  config.confidential === true
    // AWS Nitro in us-west-2 is the only registered TEE today (cre-templates hello-confidential-workflows).
    ? handlerInTee(new HTTPCapability().trigger({}), onAggregateInTee, [{ tee: 'nitro', regions: ['us-west-2'] }])
    : handler(new HTTPCapability().trigger({}), onAggregate),
];

export async function main() {
  const runner = await Runner.newRunner<Config>({ configSchema });
  await runner.run(initWorkflow);
}
