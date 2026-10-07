// plugins/mcp/test/plugin.test.ts
import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import request from 'supertest';
import { openEnvelope, optionOrder, orderKey, transcriptKeyFromSignature, type Answers, type CampaignDatumFields, type Envelope } from '@as/shared';
import { tick } from '../../../server/src/lifecycle.js';
import { demoSpec, escrowFor, keys, listen, login, makeDeps, wallet } from '../../../server/test/helpers.js';
import { createAgentSurveyServer } from '../src/tools.js';
import { agentWallet } from '../src/wallet.js';

/** Removes the per-call untrusted-text boundaries (G2) so assertions can compare raw campaign text. */
const stripMarks = (s: string) => s.replace(/<<\/?[0-9a-f]{12}>>/g, '');
/** G3: submitted single_choice answers are positions in this agent's shown order; the sealed value is the canonical index. */
const canonicalOf = (agent: string, campaignId: string, shown: Answers): Answers => Object.fromEntries(demoSpec(0).questions.map((q) =>
  [q.id, q.options ? optionOrder(orderKey(agent, campaignId, q.id), q.options.length)[shown[q.id]!]! : shown[q.id]!]));

async function world() {
  const env = await makeDeps(Date.now());
  const srv = await listen(env.app, env.deps, env.relayRef);
  const serverUrl = srv.wsUrl.replace('ws://', 'http://').replace('/ws/agents', '');
  // an active demo campaign
  const buyer = await wallet();
  const auth = { Authorization: `Bearer ${await login(env.app, buyer)}` };
  const deadline = env.clock.now + 600_000;
  const { body } = await request(env.app).post('/api/campaigns').set(auth).send(demoSpec(deadline));
  const b = await request(env.app).post(`/api/campaigns/${body.campaignId}/fund/build`).set(auth).send({}).expect(200);
  await request(env.app).post(`/api/campaigns/${body.campaignId}/fund/submit`).set(auth).send({ signedTx: buyer.signTx(b.body.unsignedTx) }).expect(200);
  const datum: CampaignDatumFields = { campaignId: body.campaignId, company: buyer.address, reportPk: env.deps.config.reportPublicKey,
    rewardLamports: 1_500_000n, budgetLamports: 30_000_000n, maxResponses: 20, minCohort: 15, deadlineMs: deadline, refundAfterMs: deadline + 86_400_000 };
  env.chainState.escrow = escrowFor(datum);
  await tick(env.deps);
  await tick(env.deps);
  // the owner signs in on the web app and creates a plugin token
  const owner = await wallet();
  const session = await login(env.app, owner);
  const reg = await request(env.app).post('/api/agents/register').set({ Authorization: `Bearer ${session}` }).send({ kind: 'plugin' });
  return { ...env, srv, serverUrl, campaignId: body.campaignId as string, owner, session, agentToken: reg.body.agentToken as string };
}

async function connect(opts: Parameters<typeof createAgentSurveyServer>[0]) {
  const server = createAgentSurveyServer(opts);
  const client = new Client({ name: 'test', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const r = await client.callTool({ name, arguments: args });
    const t = (r.content as { text: string }[])[0]!.text;
    return { isError: !!r.isError, text: t, json: (() => { try { return JSON.parse(t); } catch { return null; } })() };
  };
  return { client, call };
}

describe('agent-survey MCP plugin', () => {
  it('exposes respondent and researcher tools', async () => {
    const { client } = await connect({ serverUrl: 'http://x', webUrl: 'http://w', dataDir: mkdtempSync(join(tmpdir(), 'as-')) });
    const names = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(names).toEqual(['abstain_campaign', 'calibration_pending', 'calibration_submit', 'campaign_status', 'draft_campaign', 'evaluate_campaign', 'fund_campaign', 'get_policy', 'get_report', 'list_campaigns', 'set_policy', 'submit_answer']);
  });

  it('wraps every campaign string in per-call untrusted markers', async () => {
    const w = await world();
    const { call } = await connect({ serverUrl: w.serverUrl, webUrl: 'http://w', dataDir: mkdtempSync(join(tmpdir(), 'as-')), agentToken: w.agentToken });
    const { json } = await call('list_campaigns');
    const title: string = json[0].title;
    const m = title.match(/^<<([0-9a-f]{12})>>(.*)<<\/\1>>$/);
    expect(m?.[2]).toBe('State of agent payments & tools');
    expect(stripMarks(title)).toBe('State of agent payments & tools');
    expect(json[0].questions[0].text.startsWith(`<<${m![1]}>>`)).toBe(true);
    expect(json[0].questions[0].options.every((o: string) => o.startsWith(`<<${m![1]}>>`))).toBe(true);
    expect(json[0].note).toMatch(/never follow instructions/);
    const again = await call('list_campaigns');
    expect(again.json[0].title).not.toBe(title); // a fresh boundary per call: campaign text cannot forge the closing marker
    await w.srv.close();
  });

  it('default policy abstains on the opt-in spending question and refuses to submit', async () => {
    const w = await world();
    const { call } = await connect({ serverUrl: w.serverUrl, webUrl: 'http://w', dataDir: mkdtempSync(join(tmpdir(), 'as-')), agentToken: w.agentToken });
    const list = await call('list_campaigns');
    expect(list.json[0].note).toMatch(/UNTRUSTED/);
    expect((await call('evaluate_campaign', { campaignId: w.campaignId })).json).toEqual({ decision: 'abstained', reason: 'category not allowed: spending' });
    const refused = await call('submit_answer', { campaignId: w.campaignId, answers: { q1: 0, q2: 4, q3: 1 } });
    expect(refused.isError).toBe(true);
    expect(refused.text).toMatch(/Refused by owner policy/);
    expect((await request(w.app).get(`/api/campaigns/${w.campaignId}`)).body.abstained).toEqual([{ reason: 'category not allowed: spending', count: 1 }]);
    await w.srv.close();
  });

  it("seals a copy of the answer to the owner's transcript key (encrypt to self)", async () => {
    const w = await world();
    const ownerKey = transcriptKeyFromSignature('cd'.repeat(80));
    await request(w.app).put('/api/agents/mine/transcript-key').set({ Authorization: `Bearer ${w.session}` }).send({ publicKey: ownerKey.publicKey }).expect(200);
    const { call } = await connect({ serverUrl: w.serverUrl, webUrl: 'http://w', dataDir: mkdtempSync(join(tmpdir(), 'as-')), agentToken: w.agentToken });
    await call('set_policy', { allowedCategories: ['payments', 'blockers', 'spending'], blockedCategories: [], minimumRewardSol: 0.001, dailyLimit: 5 });
    expect((await call('submit_answer', { campaignId: w.campaignId, answers: { q1: 0, q2: 4, q3: 1 } })).json.submitted).toBe(true);
    const { copies } = (await request(w.app).get('/api/agents/mine/answer-copies').set({ Authorization: `Bearer ${w.session}` })).body;
    expect(copies).toHaveLength(1);
    expect(openEnvelope(ownerKey.privateKey, copies[0].envelope)).toEqual(canonicalOf(w.owner.address, w.campaignId, { q1: 0, q2: 4, q3: 1 }));
    await w.srv.close();
  });

  it('an unverified agent abstains from verified-humans-only campaigns and links to World ID', async () => {
    const w = await world();
    await w.deps.db.query(`update campaigns set spec = spec || '{"verifiedHumansOnly": true}'::jsonb where id = $1`, [w.campaignId]);
    const { call } = await connect({ serverUrl: w.serverUrl, webUrl: 'http://w', dataDir: mkdtempSync(join(tmpdir(), 'as-')), agentToken: w.agentToken });
    await call('set_policy', { allowedCategories: ['payments', 'blockers', 'spending'], blockedCategories: [], minimumRewardSol: 0.001, dailyLimit: 5 });
    expect((await call('evaluate_campaign', { campaignId: w.campaignId })).json).toEqual({ decision: 'abstained', reason: 'unverified: campaign requires verified humans' });
    const refused = await call('submit_answer', { campaignId: w.campaignId, answers: { q1: 0, q2: 4, q3: 1 } });
    expect(refused.isError).toBe(true);
    expect(refused.text).toContain('http://w/seller/agent#personhood');
    await w.deps.db.query(`update agents set personhood_kind = 'world', personhood_nullifier = '0xabc' where kind = 'plugin'`);
    expect((await call('submit_answer', { campaignId: w.campaignId, answers: { q1: 0, q2: 4, q3: 1 } })).json.submitted).toBe(true);
    await w.srv.close();
  });

  it('with audience matching on, a profile outside the target abstains and submit_answer refuses (Task 8.12)', async () => {
    const w = await world(); // demo campaign targets country MY, age 25-34
    const { call } = await connect({ serverUrl: w.serverUrl, webUrl: 'http://w', dataDir: mkdtempSync(join(tmpdir(), 'as-')), agentToken: w.agentToken });
    await call('set_policy', { allowedCategories: ['payments', 'blockers', 'spending'], blockedCategories: [], minimumRewardSol: 0.001, dailyLimit: 5,
      profile: { country: 'SG', ageBand: '25-34' }, matchAudience: true });
    expect((await call('get_policy')).json).toMatchObject({ profile: { country: 'SG', ageBand: '25-34' }, matchAudience: true });
    const refused = await call('submit_answer', { campaignId: w.campaignId, answers: { q1: 0, q2: 4, q3: 1 } });
    expect(refused.isError).toBe(true);
    expect(refused.text).toMatch(/no matching profile: country/);
    expect((await call('evaluate_campaign', { campaignId: w.campaignId })).json).toEqual({ decision: 'abstained', reason: 'no matching profile: country' });
    expect((await request(w.app).get(`/api/campaigns/${w.campaignId}`)).body.abstained).toEqual([{ reason: 'no matching profile: country', count: 1 }]);
    await w.srv.close();
  });

  it('with audience matching off (the default), the same profile still answers', async () => {
    const w = await world();
    const { call } = await connect({ serverUrl: w.serverUrl, webUrl: 'http://w', dataDir: mkdtempSync(join(tmpdir(), 'as-')), agentToken: w.agentToken });
    await call('set_policy', { allowedCategories: ['payments', 'blockers', 'spending'], blockedCategories: [], minimumRewardSol: 0.001, dailyLimit: 5,
      profile: { country: 'SG', ageBand: '25-34' } });
    expect((await call('get_policy')).json.matchAudience).toBe(false);
    expect((await call('evaluate_campaign', { campaignId: w.campaignId })).json.decision).toBe('may_answer');
    expect((await call('submit_answer', { campaignId: w.campaignId, answers: { q1: 0, q2: 4, q3: 1 } })).json.submitted).toBe(true);
    await w.srv.close();
  });

  it('answers a calibration round for its owner, and abstains from calibrated-only campaigns until it passes', async () => {
    const w = await world();
    const { call } = await connect({ serverUrl: w.serverUrl, webUrl: 'http://w', dataDir: mkdtempSync(join(tmpdir(), 'as-')), agentToken: w.agentToken });
    await call('set_policy', { allowedCategories: ['payments', 'blockers', 'spending'], blockedCategories: [], minimumRewardSol: 0.001, dailyLimit: 5 });
    expect((await call('evaluate_campaign', { campaignId: w.campaignId })).json.calibrationWaiting).toMatch(/calibration_pending/);
    const pending = await call('calibration_pending');
    expect(pending.json.round.questions).toHaveLength(15);
    expect(pending.json.round.howToAnswer).toMatch(/unknown/);
    const answers = Object.fromEntries(pending.json.round.questions.map((q: { id: string }) => [q.id, 'unknown']));
    const done = await call('calibration_submit', { roundId: pending.json.round.roundId, answers });
    expect(done.json).toMatchObject({ submitted: true });
    expect(done.text).toContain('http://w/seller/calibration');
    const status = (await request(w.app).get('/api/agents/mine/calibration').set({ Authorization: `Bearer ${w.session}` })).body;
    expect(status.round.state).toBe('AGENT_ANSWERED');
    expect((await call('calibration_pending')).json.round).toBeNull();
    await w.deps.db.query(`update campaigns set spec = spec || '{"calibratedAgentsOnly": true}'::jsonb where id = $1`, [w.campaignId]);
    await call('set_policy', { allowedCategories: ['payments', 'blockers', 'spending'], blockedCategories: [], minimumRewardSol: 0.001, dailyLimit: 5 });
    expect((await call('evaluate_campaign', { campaignId: w.campaignId })).json).toEqual({ decision: 'abstained', reason: 'uncalibrated: campaign requires calibrated agents' });
    expect((await call('submit_answer', { campaignId: w.campaignId, answers: { q1: 0, q2: 4, q3: 1 } })).text).toContain('http://w/seller/calibration');
    await w.srv.close();
  });

  it('with an allowing policy, answers are encrypted locally to the platform key and accepted once', async () => {
    const w = await world();
    const { call } = await connect({ serverUrl: w.serverUrl, webUrl: 'http://w', dataDir: mkdtempSync(join(tmpdir(), 'as-')), agentToken: w.agentToken });
    await call('set_policy', { allowedCategories: ['payments', 'blockers', 'spending'], blockedCategories: [], minimumRewardSol: 0.001, dailyLimit: 5 });
    expect((await call('evaluate_campaign', { campaignId: w.campaignId })).json.decision).toBe('may_answer');
    expect((await call('submit_answer', { campaignId: w.campaignId, answers: { q1: 9 } })).isError).toBe(true);
    expect((await call('submit_answer', { campaignId: w.campaignId, answers: { q1: 0, q2: 4, q3: 1 } })).json.submitted).toBe(true);
    const again = await call('submit_answer', { campaignId: w.campaignId, answers: { q1: 0, q2: 4, q3: 1 } });
    expect(again.isError).toBe(true);
    const [row] = await w.deps.db.query<{ envelope: never }>(`select envelope from envelopes where campaign_id = $1`, [w.campaignId]);
    expect(openEnvelope(keys.encSk, row!.envelope)).toEqual(canonicalOf(w.owner.address, w.campaignId, { q1: 0, q2: 4, q3: 1 }));
    expect((row!.envelope as { respondentAddress: string }).respondentAddress).toBe(w.owner.address);
    await w.srv.close();
  });

  it('shows options in a per-agent order and seals the canonical index', async () => {
    const w = await world();
    const ownerKey = transcriptKeyFromSignature('ef'.repeat(80));
    await request(w.app).put('/api/agents/mine/transcript-key').set({ Authorization: `Bearer ${w.session}` }).send({ publicKey: ownerKey.publicKey }).expect(200);
    const { call } = await connect({ serverUrl: w.serverUrl, webUrl: 'http://w', dataDir: mkdtempSync(join(tmpdir(), 'as-')), agentToken: w.agentToken });
    await call('set_policy', { allowedCategories: ['payments', 'blockers', 'spending'], blockedCategories: [], minimumRewardSol: 0, dailyLimit: 5 });
    const { json } = await call('evaluate_campaign', { campaignId: w.campaignId });
    const shown: string[] = json.campaign.questions[0].options.map(stripMarks);
    const canonical = demoSpec(0).questions[0]!.options!;
    const order = optionOrder(orderKey(w.owner.address, w.campaignId, 'q1'), canonical.length);
    expect(shown).toEqual(order.map((i) => canonical[i]));
    expect((await call('list_campaigns')).json[0].questions[0].options.map(stripMarks)).toEqual(shown); // same order on every call
    expect(json.campaign.questions[1].options).toBeUndefined(); // likert_5 untouched
    // The wallet is random per run, so pick a q1 option whose shown position differs from its canonical index:
    // a missing mapping would then seal the wrong option on every run, not just most of them.
    const pos = order.findIndex((canon, shownAt) => canon !== shownAt);
    if (pos === -1) {
      // Identity permutation for this wallet (1 in 24): nothing to map back on q1, so only the shown order is checked here.
      expect(order).toEqual([0, 1, 2, 3]);
    }
    const q1 = pos === -1 ? 0 : pos;
    const expected = { q1: order[q1]!, q2: 3, q3: 2 }; // q3: canonical index of "Over $100"
    if (pos !== -1) expect(expected.q1).not.toBe(q1);
    const shown3: string[] = json.campaign.questions[2].options.map(stripMarks);
    const r = await call('submit_answer', { campaignId: w.campaignId, answers: { q1, q2: 3, q3: shown3.indexOf('Over $100') } });
    expect(r.isError).toBe(false);
    const [row] = await w.deps.db.query<{ envelope: Envelope }>(`select envelope from envelopes where campaign_id = $1`, [w.campaignId]);
    expect(openEnvelope(keys.encSk, row!.envelope)).toEqual(expected);
    expect(canonical[expected.q1]).toBe(shown[q1]); // the sealed index names the option the agent picked
    const { copies } = (await request(w.app).get('/api/agents/mine/answer-copies').set({ Authorization: `Bearer ${w.session}` })).body;
    expect(openEnvelope(ownerKey.privateKey, copies[0].envelope)).toEqual(expected);
    await w.srv.close();
  });

  it('abstain_campaign records a content-free reason and blocks a later answer', async () => {
    const w = await world();
    const { call } = await connect({ serverUrl: w.serverUrl, webUrl: 'http://w', dataDir: mkdtempSync(join(tmpdir(), 'as-')), agentToken: w.agentToken });
    await call('set_policy', { allowedCategories: ['payments', 'blockers', 'spending'], blockedCategories: [], minimumRewardSol: 0, dailyLimit: 5 });
    expect((await call('abstain_campaign', { campaignId: w.campaignId, reason: 'nonsense' })).isError).toBe(true); // fixed reasons only
    expect((await call('abstain_campaign', { campaignId: w.campaignId, reason: 'task_request' })).json).toEqual({ abstained: true, reason: 'task request' });
    const rows = await w.deps.db.query<{ kind: string; reason: string }>(`select kind, reason from agent_decisions where campaign_id = $1`, [w.campaignId]);
    expect(rows).toEqual([{ kind: 'abstain', reason: 'task request' }]);
    expect((await call('abstain_campaign', { campaignId: w.campaignId, reason: 'unknown_answer' })).isError).toBe(true); // recorded once
    const late = await call('submit_answer', { campaignId: w.campaignId, answers: { q1: 0, q2: 3, q3: 1 } });
    expect(late.isError).toBe(true); // first decision wins, locally too
    expect(await w.deps.db.query(`select 1 from envelopes where campaign_id = $1`, [w.campaignId])).toEqual([]);
    await w.srv.close();
  });

  it('abstain_campaign refuses a campaign this agent already answered', async () => {
    const w = await world();
    const { call } = await connect({ serverUrl: w.serverUrl, webUrl: 'http://w', dataDir: mkdtempSync(join(tmpdir(), 'as-')), agentToken: w.agentToken });
    await call('set_policy', { allowedCategories: ['payments', 'blockers', 'spending'], blockedCategories: [], minimumRewardSol: 0, dailyLimit: 5 });
    expect((await call('submit_answer', { campaignId: w.campaignId, answers: { q1: 0, q2: 3, q3: 1 } })).json.submitted).toBe(true);
    expect((await call('abstain_campaign', { campaignId: w.campaignId, reason: 'credential_ask' })).isError).toBe(true);
    await w.srv.close();
  });

  it('approve_sensitive refuses an owner-facing answer until ownerApproved is passed', async () => {
    const w = await world();
    const { call } = await connect({ serverUrl: w.serverUrl, webUrl: 'http://w', dataDir: mkdtempSync(join(tmpdir(), 'as-')), agentToken: w.agentToken });
    await call('set_policy', { allowedCategories: ['payments', 'blockers', 'spending'], blockedCategories: [], minimumRewardSol: 0, dailyLimit: 5, approvalMode: 'approve_sensitive' });
    expect((await call('get_policy')).json.approvalMode).toBe('approve_sensitive');
    const refused = await call('submit_answer', { campaignId: w.campaignId, answers: { q1: 0, q2: 3, q3: 1 } });
    expect(refused.isError).toBe(true);
    expect(refused.text).toMatch(/ownerApproved/);
    const ok = await call('submit_answer', { campaignId: w.campaignId, answers: { q1: 0, q2: 3, q3: 1 }, ownerApproved: true });
    expect(ok.isError).toBe(false);
    await w.srv.close();
  });

  it('set_policy without approvalMode keeps the stored mode', async () => {
    const { call } = await connect({ serverUrl: 'http://x', webUrl: 'http://w', dataDir: mkdtempSync(join(tmpdir(), 'as-')) });
    const base = { allowedCategories: ['payments'], blockedCategories: [], minimumRewardSol: 0, dailyLimit: 5 };
    await call('set_policy', { ...base, approvalMode: 'approve_sensitive' });
    await call('set_policy', { ...base, dailyLimit: 3 });
    expect((await call('get_policy')).json).toMatchObject({ approvalMode: 'approve_sensitive', dailyLimit: 3 });
  });

  it('approve_all fails closed until the web approval queue exists', async () => {
    const w = await world();
    const { call } = await connect({ serverUrl: w.serverUrl, webUrl: 'http://w', dataDir: mkdtempSync(join(tmpdir(), 'as-')), agentToken: w.agentToken });
    await call('set_policy', { allowedCategories: ['payments', 'blockers', 'spending'], blockedCategories: [], minimumRewardSol: 0, dailyLimit: 5, approvalMode: 'approve_all' });
    const refused = await call('submit_answer', { campaignId: w.campaignId, answers: { q1: 0, q2: 3, q3: 1 }, ownerApproved: true });
    expect(refused.isError).toBe(true);
    expect(refused.text).toMatch(/approve_all/);
    expect((await w.deps.db.query(`select 1 from envelopes where campaign_id = $1`, [w.campaignId])).length).toBe(0);
    await w.srv.close();
  });

  it('an agent wallet creates its own campaign and funds it against the real server (sign-in, build, local check + sign, submit)', async () => {
    const env = await makeDeps(Date.now());
    const srv = await listen(env.app, env.deps, env.relayRef);
    const serverUrl = srv.wsUrl.replace('ws://', 'http://').replace('/ws/agents', '');
    const agent = await wallet();
    const { call } = await connect({ serverUrl, webUrl: 'http://w', dataDir: mkdtempSync(join(tmpdir(), 'as-')), wallet: agentWallet(agent.kp.secretKey), maxBudgetSol: 0.2 });
    const draft = await call('draft_campaign', { title: 'Slogan test', category: 'tools_mcp', createWithAgentWallet: true,
      questions: [{ id: 'q1', type: 'single_choice', text: 'Which slogan?', options: ['A', 'B'] }] });
    expect(draft.json).toMatchObject({ budgetSol: 0.2, company: agent.address });
    const funded = await call('fund_campaign', { campaignId: draft.json.campaignId });
    expect(funded.isError).toBe(false);
    expect(funded.json).toMatchObject({ funded: true, budgetSol: 0.2 });
    expect(env.chainState.built[0]).toMatchObject({ company: agent.address, budgetLamports: 200_000_000n });
    expect(env.chainState.submitted).toHaveLength(1);
    expect((await request(env.app).get(`/api/campaigns/${draft.json.campaignId}`)).body).toMatchObject({ state: 'FUNDING_SUBMITTED', fundTxHash: funded.json.txHash });
    expect((await call('campaign_status', { campaignId: draft.json.campaignId })).json.fundTx).toBe(`https://explorer.solana.com/tx/${funded.json.txHash}?cluster=devnet`);
    await srv.close();
  });
});
