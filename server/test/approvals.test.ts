// server/test/approvals.test.ts
import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { sealEnvelope, transcriptKeyFromSignature, type CampaignDatumFields } from '@as/shared';
import { tick } from '../src/lifecycle.js';
import { demoSpec, escrowFor, keys, login, makeDeps, wallet } from './helpers.js';

async function activeCampaign() {
  const env = await makeDeps(Date.now());
  const buyer = await wallet();
  const auth = { Authorization: `Bearer ${await login(env.app, buyer)}` };
  const deadline = env.clock.now + 600_000;
  const { body } = await request(env.app).post('/api/campaigns').set(auth).send(demoSpec(deadline));
  const b = await request(env.app).post(`/api/campaigns/${body.campaignId}/fund/build`).set(auth).send({}).expect(200);
  await request(env.app).post(`/api/campaigns/${body.campaignId}/fund/submit`).set(auth).send({ signedTx: buyer.signTx(b.body.unsignedTx) }).expect(200);
  const datum: CampaignDatumFields = { campaignId: body.campaignId, company: buyer.address, reportPk: env.deps.config.reportPublicKey,
    rewardLamports: 1_500_000n, budgetLamports: 30_000_000n, maxResponses: 20, minCohort: 15, deadlineMs: deadline, refundAfterMs: deadline + 86_400_000 };
  env.chainState.escrow = escrowFor(datum);
  await tick(env.deps); await tick(env.deps);
  const owner = await wallet();
  const session = await login(env.app, owner);
  const reg = await request(env.app).post('/api/agents/register').set({ Authorization: `Bearer ${session}` }).send({ kind: 'plugin' });
  const key = transcriptKeyFromSignature('ab'.repeat(64));
  await request(env.app).put('/api/agents/mine/transcript-key').set({ Authorization: `Bearer ${session}` }).send({ publicKey: key.publicKey }).expect(200);
  const copy = sealEnvelope(key.publicKey, body.campaignId, owner.address, { q1: 0, q2: 3, q3: 1 });
  return { app: env.app, deps: env.deps, clock: env.clock, deadline, campaignId: body.campaignId as string, owner, key, copy,
    web: { Authorization: `Bearer ${session}` }, agent: { Authorization: `Bearer ${reg.body.agentToken as string}` } };
}

describe('answer approvals', () => {
  it('queues the owner copy, lets the owner decide, and reports the state to the agent', async () => {
    const w = await activeCampaign();
    await request(w.app).post(`/api/agents/campaigns/${w.campaignId}/approval`).set(w.agent).send(w.copy).expect(204);
    const mine = await request(w.app).get('/api/agents/mine/approvals').set(w.web).expect(200);
    expect(mine.body.pending).toHaveLength(1);
    expect(mine.body.pending[0]).toMatchObject({ campaignId: w.campaignId, title: demoSpec(0).title, deadlineMs: w.deadline });
    expect(mine.body.pending[0].envelope).toEqual(w.copy);
    expect(mine.body.transcriptPublicKey).toBe(w.key.publicKey);
    let st = await request(w.app).get('/api/agents/approvals').set(w.agent).expect(200);
    expect(st.body.approvals).toEqual([{ campaignId: w.campaignId, state: 'pending' }]);
    await request(w.app).post(`/api/agents/mine/approvals/${w.campaignId}`).set(w.web).send({ decision: 'approve' }).expect(204);
    await request(w.app).post(`/api/agents/mine/approvals/${w.campaignId}`).set(w.web).send({ decision: 'reject' }).expect(404); // decided once
    st = await request(w.app).get('/api/agents/approvals').set(w.agent).expect(200);
    expect(st.body.approvals).toEqual([{ campaignId: w.campaignId, state: 'approved' }]);
    expect((await request(w.app).get('/api/agents/mine/approvals').set(w.web).expect(200)).body.pending).toEqual([]);
  });
  it('keeps the first request; a later copy does not replace it', async () => {
    const w = await activeCampaign();
    await request(w.app).post(`/api/agents/campaigns/${w.campaignId}/approval`).set(w.agent).send(w.copy).expect(204);
    const second = sealEnvelope(w.key.publicKey, w.campaignId, w.owner.address, { q1: 1, q2: 1, q3: 1 });
    await request(w.app).post(`/api/agents/campaigns/${w.campaignId}/approval`).set(w.agent).send(second).expect(204);
    expect((await request(w.app).get('/api/agents/mine/approvals').set(w.web)).body.pending[0].envelope).toEqual(w.copy);
  });
  it('lets the owner reject, and validates the decision', async () => {
    const w = await activeCampaign();
    await request(w.app).post(`/api/agents/campaigns/${w.campaignId}/approval`).set(w.agent).send(w.copy).expect(204);
    await request(w.app).post(`/api/agents/mine/approvals/${w.campaignId}`).set(w.web).send({ decision: 'maybe' }).expect(400);
    await request(w.app).post(`/api/agents/mine/approvals/${w.campaignId}`).set(w.web).send({ decision: 'reject' }).expect(204);
    expect((await request(w.app).get('/api/agents/approvals').set(w.agent)).body.approvals[0].state).toBe('rejected');
  });
  it("refuses a copy that is not the agent's own", async () => {
    const w = await activeCampaign();
    const other = await wallet();
    const copy = sealEnvelope(transcriptKeyFromSignature('cd'.repeat(64)).publicKey, w.campaignId, other.address, { q1: 0, q2: 3, q3: 1 });
    await request(w.app).post(`/api/agents/campaigns/${w.campaignId}/approval`).set(w.agent).send(copy).expect(403);
    await request(w.app).post(`/api/agents/campaigns/${'0'.repeat(64)}/approval`).set(w.agent).send(w.copy).expect(403); // campaign mismatch
  });
  it('refuses while paused, after answering, after an explicit abstain, and after the deadline', async () => {
    const paused = await activeCampaign();
    await request(paused.app).put('/api/agents/mine').set(paused.web).send({ paused: true }).expect(200);
    expect((await request(paused.app).post(`/api/agents/campaigns/${paused.campaignId}/approval`).set(paused.agent).send(paused.copy).expect(409)).body.code).toBe('AGENT_PAUSED');

    const answered = await activeCampaign();
    await request(answered.app).post(`/api/agents/campaigns/${answered.campaignId}/envelope`).set(answered.agent)
      .send(sealEnvelope(keys.encPk, answered.campaignId, answered.owner.address, { q1: 0, q2: 3, q3: 1 })).expect(204);
    expect((await request(answered.app).post(`/api/agents/campaigns/${answered.campaignId}/approval`).set(answered.agent).send(answered.copy).expect(409)).body.code).toBe('ANSWERED');

    const abstained = await activeCampaign();
    await request(abstained.app).post(`/api/agents/campaigns/${abstained.campaignId}/decision`).set(abstained.agent).send({ kind: 'abstain', reason: 'task request' }).expect(204);
    expect((await request(abstained.app).post(`/api/agents/campaigns/${abstained.campaignId}/approval`).set(abstained.agent).send(abstained.copy).expect(409)).body.code).toBe('ABSTAINED');

    const late = await activeCampaign();
    late.clock.now = late.deadline + 1;
    expect((await request(late.app).post(`/api/agents/campaigns/${late.campaignId}/approval`).set(late.agent).send(late.copy).expect(409)).body.code).toBe('LATE');
  });
  it('hides and freezes pending rows once the deadline passes', async () => {
    const w = await activeCampaign();
    await request(w.app).post(`/api/agents/campaigns/${w.campaignId}/approval`).set(w.agent).send(w.copy).expect(204);
    w.clock.now = w.deadline + 1;
    expect((await request(w.app).get('/api/agents/mine/approvals').set(w.web).expect(200)).body.pending).toEqual([]);
    await request(w.app).post(`/api/agents/mine/approvals/${w.campaignId}`).set(w.web).send({ decision: 'approve' }).expect(404);
  });
  it('refuses a direct envelope while the approval is pending or after the owner rejected it', async () => {
    const w = await activeCampaign();
    const env = sealEnvelope(keys.encPk, w.campaignId, w.owner.address, { q1: 0, q2: 3, q3: 1 });
    await request(w.app).post(`/api/agents/campaigns/${w.campaignId}/approval`).set(w.agent).send(w.copy).expect(204);
    expect((await request(w.app).post(`/api/agents/campaigns/${w.campaignId}/envelope`).set(w.agent).send(env).expect(409)).body.code).toBe('AWAITING_APPROVAL');
    await request(w.app).post(`/api/agents/mine/approvals/${w.campaignId}`).set(w.web).send({ decision: 'reject' }).expect(204);
    expect((await request(w.app).post(`/api/agents/campaigns/${w.campaignId}/envelope`).set(w.agent).send(env).expect(409)).body.code).toBe('REJECTED_BY_OWNER');

    const ok = await activeCampaign();
    await request(ok.app).post(`/api/agents/campaigns/${ok.campaignId}/approval`).set(ok.agent).send(ok.copy).expect(204);
    await request(ok.app).post(`/api/agents/mine/approvals/${ok.campaignId}`).set(ok.web).send({ decision: 'approve' }).expect(204);
    await request(ok.app).post(`/api/agents/campaigns/${ok.campaignId}/envelope`).set(ok.agent)
      .send(sealEnvelope(keys.encPk, ok.campaignId, ok.owner.address, { q1: 0, q2: 3, q3: 1 })).expect(204);
  });
  it('hides and freezes pending rows once the campaign leaves ACTIVE', async () => {
    const w = await activeCampaign();
    await request(w.app).post(`/api/agents/campaigns/${w.campaignId}/approval`).set(w.agent).send(w.copy).expect(204);
    await w.deps.db.query(`update campaigns set state = 'AGGREGATING' where id = $1`, [w.campaignId]);
    expect((await request(w.app).get('/api/agents/mine/approvals').set(w.web).expect(200)).body.pending).toEqual([]);
    await request(w.app).post(`/api/agents/mine/approvals/${w.campaignId}`).set(w.web).send({ decision: 'approve' }).expect(404);
  });
  it('needs a registered agent on the web side', async () => {
    const w = await activeCampaign();
    const stranger = { Authorization: `Bearer ${await login(w.app, await wallet())}` };
    await request(w.app).get('/api/agents/mine/approvals').set(stranger).expect(404);
  });
});
