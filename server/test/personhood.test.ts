// server/test/personhood.test.ts: World ID seller verification (spec 2026-10-07-world-id-personhood-design.md §2).
import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { hashSignal } from '@worldcoin/idkit-core/hashing';
import { sealEnvelope } from '@as/shared';
import { CRE_TOKEN, demoSpec, keys, login, makeDeps, wallet } from './helpers.js';
import { createHash } from 'node:crypto';
import { ensureSyntheticAgents } from '../src/synthetic.js';
import { SYNTHETIC_AGENTS } from '../src/syntheticProfiles.js';

const PERSONHOOD = { appId: 'app_test', rpId: 'rp_0123456789abcdef', signingKey: '11'.repeat(32), environment: 'staging' as const };
const proofFor = (address: string, action = 'cardanofish-seller') => ({
  protocol_version: '3.0', nonce: 'n', action, environment: 'staging',
  responses: [{ identifier: 'orb', signal_hash: hashSignal(address), proof: '0x01', merkle_root: '0x02', nullifier: '0x03' }],
});
const world = (body: object, status = 200) => vi.fn(async () => new Response(JSON.stringify(body), { status }));

async function setup(enabled = true) {
  const env = await makeDeps(Date.now());
  if (enabled) env.deps.config.personhood = PERSONHOOD;
  const seller = await wallet();
  const s = { Authorization: `Bearer ${await login(env.app, seller)}` };
  const register = () => request(env.app).post('/api/agents/register').set(s).send({ kind: 'live' }).expect(200);
  return { ...env, seller, s, register };
}

describe('POST /personhood/request', () => {
  it('signs a request for the seller action bound to the wallet', async () => {
    const t = await setup();
    await t.register();
    const { body } = await request(t.app).post('/api/personhood/request').set(t.s).expect(200);
    expect(body).toMatchObject({ appId: 'app_test', action: 'cardanofish-seller', environment: 'staging', signal: t.seller.address });
    expect(body.rpContext).toMatchObject({ rp_id: PERSONHOOD.rpId });
    expect(body.rpContext.signature).toMatch(/^0x[0-9a-f]+$/);
    expect(JSON.stringify(body)).not.toContain(PERSONHOOD.signingKey);
  });
  it('needs an agent first, and is off when World ID is not configured', async () => {
    const t = await setup();
    expect((await request(t.app).post('/api/personhood/request').set(t.s).expect(409)).body.code).toBe('NO_AGENT');
    const off = await setup(false);
    await off.register();
    expect((await request(off.app).post('/api/personhood/request').set(off.s).expect(404)).body.code).toBe('PERSONHOOD_DISABLED');
    expect((await request(off.app).get('/api/config/public').expect(200)).body.personhood).toBeNull();
  });
});

describe('POST /personhood/verify', () => {
  it('marks the agent as a verified human without exposing the nullifier', async () => {
    const t = await setup();
    await t.register();
    t.deps.worldFetch = world({ success: true, action: 'cardanofish-seller', nullifier: '0xABC' });
    await request(t.app).post('/api/personhood/verify').set(t.s).send(proofFor(t.seller.address)).expect(200);
    const mine = await request(t.app).get('/api/agents/mine').set(t.s).expect(200);
    expect(mine.body.agent.personhood).toMatchObject({ kind: 'world' });
    expect(JSON.stringify(mine.body)).not.toMatch(/0xabc/i);
    const [row] = await t.deps.db.query<{ personhood_nullifier: string }>(`select personhood_nullifier from agents`);
    expect(row!.personhood_nullifier).toBe('0xabc');
  });
  it('refuses a World ID already linked to another agent', async () => {
    const t = await setup();
    await t.register();
    t.deps.worldFetch = world({ success: true, action: 'cardanofish-seller', nullifier: '0xabc' });
    await request(t.app).post('/api/personhood/verify').set(t.s).send(proofFor(t.seller.address)).expect(200);
    const other = await wallet();
    const o = { Authorization: `Bearer ${await login(t.app, other)}` };
    await request(t.app).post('/api/agents/register').set(o).send({ kind: 'live' }).expect(200);
    const res = await request(t.app).post('/api/personhood/verify').set(o).send(proofFor(other.address)).expect(409);
    expect(res.body.code).toBe('HUMAN_ALREADY_LINKED');
  });
  it('verifying twice with the same World ID is idempotent; a different World ID is refused', async () => {
    const t = await setup();
    await t.register();
    t.deps.worldFetch = world({ success: true, action: 'cardanofish-seller', nullifier: '0xabc' });
    await request(t.app).post('/api/personhood/verify').set(t.s).send(proofFor(t.seller.address)).expect(200);
    await request(t.app).post('/api/personhood/verify').set(t.s).send(proofFor(t.seller.address)).expect(200);
    t.deps.worldFetch = world({ success: true, action: 'cardanofish-seller', nullifier: '0xdef' });
    expect((await request(t.app).post('/api/personhood/verify').set(t.s).send(proofFor(t.seller.address)).expect(409)).body.code).toBe('ALREADY_VERIFIED');
  });
  it('rejects a proof for another wallet or action without calling World', async () => {
    const t = await setup();
    await t.register();
    const f = world({ success: true, action: 'cardanofish-seller', nullifier: '0xabc' });
    t.deps.worldFetch = f;
    const other = await wallet();
    expect((await request(t.app).post('/api/personhood/verify').set(t.s).send(proofFor(other.address)).expect(422)).body.code).toBe('BAD_PROOF');
    expect((await request(t.app).post('/api/personhood/verify').set(t.s).send(proofFor(t.seller.address, 'campaign-1')).expect(422)).body.code).toBe('BAD_PROOF');
    expect(f).not.toHaveBeenCalled();
  });
  it('maps World rejections and outages', async () => {
    const t = await setup();
    await t.register();
    t.deps.worldFetch = world({ success: false, code: 'invalid_proof' }, 400);
    expect((await request(t.app).post('/api/personhood/verify').set(t.s).send(proofFor(t.seller.address)).expect(422)).body.code).toBe('WORLD_REJECTED');
    t.deps.worldFetch = vi.fn(async () => { throw new TypeError('fetch failed'); });
    expect((await request(t.app).post('/api/personhood/verify').set(t.s).send(proofFor(t.seller.address)).expect(502)).body.code).toBe('WORLD_UNAVAILABLE');
    const [row] = await t.deps.db.query<{ personhood_kind: string | null }>(`select personhood_kind from agents`);
    expect(row!.personhood_kind).toBeNull();
  });
  it('keeps personhood when the seller re-pairs their agent', async () => {
    const t = await setup();
    await t.register();
    t.deps.worldFetch = world({ success: true, action: 'cardanofish-seller', nullifier: '0xabc' });
    await request(t.app).post('/api/personhood/verify').set(t.s).send(proofFor(t.seller.address)).expect(200);
    await request(t.app).post('/api/agents/register').set(t.s).send({ kind: 'plugin' }).expect(200);
    expect((await request(t.app).get('/api/agents/mine').set(t.s).expect(200)).body.agent.personhood).toMatchObject({ kind: 'world' });
  });
});

async function activeCampaign(t: Awaited<ReturnType<typeof setup>>, verifiedHumansOnly = false) {
  const buyer = await wallet();
  const b = { Authorization: `Bearer ${await login(t.app, buyer)}` };
  const spec = { ...demoSpec(t.clock.now + 3_600_000), ...(verifiedHumansOnly ? { verifiedHumansOnly: true } : {}) };
  const { body } = await request(t.app).post('/api/campaigns').set(b).send(spec).expect(201);
  await t.deps.db.query(`update campaigns set state = 'ACTIVE', escrow_tx_ref = $2 where id = $1`, [body.campaignId, `${'ab'.repeat(32)}#0`]);
  return body.campaignId as string;
}
const answer = (t: Awaited<ReturnType<typeof setup>>, token: string, id: string, address: string) =>
  request(t.app).post(`/api/agents/campaigns/${id}/envelope`).set({ Authorization: `Bearer ${token}` })
    .send(sealEnvelope(keys.encPk, id, address, { q1: 0, q2: 4, q3: 1 }));

describe('one human, one answer', () => {
  it('rejects a second envelope from the same human through another agent (server guard)', async () => {
    const t = await setup();
    const { body: reg } = await t.register();
    await t.deps.db.query(`update agents set personhood_kind = 'world', personhood_nullifier = '0xabc'`);
    const id = await activeCampaign(t);
    // A row that slipped in from another agent with the same nullifier (e.g. a DB edit) must block this one.
    await t.deps.db.query(`insert into envelopes (campaign_id, respondent_address, envelope, received_at_ms, personhood_nullifier)
      values ($1, 'OtherAgentWa11et1111111111111111111111111111', '{}'::jsonb, 1, '0xabc')`, [id]);
    expect((await answer(t, reg.agentToken, id, t.seller.address).expect(409)).body.code).toBe('DUPLICATE_HUMAN');
  });
  it('same address twice is still DUPLICATE', async () => {
    const t = await setup();
    const { body: reg } = await t.register();
    const id = await activeCampaign(t);
    await answer(t, reg.agentToken, id, t.seller.address).expect(204);
    expect((await answer(t, reg.agentToken, id, t.seller.address).expect(409)).body.code).toBe('DUPLICATE');
  });
  it('a verified-humans-only campaign refuses unverified agents', async () => {
    const t = await setup();
    const { body: reg } = await t.register();
    const id = await activeCampaign(t, true);
    expect((await answer(t, reg.agentToken, id, t.seller.address).expect(403)).body.code).toBe('UNVERIFIED');
    await t.deps.db.query(`update agents set personhood_kind = 'world', personhood_nullifier = '0xabc'`);
    await answer(t, reg.agentToken, id, t.seller.address).expect(204);
  });
  it('gives CRE every registered agent personhood and the campaign tier', async () => {
    const t = await setup();
    await t.register();
    await t.deps.db.query(`update agents set personhood_kind = 'world', personhood_nullifier = '0xabc'`);
    const id = await activeCampaign(t, true);
    const { body } = await request(t.app).get(`/api/cre/campaigns/${id}/context`).set({ Authorization: `Bearer ${CRE_TOKEN}` }).expect(200);
    expect(body.verifiedHumansOnly).toBe(true);
    expect(body.personhood[t.seller.address]).toEqual({ kind: 'world', nullifier: '0xabc' });
  });
  it('agents see the tier; the public view shows it and never shows nullifiers', async () => {
    const t = await setup();
    const { body: reg } = await t.register();
    await t.deps.db.query(`update agents set personhood_kind = 'world', personhood_nullifier = '0xabc'`);
    const id = await activeCampaign(t, true);
    const { body: list } = await request(t.app).get('/api/agents/campaigns').set({ Authorization: `Bearer ${reg.agentToken}` }).expect(200);
    expect(list.campaigns[0].verifiedHumansOnly).toBe(true);
    const { body: view } = await request(t.app).get(`/api/campaigns/${id}`).expect(200);
    expect(view.verifiedHumansOnly).toBe(true);
    expect(JSON.stringify(view)).not.toContain('0xabc');
  });
  it('gives synthetic agents unique simulated personhood', async () => {
    const t = await setup();
    await ensureSyntheticAgents(t.deps.db, 's'.repeat(64));
    const rows = await t.deps.db.query<{ personhood_kind: string; personhood_nullifier: string }>(
      `select personhood_kind, personhood_nullifier from agents where kind = 'synthetic'`);
    expect(rows.length).toBeGreaterThan(20);
    expect(rows.every((r) => r.personhood_kind === 'simulated' && r.personhood_nullifier.startsWith('sim:'))).toBe(true);
    expect(new Set(rows.map((r) => r.personhood_nullifier)).size).toBe(rows.length);
  });
});
describe('final review fixes', () => {
  it('rejects World ID 4.0 proofs: only 3.0 legacy nullifiers are tracked (one human, two agents otherwise)', async () => {
    const t = await setup();
    await t.register();
    const f = world({ success: true, action: 'cardanofish-seller', nullifier: '0xabc' });
    t.deps.worldFetch = f;
    const v4 = { ...proofFor(t.seller.address), protocol_version: '4.0' };
    expect((await request(t.app).post('/api/personhood/verify').set(t.s).send(v4).expect(422)).body.code).toBe('BAD_PROOF');
    expect(f).not.toHaveBeenCalled();
  });
  it('rejects a proof from another World environment (simulator proofs on a production server)', async () => {
    const t = await setup();
    t.deps.config.personhood = { ...PERSONHOOD, environment: 'production' };
    await t.register();
    const f = world({ success: true, action: 'cardanofish-seller', nullifier: '0xabc' });
    t.deps.worldFetch = f;
    expect((await request(t.app).post('/api/personhood/verify').set(t.s).send(proofFor(t.seller.address)).expect(422)).body.code).toBe('BAD_PROOF');
    expect(f).not.toHaveBeenCalled();
  });
  it('treats World 5xx and 429 as unavailable (retry), not as a rejection', async () => {
    const t = await setup();
    await t.register();
    for (const status of [503, 429]) {
      t.deps.worldFetch = world({ success: false, code: 'internal_error' }, status);
      expect((await request(t.app).post('/api/personhood/verify').set(t.s).send(proofFor(t.seller.address)).expect(502)).body.code).toBe('WORLD_UNAVAILABLE');
    }
  });
  it('keys synthetic nullifiers by profile id, so reordering the roster cannot collide at boot', async () => {
    const t = await setup();
    const secret = 's'.repeat(64);
    await ensureSyntheticAgents(t.deps.db, secret);
    const [first] = SYNTHETIC_AGENTS;
    const [row] = await t.deps.db.query<{ personhood_nullifier: string }>(`select personhood_nullifier from agents where id = $1`, [first!.profile.id]);
    expect(row!.personhood_nullifier).toBe(`sim:${createHash('sha256').update(`${secret}:${first!.profile.id}`).digest('hex')}`);
  });
});
