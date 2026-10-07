// shared/src/screening.ts
import { MAX_PAYEES } from './settlePayload';
import type { CampaignSpec } from './types';

/** Never askable: personal-sensitive topics, and `credentials` (keys, passwords, how an agent stores secrets). */
export const SENSITIVE_CATEGORIES = ['health', 'religion', 'ethnicity', 'politics', 'sexual_orientation', 'credentials'];
const IDENTIFYING = [
  /\b(home|exact|street|residential)\s+address\b/i,
  /\bwhere\s+(do\s+)?you\s+live\b/i,
  /\b(full|real|legal)\s+name\b/i,
  /\b(ic|nric|passport|ssn)\s*(number|no\.?)?\b/i,
  /\bphone\s+number\b/i,
  /\bemployer\b/i,
];
const INJECTION = [/ignore (all |any )?(previous|prior) instructions/i, /system prompt/i, /you are now/i];

/** Platform screening at DRAFT. Returns rejection reasons; empty array means the campaign may be funded. */
/** Each payout must leave a fresh wallet rent-exempt (~0.00089 SOL); the program enforces it, screening rounds up. */
export const MIN_REWARD_LAMPORTS = 1_000_000n;

export function screenCampaign(spec: CampaignSpec, nowMs: number, maxResponsesCap = MAX_PAYEES): string[] {
  const reasons: string[] = [];
  const cats = [spec.category, ...spec.questions.map((q) => q.category ?? spec.category)];
  for (const c of cats) if (SENSITIVE_CATEGORIES.includes(c)) reasons.push(`sensitive category: ${c}`);
  for (const q of spec.questions) {
    for (const re of IDENTIFYING) if (re.test(q.text)) reasons.push(`identifying question: ${q.id}`);
    for (const re of INJECTION) if (re.test(q.text) || (q.options ?? []).some((o) => re.test(o))) reasons.push(`injection pattern: ${q.id}`);
    if (q.type === 'single_choice' && !(q.options && q.options.length >= 2 && q.options.length <= 6)) reasons.push(`bad options: ${q.id}`);
  }
  if (spec.questions.length < 1 || spec.questions.length > 5) reasons.push('1 to 5 questions required');
  if (new Set(spec.questions.map((q) => q.id)).size !== spec.questions.length) reasons.push('duplicate question id');
  if (BigInt(spec.rewardLamports) < MIN_REWARD_LAMPORTS) reasons.push('reward below 0.001 SOL');
  if (spec.maxResponses < 1 || spec.maxResponses > maxResponsesCap) reasons.push(`maxResponses must be 1..${maxResponsesCap}`);
  if (spec.minCohort < 1 || spec.minCohort > spec.maxResponses) reasons.push('minCohort must be 1..maxResponses');
  if (spec.deadlineMs < nowMs + 60_000) reasons.push('deadline must be at least 1 minute ahead');
  return [...new Set(reasons)];
}
