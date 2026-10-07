// server/test/calibration.test.ts: owner-vs-agent calibration (spec 2026-10-07-agent-calibration-design.md).
import { describe, expect, it } from 'vitest';
import { pgliteDb } from './helpers.js';

const CATEGORIES = ['habits', 'food', 'shopping', 'tech', 'travel', 'media'];

describe('calibration bank (seeded by migration)', () => {
  it('has 200 active, well-formed, low-sensitivity questions', async () => {
    const db = await pgliteDb();
    const rows = await db.query<{ id: string; type: string; options: string[] | null; category: string; prior: number[]; active: boolean; bank_version: number }>(
      `select id, type, options, category, prior, active, bank_version from calibration_questions`);
    expect(rows).toHaveLength(200);
    expect(new Set(rows.map((r) => r.id)).size).toBe(200);
    for (const r of rows) {
      expect(r.active && r.bank_version === 1, r.id).toBe(true);
      expect(CATEGORIES, r.id).toContain(r.category);
      if (r.type === 'single_choice') {
        expect(r.options!.length, r.id).toBeGreaterThanOrEqual(2);
        expect(r.options!.length, r.id).toBeLessThanOrEqual(5);
        expect(r.prior.length, r.id).toBe(r.options!.length);
      } else {
        expect(r.type, r.id).toBe('likert_5');
        expect(r.prior.length, r.id).toBe(5);
      }
      expect(Math.abs(r.prior.reduce((a, b) => a + b, 0) - 1), r.id).toBeLessThan(0.01);
    }
  });
});

// ---- rounds --------------------------------------------------------------------------------------------------------
import request from 'supertest';
import { CRE_TOKEN, demoSpec, keys, login, makeDeps, wallet } from './helpers.js';
import { majorityAnswer, sealEnvelope, type CalibrationQuestion } from '@as/shared';
import { calibrationTick } from '../src/calibration.js';
import { ensureSyntheticAgents } from '../src/synthetic.js';

type Q = { id: string; type: 'single_choice' | 'likert_5'; options?: string[] };
const MIN = 60_000, DAY = 86_400_000;

async function setup(kind: 'plugin' | 'live' = 'plugin') {
  const env = await makeDeps(Date.now());
  const seller = await wallet();
  const s = { Authorization: `Bearer ${await login(env.app, seller)}` };
  const { body } = await request(env.app).post('/api/agents/register').set(s).send({ kind }).expect(200);
  const a = { Authorization: `Bearer ${body.agentToken}` };
  return { ...env, seller, s, a, agentId: body.agentId as string };
}
/** An owner whose answers differ from "a typical person" on every question, so a perfect agent clearly passes. */
async function ownerAnswers(t: Awaited<ReturnType<typeof setup>>, qs: Q[]) {
  const rows = await t.deps.db.query<CalibrationQuestion>(`select id, text, type, options, category, prior from calibration_questions where id = any($1)`, [qs.map((q) => q.id)]);
  return Object.fromEntries(rows.map((q) => {
    const m = majorityAnswer(q, undefined);
    return [q.id, q.type === 'likert_5' ? (m >= 3 ? 1 : 5) : m === 0 ? 1 : 0];
  }));
}
const pending = async (t: Awaited<ReturnType<typeof setup>>) => (await request(t.app).get('/api/agents/calibration').set(t.a).expect(200)).body;

describe('calibration rounds', () => {
  it('starts a round at onboarding (first plugin registration), once', async () => {
    const t = await setup();
    const p = await pending(t);
    expect(p.round.questions).toHaveLength(15);
    const perCat = new Map<string, number>();
    const cats = await t.deps.db.query<{ category: string }>(`select category from calibration_questions where id = any($1)`, [p.round.questions.map((q: Q) => q.id)]);
    for (const c of cats) perCat.set(c.category, (perCat.get(c.category) ?? 0) + 1);
    expect(Math.max(...perCat.values())).toBeLessThanOrEqual(4);
    await request(t.app).post('/api/agents/register').set(t.s).send({ kind: 'plugin' }).expect(200);
    expect((await t.deps.db.query(`select id from calibration_rounds`))).toHaveLength(1);
  });

  it('is not offered to the web demo agent', async () => {
    const t = await setup('live');
    expect((await t.deps.db.query(`select id from calibration_rounds`))).toHaveLength(0);
    expect((await request(t.app).post('/api/agents/mine/calibration').set(t.s).expect(409)).body.code).toBe('NOT_CALIBRATABLE');
  });

  it('runs agent first, owner second, scores, keeps no answers, and calibrates for 30 days', async () => {
    const t = await setup();
    const { round } = await pending(t);
    const owner = await ownerAnswers(t, round.questions);
    expect((await request(t.app).post(`/api/agents/mine/calibration/${round.roundId}/open`).set(t.s).expect(409)).body.code).toBe('AGENT_NOT_READY');
    await request(t.app).post(`/api/agents/calibration/${round.roundId}/answers`).set(t.a).send({ answers: owner }).expect(204);
    expect((await request(t.app).post(`/api/agents/calibration/${round.roundId}/answers`).set(t.a).send({ answers: owner }).expect(409)).body.code).toBe('ALREADY_ANSWERED');
    const status = await request(t.app).get('/api/agents/mine/calibration').set(t.s).expect(200);
    expect(status.body.round.state).toBe('AGENT_ANSWERED');
    const opened = await request(t.app).post(`/api/agents/mine/calibration/${round.roundId}/open`).set(t.s).expect(200);
    expect(opened.body.questions).toHaveLength(15);
    expect(JSON.stringify(opened.body) + JSON.stringify(status.body)).not.toMatch(/agent_?answers/i);
    const res = await request(t.app).post(`/api/agents/mine/calibration/${round.roundId}/answers`).set(t.s).send({ answers: owner }).expect(200);
    expect(res.body.result).toMatchObject({ agreement: 1, passed: true });
    expect(res.body.result.lift).toBeGreaterThanOrEqual(0.2);
    await request(t.app).post(`/api/agents/mine/calibration/${round.roundId}/answers`).set(t.s).send({ answers: owner }).expect(409);
    const [r] = await t.deps.db.query<{ agent_answers: unknown; state: string }>(`select agent_answers, state from calibration_rounds`);
    expect(r).toEqual({ agent_answers: null, state: 'SCORED' });
    expect(Number((await t.deps.db.query<{ n: string }>(`select sum(n) as n from calibration_counts`))[0]!.n)).toBe(15);
    expect(await t.deps.db.query(`select 1 from calibration_seen`)).toHaveLength(15);
    const mine = (await request(t.app).get('/api/agents/mine').set(t.s).expect(200)).body.agent;
    expect(mine.calibration.calibratedUntil).toBeGreaterThan(t.clock.now + 29 * DAY);
  });

  it('fails a generic agent that only gives popular answers', async () => {
    const t = await setup();
    const { round } = await pending(t);
    const rows = await t.deps.db.query<CalibrationQuestion>(`select id, text, type, options, category, prior from calibration_questions where id = any($1)`, [round.questions.map((q: Q) => q.id)]);
    const generic = Object.fromEntries(rows.map((q) => [q.id, majorityAnswer(q, undefined)]));
    await request(t.app).post(`/api/agents/calibration/${round.roundId}/answers`).set(t.a).send({ answers: generic }).expect(204);
    await request(t.app).post(`/api/agents/mine/calibration/${round.roundId}/open`).set(t.s).expect(200);
    const res = await request(t.app).post(`/api/agents/mine/calibration/${round.roundId}/answers`).set(t.s).send({ answers: await ownerAnswers(t, round.questions) }).expect(200);
    expect(res.body.result.passed).toBe(false);
    expect((await request(t.app).get('/api/agents/mine').set(t.s)).body.agent.calibration.calibratedUntil).toBeNull();
  });

  it('rejects malformed agent answers and keeps the round open', async () => {
    const t = await setup();
    const { round } = await pending(t);
    const ok = Object.fromEntries(round.questions.map((q: Q) => [q.id, 'unknown']));
    const bad = (answers: object) => request(t.app).post(`/api/agents/calibration/${round.roundId}/answers`).set(t.a).send({ answers }).expect(422);
    const [first] = round.questions as Q[];
    await bad({ ...ok, [first!.id]: first!.type === 'likert_5' ? 9 : 99 });
    await bad({ ...ok, 'cb-999': 0 });
    const { [first!.id]: _drop, ...missing } = ok;
    await bad(missing);
    expect((await pending(t)).round.roundId).toBe(round.roundId);
    await request(t.app).post(`/api/agents/calibration/${round.roundId}/answers`).set(t.a).send({ answers: ok }).expect(204);
  });

  it('expires an owner answer after 10 minutes', async () => {
    const t = await setup();
    const { round } = await pending(t);
    const owner = await ownerAnswers(t, round.questions);
    await request(t.app).post(`/api/agents/calibration/${round.roundId}/answers`).set(t.a).send({ answers: owner }).expect(204);
    await request(t.app).post(`/api/agents/mine/calibration/${round.roundId}/open`).set(t.s).expect(200);
    t.clock.now += 11 * MIN;
    expect((await request(t.app).post(`/api/agents/mine/calibration/${round.roundId}/answers`).set(t.s).send({ answers: owner }).expect(409)).body.code).toBe('EXPIRED');
    expect((await t.deps.db.query<{ state: string }>(`select state from calibration_rounds`))[0]!.state).toBe('EXPIRED');
  });

  it('tick expires stale rounds, spares an owner mid-answer, and renews an expired pass', async () => {
    const t = await setup();
    t.clock.now += 25 * 60 * MIN;
    await calibrationTick(t.deps);
    expect((await t.deps.db.query<{ state: string }>(`select state from calibration_rounds`))[0]!.state).toBe('EXPIRED');
    t.s.Authorization = `Bearer ${await login(t.app, t.seller)}`; // the 24 h sign-in session lapsed with the clock jump
    const { body } = await request(t.app).post('/api/agents/mine/calibration').set(t.s).expect(201);
    const { round } = await pending(t);
    expect(round.roundId).toBe(body.roundId);
    await request(t.app).post(`/api/agents/calibration/${round.roundId}/answers`).set(t.a).send({ answers: await ownerAnswers(t, round.questions) }).expect(204);
    await request(t.app).post(`/api/agents/mine/calibration/${round.roundId}/open`).set(t.s).expect(200);
    t.clock.now += 5 * MIN;
    await calibrationTick(t.deps);
    expect((await t.deps.db.query<{ state: string }>(`select state from calibration_rounds where id = $1`, [round.roundId]))[0]!.state).toBe('OWNER_ANSWERING');
    await t.deps.db.query(`update calibration_rounds set state = 'SCORED' where id = $1`, [round.roundId]);
    await t.deps.db.query(`update agents set calibrated_until = to_timestamp($1 / 1000.0) where id = $2`, [t.clock.now - MIN, t.agentId]);
    await calibrationTick(t.deps);
    expect((await pending(t)).round).not.toBeNull();
    expect((await request(t.app).post('/api/agents/mine/calibration').set(t.s).expect(409)).body.code).toBe('ROUND_OPEN');
  });

  it('gives synthetic agents a simulated pass', async () => {
    const t = await setup();
    await ensureSyntheticAgents(t.deps.db, 's'.repeat(64));
    const rows = await t.deps.db.query<{ ms: string }>(`select extract(epoch from calibrated_until) * 1000 as ms from agents where kind = 'synthetic'`);
    expect(rows.every((r) => Number(r.ms) > Date.now() + 300 * DAY)).toBe(true);
  });
});

describe('calibrated-agents-only campaigns', () => {
  async function campaign(t: Awaited<ReturnType<typeof setup>>) {
    const buyer = await wallet();
    const b = { Authorization: `Bearer ${await login(t.app, buyer)}` };
    const { body } = await request(t.app).post('/api/campaigns').set(b).send({ ...demoSpec(t.clock.now + 3_600_000), calibratedAgentsOnly: true }).expect(201);
    await t.deps.db.query(`update campaigns set state = 'ACTIVE', escrow_tx_ref = $2 where id = $1`, [body.campaignId, `${'ab'.repeat(32)}#0`]);
    return body.campaignId as string;
  }
  it('refuses uncalibrated agents at the server and tells CRE who is calibrated', async () => {
    const t = await setup();
    const id = await campaign(t);
    const send = () => request(t.app).post(`/api/agents/campaigns/${id}/envelope`).set(t.a).send(sealEnvelope(keys.encPk, id, t.seller.address, { q1: 0, q2: 4, q3: 1 }));
    expect((await send().expect(403)).body.code).toBe('UNCALIBRATED');
    const until = t.clock.now + 30 * DAY;
    await t.deps.db.query(`update agents set calibrated_until = to_timestamp($1 / 1000.0) where id = $2`, [until, t.agentId]);
    await send().expect(204);
    const ctx = (await request(t.app).get(`/api/cre/campaigns/${id}/context`).set({ Authorization: `Bearer ${CRE_TOKEN}` }).expect(200)).body;
    expect(ctx.calibratedAgentsOnly).toBe(true);
    expect(Math.abs(ctx.calibratedUntil[t.seller.address] - until)).toBeLessThan(1000);
    const { body: list } = await request(t.app).get('/api/agents/campaigns').set(t.a).expect(200);
    expect(list.campaigns[0].calibratedAgentsOnly).toBe(true);
    expect((await request(t.app).get(`/api/campaigns/${id}`).expect(200)).body.calibratedAgentsOnly).toBe(true);
  });
});

describe('final review fixes', () => {
  it('open cannot revive a round that was scored between its read and its write (race)', async () => {
    const t = await setup();
    const { round } = await pending(t);
    const owner = await ownerAnswers(t, round.questions);
    await request(t.app).post(`/api/agents/calibration/${round.roundId}/answers`).set(t.a).send({ answers: owner }).expect(204);
    await request(t.app).post(`/api/agents/mine/calibration/${round.roundId}/open`).set(t.s).expect(200);
    // Simulate a concurrent submit landing just before /open writes its update.
    const db = t.deps.db, query = db.query.bind(db);
    db.query = (async (sql: string, params?: unknown[]) => {
      if (/set state = 'OWNER_ANSWERING'/.test(sql)) await query(`update calibration_rounds set state = 'SCORED', agent_answers = null where id = $1`, [round.roundId]);
      return query(sql, params);
    }) as typeof db.query;
    await request(t.app).post(`/api/agents/mine/calibration/${round.roundId}/open`).set(t.s).expect(409);
    db.query = query;
    expect((await t.deps.db.query<{ state: string }>(`select state from calibration_rounds`))[0]!.state).toBe('SCORED');
  });

  it('tick expiry deletes the agent\'s answers when the owner never answers', async () => {
    const t = await setup();
    const { round } = await pending(t);
    await request(t.app).post(`/api/agents/calibration/${round.roundId}/answers`).set(t.a).send({ answers: await ownerAnswers(t, round.questions) }).expect(204);
    t.clock.now += 8 * DAY;
    await calibrationTick(t.deps);
    expect((await t.deps.db.query(`select state, agent_answers from calibration_rounds`))[0]).toEqual({ state: 'EXPIRED', agent_answers: null });
  });

  it('a failure starting the onboarding round never breaks registration (the new token still works)', async () => {
    const env = await makeDeps(Date.now());
    const seller = await wallet();
    const s = { Authorization: `Bearer ${await login(env.app, seller)}` };
    const db = env.deps.db, query = db.query.bind(db);
    db.query = (async (sql: string, params?: unknown[]) => {
      if (/from calibration_rounds/.test(sql)) throw new Error('relation "calibration_rounds" does not exist');
      return query(sql, params);
    }) as typeof db.query;
    const { body } = await request(env.app).post('/api/agents/register').set(s).send({ kind: 'plugin' }).expect(200);
    db.query = query;
    await request(env.app).get('/api/agents/me').set({ Authorization: `Bearer ${body.agentToken}` }).expect(200);
  });
});
