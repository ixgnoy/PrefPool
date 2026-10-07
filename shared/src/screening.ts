// shared/src/screening.ts
import { KNOWN_CATEGORIES, SENSITIVE_CATEGORIES } from './categories';
import { lintCampaign, MAX_SINGLE_CHOICE_OPTIONS } from './lint';
import { MAX_PAYEES } from './settlePayload';
import type { CampaignSpec } from './types';

const IDENTIFYING = [
  /\b(home|exact|street|residential)\s+address\b/i,
  /\bwhere\s+(do\s+)?you\s+live\b/i,
  /\b(full|real|legal)\s+name\b/i,
  /\b(ic|nric|passport|ssn)\s*(number|no\.?)?\b/i,
  /\bphone\s+number\b/i,
  /\bemployer\b/i,
  // Where the owner is. "tools that live in the browser" passes: the subject must be a person (one word may sit between).
  /\b(?:you|owner|they|he|she)\s+(?:\w+\s+)?(?:lives?|living|located|based|resides?|residing)\s+in\b/i,
  /\bwhere\s+(?:do|does|did|is|are)\s+(?:you|your\s+owner|they|he|she)\s+(?:live|work|stay|reside|located|based)\b/i,
  /\bwhich\s+(?:city|country|state|town|region|province|area|suburb|district|neighbou?rhood)\s+(?:is|are|does|do)\s+(?:you|your\s+owner|they|he|she)\b/i,
  /\b(?:date of birth|born on)\b|\b(?:your|owner['\u2019]?s|their)\s+birthday\b|\b(?:were|was|is|are)\s+(?:you|your\s+owner|they|he|she)\s+born\b/i,
  // Contact details. "Do you send email for your owner?" is a workflow question and passes.
  /\be-?mail\s+address(?:es)?\b|\bwhat(?:['\u2019]s|\s+is)\s+(?:your|the)\s+(?:owner['\u2019]?s\s+)?e-?mail\b/i,
  /[^\s@]+@[^\s@]+\.\w+/,
  /\b(?:bank|card|account|wallet)\s+(?:number|address)\b(?!\s+(?:formats?|types?|styles?|standards?|validation)\b)/i,
  // Accounts and addresses. "Do you use a crypto wallet?" and "public key authentication" pass; the account itself does not.
  /\b(?:solana|crypto|phantom|solflare)\s+(?:account|address|pubkey)\b|\b(?:your|owner['\u2019]?s|their|its)\s+(?:\w+\s+){0,2}pub(?:lic\s*)?keys?\b|\bpub(?:lic\s*)?keys?\s+of\s+(?:your|the|their)\b/i,
  // "What is your (Solana) wallet?", "Which of these is your wallet?": wallet/account only when it ends the clause, so
  // "What is your account tier?" and "Which is your main wallet app?" pass. Address and public key always count.
  /\b(?:what(?:['\u2019]s|\s+is)|which(?:\s+(?:of\s+these|of\s+them|one))?\s+is|is\s+this)\s+(?:your|the|their)\s+(?:owner['\u2019]?s\s+)?(?!(?:preferred|favou?rite)\b)(?:\w+\s+){0,2}?(?:(?:wallet|account)(?=\s*(?:[?.!,;:]|$))|(?:address(?:es)?|pub(?:lic\s*)?keys?)\b(?!\s+(?:formats?|types?|standards?|book)\b))/i,
  /\bis\s+(?:your|the|their)\s+(?:owner['\u2019]?s\s+)?(?:\w+\s+){0,2}(?:wallet|account|address|pub(?:lic\s*)?key)\s+(?:0x|(?=[1-9A-HJ-NP-Za-km-z]{4,})[1-9A-HJ-NP-Za-km-z]*\d|[1-9A-HJ-NP-Za-km-z]{2,}(?:\.{3}|\u2026))/i,
  // "... wallet starts with", only when adjacent: "Does your account setup start with email verification?" passes.
  /\b(?:wallets?|address(?:es)?|accounts?|keys?|pubkeys?)\s+(?:(?:usually|always|normally|still|really|actually)\s+)?(?:starts?|begins?|ends?)\s+with\b|\b(?:first|last)\s+(?:\w+\s+)?(?:character|letter|digit)s?\s+of\s+(?:your|the)\b/i,
  // Address-shaped strings: base58 (Solana), 0x EVM, 64-char hex. Case-sensitive.
  /\b[1-9A-HJ-NP-Za-km-z]{32,44}\b|\b0x[0-9a-fA-F]{40,}\b|\b[0-9a-fA-F]{64}\b/,
  // A shortened address as a whole option: "7xKX...AsU", "9WzD\u2026AWWM" (needs a digit, so "Wait...ok" passes).
  /^(?=[^\n]*\d)[1-9A-HJ-NP-Za-km-z]{3,8}(?:\.{2,}|\u2026)[1-9A-HJ-NP-Za-km-z]{2,8}$/,
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
  for (const c of cats) if (!KNOWN_CATEGORIES.includes(c)) reasons.push(`unknown category: ${c}`);
  for (const q of spec.questions) {
    for (const re of IDENTIFYING) if (re.test(q.text) || (q.options ?? []).some((o) => re.test(o))) reasons.push(`identifying question: ${q.id}`);
    for (const re of INJECTION) if (re.test(q.text) || (q.options ?? []).some((o) => re.test(o))) reasons.push(`injection pattern: ${q.id}`);
    if (q.type === 'single_choice' && !(q.options && q.options.length >= 2 && q.options.length <= MAX_SINGLE_CHOICE_OPTIONS + 1)) reasons.push(`bad options: ${q.id}`);
  }
  if (spec.questions.length < 1 || spec.questions.length > 5) reasons.push('1 to 5 questions required');
  if (new Set(spec.questions.map((q) => q.id)).size !== spec.questions.length) reasons.push('duplicate question id');
  if (BigInt(spec.rewardLamports) < MIN_REWARD_LAMPORTS) reasons.push('reward below 0.001 SOL');
  if (spec.maxResponses < 1 || spec.maxResponses > maxResponsesCap) reasons.push(`maxResponses must be 1..${maxResponsesCap}`);
  if (spec.minCohort < 1 || spec.minCohort > spec.maxResponses) reasons.push('minCohort must be 1..maxResponses');
  if (spec.deadlineMs < nowMs + 60_000) reasons.push('deadline must be at least 1 minute ahead');
  // Wording blocks (shared/src/lint.ts): meta options, work requests, credential asks, unlabeled scales. The finer
  // option-count rule (5 substantive + 1 escape) lives there too; `bad options` above only bounds the total.
  for (const i of lintCampaign(spec)) if (i.level === 'block') reasons.push(i.message);
  return [...new Set(reasons)];
}

/** Non-blocking wording advice, returned to the buyer with the created campaign. */
export const screenWarnings = (spec: Pick<CampaignSpec, 'category' | 'questions'>): string[] =>
  lintCampaign(spec).filter((i) => i.level === 'warn').map((i) => i.message);
