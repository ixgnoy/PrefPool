// shared/src/order.ts: per-agent option order. The same (agent, campaign, question) always shows the same order, another
// agent gets another, so position bias cancels in the aggregate. Answers are mapped back to canonical indexes before sealing.
import { sha256Hex } from './crypto';
import type { Answers, Question } from './types';

export const orderKey = (agentAddress: string, campaignId: string, questionId: string) => `order:${agentAddress}:${campaignId}:${questionId}`;

/** Seeded Fisher-Yates. Returns shown position -> canonical index. */
export function optionOrder(seedKey: string, n: number): number[] {
  const order = Array.from({ length: n }, (_, i) => i);
  const hex = sha256Hex(seedKey);
  for (let i = n - 1; i > 0; i--) {
    const at = (i * 4) % 60;
    const j = parseInt(hex.slice(at, at + 4), 16) % (i + 1);
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  return order;
}

/** The question as one agent sees it: single_choice options permuted; likert_5 untouched (its anchors live in the stem). */
export function shownQuestion(q: Question, agentAddress: string, campaignId: string): { question: Question; order: number[] | null } {
  if (q.type !== 'single_choice' || !q.options) return { question: q, order: null };
  const order = optionOrder(orderKey(agentAddress, campaignId, q.id), q.options.length);
  return { question: { ...q, options: order.map((i) => q.options![i]!) }, order };
}

/** Answers given against shown positions, mapped back to canonical option indexes (-1 when out of range). */
export function canonicalAnswers(questions: Question[], agentAddress: string, campaignId: string, shown: Answers): Answers {
  const out: Answers = {};
  for (const q of questions) {
    const v = shown[q.id];
    if (v === undefined) continue;
    if (q.type !== 'single_choice' || !q.options) { out[q.id] = v; continue; }
    const order = optionOrder(orderKey(agentAddress, campaignId, q.id), q.options.length);
    out[q.id] = Number.isInteger(v) && v >= 0 && v < order.length ? order[v]! : -1;
  }
  return out;
}
