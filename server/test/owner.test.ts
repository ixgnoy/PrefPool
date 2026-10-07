// server/test/owner.test.ts — endpoints for the redesigned web app (FRONTEND_PRD Appendix A):
// seller agent status/policy/activity, buyer campaign list, refund escape hatch, dev-view trace, public config.
import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { Transaction } from '@solana/web3.js';
import { campaignEscrowAddress, sealEnvelope, transcriptKeyFromSignature } from '@as/shared';
import { decide } from '../src/synthetic.js';
import { SYNTHETIC_AGENTS } from '../src/syntheticProfiles.js';
import { demoSpec, keys, login, makeDeps, wallet } from './helpers.js';


async function setup() {
  const env = await makeDeps(Date.now());
  const seller = await wallet();
  const buyer = await wallet();
  const sellerSession = await login(env.app, seller);
  const buyerSession = await login(env.app, buyer);
  const s = { Authorization: `Bearer ${sellerSession}` };
  const b = { Authorization: `Bearer ${buyerSession}` };
  const newCampaign = async (deadlineMs = env.clock.now + 3_600_000) => {
    const res = await request(env.app).post('/api/campaigns').set(b).send(demoSpec(deadlineMs)).expect(201);
    return res.body as { campaignId: string; accessToken: string };
  };
  const register = async () => (await request(env.app).post('/api/agents/register').set(s).send({ kind: 'plugin' }).expect(200)).body as { agentId: string; agentToken: string };
  const setState = (id: string, state: string, extra = '') => env.deps.db.query(`update campaigns set state = $2 ${extra} where id = $1`, [id, state]);
  const decide = (campaignId: string, agentId: string, kind: 'answer' | 'abstain', reason: string | null = null) =>
    env.deps.db.query(`insert into agent_decisions (campaign_id, agent_id, kind, reason) values ($1, $2, $3, $4)`, [campaignId, agentId, kind, reason]);
  const report = (campaignId: string, payouts: { address: string; lamports: string }[]) =>
    env.deps.db.query(`insert into reports (campaign_id, settlement, research, report_hash) values ($1, $2::jsonb, $3::jsonb, $4)`, [campaignId,
      JSON.stringify({ campaignId, acceptedCount: payouts.length, payouts, rejectionCounts: { malformed: 0, duplicate: 0, ineligible: 0, late: 0 }, reportHash: campaignId.slice(0, 64) }),
      JSON.stringify({ validRespondents: payouts.length, minCohort: 15, results: { q1: { 'Pay less, live more': 1 } } }), campaignId]);
  return { ...env, env, seller, buyer, s, b, newCampaign, register, setState, decide, report };
}

describe('CORS', () => {
  it('lets the browser PUT (saving guardrails from the web app)', async () => {
    const t = await setup();
    const pre = await request(t.app).options('/api/agents/mine').set('Origin', 'http://localhost:3000').set('Access-Control-Request-Method', 'PUT').expect(204);
    expect(pre.headers['access-control-allow-methods']).toContain('PUT');
  });
});

describe('seller: my agent', () => {
  it('is null before registering, then shows policy and connection status', async () => {
    const t = await setup();
    expect((await request(t.app).get('/api/agents/mine').set(t.s).expect(200)).body).toEqual({ agent: null });
    const { agentToken } = await t.register();
    const before = (await request(t.app).get('/api/agents/mine').set(t.s).expect(200)).body.agent;
    expect(before).toMatchObject({ kind: 'plugin', address: t.seller.address, connected: false, lastSeenAt: null, paused: false });
    await request(t.app).get('/api/agents/me').set({ Authorization: `Bearer ${agentToken}` }).expect(200);
    const after = (await request(t.app).get('/api/agents/mine').set(t.s).expect(200)).body.agent;
    expect(after.connected).toBe(true);
    expect(typeof after.lastSeenAt).toBe('number');
  });
  it('needs a wallet session', async () => {
    const t = await setup();
    await request(t.app).get('/api/agents/mine').expect(401);
  });
  it('saves guardrails and validates them', async () => {
    const t = await setup();
    await t.register();
    const policy = { allowedCategories: ['payments'], blockedCategories: ['spending'], minimumRewardSol: 2, dailyLimit: 3, approvalMode: 'auto' };
    await request(t.app).put('/api/agents/mine').set(t.s).send({ policy }).expect(200);
    expect((await request(t.app).get('/api/agents/mine').set(t.s)).body.agent.policy).toEqual(policy);
    await request(t.app).put('/api/agents/mine').set(t.s).send({ policy: { ...policy, dailyLimit: 0 } }).expect(400);
  });
  it('a paused agent is offered no campaigns', async () => {
    const t = await setup();
    const { agentToken } = await t.register();
    const c = await t.newCampaign();
    await t.setState(c.campaignId, 'ACTIVE');
    const a = { Authorization: `Bearer ${agentToken}` };
    expect((await request(t.app).get('/api/agents/campaigns').set(a)).body.campaigns).toHaveLength(1);
    await request(t.app).put('/api/agents/mine').set(t.s).send({ paused: true }).expect(200);
    expect((await request(t.app).get('/api/agents/campaigns').set(a)).body.campaigns).toHaveLength(0);
  });
});

describe('seller: activity and earnings', () => {
  it('derives outcomes from decisions, settlement payouts and refunds', async () => {
    const t = await setup();
    const { agentId } = await t.register();
    const paid = await t.newCampaign(); const pending = await t.newCampaign(); const skipped = await t.newCampaign(); const refunded = await t.newCampaign();
    await t.setState(paid.campaignId, 'SETTLED'); await t.setState(pending.campaignId, 'ACTIVE');
    await t.setState(skipped.campaignId, 'ACTIVE'); await t.setState(refunded.campaignId, 'REFUNDED');
    await t.decide(paid.campaignId, agentId, 'answer'); await t.decide(pending.campaignId, agentId, 'answer');
    await t.decide(skipped.campaignId, agentId, 'abstain', 'blocked category: spending'); await t.decide(refunded.campaignId, agentId, 'answer');
    await t.report(paid.campaignId, [{ address: t.seller.address, lamports: '1500000' }]);
    await t.report(refunded.campaignId, []); // cohort too small: CRE's zero-count report precedes the refund

    const { items, totals } = (await request(t.app).get('/api/agents/mine/activity').set(t.s).expect(200)).body;
    const by = (id: string) => items.find((i: { campaignId: string }) => i.campaignId === id);
    expect(by(paid.campaignId)).toMatchObject({ kind: 'answer', outcome: 'paid', payoutLamports: '1500000' });
    expect(by(pending.campaignId)).toMatchObject({ kind: 'answer', outcome: 'pending' });
    expect(by(skipped.campaignId)).toMatchObject({ kind: 'abstain', reason: 'blocked category: spending', outcome: 'abstained' });
    expect(by(refunded.campaignId)).toMatchObject({ outcome: 'not_paid', notPaidReason: 'cohort too small, budget refunded' });
    expect(totals).toMatchObject({ earnedLamports: '1500000', pendingLamports: '1500000', seen: 4, answered: 3, abstained: 1,
      abstainReasons: { blocked_category: 1, category_not_allowed: 0, reward_below_minimum: 0, daily_limit: 0, no_matching_profile: 0, other: 0 }, todayCount: 3 });
    expect(totals.earningsByDay).toHaveLength(30);
    expect(totals.earningsByDay.at(-1).lamports).toBe('1500000');
  });
});

describe('buyer: campaign list', () => {
  it('lists only my campaigns, and needs a session', async () => {
    const t = await setup();
    const mine = await t.newCampaign();
    const res = await request(t.app).get('/api/campaigns?mine=1').set(t.b).expect(200);
    expect(res.body.campaigns.map((c: { campaignId: string }) => c.campaignId)).toEqual([mine.campaignId]);
    expect((await request(t.app).get('/api/campaigns?mine=1').set(t.s).expect(200)).body.campaigns).toEqual([]);
    await request(t.app).get('/api/campaigns?mine=1').expect(401);
  });
  it('latest public campaign for the landing page', async () => {
    const t = await setup();
    const c = await t.newCampaign();
    expect((await request(t.app).get('/api/campaigns?latest=1').expect(200)).body.campaigns).toEqual([]);
    await t.setState(c.campaignId, 'ACTIVE');
    expect((await request(t.app).get('/api/campaigns?latest=1').expect(200)).body.campaigns[0].campaignId).toBe(c.campaignId);
  });
});

describe('buyer: refund escape hatch', () => {
  it('is refused before refund_after, then builds and submits the company refund', async () => {
    const t = await setup();
    const c = await t.newCampaign();
    await t.setState(c.campaignId, 'SETTLEMENT_FAILED', `, escrow_tx_ref = '${campaignEscrowAddress(t.deps.chain.programId, c.campaignId)}'`);
    const build = () => request(t.app).post(`/api/campaigns/${c.campaignId}/refund/build`).set(t.b).send({});
    expect((await build().expect(409)).body.code).toBe('REFUND_NOT_OPEN');
    t.clock.now += 3_600_000 + 7_200_000 + 120_000;
    // the settle window is 24 h, so 2 h after the deadline is still too early
    expect((await build().expect(409)).body.code).toBe('REFUND_NOT_OPEN');
    t.clock.now += 86_400_000;
    t.b.Authorization = `Bearer ${await login(t.app, t.buyer)}`; // the 24 h sign-in sessions lapsed with the clock jump
    t.s.Authorization = `Bearer ${await login(t.app, t.seller)}`;
    const built = (await build().expect(200)).body;
    expect(Transaction.from(Buffer.from(built.unsignedTx, 'base64')).feePayer?.toBase58()).toBe(t.buyer.address);
    const signed = t.buyer.signTx(built.unsignedTx);
    await request(t.app).post(`/api/campaigns/${c.campaignId}/refund/submit`).set(t.s).send({ signedTx: signed }).expect(403);
    const sub = (await request(t.app).post(`/api/campaigns/${c.campaignId}/refund/submit`).set(t.b).send({ signedTx: signed }).expect(200)).body;
    const view = (await request(t.app).get(`/api/campaigns/${c.campaignId}`)).body;
    expect(view).toMatchObject({ state: 'REFUNDED', settlementTxHash: sub.txHash });
  });
  it('is refused for a settled campaign', async () => {
    const t = await setup();
    const c = await t.newCampaign();
    await t.setState(c.campaignId, 'SETTLED');
    t.clock.now += 20_000_000;
    await request(t.app).post(`/api/campaigns/${c.campaignId}/refund/build`).set(t.b).send({}).expect(409);
  });
});

describe('dev view: trace', () => {
  it('returns the technical trace; the research report only for the buyer', async () => {
    const t = await setup();
    const c = await t.newCampaign();
    await t.setState(c.campaignId, 'SETTLED', `, fund_tx_hash = '${'a'.repeat(64)}', settlement_tx_hash = '${'b'.repeat(64)}'`);
    await t.report(c.campaignId, [{ address: t.seller.address, lamports: '1500000' }]);
    t.chainState.txs['b'.repeat(64)] = { signature: 'b'.repeat(64), slot: 2, blockTime: 1_791_000_000, fee: '10000', err: null,
      instructions: [{ program: 'ed25519-verify', programId: 'Ed25519SigVerify111111111111111111111111111', name: '' },
        { program: 'campaign_escrow', programId: t.deps.chain.programId, name: 'settle' }], logMessages: ['Program log: Instruction: Settle'] };
    const pub = (await request(t.app).get(`/api/campaigns/${c.campaignId}/trace`).expect(200)).body;
    expect(pub).toMatchObject({ state: 'SETTLED', spec: { title: 'State of agent payments & tools' }, settlementReport: { acceptedCount: 1 }, researchReport: null });
    expect(pub.fundTx).toMatchObject({ signature: 'a'.repeat(64) });
    expect(pub.settlementTx.instructions.at(-1)).toMatchObject({ program: 'campaign_escrow', name: 'settle' });
    expect(pub.escrow).toBeNull(); // not funded
    const own = (await request(t.app).get(`/api/campaigns/${c.campaignId}/trace`).set(t.b).expect(200)).body;
    expect(own.researchReport.validRespondents).toBe(1);
    expect(JSON.stringify(pub)).not.toContain('access_token');
  });
  it('public config exposes the on-chain identifiers for the dev strip', async () => {
    const t = await setup();
    const cfg = (await request(t.app).get('/api/config/public').expect(200)).body;
    expect(cfg).toMatchObject({ cluster: 'devnet', programId: t.deps.chain.programId, relayerAddress: t.deps.chain.relayerAddress,
      platformFeeUsdc: 0, platformFeePayTo: null, reportPublicKey: t.deps.config.reportPublicKey, rpcUrl: 'https://api.devnet.solana.com' });
  });
});

describe('campaign view: agent tiles for the aquarium', () => {
  it('lists each decision under a per-campaign pseudonym, never the agent id or address', async () => {
    const t = await setup();
    const { agentId } = await t.register();
    const a = await t.newCampaign(); const b = await t.newCampaign();
    await t.setState(a.campaignId, 'ACTIVE'); await t.setState(b.campaignId, 'ACTIVE');
    await t.decide(a.campaignId, agentId, 'abstain', 'blocked category: spending');
    await t.decide(b.campaignId, agentId, 'answer');
    const va = (await request(t.app).get(`/api/campaigns/${a.campaignId}`)).body;
    const vb = (await request(t.app).get(`/api/campaigns/${b.campaignId}`)).body;
    expect(va.agents).toEqual([{ tag: expect.stringMatching(/^agt_[0-9a-f]{6}$/), kind: 'abstain', reason: 'blocked category: spending', live: true, personhood: null }]);
    expect(vb.agents[0]).toMatchObject({ kind: 'answer', reason: null });
    expect(vb.agents[0].tag).not.toBe(va.agents[0].tag); // not linkable across campaigns
    expect(va.networkSize).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(va)).not.toContain(agentId);
    expect(JSON.stringify(va)).not.toContain(t.seller.address);
  });
});

describe('review fixes', () => {
  it("refund submit refuses a tx that is not the buyer's refund of this escrow", async () => {
    const t = await setup();
    const c = await t.newCampaign();
    const other = await t.newCampaign();
    await t.setState(c.campaignId, 'SETTLEMENT_FAILED', `, escrow_tx_ref = '${campaignEscrowAddress(t.deps.chain.programId, c.campaignId)}'`);
    t.clock.now += 3_600_000 + 86_400_000 + 120_000;
    t.b.Authorization = `Bearer ${await login(t.app, t.buyer)}`; // the 24 h sign-in session lapsed with the clock jump
    const submit = (signedTx: string) => request(t.app).post(`/api/campaigns/${c.campaignId}/refund/submit`).set(t.b).send({ signedTx });
    const otherRefund = (await t.deps.chain.buildRefundTx(other.campaignId, t.buyer.address)).unsignedTx;
    expect((await submit(t.buyer.signTx(otherRefund)).expect(422)).body.code).toBe('NOT_A_REFUND'); // another campaign's escrow
    const ownRefund = (await t.deps.chain.buildRefundTx(c.campaignId, t.buyer.address)).unsignedTx;
    expect((await submit(ownRefund).expect(422)).body.code).toBe('NOT_A_REFUND'); // unsigned
    const fund = (await t.deps.chain.buildFundTx({ campaignId: c.campaignId, company: t.buyer.address, reportPk: t.deps.config.reportPublicKey,
      rewardLamports: 1n, budgetLamports: 1n, maxResponses: 1, minCohort: 1, deadlineMs: 0, refundAfterMs: 1 })).unsignedTx;
    const res = await submit(t.buyer.signTx(fund)).expect(422); // an escrow instruction, but not refund
    expect(res.body.code).toBe('NOT_A_REFUND');
    expect((await request(t.app).get(`/api/campaigns/${c.campaignId}`)).body.state).toBe('SETTLEMENT_FAILED');
  });
  it('a buyer reclaim after answers were accepted is not reported as "cohort too small"', async () => {
    const t = await setup();
    const { agentId } = await t.register();
    const c = await t.newCampaign();
    await t.setState(c.campaignId, 'REFUNDED');
    await t.decide(c.campaignId, agentId, 'answer');
    await t.report(c.campaignId, [{ address: t.seller.address, lamports: '1500000' }]);
    const { items } = (await request(t.app).get('/api/agents/mine/activity').set(t.s)).body;
    expect(items[0]).toMatchObject({ outcome: 'not_paid', notPaidReason: 'budget reclaimed by the buyer before payout' });
  });
  it('a paused agent cannot decide or answer, over REST or the relay', async () => {
    const t = await setup();
    const { agentToken } = await t.register();
    const c = await t.newCampaign();
    await t.setState(c.campaignId, 'ACTIVE');
    await request(t.app).put('/api/agents/mine').set(t.s).send({ paused: true }).expect(200);
    const res = await request(t.app).post(`/api/agents/campaigns/${c.campaignId}/decision`).set({ Authorization: `Bearer ${agentToken}` }).send({ kind: 'abstain', reason: 'x' }).expect(409);
    expect(res.body.code).toBe('AGENT_PAUSED');
  });
  it('a new token resets "last seen", so a disconnected agent stops showing as connected', async () => {
    const t = await setup();
    const { agentToken } = await t.register();
    await request(t.app).get('/api/agents/me').set({ Authorization: `Bearer ${agentToken}` }).expect(200);
    expect((await request(t.app).get('/api/agents/mine').set(t.s)).body.agent.connected).toBe(true);
    await t.register();
    expect((await request(t.app).get('/api/agents/mine').set(t.s)).body.agent).toMatchObject({ connected: false, lastSeenAt: null });
  });
});

describe("encrypt to self: the owner's transcript", () => {
  const owner = transcriptKeyFromSignature('aa'.repeat(80));
  it('stores the transcript public key once; a different wallet key is refused', async () => {
    const t = await setup();
    const { agentToken } = await t.register();
    await request(t.app).put('/api/agents/mine/transcript-key').set(t.s).send({ publicKey: owner.publicKey }).expect(200);
    await request(t.app).put('/api/agents/mine/transcript-key').set(t.s).send({ publicKey: owner.publicKey }).expect(200);
    const res = await request(t.app).put('/api/agents/mine/transcript-key').set(t.s).send({ publicKey: 'ab'.repeat(32) }).expect(409);
    expect(res.body.code).toBe('KEY_MISMATCH');
    expect((await request(t.app).get('/api/agents/me').set({ Authorization: `Bearer ${agentToken}` })).body.transcriptPublicKey).toBe(owner.publicKey);
  });
  it('an agent uploads its owner copy next to a real answer; the owner lists the ciphertexts', async () => {
    const t = await setup();
    const { agentToken } = await t.register();
    const a = { Authorization: `Bearer ${agentToken}` };
    const c = await t.newCampaign();
    await t.setState(c.campaignId, 'ACTIVE');
    const copy = sealEnvelope(owner.publicKey, c.campaignId, t.seller.address, { q1: 1, q2: 4, q3: 0 });
    expect((await request(t.app).post(`/api/agents/campaigns/${c.campaignId}/answer-copy`).set(a).send(copy).expect(409)).body.code).toBe('NO_ANSWER');
    await request(t.app).post(`/api/agents/campaigns/${c.campaignId}/envelope`).set(a).send(sealEnvelope(keys.encPk, c.campaignId, t.seller.address, { q1: 1, q2: 4, q3: 0 })).expect(204);
    await request(t.app).post(`/api/agents/campaigns/${c.campaignId}/answer-copy`).set(a).send(copy).expect(204);
    const { copies } = (await request(t.app).get('/api/agents/mine/answer-copies').set(t.s).expect(200)).body;
    expect(copies).toHaveLength(1);
    expect(copies[0]).toMatchObject({ campaignId: c.campaignId, title: 'State of agent payments & tools', envelope: copy });
    expect(copies[0].questions).toHaveLength(3);
    await request(t.app).get('/api/agents/mine/answer-copies').set(t.b).expect(200).then((r) => expect(r.body.copies).toEqual([]));
  });
});

describe('audience filtering', () => {
  it('agents see the campaign audience; synthetic agents outside it abstain with "no matching profile"', async () => {
    const t = await setup();
    const { agentToken } = await t.register();
    const c = await t.newCampaign();
    await t.setState(c.campaignId, 'ACTIVE');
    const [view] = (await request(t.app).get('/api/agents/campaigns').set({ Authorization: `Bearer ${agentToken}` })).body.campaigns;
    expect(view.audience).toEqual({ country: ['MY'], ageBand: ['25-34'] });
    const outsider = SYNTHETIC_AGENTS.find((x) => x.audience.country !== 'MY')!;
    // Policy is checked first; give the outsider an allow-all policy so the audience check is what decides.
    expect(decide({ ...outsider, policy: SYNTHETIC_AGENTS[0]!.policy }, view, 0)).toMatchObject({ kind: 'abstain', reason: 'no matching profile: country' });
  });
});

describe('analytics', () => {
  it('seller totals break down by category', async () => {
    const t = await setup();
    const { agentId } = await t.register();
    const c = await t.newCampaign();
    await t.setState(c.campaignId, 'SETTLED');
    await t.decide(c.campaignId, agentId, 'answer');
    await t.report(c.campaignId, [{ address: t.seller.address, lamports: '1500000' }]);
    const { totals } = (await request(t.app).get('/api/agents/mine/activity').set(t.s)).body;
    expect(totals.byCategory).toEqual([{ category: 'payments', seen: 1, answered: 1, earnedLamports: '1500000' }]);
  });
  it('buyer dashboard aggregates spend, payouts, refunds, categories and why agents declined', async () => {
    const t = await setup();
    const { agentId } = await t.register();
    const settled = await t.newCampaign(); const refunded = await t.newCampaign(); await t.newCampaign();
    await t.setState(settled.campaignId, 'SETTLED'); await t.setState(refunded.campaignId, 'REFUNDED');
    await t.report(settled.campaignId, [{ address: t.seller.address, lamports: '1500000' }]);
    await t.env.deps.db.query(`update reports set settlement = settlement || '{"payoutTotalLamports":"1500000","refundLamports":"28500000","escrowedLamports":"30000000"}'::jsonb where campaign_id = $1`, [settled.campaignId]);
    await t.report(refunded.campaignId, []);
    await t.decide(refunded.campaignId, agentId, 'abstain', 'blocked category: spending');
    const a = (await request(t.app).get('/api/campaigns/analytics').set(t.b).expect(200)).body;
    expect(a).toMatchObject({ campaigns: 3, funded: 2, budgetLockedLamports: '60000000', paidOutLamports: '1500000', refundedLamports: '58500000',
      acceptedAnswers: 1, costPerAnswerLamports: '1500000', byState: { SETTLED: 1, REFUNDED: 1, AWAITING_FUNDING: 1 },
      declines: { blocked_category: 1 }, topDeclineReasons: [{ reason: 'blocked category: spending', count: 1 }] });
    expect(a.byCategory[0]).toMatchObject({ category: 'payments', campaigns: 3, acceptedAnswers: 1, paidLamports: '1500000' });
    expect(a.payoutsByDay).toHaveLength(30);
    await request(t.app).get('/api/campaigns/analytics').expect(401);
  });
});

describe('seller: agent presence (online / idle / offline)', () => {
  it('reports online within 2 minutes, idle within 24 hours, offline after that or never', async () => {
    const t = await setup();
    const { agentToken } = await t.register();
    const status = async () => (await request(t.app).get('/api/agents/mine').set(t.s).expect(200)).body.agent.status;
    expect(await status()).toBe('offline'); // never checked in
    await request(t.app).get('/api/agents/me').set({ Authorization: `Bearer ${agentToken}` }).expect(200); // any agent call = check-in
    expect(await status()).toBe('online');
    const seen = Date.now();
    const at = async (ms: number) => { await t.deps.db.query(`update agents set last_seen_at = to_timestamp($1 / 1000.0)`, [seen]); t.clock.now = seen + ms; return status(); };
    expect(await at(119_000)).toBe('online');
    expect(await at(121_000)).toBe('idle');
    expect(await at(23 * 3_600_000)).toBe('idle');
    await t.deps.db.query(`update agents set last_seen_at = to_timestamp($1 / 1000.0)`, [seen]);
    t.clock.now = seen + 25 * 3_600_000;
    t.s.Authorization = `Bearer ${await login(t.app, t.seller)}`; // the 24 h sign-in session lapsed with the clock jump
    expect(await status()).toBe('offline');
  });
});
