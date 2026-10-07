// shared/src/calibration.ts: owner-vs-agent calibration (spec 2026-10-07-agent-calibration-design.md).
// Pure scoring and gating, used by the server (rounds), the agents (abstain) and CRE (payment gate).
export const CALIBRATION_MIN_AGREEMENT = 0.7;
export const CALIBRATION_MIN_LIFT = 0.2;
export const CALIBRATION_ROUND_SIZE = 15;
/** Below this many owner answers a question's majority comes from the bank prior. */
export const CALIBRATION_MIN_COUNTS = 30;
export const UNCALIBRATED_REASON = 'uncalibrated: campaign requires calibrated agents';
const EPS = 1e-9; // 0.7 - 0.5 is 0.19999999999999996 in floating point

export interface CalibrationQuestion {
  id: string; text: string; type: 'single_choice' | 'likert_5'; options?: string[]; category: string;
  /** Cold-start answer distribution; index = option (likert 1..5 -> 0..4). */
  prior: number[];
}
/** single_choice: 0-based option index; likert_5: 1..5; the agent may say it doesn't know. */
export type AgentAnswer = number | 'unknown';

/** What "a typical person" answers: the counts once there are enough, otherwise the prior. Likert uses the rounded mean. */
export function majorityAnswer(q: CalibrationQuestion, counts: number[] | undefined): number {
  const total = counts?.reduce((a, b) => a + b, 0) ?? 0;
  const dist = counts && total >= CALIBRATION_MIN_COUNTS ? counts.map((n) => n / total) : q.prior;
  if (q.type === 'likert_5') return Math.round(dist.reduce((s, p, i) => s + p * (i + 1), 0));
  return dist.reduce((best, p, i) => (p > dist[best]! ? i : best), 0);
}

/** A question is contested when no answer holds more than this share: only those separate an owner from the majority. */
export const CONTESTED_MAX_SHARE = 0.5;
/** Share of the most popular answer: counts once there are enough, otherwise the prior. */
export function majorityShare(q: Pick<CalibrationQuestion, 'type' | 'prior'>, counts: number[] | undefined): number {
  const total = counts?.reduce((a, b) => a + b, 0) ?? 0;
  const dist = counts && total >= CALIBRATION_MIN_COUNTS ? counts.map((n) => n / total) : q.prior;
  return Math.max(...dist);
}

const match = (q: CalibrationQuestion, x: AgentAnswer, o: number) =>
  x === 'unknown' ? 0 : q.type === 'likert_5' ? 1 - Math.abs(x - o) / 4 : x === o ? 1 : 0;

/** Agreement with the owner, versus what always giving the popular answer would have scored. */
export function scoreRound(qs: CalibrationQuestion[], agent: Record<string, AgentAnswer>, owner: Record<string, number>, majority: Record<string, number>) {
  const mean = (f: (q: CalibrationQuestion) => number) => qs.reduce((s, q) => s + f(q), 0) / qs.length;
  const agreement = mean((q) => match(q, agent[q.id] ?? 'unknown', owner[q.id]!));
  const baseline = mean((q) => match(q, majority[q.id]!, owner[q.id]!));
  const lift = agreement - baseline;
  return { agreement, baseline, lift, passed: agreement >= CALIBRATION_MIN_AGREEMENT - EPS && lift >= CALIBRATION_MIN_LIFT - EPS };
}

/** Calibrated-only campaigns accept agents whose pass is still valid at `atMs` (the campaign deadline). */
export function calibrationGate(c: { calibratedAgentsOnly?: boolean }, calibratedUntilMs: number | null, atMs: number): { ok: true } | { ok: false; reason: string } {
  return c.calibratedAgentsOnly && !((calibratedUntilMs ?? 0) > atMs) ? { ok: false, reason: UNCALIBRATED_REASON } : { ok: true };
}
