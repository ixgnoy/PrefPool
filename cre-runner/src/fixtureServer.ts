// cre-runner/src/fixtureServer.ts
/**
 * Stand-in for the platform's /api/cre/* endpoints so the CRE lane can run `cre workflow simulate` without the server.
 * Two escrow modes:
 *  - real devnet escrow: ESCROW_ADDRESS=<PDA> (funded via the web/plugin); keep the workflow's solanaRpcUrl on devnet.
 *  - synthetic escrow (offline): omit ESCROW_ADDRESS; the fixture also answers Solana JSON-RPC getAccountInfo at
 *    POST /rpc with an encoded Campaign account, so set the workflow config's solanaRpcUrl to http://localhost:4000/rpc.
 * Run: CAMPAIGN_ID=<64hex> DEADLINE_MS=<ms> ENVELOPE_X25519_PK=<hex> REPORT_ED25519_PK=<hex> CRE_PLATFORM_TOKEN=<hex> npm run fixture -w @as/cre-runner
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import {
  addressFromSeed, campaignEscrowAddress, encodeCampaignAccount, randomHex32, sealEnvelope,
  type CampaignDatumFields, type EscrowAccount, type Question,
} from '@as/shared';

export const FIXTURE_PROGRAM_ID = 'Cm1NmUPngoFke9pc8zXsK2qebBEfPb76bS3gHfjMS2hN';

export interface Fixture {
  campaignId: string; escrowTxRef: string; deadlineMs: number; questions: Question[];
  registered: string[]; envelopes: (ReturnType<typeof sealEnvelope> & { receivedAtMs: number })[];
  /** Synthetic on-chain escrow served by the /rpc mock (null in real-escrow mode). */
  escrow: EscrowAccount | null;
}

export function makeFixture(opts: {
  campaignId: string; deadlineMs: number; envelopePk: string; respondents: number;
  /** Real escrow PDA; omit for a synthetic escrow (needs reportPk). */
  escrowAddress?: string; programId?: string; reportPk?: string; rewardLamports?: bigint;
}): Fixture {
  const programId = opts.programId ?? FIXTURE_PROGRAM_ID;
  const questions: Question[] = [
    { id: 'q1', type: 'single_choice', text: 'Which slogan makes you most likely to try the app?', options: ['Pay less, live more', 'Your money, faster'] },
    { id: 'q2', type: 'likert_5', text: 'How much do you trust new e-wallet brands?' },
  ];
  const registered = Array.from({ length: opts.respondents }, () => addressFromSeed(`fixture:${randomHex32()}`));
  const envelopes = registered.map((a, i) => ({
    ...sealEnvelope(opts.envelopePk, opts.campaignId, a, { q1: i % 3 === 0 ? 0 : 1, q2: 1 + (i % 5) }),
    receivedAtMs: opts.deadlineMs - 60_000 + i,
  }));
  let escrow: EscrowAccount | null = null;
  const escrowTxRef = opts.escrowAddress ?? campaignEscrowAddress(programId, opts.campaignId);
  if (!opts.escrowAddress) {
    if (!opts.reportPk) throw new Error('synthetic escrow needs reportPk');
    const reward = opts.rewardLamports ?? 10_000_000n; // 0.01 SOL
    const datum: CampaignDatumFields = {
      campaignId: opts.campaignId, company: addressFromSeed('fixture:company'), reportPk: opts.reportPk,
      rewardLamports: reward, budgetLamports: reward * 20n, maxResponses: 20, minCohort: 5,
      deadlineMs: opts.deadlineMs, refundAfterMs: opts.deadlineMs + 7 * 86_400_000,
    };
    escrow = { address: escrowTxRef, owner: programId, lamports: (reward * 20n + 2_000_000n).toString(), data: Buffer.from(encodeCampaignAccount(datum)).toString('base64') };
  }
  return { campaignId: opts.campaignId, escrowTxRef, deadlineMs: opts.deadlineMs, questions, registered, envelopes, escrow };
}

/** Solana JSON-RPC getAccountInfo response for the fixture's escrow (base64 encoding), as devnet would return it. */
export function accountInfoResult(fx: Fixture, address: string) {
  const acct = fx.escrow && fx.escrow.address === address ? fx.escrow : null;
  return {
    context: { apiVersion: '2.2.0', slot: 1 },
    value: acct && { data: [acct.data, 'base64'], executable: false, lamports: Number(acct.lamports), owner: acct.owner, rentEpoch: 0, space: 0 },
  };
}

export function fixtureHandler(fx: Fixture, token: string, onReports: (body: unknown) => void) {
  return (req: IncomingMessage, res: ServerResponse) => {
    const send = (status: number, body?: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(body === undefined ? undefined : JSON.stringify(body));
    };
    const readBody = (fn: (body: string) => void) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => fn(body));
    };
    const url = new URL(req.url ?? '/', 'http://x');
    // Solana RPC mock (no auth, like a public RPC node).
    if (req.method === 'POST' && url.pathname === '/rpc') {
      return readBody((body) => {
        const r = JSON.parse(body) as { id: unknown; method: string; params?: [string, unknown?] };
        if (r.method !== 'getAccountInfo' || !r.params?.[0]) {
          return send(200, { jsonrpc: '2.0', id: r.id, error: { code: -32601, message: 'Method not found' } });
        }
        send(200, { jsonrpc: '2.0', id: r.id, result: accountInfoResult(fx, r.params[0]) });
      });
    }
    if (req.headers.authorization !== `Bearer ${token}`) return send(401, { error: 'unauthorized', code: 'AUTH' });
    const base = `/api/cre/campaigns/${fx.campaignId}`;
    if (req.method === 'GET' && url.pathname === `${base}/context`) {
      return send(200, { campaignId: fx.campaignId, escrowTxRef: fx.escrowTxRef, questions: fx.questions, deadlineMs: fx.deadlineMs, registered: fx.registered });
    }
    if (req.method === 'GET' && url.pathname === `${base}/envelopes`) {
      const page = Math.max(1, Number(url.searchParams.get('page') ?? '1'));
      return send(200, { page, pageSize: 10, total: fx.envelopes.length, items: fx.envelopes.slice((page - 1) * 10, page * 10) });
    }
    if (req.method === 'POST' && url.pathname === `${base}/reports`) {
      return readBody((body) => { onReports(JSON.parse(body)); send(200, { ack: 'stored' }); });
    }
    send(404, { error: 'not found', code: 'NOT_FOUND' });
  };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split(/[\\/]/).pop()!)) {
  const env = (k: string) => process.env[k] ?? (() => { throw new Error(`missing ${k}`); })();
  const fx = makeFixture({
    campaignId: env('CAMPAIGN_ID'), deadlineMs: Number(env('DEADLINE_MS')), envelopePk: env('ENVELOPE_X25519_PK'),
    respondents: Number(process.env.RESPONDENTS ?? '12'), escrowAddress: process.env.ESCROW_ADDRESS || undefined,
    programId: process.env.ESCROW_PROGRAM_ID || undefined,
    reportPk: process.env.ESCROW_ADDRESS ? undefined : env('REPORT_ED25519_PK'),
  });
  createServer(fixtureHandler(fx, env('CRE_PLATFORM_TOKEN'), (b) => console.log('REPORTS', JSON.stringify(b, null, 2))))
    .listen(4000, () => console.log(`fixture platform on http://localhost:4000 (escrow ${fx.escrowTxRef}${fx.escrow ? ', synthetic via /rpc' : ''})`));
}
