// shared/src/screening.ts
import { SENSITIVE_CATEGORIES } from './categories';
import { MAX_PAYEES } from './settlePayload';
import type { CampaignSpec } from './types';

const IDENTIFYING = [
  /\b(home|exact|street|residential)\s+address\b/i,
  /\bwhere\s+(do\s+)?you\s+live\b/i,
  /\b(full|real|legal)\s+name\b/i,
  /\b(ic|nric|passport|ssn)\s*(number|no\.?)?\b/i,
  /\bphone\s+number\b/i,
  /\bemployer\b/i,
  // Where the owner is. "tools that live in the browser" passes: the subject must be a person.
  /\b(?:you|owner|they|he|she)\s+(?:lives?|living|located|based)\s+in\b/i,
  /\b(?:date of birth|born on)\b|\b(?:your|owner['\u2019]?s|their)\s+birthday\b/i,
  // Contact details. "Do you send email for your owner?" is a workflow question and passes.
  /\be-?mail\s+address(?:es)?\b|\bwhat(?:['\u2019]s|\s+is)\s+(?:your|the)\s+(?:owner['\u2019]?s\s+)?e-?mail\b/i,
  /\b(?:bank|card|account|wallet)\s+(?:number|address)\b/i,
  // Accounts and addresses. "Do you use a crypto wallet?" passes; the account itself, or any of its characters, does not.
  /\b(?:solana|crypto|phantom|solflare)\s+(?:account|address)\b|\b(?:your|owner['\u2019]?s|their)\s+(?:\w+\s+)?public key\b/i,
  /\b(?:wallet|address|account|key)\b.*\b(?:starts?|begins?|ends?)\s+with\b|\b(?:first|last)\s+(?:\w+\s+)?(?:character|letter|digit)s?\s+of\s+(?:your|the)\b/i,
  /\b(?:zip|postal)\s*code\b|\bpostcode\b/i,
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
