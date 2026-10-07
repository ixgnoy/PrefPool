// server/test/relay.test.ts
import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { tick } from '../src/lifecycle.js';
import { ensureSyntheticAgents, startSyntheticAgents } from '../src/synthetic.js';
import { demoSpec, escrowFor, listen, login, makeDeps, wallet } from './helpers.js';

const SECRET = 's'.repeat(64);
const until = async (cond: () => Promise<boolean>, ms = 15_000) => {
  const end = Date.now() + ms;
  while (!(await cond())) { if (Date.now() > end) throw new Error('timeout'); await new Promise((r) => setTimeout(r, 100)); }
};

describe('synthetic agents over the real WebSocket relay', () => {
  it('29 agents receive the demo campaign: 22 answer with envelopes, 7 abstain with reasons', async () => {
    const { app, deps, clock, chainState, relayRef } = await makeDeps(Date.now());
    const srv = await listen(app, deps, relayRef);
    await ensureSyntheticAgents(deps.db, SECRET);
    const agents = startSyntheticAgents(srv.wsUrl, SECRET, { maxDelayMs: 200 });

    const buyer = await wallet();
    const auth = { Authorization: `Bearer ${await login(app, buyer)}` };
    const deadline = clock.now + 600_000;
    const { body } = await request(app).post('/api/campaigns').set(auth).send(demoSpec(deadline)).expect(201);
    const b = await request(app).post(`/api/campaigns/${body.campaignId}/fund/build`).set(auth).send({});
    await request(app).post(`/api/campaigns/${body.campaignId}/fund/submit`).set(auth).send({ signedTx: buyer.signTx(b.body.unsignedTx) }).expect(200);
    chainState.escrow = escrowFor(chainState.built[0]!);
    await tick(deps);
    await tick(deps); // ACTIVE -> broadcast to connected agents

    const view = async () => (await request(app).get(`/api/campaigns/${body.campaignId}`)).body;
    await until(async () => { const v = await view(); return v.envelopes + v.abstained.reduce((s: number, a: { count: number }) => s + a.count, 0) === 29; });
    const v = await view();
    expect(v.envelopes).toBe(22);
    expect(v.answered).toBe(22);
    expect(Object.fromEntries(v.abstained.map((a: { reason: string; count: number }) => [a.reason, a.count]))).toEqual({
      'blocked category: spending': 4,
      'category not allowed: payments': 2,
      'reward 0.0015 SOL below minimum 0.002 SOL': 1,
    });
    agents.stop();
    await srv.close();
  }, 30_000);
});
