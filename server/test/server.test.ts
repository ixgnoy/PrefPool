// server/test/server.test.ts
import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { Transaction } from '@solana/web3.js';
import { campaignEscrowAddress, runPipeline, sealEnvelope, type CampaignDatumFields } from '@as/shared';
import { tick } from '../src/lifecycle.js';
import { CRE_TOKEN, RUNNER_TOKEN, demoSpec, escrowFor, keys, login, makeDeps, wallet } from './helpers.js';

const cre = { Authorization: `Bearer ${CRE_TOKEN}` };
const runner = { Authorization: `Bearer ${RUNNER_TOKEN}` };

/** Create + fund + activate a demo campaign; returns everything later steps need. */
async function activeCampaign() {
  const env = await makeDeps();
  const { app, deps, clock, chainState } = env;
  const buyer = await wallet();
  const session = await login(app, buyer);
  const auth = { Authorization: `Bearer ${session}` };
  const deadline = clock.now + 600_000;
  const created = await request(app).post('/api/campaigns').set(auth).send(demoSpec(deadline)).expect(201);
  const id = created.body.campaignId as string;
  const built = await request(app).post(`/api/campaigns/${id}/fund/build`).set(auth).send({}).expect(200);
  expect(built.body).toMatchObject({ budgetLamports: '30000000', escrowAddress: campaignEscrowAddress(deps.chain.programId, id) });
  const funded = await request(app).post(`/api/campaigns/${id}/fund/submit`).set(auth).send({ signedTx: buyer.signTx(built.body.unsignedTx) }).expect(200);
  const datum: CampaignDatumFields = { campaignId: id, company: buyer.address, reportPk: deps.config.reportPublicKey, rewardLamports: 1_500_000n,
    budgetLamports: 30_000_000n, maxResponses: 20, minCohort: 15, deadlineMs: deadline, refundAfterMs: deadline + 86_400_000 };
  chainState.escrow = escrowFor(datum);
  await tick(deps); // FUNDING_SUBMITTED -> FUNDED
  await tick(deps); // FUNDED -> ACTIVE (+ broadcast)
  return { ...env, buyer, auth, id, deadline, datum, fundTxHash: funded.body.txHash as string, accessToken: created.body.accessToken as string };
}

async function registerAgent(app: Awaited<ReturnType<typeof makeDeps>>['app']) {
  const who = await wallet();
  const session = await login(app, who);
  const { body } = await request(app).post('/api/agents/register').set({ Authorization: `Bearer ${session}` }).send({ kind: 'plugin' }).expect(200);
  return { ...who, agentAuth: { Authorization: `Bearer ${body.agentToken}` } };
}

/** A campaign whose fund tx was broadcast (FUNDING_SUBMITTED), escrow not visible yet. */
async function submittedCampaign() {
  const env = await makeDeps();
  const buyer = await wallet();
  const auth = { Authorization: `Bearer ${await login(env.app, buyer)}` };
  const { body } = await request(env.app).post('/api/campaigns').set(auth).send(demoSpec(env.clock.now + 600_000)).expect(201);
  const b = await request(env.app).post(`/api/campaigns/${body.campaignId}/fund/build`).set(auth).send({}).expect(200);
  await request(env.app).post(`/api/campaigns/${body.campaignId}/fund/submit`).set(auth).send({ signedTx: buyer.signTx(b.body.unsignedTx) }).expect(200);
  const view = async () => (await request(env.app).get(`/api/campaigns/${body.campaignId}`)).body;
  return { ...env, buyer, auth, id: body.campaignId as string, view };
}

describe('auth', () => {
  it('rejects a signature from another wallet', async () => {
    const { app } = await makeDeps();
    const a = await wallet();
    const b = await wallet();
    const { body } = await request(app).post('/api/auth/nonce').send({ address: a.address }).expect(200);
    expect(body.message).toBe(`Sign in to PrefPool\n\nWallet: ${a.address}\nNonce: ${body.nonce}`);
    await request(app).post('/api/auth/verify').send({ address: a.address, signature: b.signMessage(body.message) }).expect(401);
  });
  it('a nonce works only once', async () => {
    const { app } = await makeDeps();
    const a = await wallet();
    const { body } = await request(app).post('/api/auth/nonce').send({ address: a.address });
    const signature = a.signMessage(body.message);
    await request(app).post('/api/auth/verify').send({ address: a.address, signature }).expect(200);
    await request(app).post('/api/auth/verify').send({ address: a.address, signature }).expect(401);
  });
  it('refuses a non-Solana address and a signature over a different message', async () => {
    const { app } = await makeDeps();
    await request(app).post('/api/auth/nonce').send({ address: 'addr_test1qpfx9xztm0rs2ev9n9k6gat2qws8qghtr6xhl' }).expect(400);
    const a = await wallet();
    const { body } = await request(app).post('/api/auth/nonce').send({ address: a.address }).expect(200);
    await request(app).post('/api/auth/verify').send({ address: a.address, signature: a.signMessage(body.nonce) }).expect(401);
  });
});

describe('campaigns and funding', () => {
  it('rejects an identifying campaign before funding', async () => {
    const { app, clock } = await makeDeps();
    const s = await login(app, await wallet());
    const spec = { ...demoSpec(clock.now + 600_000), questions: [{ id: 'q1', type: 'single_choice', text: 'What is your exact home address?', options: ['a', 'b'] }] };
    const res = await request(app).post('/api/campaigns').set({ Authorization: `Bearer ${s}` }).send(spec).expect(422);
    expect(res.body).toMatchObject({ state: 'REJECTED', reasons: ['identifying question: q1'] });
  });
  it('returns wording warnings with a created campaign and rejects lint blocks', async () => {
    const { app, clock, deps } = await makeDeps();
    const auth = { Authorization: `Bearer ${await login(app, await wallet())}` };
    const ok = await request(app).post('/api/campaigns').set(auth).send(demoSpec(clock.now + 600_000)).expect(201);
    expect(ok.body.warnings).toEqual(expect.arrayContaining([expect.stringMatching(/^q3: add an option/)]));
    const rows = await deps.db.query<{ lint_warnings: string[] }>('select lint_warnings from campaigns where id = $1', [ok.body.campaignId]);
    expect(rows[0]!.lint_warnings).toEqual(ok.body.warnings);
    const bad = demoSpec(clock.now + 600_000);
    bad.questions[0]!.options = ['Card', 'Crypto', 'Both'];
    const rejected = await request(app).post('/api/campaigns').set(auth).send(bad).expect(422);
    expect(rejected.body.reasons.join()).toMatch(/refers to other options/);
    const unknown = await request(app).post('/api/campaigns').set(auth).send({ ...demoSpec(clock.now + 600_000), category: 'brand' }).expect(422);
    expect(unknown.body.reasons).toContain('unknown category: brand');
  });
  it('rejects more responses than one settle tx can pay', async () => {
    const { app, clock } = await makeDeps();
    const s = await login(app, await wallet());
    const res = await request(app).post('/api/campaigns').set({ Authorization: `Bearer ${s}` }).send({ ...demoSpec(clock.now + 600_000), maxResponses: 30 }).expect(422);
    expect(res.body.reasons).toEqual(['maxResponses must be 1..20']);
  });
  it('throttles a buyer after 10 rejected drafts in 24 hours (by the server clock), per buyer', async () => {
    const env = await makeDeps();
    const buyer = await wallet();
    const auth = { Authorization: `Bearer ${await login(env.app, buyer)}` };
    const bad = { ...demoSpec(env.clock.now + 600_000), category: 'health' };
    for (let i = 0; i < 10; i++) await request(env.app).post('/api/campaigns').set(auth).send(bad).expect(422);
    const blocked = await request(env.app).post('/api/campaigns').set(auth).send(demoSpec(env.clock.now + 600_000)).expect(429);
    expect(blocked.body.code).toBe('TOO_MANY_REJECTED');
    // Another buyer is not affected.
    const other = { Authorization: `Bearer ${await login(env.app, await wallet())}` };
    await request(env.app).post('/api/campaigns').set(other).send(demoSpec(env.clock.now + 600_000)).expect(201);
    // A day later the window has passed.
    env.clock.now += 86_400_001;
    const again = { Authorization: `Bearer ${await login(env.app, buyer)}` }; // the old session expired too
    await request(env.app).post('/api/campaigns').set(again).send(demoSpec(env.clock.now + 600_000)).expect(201);
  });
  it('funds, confirms the escrow on chain, and activates', async () => {
    const { app, id, deps, fundTxHash, chainState } = await activeCampaign();
    const view = await request(app).get(`/api/campaigns/${id}`).expect(200);
    expect(view.body).toMatchObject({ state: 'ACTIVE', escrowTxRef: campaignEscrowAddress(deps.chain.programId, id), fundTxHash });
    expect(fundTxHash).toMatch(/^[1-9A-HJ-NP-Za-km-z]{64,88}$/);
    expect(chainState.submitted).toHaveLength(1);
  });
  it('only broadcasts the funding tx it issued, signed by the buyer', async () => {
    const { app, clock, chainState } = await makeDeps();
    const buyer = await wallet();
    const auth = { Authorization: `Bearer ${await login(app, buyer)}` };
    const { body } = await request(app).post('/api/campaigns').set(auth).send(demoSpec(clock.now + 600_000));
    const other = await request(app).post('/api/campaigns').set(auth).send(demoSpec(clock.now + 700_000));
    const built = (await request(app).post(`/api/campaigns/${body.campaignId}/fund/build`).set(auth).send({}).expect(200)).body;
    const builtOther = (await request(app).post(`/api/campaigns/${other.body.campaignId}/fund/build`).set(auth).send({}).expect(200)).body;
    const submit = (signedTx: string) => request(app).post(`/api/campaigns/${body.campaignId}/fund/submit`).set(auth).send({ signedTx });
    expect((await submit('bm90LWEtdHg=').expect(422)).body.code).toBe('UNPARSEABLE');
    expect((await submit(built.unsignedTx).expect(422)).body.code).toBe('BAD_SIGNATURE'); // never signed
    expect((await submit(buyer.signTx(builtOther.unsignedTx)).expect(422)).body.code).toBe('FUND_MISMATCH'); // another campaign's terms
    const stranger = await wallet(); // the right instruction, but paid and signed by someone else
    const forged = Transaction.from(Buffer.from(built.unsignedTx, 'base64'));
    forged.feePayer = stranger.kp.publicKey;
    forged.partialSign(stranger.kp);
    const forgedB64 = forged.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64');
    expect((await submit(forgedB64).expect(422)).body.code).toMatch(/^(FEE_PAYER|BAD_SIGNATURE)$/);
    expect(chainState.submitted).toHaveLength(0);
    await submit(buyer.signTx(built.unsignedTx)).expect(200);
    await submit(buyer.signTx(built.unsignedTx)).expect(409); // already FUNDING_SUBMITTED
  });
  it("another wallet cannot fund someone else's campaign", async () => {
    const { app, clock } = await makeDeps();
    const auth = { Authorization: `Bearer ${await login(app, await wallet())}` };
    const { body } = await request(app).post('/api/campaigns').set(auth).send(demoSpec(clock.now + 600_000));
    const s = { Authorization: `Bearer ${await login(app, await wallet())}` };
    await request(app).post(`/api/campaigns/${body.campaignId}/fund/build`).set(s).send({}).expect(403);
  });
  it('marks funding failed when the escrow account does not match the campaign', async () => {
    const s = await submittedCampaign();
    s.chainState.escrow = escrowFor({ ...s.chainState.built[0]!, rewardLamports: 1n });
    await tick(s.deps);
    expect(await s.view()).toMatchObject({ state: 'FUNDING_FAILED', lastError: 'escrow account does not match the campaign' });
  });
  it('an account not owned by the escrow program does not count as funding', async () => {
    const s = await submittedCampaign();
    s.chainState.escrow = { ...escrowFor(s.chainState.built[0]!), owner: s.deps.chain.relayerAddress };
    await tick(s.deps);
    expect((await s.view()).state).toBe('FUNDING_FAILED');
  });
  it('stays FUNDING_SUBMITTED while the tx is pending; FUNDING_FAILED when it failed or its blockhash expired', async () => {
    const pending = await submittedCampaign();
    await tick(pending.deps);
    expect((await pending.view()).state).toBe('FUNDING_SUBMITTED');

    const failed = await submittedCampaign();
    failed.chainState.txStatus = 'failed';
    await tick(failed.deps);
    expect(await failed.view()).toMatchObject({ state: 'FUNDING_FAILED', lastError: 'funding tx failed on chain' });

    const expired = await submittedCampaign();
    expired.chainState.txStatus = 'expired';
    await tick(expired.deps);
    expect(await expired.view()).toMatchObject({ state: 'FUNDING_FAILED', lastError: 'funding tx expired without landing' });
    // ...and the buyer can fund again
    const again = await request(expired.app).post(`/api/campaigns/${expired.id}/fund/build`).set(expired.auth).send({}).expect(200);
    await request(expired.app).post(`/api/campaigns/${expired.id}/fund/submit`).set(expired.auth).send({ signedTx: expired.buyer.signTx(again.body.unsignedTx) }).expect(200);
    expect((await expired.view()).state).toBe('FUNDING_SUBMITTED');
  });
});

describe('agents', () => {
  it('accepts one envelope per address, only for the agent\'s own address, and never after the deadline', async () => {
    const { app, id, clock, deadline } = await activeCampaign();
    const agent = await registerAgent(app);
    const other = await registerAgent(app);
    expect((await request(app).get('/api/agents/me').set(agent.agentAuth).expect(200)).body).toMatchObject({ address: agent.address, kind: 'plugin' });
    const list = await request(app).get('/api/agents/campaigns').set(agent.agentAuth).expect(200);
    expect(list.body.campaigns[0]).toMatchObject({ campaignId: id, envelopePublicKey: keys.encPk });
    const env = sealEnvelope(keys.encPk, id, agent.address, { q1: 1, q2: 4, q3: 0 });
    await request(app).post(`/api/agents/campaigns/${id}/envelope`).set(other.agentAuth).send(env).expect(403);
    await request(app).post(`/api/agents/campaigns/${id}/envelope`).set(agent.agentAuth).send(env).expect(204);
    await request(app).post(`/api/agents/campaigns/${id}/envelope`).set(agent.agentAuth).send(env).expect(409);
    clock.now = deadline + 1;
    const late = sealEnvelope(keys.encPk, id, other.address, { q1: 1, q2: 4, q3: 0 });
    const res = await request(app).post(`/api/agents/campaigns/${id}/envelope`).set(other.agentAuth).send(late).expect(409);
    expect(res.body.code).toBe('LATE');
  });
  it('accepts a v2 envelope (sealed sources and client) and refuses an oversized or unknown-version one', async () => {
    const { app, id } = await activeCampaign();
    const a = await registerAgent(app);
    const meta = { sources: { q1: 'checked' as const, q2: 'owner_told' as const, q3: 'inferred' as const }, client: { name: 'agent-survey-mcp', version: '0.2.0', modelId: 'claude-x' } };
    const env = sealEnvelope(keys.encPk, id, a.address, { q1: 1, q2: 4, q3: 0 }, meta);
    expect(env.v).toBe(2);
    await request(app).post(`/api/agents/campaigns/${id}/envelope`).set(a.agentAuth).send({ ...env, v: 3 }).expect(400);
    await request(app).post(`/api/agents/campaigns/${id}/envelope`).set(a.agentAuth).send({ ...env, ct: 'ab'.repeat(1001) }).expect(400);
    await request(app).post(`/api/agents/campaigns/${id}/envelope`).set(a.agentAuth).send(env).expect(204);
  });
  it('records abstain reasons and shows counts but never answers', async () => {
    const { app, id } = await activeCampaign();
    const a = await registerAgent(app);
    await request(app).post(`/api/agents/campaigns/${id}/decision`).set(a.agentAuth).send({ kind: 'abstain', reason: 'blocked category: spending' }).expect(204);
    const view = (await request(app).get(`/api/campaigns/${id}`)).body;
    expect(view.abstained).toEqual([{ reason: 'blocked category: spending', count: 1 }]);
    expect(JSON.stringify(view)).not.toMatch(/"ct"|"epk"|answers/);
  });
  it('refuses an answer after an explicit abstain, but not after a policy abstain', async () => {
    const { app, id } = await activeCampaign();
    const explicit = await registerAgent(app);
    await request(app).post(`/api/agents/campaigns/${id}/decision`).set(explicit.agentAuth).send({ kind: 'abstain', reason: 'task request' }).expect(204);
    const refused = await request(app).post(`/api/agents/campaigns/${id}/envelope`).set(explicit.agentAuth)
      .send(sealEnvelope(keys.encPk, id, explicit.address, { q1: 1, q2: 4, q3: 0 })).expect(409);
    expect(refused.body.code).toBe('ABSTAINED');
    const policy = await registerAgent(app); // e.g. abstained as unverified, then the owner verified
    await request(app).post(`/api/agents/campaigns/${id}/decision`).set(policy.agentAuth).send({ kind: 'abstain', reason: 'category not allowed: spending' }).expect(204);
    await request(app).post(`/api/agents/campaigns/${id}/envelope`).set(policy.agentAuth)
      .send(sealEnvelope(keys.encPk, id, policy.address, { q1: 1, q2: 4, q3: 0 })).expect(204);
  });
});

describe('CRE endpoints, relayer and settlement', () => {
  async function aggregated(respondents: number) {
    const ctx = await activeCampaign();
    const agents = [];
    for (let i = 0; i < respondents; i++) {
      const a = await registerAgent(ctx.app);
      await request(ctx.app).post(`/api/agents/campaigns/${ctx.id}/envelope`).set(a.agentAuth)
        .send(sealEnvelope(keys.encPk, ctx.id, a.address, { q1: i % 2, q2: 3, q3: 1 })).expect(204);
      agents.push(a);
    }
    ctx.clock.now = ctx.deadline + 1;
    await tick(ctx.deps); // ACTIVE -> AGGREGATING + job
    return { ...ctx, agents };
  }

  it('queues one CRE job, claims it atomically, and stores the runner log', async () => {
    const { app, id } = await aggregated(1);
    await request(app).get('/api/cre/jobs/next').set({ Authorization: 'Bearer wrong' }).expect(401);
    const [a, b] = await Promise.all([request(app).get('/api/cre/jobs/next').set(runner), request(app).get('/api/cre/jobs/next').set(runner)]);
    const claimed = [a, b].filter((r) => r.status === 200);
    expect(claimed).toHaveLength(1);
    expect(claimed[0]!.body.campaignId).toBe(id);
    await request(app).post(`/api/cre/jobs/${claimed[0]!.body.jobId}/result`).set(runner).send({ ok: true, log: 'accepted=1' }).expect(204);
    expect((await request(app).get(`/api/campaigns/${id}`)).body.cre).toEqual({ status: 'done', log: 'accepted=1' });
  });

  /** Plays the CRE role: page through envelopes over HTTP and run the real pipeline against the escrow account. */
  async function runCre(ctx: Awaited<ReturnType<typeof aggregated>>, signWith = keys.repSk) {
    const context = (await request(ctx.app).get(`/api/cre/campaigns/${ctx.id}/context`).set(cre).expect(200)).body;
    const envelopes = [];
    for (let page = 1; ; page++) {
      const p = (await request(ctx.app).get(`/api/cre/campaigns/${ctx.id}/envelopes?page=${page}`).set(cre).expect(200)).body;
      expect(p.items.length).toBeLessThanOrEqual(10);
      envelopes.push(...p.items);
      if (page * p.pageSize >= p.total) break;
    }
    return runPipeline({ context, escrow: ctx.chainState.escrow, programId: ctx.deps.chain.programId, envelopes, envelopeSecretKey: keys.encSk,
      reportSecretKey: signWith, nowIso: new Date(ctx.clock.now).toISOString() });
  }

  it('serves context and pages of 10 envelopes to CRE, then settles from the signed report', async () => {
    const ctx = await aggregated(16);
    const { app, deps, id, chainState, clock, deadline } = ctx;
    await request(app).get(`/api/cre/campaigns/${id}/context`).expect(401);
    const out = await runCre(ctx);
    expect(out.settlement.acceptedCount).toBe(16);
    expect(out.settlement.escrowTxRef).toBe(campaignEscrowAddress(deps.chain.programId, id));
    await request(app).post(`/api/cre/campaigns/${id}/reports`).set(cre).send(out).expect(200, { ack: 'stored' });
    await request(app).post(`/api/cre/campaigns/${id}/reports`).set(cre).send(out).expect(200, { ack: 'stored' });
    expect((await request(app).get(`/api/campaigns/${id}`)).body.state).toBe('SETTLEMENT_READY');
    clock.now = deadline + 30_000;
    await tick(deps);
    expect(chainState.settled).toHaveLength(0); // settle waits for deadline + 60 s
    clock.now = deadline + 61_000;
    await tick(deps);
    expect(chainState.settled[0]!.reportHash).toBe(out.settlement.reportHash);
    expect((await request(app).get(`/api/campaigns/${id}`)).body).toMatchObject({ state: 'SETTLEMENT_SUBMITTED', settlementTxHash: 'f'.repeat(64) });
    chainState.closedBy = 'f'.repeat(64);
    await tick(deps);
    const view = (await request(app).get(`/api/campaigns/${id}`)).body;
    expect(view).toMatchObject({ state: 'SETTLED', report: { acceptedCount: 16, reportHash: out.settlement.reportHash } });
    const results = (await request(app).get(`/api/campaigns/${id}/results`).set(ctx.auth).expect(200)).body;
    expect(results).toMatchObject({ validRespondents: 16, settlementTx: 'f'.repeat(64) });
    const stranger = await login(app, await wallet());
    await request(app).get(`/api/campaigns/${id}/results`).set({ Authorization: `Bearer ${stranger}` }).expect(403);
  });

  it('rejects a report signed by another key', async () => {
    const ctx = await aggregated(15);
    const forged = await runCre(ctx, '11'.repeat(32));
    const res = await request(ctx.app).post(`/api/cre/campaigns/${ctx.id}/reports`).set(cre).send(forged).expect(422);
    expect(res.body.error).toContain('bad signature');
  });

  it('insufficient cohort settles a full refund and ends REFUNDED', async () => {
    const ctx = await aggregated(3);
    const out = await runCre(ctx);
    expect(out.settlement.acceptedCount).toBe(0);
    await request(ctx.app).post(`/api/cre/campaigns/${ctx.id}/reports`).set(cre).send(out).expect(200);
    expect((await request(ctx.app).get(`/api/campaigns/${ctx.id}`)).body.state).toBe('INSUFFICIENT_COHORT');
    ctx.clock.now = ctx.deadline + 61_000;
    await tick(ctx.deps);
    ctx.chainState.closedBy = 'f'.repeat(64);
    await tick(ctx.deps);
    expect((await request(ctx.app).get(`/api/campaigns/${ctx.id}`)).body.state).toBe('REFUNDED');
  });

  it('a relayer restart after settlement does not settle twice', async () => {
    const ctx = await aggregated(15);
    await request(ctx.app).post(`/api/cre/campaigns/${ctx.id}/reports`).set(cre).send(await runCre(ctx)).expect(200);
    ctx.chainState.settleResult = { status: 'already-spent', txHash: 'e'.repeat(64) };
    ctx.clock.now = ctx.deadline + 61_000;
    await tick(ctx.deps);
    expect((await request(ctx.app).get(`/api/campaigns/${ctx.id}`)).body).toMatchObject({ state: 'SETTLED', settlementTxHash: 'e'.repeat(64) });
  });
});

describe('funding errors from the chain builder', () => {
  it("a wallet without enough devnet SOL gets 422 with the builder's message, not 500", async () => {
    const { app, deps, clock } = await makeDeps();
    const { FundingError } = await import('@as/chain');
    deps.chain.buildFundTx = async () => { throw new FundingError('INSUFFICIENT_FUNDS', 'Your wallet has 0 SOL on devnet but this campaign needs 0.0319 SOL.'); };
    const buyer = await wallet();
    const auth = { Authorization: `Bearer ${await login(app, buyer)}` };
    const { body } = await request(app).post('/api/campaigns').set(auth).send(demoSpec(clock.now + 3_600_000));
    const res = await request(app).post(`/api/campaigns/${body.campaignId}/fund/build`).set(auth).send({}).expect(422);
    expect(res.body).toEqual({ code: 'INSUFFICIENT_FUNDS', error: expect.stringMatching(/^Your wallet has 0 SOL on devnet/) });
  });
  it('a broadcast the network refuses is a 422, and the campaign stays fundable', async () => {
    const { app, deps, clock } = await makeDeps();
    deps.chain.submitSignedTx = async () => { throw new Error('Blockhash not found'); };
    const buyer = await wallet();
    const auth = { Authorization: `Bearer ${await login(app, buyer)}` };
    const { body } = await request(app).post('/api/campaigns').set(auth).send(demoSpec(clock.now + 3_600_000));
    const b = await request(app).post(`/api/campaigns/${body.campaignId}/fund/build`).set(auth).send({}).expect(200);
    const res = await request(app).post(`/api/campaigns/${body.campaignId}/fund/submit`).set(auth).send({ signedTx: buyer.signTx(b.body.unsignedTx) }).expect(422);
    expect(res.body).toMatchObject({ code: 'SUBMIT_FAILED', error: expect.stringMatching(/expired.*try again/) });
    expect((await request(app).get(`/api/campaigns/${body.campaignId}`)).body.state).toBe('AWAITING_FUNDING');
  });
});

describe("signed settlement: the escrow names CRE's report key", () => {
  it('funds escrows whose account carries the report public key and the buyer as company', async () => {
    const env = await makeDeps(Date.now());
    const buyer = await wallet();
    const b = { Authorization: `Bearer ${await login(env.app, buyer)}` };
    const { body } = await request(env.app).post('/api/campaigns').set(b).send(demoSpec(env.clock.now + 3_600_000)).expect(201);
    await request(env.app).post(`/api/campaigns/${body.campaignId}/fund/build`).set(b).send({}).expect(200);
    expect(env.chainState.built.at(-1)!).toMatchObject({ reportPk: env.deps.config.reportPublicKey, company: buyer.address, budgetLamports: 30_000_000n });
  });
});
