// server/src/calibration.ts: owner-vs-agent calibration rounds (spec 2026-10-07-agent-calibration-design.md §2–§5).
// The agent answers first (locked); the owner answers the same questions within 10 minutes; we score and keep only the
// score. Agent answers are nulled after scoring; owner answers only ever bump per-option counts (the "typical person").
import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { CALIBRATION_ROUND_SIZE, majorityAnswer, scoreRound, type AgentAnswer, type CalibrationQuestion } from '@as/shared';
import { z } from 'zod';
import { requireAgent, requireSession, type AuthedRequest } from './auth.js';
import { isUniqueViolation } from './db.js';
import { HttpError, type Deps } from './deps.js';

const MIN = 60_000, HOUR = 3_600_000, DAY = 86_400_000;
export const AGENT_WINDOW_MS = 24 * HOUR;
export const OWNER_OPEN_WINDOW_MS = 7 * DAY;
export const OWNER_ANSWER_WINDOW_MS = 10 * MIN;
export const PASS_VALID_MS = 30 * DAY;
const PER_CATEGORY = 4;
const OPEN = ['CREATED', 'AGENT_ANSWERED', 'OWNER_ANSWERING'];

type Rng = () => number;
interface RoundRow {
  id: string; agent_id: string; question_ids: string[]; state: string; agent_answers: Record<string, AgentAnswer> | null;
  agent_answered_ms: string | number | null; owner_opened_ms: string | number | null; created_ms: string | number;
}
const ts = (ms: number) => new Date(ms).toISOString();
const ROUND_COLS = `id, agent_id, question_ids, state, agent_answers, extract(epoch from agent_answered_at) * 1000 as agent_answered_ms,
  extract(epoch from owner_opened_at) * 1000 as owner_opened_ms, extract(epoch from created_at) * 1000 as created_ms`;

async function questions(deps: Deps, ids: string[]): Promise<CalibrationQuestion[]> {
  const rows = await deps.db.query<CalibrationQuestion>(
    `select id, text, type, options, category, prior from calibration_questions where id = any($1)`, [ids]);
  const byId = new Map(rows.map((q) => [q.id, q]));
  return ids.map((id) => byId.get(id)!);
}
/** What the agent and the owner see: never the prior, never anyone's answers. */
const publicQ = (q: CalibrationQuestion) => ({ id: q.id, text: q.text, type: q.type, ...(q.options ? { options: q.options } : {}) });

/** 15 questions this agent hasn't seen, at most 4 per category; falls back to seen ones once the bank runs out. */
export async function createRound(deps: Deps, agentId: string, rng: Rng = Math.random): Promise<string> {
  const pool = await deps.db.query<{ id: string; category: string; seen: boolean }>(
    `select q.id, q.category, s.agent_id is not null as seen from calibration_questions q
       left join calibration_seen s on s.question_id = q.id and s.agent_id = $1 where q.active order by q.id`, [agentId]);
  const shuffled = pool.map((q) => ({ q, r: rng() })).sort((a, b) => Number(a.q.seen) - Number(b.q.seen) || a.r - b.r).map((x) => x.q);
  const picked: string[] = [];
  const perCat = new Map<string, number>();
  for (const q of shuffled) {
    if (picked.length === CALIBRATION_ROUND_SIZE) break;
    if ((perCat.get(q.category) ?? 0) >= PER_CATEGORY) continue;
    perCat.set(q.category, (perCat.get(q.category) ?? 0) + 1);
    picked.push(q.id);
  }
  const [bank] = await deps.db.query<{ v: number }>(`select max(bank_version) as v from calibration_questions where active`);
  const id = randomUUID();
  try {
    await deps.db.query(`insert into calibration_rounds (id, agent_id, bank_version, question_ids, state, created_at) values ($1, $2, $3, $4::jsonb, 'CREATED', $5)`,
      [id, agentId, bank?.v ?? 1, JSON.stringify(picked), ts(deps.now())]);
  } catch (e) {
    if (isUniqueViolation(e)) throw new HttpError(409, 'ROUND_OPEN', 'a calibration round is already open');
    throw e;
  }
  return id;
}

/** Onboarding: the first time a plugin agent registers, it gets its first round. Re-pairing never adds one. */
export async function onboardingRound(deps: Deps, agentId: string) {
  // Never fail registration over calibration: the agent's new token is already issued (tick/"Calibrate now" can retry).
  try {
    const [any] = await deps.db.query(`select 1 from calibration_rounds where agent_id = $1 limit 1`, [agentId]);
    if (!any) await createRound(deps, agentId);
  } catch (e) {
    if (!(e instanceof HttpError)) console.error('onboarding calibration round', e);
  }
}

/** Expire stale rounds; start a new round for plugin agents whose pass has expired. Runs in the lifecycle tick. */
export async function calibrationTick(deps: Deps) {
  const now = deps.now();
  await deps.db.query(
    `update calibration_rounds set state = 'EXPIRED', agent_answers = null where
       (state = 'CREATED' and created_at < $1) or (state = 'AGENT_ANSWERED' and agent_answered_at < $2)
       or (state = 'OWNER_ANSWERING' and owner_opened_at < $3)`,
    [ts(now - AGENT_WINDOW_MS), ts(now - OWNER_OPEN_WINDOW_MS), ts(now - OWNER_ANSWER_WINDOW_MS)]);
  const due = await deps.db.query<{ id: string }>(
    `select a.id from agents a where a.kind = 'plugin' and a.calibrated_until is not null and a.calibrated_until < $1
       and not exists (select 1 from calibration_rounds r where r.agent_id = a.id and r.state = any($2))`, [ts(now), OPEN]);
  for (const a of due) await createRound(deps, a.id).catch((e) => { if (!(e instanceof HttpError)) throw e; });
}

function validate(qs: CalibrationQuestion[], answers: Record<string, unknown>, allowUnknown: boolean) {
  const ids = new Set(qs.map((q) => q.id));
  const ok = Object.keys(answers).length === qs.length && Object.keys(answers).every((k) => ids.has(k)) && qs.every((q) => {
    const v = answers[q.id];
    if (v === 'unknown') return allowUnknown;
    if (!Number.isInteger(v)) return false;
    return q.type === 'likert_5' ? (v as number) >= 1 && (v as number) <= 5 : (v as number) >= 0 && (v as number) < (q.options?.length ?? 0);
  });
  if (!ok) throw new HttpError(422, 'BAD_ANSWERS', 'answer every question in the round with a listed option (0-based) or 1..5');
}

export function calibrationRoutes(deps: Deps): Router {
  const r = Router();
  const roundOf = async (id: string, agentId: string) => {
    const [row] = await deps.db.query<RoundRow>(`select ${ROUND_COLS} from calibration_rounds where id = $1 and agent_id = $2`, [id, agentId]);
    if (!row) throw new HttpError(404, 'NO_ROUND', 'no such calibration round');
    return row;
  };
  const ownerAgent = async (address: string) => {
    const [a] = await deps.db.query<{ id: string; kind: string; calibrated_ms: string | number | null }>(
      `select id, kind, extract(epoch from calibrated_until) * 1000 as calibrated_ms from agents where address = $1`, [address]);
    if (!a) throw new HttpError(404, 'NO_AGENT', 'register your agent first');
    return a;
  };

  // ---- agent (plugin / OpenClaw) ----
  r.get('/agents/calibration', requireAgent(deps), async (req: AuthedRequest, res) => {
    const [row] = await deps.db.query<RoundRow>(`select ${ROUND_COLS} from calibration_rounds where agent_id = $1 and state = 'CREATED'`, [req.agent!.id]);
    if (!row) return res.json({ round: null });
    res.json({ round: { roundId: row.id, questions: (await questions(deps, row.question_ids)).map(publicQ) } });
  });
  r.post('/agents/calibration/:id/answers', requireAgent(deps), async (req: AuthedRequest, res) => {
    const row = await roundOf(String(req.params.id), req.agent!.id);
    if (row.state !== 'CREATED') throw new HttpError(409, 'ALREADY_ANSWERED', `round is ${row.state}`);
    const { answers } = z.object({ answers: z.record(z.string(), z.union([z.number(), z.literal('unknown')])) }).parse(req.body);
    validate(await questions(deps, row.question_ids), answers, true);
    const done = await deps.db.query(`update calibration_rounds set state = 'AGENT_ANSWERED', agent_answers = $2::jsonb, agent_answered_at = $3
      where id = $1 and state = 'CREATED' returning id`, [row.id, JSON.stringify(answers), ts(deps.now())]);
    if (!done.length) throw new HttpError(409, 'ALREADY_ANSWERED', 'round already answered');
    res.status(204).end();
  });

  // ---- owner (web) ----
  r.get('/agents/mine/calibration', requireSession(deps), async (req: AuthedRequest, res) => {
    const a = await ownerAgent(req.address!);
    const [open] = await deps.db.query<RoundRow>(`select ${ROUND_COLS} from calibration_rounds where agent_id = $1 and state = any($2)`, [a.id, OPEN]);
    const [last] = await deps.db.query<{ agreement: string; baseline: string; lift: string; passed: boolean; scored_ms: string }>(
      `select agreement, baseline, lift, passed, extract(epoch from scored_at) * 1000 as scored_ms from calibration_rounds
        where agent_id = $1 and state = 'SCORED' order by scored_at desc limit 1`, [a.id]);
    res.json({
      calibratable: a.kind === 'plugin',
      calibratedUntil: a.calibrated_ms === null ? null : Number(a.calibrated_ms),
      round: open ? { roundId: open.id, state: open.state, createdAt: Number(open.created_ms),
        ownerDeadline: open.owner_opened_ms === null ? null : Number(open.owner_opened_ms) + OWNER_ANSWER_WINDOW_MS } : null,
      last: last ? { agreement: Number(last.agreement), baseline: Number(last.baseline), lift: Number(last.lift), passed: last.passed, scoredAt: Number(last.scored_ms) } : null,
    });
  });
  r.post('/agents/mine/calibration', requireSession(deps), async (req: AuthedRequest, res) => {
    const a = await ownerAgent(req.address!);
    if (a.kind !== 'plugin') throw new HttpError(409, 'NOT_CALIBRATABLE', 'only plugin or OpenClaw agents can be calibrated');
    res.status(201).json({ roundId: await createRound(deps, a.id) });
  });
  r.post('/agents/mine/calibration/:id/open', requireSession(deps), async (req: AuthedRequest, res) => {
    const a = await ownerAgent(req.address!);
    const row = await roundOf(String(req.params.id), a.id);
    if (row.state === 'CREATED') throw new HttpError(409, 'AGENT_NOT_READY', 'your agent has not answered yet');
    if (row.state !== 'AGENT_ANSWERED' && row.state !== 'OWNER_ANSWERING') throw new HttpError(409, row.state === 'EXPIRED' ? 'EXPIRED' : 'CLOSED', `round is ${row.state}`);
    // Opening is idempotent: the 10-minute window starts at the first open.
    const opening = await deps.db.query(`update calibration_rounds set state = 'OWNER_ANSWERING', owner_opened_at = coalesce(owner_opened_at, $2)
      where id = $1 and state in ('AGENT_ANSWERED', 'OWNER_ANSWERING') returning id`, [row.id, ts(deps.now())]);
    if (!opening.length) throw new HttpError(409, 'CLOSED', 'this round was just scored or expired'); // lost a race with submit or tick
    const opened = row.owner_opened_ms === null ? deps.now() : Number(row.owner_opened_ms);
    res.json({ questions: (await questions(deps, row.question_ids)).map(publicQ), deadline: opened + OWNER_ANSWER_WINDOW_MS });
  });
  r.post('/agents/mine/calibration/:id/answers', requireSession(deps), async (req: AuthedRequest, res) => {
    const a = await ownerAgent(req.address!);
    const row = await roundOf(String(req.params.id), a.id);
    if (row.state !== 'OWNER_ANSWERING') throw new HttpError(409, row.state === 'EXPIRED' ? 'EXPIRED' : 'CLOSED', `round is ${row.state}`);
    if (deps.now() > Number(row.owner_opened_ms) + OWNER_ANSWER_WINDOW_MS) {
      await deps.db.query(`update calibration_rounds set state = 'EXPIRED', agent_answers = null where id = $1 and state = 'OWNER_ANSWERING'`, [row.id]);
      throw new HttpError(409, 'EXPIRED', 'the 10-minute window has passed');
    }
    const { answers } = z.object({ answers: z.record(z.string(), z.number()) }).parse(req.body);
    const qs = await questions(deps, row.question_ids);
    validate(qs, answers, false);
    const counts = await deps.db.query<{ question_id: string; option: number; n: number }>(
      `select question_id, option, n from calibration_counts where question_id = any($1)`, [row.question_ids]);
    const majority = Object.fromEntries(qs.map((q) => {
      const c = Array.from({ length: q.type === 'likert_5' ? 5 : q.options!.length }, (_, i) => counts.find((x) => x.question_id === q.id && x.option === i)?.n ?? 0);
      return [q.id, majorityAnswer(q, c)];
    }));
    const result = scoreRound(qs, row.agent_answers ?? {}, answers, majority);
    const now = deps.now();
    const scored = await deps.db.query(
      `update calibration_rounds set state = 'SCORED', agent_answers = null, agreement = $2, baseline = $3, lift = $4, passed = $5, scored_at = $6
        where id = $1 and state = 'OWNER_ANSWERING' returning id`, [row.id, result.agreement, result.baseline, result.lift, result.passed, ts(now)]);
    if (!scored.length) throw new HttpError(409, 'CLOSED', 'round already scored');
    for (const q of qs) {
      const option = q.type === 'likert_5' ? answers[q.id]! - 1 : answers[q.id]!; // likert 1..5 -> 0..4, like the prior
      await deps.db.query(`insert into calibration_counts (question_id, option, n) values ($1, $2, 1)
        on conflict (question_id, option) do update set n = calibration_counts.n + 1`, [q.id, option]);
      await deps.db.query(`insert into calibration_seen (agent_id, question_id) values ($1, $2) on conflict do nothing`, [a.id, q.id]);
    }
    if (result.passed) await deps.db.query(`update agents set calibrated_until = $2 where id = $1`, [a.id, ts(now + PASS_VALID_MS)]);
    res.json({ result });
  });
  return r;
}
