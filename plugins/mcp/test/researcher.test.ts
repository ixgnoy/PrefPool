// plugins/mcp/test/researcher.test.ts: researcher tools with the agent's own Solana keypair (sign-in, fund, x402 report fee).
import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Keypair, SystemProgram, Transaction } from '@solana/web3.js';
import { ed25519 } from '@noble/curves/ed25519.js';
import { base58 } from '@scure/base';
import { fundInstruction } from '@as/chain';
import { addressBytes, campaignEscrowAddress, hexToBytes, type CampaignDatumFields } from '@as/shared';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createAgentSurveyServer, DEFAULT_PROGRAM_ID } from '../src/tools.js';
import { agentWallet, fundTxProblem, parseSecretKey } from '../src/wallet.js';
import { reportPayingFetch } from '../src/x402.js';

const CID = 'c'.repeat(64);
const dir = () => mkdtempSync(join(tmpdir(), 'as-'));

async function connect(opts: Parameters<typeof createAgentSurveyServer>[0]) {
  const server = createAgentSurveyServer(opts);
  const client = new Client({ name: 'test', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  return async (name: string, args: Record<string, unknown> = {}) => {
    const r = await client.callTool({ name, arguments: args });
    const t = (r.content as { text: string }[])[0]!.text;
    return { isError: !!r.isError, text: t, json: (() => { try { return JSON.parse(t); } catch { return null; } })() };
  };
}

/** A stand-in for the platform: Phantom-style sign-in, campaign view, fund/build (a real escrow fund tx) and fund/submit. */
function fakePlatform(agent: Keypair, opts: { tamper?: (tx: Transaction) => void; buyer?: string } = {}) {
  const company = agent.publicKey.toBase58();
  const datum: CampaignDatumFields = { campaignId: CID, company, reportPk: 'ab'.repeat(32), rewardLamports: 10_000_000n,
    budgetLamports: 200_000_000n, maxResponses: 20, minCohort: 10, deadlineMs: 2_000_000_000_000, refundAfterMs: 2_000_086_400_000 };
  const seen: { path: string; auth?: string; body?: unknown }[] = [];
  const message = `Sign in to PrefPool\n\nWallet: ${company}\nNonce: n1`;
  let submitted: Transaction | null = null;
  const fetchFn = (async (url: string, init?: RequestInit) => {
    const path = new URL(url).pathname.replace(/^\/api/, '');
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    seen.push({ path, auth: (init?.headers as Record<string, string> | undefined)?.Authorization, body });
    const ok = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
    if (path === '/auth/nonce') return ok({ nonce: 'n1', message });
    if (path === '/auth/verify') {
      const good = ed25519.verify(hexToBytes(body.signature), new TextEncoder().encode(message), addressBytes(body.address));
      return good ? ok({ sessionToken: 's'.repeat(64) }) : ok({ error: 'bad signature' }, 401);
    }
    if (path === '/config/public') return ok({ programId: DEFAULT_PROGRAM_ID, cluster: 'devnet' });
    if (path === '/campaigns' && init?.method === 'POST') return ok({ campaignId: CID, state: 'AWAITING_FUNDING', accessToken: 'd'.repeat(64) }, 201);
    if (path === `/campaigns/${CID}`) return ok({ state: 'AWAITING_FUNDING', rewardLamports: '10000000', maxResponses: 20 });
    if (path === `/campaigns/${CID}/fund/build`) {
      if (opts.buyer && opts.buyer !== company) return ok({ error: 'only the campaign creator can fund it', code: 'NOT_BUYER' }, 403);
      const tx = new Transaction({ feePayer: agent.publicKey, recentBlockhash: base58.encode(new Uint8Array(32).fill(7)) })
        .add(fundInstruction(DEFAULT_PROGRAM_ID, datum));
      opts.tamper?.(tx);
      return ok({ unsignedTx: tx.serialize({ requireAllSignatures: false }).toString('base64'), budgetLamports: '200000000',
        escrowAddress: campaignEscrowAddress(DEFAULT_PROGRAM_ID, CID), lastValidBlockHeight: 100 });
    }
    if (path === `/campaigns/${CID}/fund/submit`) {
      submitted = Transaction.from(Buffer.from(body.signedTx, 'base64'));
      return ok({ txHash: base58.encode(submitted.signature!) });
    }
    return ok({ error: 'not found' }, 404);
  }) as typeof fetch;
  return { fetchFn, seen, submitted: () => submitted };
}

describe('agent wallet', () => {
  it('reads AGENT_SOLANA_SECRET_KEY as base58, a JSON byte array, or a 32-byte seed', () => {
    const kp = Keypair.generate();
    expect(parseSecretKey(base58.encode(kp.secretKey))).toEqual(kp.secretKey);
    expect(parseSecretKey(JSON.stringify([...kp.secretKey]))).toEqual(kp.secretKey);
    expect(agentWallet(parseSecretKey(base58.encode(kp.secretKey.slice(0, 32)))).address).toBe(kp.publicKey.toBase58());
    expect(() => parseSecretKey(base58.encode(new Uint8Array(10)))).toThrow(/64-byte/);
  });
});

describe('fund_campaign', () => {
  it('refuses above max_budget_sol (or without a wallet) and hands funding to a human', async () => {
    const agent = Keypair.generate();
    const p = fakePlatform(agent);
    for (const maxBudgetSol of [undefined, 0, 0.19]) {
      const call = await connect({ serverUrl: 'http://x', webUrl: 'http://w', dataDir: dir(), fetchFn: p.fetchFn, wallet: agentWallet(agent.secretKey), maxBudgetSol });
      const r = await call('fund_campaign', { campaignId: CID });
      expect(r.text).toMatch(/Not funding 0\.2 SOL/);
      expect(r.text).toContain('http://w/research/new');
    }
    const call = await connect({ serverUrl: 'http://x', webUrl: 'http://w', dataDir: dir(), fetchFn: p.fetchFn, maxBudgetSol: 5 });
    expect((await call('fund_campaign', { campaignId: CID })).text).toMatch(/no agent wallet configured/);
    expect(p.seen.some((s) => s.path.includes('fund/'))).toBe(false);
  });

  it('within the cap: signs in with the keypair, checks and signs the fund tx locally, submits it', async () => {
    const agent = Keypair.generate();
    const p = fakePlatform(agent);
    const call = await connect({ serverUrl: 'http://x', webUrl: 'http://w', dataDir: dir(), fetchFn: p.fetchFn, wallet: agentWallet(agent.secretKey), maxBudgetSol: 0.2 });
    const r = await call('fund_campaign', { campaignId: CID });
    expect(r.isError).toBe(false);
    const tx = p.submitted()!;
    expect(tx.verifySignatures()).toBe(true);
    expect(tx.feePayer!.toBase58()).toBe(agent.publicKey.toBase58());
    expect(r.json).toMatchObject({ funded: true, budgetSol: 0.2, txHash: base58.encode(tx.signature!), escrowAddress: campaignEscrowAddress(DEFAULT_PROGRAM_ID, CID) });
    expect(r.json.explorer).toBe(`https://explorer.solana.com/tx/${r.json.txHash}?cluster=devnet`);
    const build = p.seen.find((s) => s.path.endsWith('fund/build'))!;
    expect(build.auth).toBe(`Bearer ${'s'.repeat(64)}`);
    expect(build.body).toEqual({});
  });

  it('refuses to sign a fund tx that does more than fund this campaign', async () => {
    const agent = Keypair.generate();
    const drain = (tx: Transaction) => { tx.add(SystemProgram.transfer({ fromPubkey: agent.publicKey, toPubkey: Keypair.generate().publicKey, lamports: 1 })); };
    const p = fakePlatform(agent, { tamper: drain });
    const call = await connect({ serverUrl: 'http://x', webUrl: 'http://w', dataDir: dir(), fetchFn: p.fetchFn, wallet: agentWallet(agent.secretKey), maxBudgetSol: 1 });
    const r = await call('fund_campaign', { campaignId: CID });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/Refusing to sign.*other than the escrow/);
    expect(p.submitted()).toBeNull();
  });

  it('only the campaign creator can fund: a campaign made by another wallet is handed back', async () => {
    const agent = Keypair.generate();
    const p = fakePlatform(agent, { buyer: Keypair.generate().publicKey.toBase58() });
    const call = await connect({ serverUrl: 'http://x', webUrl: 'http://w', dataDir: dir(), fetchFn: p.fetchFn, wallet: agentWallet(agent.secretKey), maxBudgetSol: 1 });
    expect((await call('fund_campaign', { campaignId: CID })).text).toContain(`http://w/research/new?fund=${CID}`);
  });
});

describe('fundTxProblem', () => {
  const agent = Keypair.generate();
  const datum: CampaignDatumFields = { campaignId: CID, company: agent.publicKey.toBase58(), reportPk: 'ab'.repeat(32), rewardLamports: 10_000_000n,
    budgetLamports: 200_000_000n, maxResponses: 20, minCohort: 10, deadlineMs: 2_000_000_000_000, refundAfterMs: 2_000_086_400_000 };
  const b64 = (d: CampaignDatumFields, feePayer = agent.publicKey) => new Transaction({ feePayer, recentBlockhash: base58.encode(new Uint8Array(32).fill(1)) })
    .add(fundInstruction(DEFAULT_PROGRAM_ID, d)).serialize({ requireAllSignatures: false }).toString('base64');
  const want = { feePayer: agent.publicKey.toBase58(), programId: DEFAULT_PROGRAM_ID, campaignId: CID, budgetLamports: 200_000_000n };
  it('accepts the expected fund tx and rejects other budgets, campaigns and fee payers', () => {
    expect(fundTxProblem(b64(datum), want)).toBeNull();
    expect(fundTxProblem(b64({ ...datum, budgetLamports: 900_000_000n }), want)).toMatch(/budget/);
    expect(fundTxProblem(b64({ ...datum, campaignId: 'e'.repeat(64) }), want)).toMatch(/another campaign/);
    expect(fundTxProblem(b64(datum, Keypair.generate().publicKey), want)).toMatch(/fee payer/);
    expect(fundTxProblem('bm9wZQ==', want)).toMatch(/legacy/);
  });
});

describe('draft_campaign', () => {
  it('screens locally and returns a SOL funding link', async () => {
    const call = await connect({ serverUrl: 'http://x', webUrl: 'http://w', dataDir: dir() });
    const bad = await call('draft_campaign', { title: 'Where people live', category: 'tools_mcp',
      questions: [{ id: 'q1', type: 'single_choice', text: 'What is your exact home address?', options: ['a', 'b'] }] });
    expect(bad.isError).toBe(true);
    const ok = await call('draft_campaign', { title: 'Slogan test', category: 'tools_mcp',
      questions: [{ id: 'q1', type: 'single_choice', text: 'Which slogan?', options: ['A', 'B'] }] });
    expect(ok.json.fundingLink).toMatch(/^http:\/\/w\/research\/new#draft=/);
    expect(ok.json.budgetSol).toBe(0.2);
    expect(ok.json.next).toMatch(/Phantom/);
    expect(ok.json.warnings).toEqual([expect.stringMatching(/^q1: add an option/)]);
    expect(ok.json.fixFirst).toMatch(/rephrase before funding/);
    const clean = await call('draft_campaign', { title: 'Slogan test', category: 'tools_mcp',
      questions: [{ id: 'q1', type: 'single_choice', text: 'Which slogan?', options: ['A', 'B', 'Not sure'] }] });
    expect(clean.json.warnings).toEqual([]);
    expect(clean.json.fixFirst).toBeUndefined();
    const both = await call('draft_campaign', { title: 'Pay', category: 'payments',
      questions: [{ id: 'q1', type: 'single_choice', text: 'Which do you use?', options: ['Card', 'Crypto', 'Both'] }] });
    expect(both.isError).toBe(true);
    expect(both.text).toMatch(/refers to other options/);
    // Category is a closed enum in the tool schema, so researcher agents see the allowed values up front.
    const brand = await call('draft_campaign', { title: 'x', category: 'brand',
      questions: [{ id: 'q1', type: 'single_choice', text: 'Which slogan?', options: ['A', 'B', 'Not sure'] }] });
    expect(brand.isError).toBe(true);
    expect(brand.text).toMatch(/tools_mcp/);
    expect((await call('draft_campaign', { title: 'x', category: 'tools_mcp',
      questions: [{ id: 'q1', type: 'single_choice', category: 'health', text: 'Which slogan?', options: ['A', 'B', 'Not sure'] }] })).isError).toBe(true);
    const draft = JSON.parse(Buffer.from(ok.json.fundingLink.split('#draft=')[1], 'base64url').toString());
    expect(draft).toMatchObject({ title: 'Slogan test', rewardSol: 0.01, maxResponses: 20, minCohort: 10 });
    expect((await call('draft_campaign', { title: 't', category: 'tools_mcp', questions: [{ id: 'q1', type: 'likert_5', text: 'How often do you hit rate limits? (1 = never, 5 = very often)' }],
      createWithAgentWallet: true })).text).toMatch(/No agent wallet/);
  });
  it('createWithAgentWallet creates the campaign as the agent wallet (company = agent)', async () => {
    const agent = Keypair.generate();
    const p = fakePlatform(agent);
    const call = await connect({ serverUrl: 'http://x', webUrl: 'http://w', dataDir: dir(), fetchFn: p.fetchFn, wallet: agentWallet(agent.secretKey), maxBudgetSol: 1 });
    const r = await call('draft_campaign', { title: 'Slogan test', category: 'tools_mcp', rewardSol: 0.005, maxResponses: 12, minCohort: 6,
      questions: [{ id: 'q1', type: 'single_choice', text: 'Which slogan?', options: ['A', 'B'] }] , createWithAgentWallet: true });
    expect(r.json).toMatchObject({ campaignId: CID, accessToken: 'd'.repeat(64), budgetSol: 0.06, company: agent.publicKey.toBase58(),
      warnings: [expect.stringMatching(/^q1: add an option/)], fixFirst: expect.any(String) });
    const create = p.seen.find((s) => s.path === '/campaigns')!;
    expect(create.auth).toBe(`Bearer ${'s'.repeat(64)}`);
    expect(create.body).toMatchObject({ rewardLamports: '5000000', maxResponses: 12, minCohort: 6 });
  });
});

describe('get_report', () => {
  it('no fee: plain fetch with the token; a 402 without an agent wallet explains what to configure', async () => {
    const free = (async () => new Response(JSON.stringify({ results: { q1: { A: 1 } } }), { status: 200 })) as typeof fetch;
    const call = await connect({ serverUrl: 'http://x', webUrl: 'http://w', dataDir: dir(), fetchFn: free });
    expect((await call('get_report', { campaignId: CID, accessToken: 'd'.repeat(64) })).json.results.q1.A).toBe(1);
    const paid = (async () => new Response('{}', { status: 402 })) as typeof fetch;
    const call2 = await connect({ serverUrl: 'http://x', webUrl: 'http://w', dataDir: dir(), fetchFn: paid });
    expect((await call2('get_report', { campaignId: CID, accessToken: 'd'.repeat(64) })).text).toMatch(/agent wallet/);
  });
  it('passes the access token through the paying fetch', async () => {
    let seen: string | undefined;
    const payingFetch = (async (_url: string, init?: RequestInit) => {
      seen = (init?.headers as Record<string, string>).Authorization;
      return new Response(JSON.stringify({ results: { q1: { A: 0.4 } } }), { status: 200 });
    }) as typeof fetch;
    const call = await connect({ serverUrl: 'http://x', webUrl: 'http://w', dataDir: dir(), payingFetch });
    const r = await call('get_report', { campaignId: CID, accessToken: 'd'.repeat(64) });
    expect(r.json.results.q1.A).toBe(0.4);
    expect(seen).toBe(`Bearer ${'d'.repeat(64)}`);
  });
  it('the x402 buyer refuses a fee above max_report_price_usdc before signing anything', async () => {
    const required = (amount: string) => ({
      x402Version: 2, error: 'Payment required', resource: { url: 'http://x/api/campaigns/c/report', description: 'report', mimeType: 'application/json' },
      accepts: [{ scheme: 'exact', network: 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1', amount, asset: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
        payTo: Keypair.generate().publicKey.toBase58(), maxTimeoutSeconds: 60, extra: { feePayer: Keypair.generate().publicKey.toBase58() } }],
    });
    let calls = 0;
    const fetchFn = (async () => {
      calls++;
      return new Response('{}', { status: 402, headers: { 'PAYMENT-REQUIRED': Buffer.from(JSON.stringify(required('6000000'))).toString('base64') } });
    }) as typeof fetch;
    const pay = (await reportPayingFetch(Keypair.generate().secretKey, { maxUsdc: 5, rpcUrl: 'http://127.0.0.1:1', fetchFn }))!;
    await expect(pay('http://x/api/campaigns/c/report')).rejects.toThrow(/spendControls.maxAmountPerPayment/);
    expect(calls).toBe(1); // no retry with a payment
    expect(await reportPayingFetch(Keypair.generate().secretKey, { maxUsdc: 0 })).toBeUndefined();
  });
});
