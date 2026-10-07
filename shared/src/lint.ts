// shared/src/lint.ts: question quality rules, so that a 1B-8B model answers the same way a frontier model does.
// Deterministic, no model. Evidence per rule: studies/preference-guardrails-review.md (lint appendix).
import type { CampaignSpec, Question } from './types';

export type LintLevel = 'block' | 'warn';
export interface LintIssue { questionId: string; rule: string; level: LintLevel; message: string }

/**
 * Max substantive options in a single_choice question. One escape option ("None yet", "Not sure", "Other")
 * may come on top, so at most MAX + 1 options in total. 4 -> 10 options costs 16-33% accuracy (MMLU-Pro).
 */
export const MAX_SINGLE_CHOICE_OPTIONS = 5;
const STEM_MAX_WORDS = 30;
const OPTION_MAX_WORDS = 12;

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean);
/** Case/width-folded comparison key; keeps letters and digits of any script plus $ % . + # (so C, C++ and C# differ). */
const norm = (s: string) => s.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}$%.+#]+/gu, ' ').trim();

// Likert anchors: "(1 = never, 5 = very often)", "1 - never ... 5 - always", "1: never, 5: always",
// "from 1 (never) to 5 (always)", "1 Very dissatisfied - 5 Very satisfied", "(1 = 0 times, 5 = 10+ times)".
// Labels start with a letter (any script) or a digit. "1-5 scale" and "from 1 to 5" are not labels.
// A separator (= : - en dash, or "(") is required; the space-only form ("1 Very dissatisfied - 5 Very satisfied")
// is accepted separately and only with a capitalized label, so "in the last 1 month ... over 5 minutes" is not a scale.
// "1 is poor ... 5 is excellent" and "1 being worst ... 5 being best" also count as labeled.
// Case-sensitive on purpose (no `i`); not written with (?-i:) groups because shared also runs in browsers.
const ANCHOR_SEP = String.raw`\s*(?:[=:\-\u2013]\s*|\(\s*)|\s+(?:is|being|means)\s+`;
const ANCHOR = String.raw`\b1(?:${ANCHOR_SEP})(?!5\b|to\b)(?:\p{L}|\d)[^\n]*?\b5(?:${ANCHOR_SEP})(?:\p{L}|\d)[^,;.?)\n]*\)?`;
const SPACE_ANCHOR = String.raw`\b1\s+\p{Lu}[^\n]*?\b5\s+\p{Lu}[^,;.?)\n]*\)?`;
const LIKERT_ANCHORS = [new RegExp(ANCHOR, 'iu'), new RegExp(SPACE_ANCHOR, 'u')];
const LIKERT_ANCHOR_SPANS = [new RegExp(ANCHOR, 'giu'), new RegExp(SPACE_ANCHOR, 'gu')];
const hasLikertAnchors = (s: string) => LIKERT_ANCHORS.some((r) => r.test(s));
const stripLikertAnchors = (s: string) => LIKERT_ANCHOR_SPANS.reduce((t, r) => t.replace(r, ' '), s);
/** Likert anchor labels and parentheticals are labels, not the question's logic. Anchors only exist on likert questions. */
const stemOnly = (q: Question) => (q.type === 'likert_5' ? stripLikertAnchors(q.text) : q.text).replace(/\([^)]*\)/g, ' ');

// Small models answer "which do you NOT use" as if the NOT were absent (inverse scaling, NeQA).
const HARD_NEGATION = [
  /\bNOT\b/,
  /\bexcept\b|(?<!\bat\s)\bleast\b/i,
  /\b(do|does|did|have|has|are|is|was|were|would|will|should|can|could)(\s+(you|they|we|your\s+\w+))?\s+(not|never)\b/i,
  // Contracted negation then a subject: "which tools don't you use", "can't your owner", "cannot you".
  /\b(?:(?:do|does|did|have|has|are|is|was|were|would|wo|should|ca|could)n['\u2019]t|cannot)\s+(you|they|we|your\s+\w+)\b/i,
];
const SOFT_NEGATION = /\b(can['\u2019]t|cannot|don['\u2019]t|doesn['\u2019]t|isn['\u2019]t|aren['\u2019]t|won['\u2019]t|wouldn['\u2019]t|never|no)\b/i;
// Options that point at other options: accuracy collapses 30-50% when "none of the above" is the right answer.
// Letter references need two different letters; a bare "&" needs spaces around it, so brand names (A&E, B&B, D&D) pass.
const META_OPTION = /^(all|none|neither|any|both)\s+of\s+(the\s+)?(above|these|them|those)$|^both$|^([a-f])\s*(?:and|\+)\s*(?!\4)[a-f]$|^([a-f])\s+&\s+(?!\5)[a-f]$/i;
const NEITHER = /^neither$/i;
const FREE_TEXT = /\bplease specify\b|\(\s*specify\s*\)/i;
const LEADING = /\b(don['\u2019]t you (agree|think)|wouldn['\u2019]t you|isn['\u2019]t it (true|obvious)|obviously|clearly|everyone knows|most (people|experts) (agree|think|say))\b/i;
const VAGUE = /^(always|never|all|only|every|frequently|occasionally|sometimes|often|rarely|seldom|a few|some|several|many)\b/i;
const ESCAPE = /^(none|not applicable|n\/a|other\b|don['\u2019]?t know|not sure|prefer not)/i;
// Links, backticks, markdown links, and HTML: a tag-like "<x ...>", a comment/doctype "<!", or a known dangerous tag.
// "< a second" and "<1s" are comparisons, not markup.
const MARKUP = /https?:\/\/|www\.|`|\]\(|<!|<\/?[a-z][a-z0-9-]*(?:\s[^<>]*)?>|<\/?(?:script|iframe|img|svg|style|object|embed|link|meta)\b/i;
// Abuse (G4b). Campaigns ask about an agent's experience; a stem that commands work, or text that carries code or
// arithmetic, is labor extraction, not research. Imperatives only count at the start of the stem ("Which tools ...
// do you use to translate" passes); "Can you pay with crypto?" passes because "pay" is not a work verb.
const TASK_REQUEST = [
  /^(?:(?:please|can you|could you|would you)\s+)?(?:write|fix|debug|solve|compute|calculate|translate|summari[sz]e|generate|implement|explain|draft|rewrite|refactor|convert|classify|prove|evaluate|simplify|correct|complete|rank|find the (?:bug|error|mistake))\b/i,
  // Grading items with one right answer: "Which of these SQL statements is correct?". "... is correct for you" is a preference.
  /\bwhich\s+(?:(?:of\s+these|one)\s+)?(?:[\w-]+\s+){0,3}(?:is|are)\s+(?:the\s+)?(?:correct|right|valid|accurate|grammatical|true)(?:\s+answer)?\b(?!\s+(?:for|in|about|of)\b)/i,
];
// Code, case-sensitive: only structural signals. Words like "function" or "code" and calls like "useState()" are prose.
const CODE = /[{}]|=>|\b(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*=|\bfunction\s*[\w$]*\s*\(|\bdef\s+\w+\s*\(|\b(?:elif|printf|console\.log|System\.out)\b|#include\b|\bSELECT\b.+\bFROM\b/;
// Arithmetic. "1-5", "$20-100", "10+ times" and "24/7" are ranges and phrases, not sums: + and / only count with spaces
// on both sides ("2 + 2", "100 / 4") or after "what is".
const MATH = [
  /\d\s*[*\u00D7\u00F7^]\s*\d/,
  /\d\s+[+/]\s+\d/,
  /\bwhat(?:['\u2019]s|\s+is)\s+-?\d[\d.,]*\s*[-+*/\u00D7\u00F7^x]\s*\d/i,
  /\b(?:sqrt|square root of|integral of|derivative of|solve for)\b/i,
];
// Secrets of the agent or the owner. "password manager" is a product and passes; "your password" does not.
const CREDENTIAL = [
  /\b(?:api[ _-]?keys?|secret[ _-]?keys?|private[ _-]?keys?|signing keys?|key ?pairs?|seed phrases?|recovery phrases?|mnemonics?|passphrases?|(?:access|bearer|auth|refresh|session) tokens?|client secrets?|credentials?)\b/i,
  /(?:^|\s)\.env\b|\benv(?:ironment)?\s+var(?:iable)?s?\b/i,
  /\b(?:openai|anthropic|github|solana|wallet|ssh|gpg)\s+(?:secret\s+)?keys?\b/i,
  /\b(?:your|owner['\u2019]?s|their|the)\s+passwords?\b(?!\s+managers?\b)/i,
  // Env var names, case-sensitive so prose like "max_token" does not count.
  /\b[A-Z][A-Z0-9_]*_(?:KEY|SECRET|TOKEN|PASSWORD|PASSPHRASE|MNEMONIC)S?\b/,
];
// Printable ASCII plus Latin-1/Latin Extended letters, typographic dashes/quotes/ellipsis and the euro sign.
const ODD_CHARS = /[^\x09\x0A\x0D\x20-\x7E\u00A0-\u024F\u2010-\u2027\u20AC]/;
const NUM = String.raw`\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?`;
const NUM_G = new RegExp(NUM, 'g');
const RANGE = new RegExp(String.raw`(${NUM})\s*[-\u2013]\s*\$?(${NUM})`);
const num = (s: string) => Number(s.replace(/,/g, ''));
/** Options are only compared as ranges when they read the same with numbers masked ("1-2 times a week" vs "... a month" differ). */
const shape = (s: string) => norm(s.replace(NUM_G, '#'));
const DOUBLE = /\b(how|what|which|do|does|did|are|is|would)\b[^?]*\band\b[^?]*\b(how|what|which|do|does|did|are|is|would)\b/i;
const ACQUIESCENCE = [['yes', 'no'], ['true', 'false'], ['agree', 'disagree']];

export function lintQuestion(q: Question): LintIssue[] {
  const out: LintIssue[] = [];
  const issue = (rule: string, level: LintLevel, message: string) => out.push({ questionId: q.id, rule, level, message: `${q.id}: ${message}` });
  const stem = stemOnly(q);
  const opts = q.options ?? [];

  if (MARKUP.test(q.text) || opts.some((o) => MARKUP.test(o))) issue('markup', 'block', 'no links, HTML or code in a question');
  const all = [q.text, ...opts];
  if (TASK_REQUEST.some((r) => r.test(stem.trim())) || all.some((t) => CODE.test(t) || MATH.some((r) => r.test(t)))) {
    issue('task_request', 'block', 'campaigns ask about experience; they must not ask the agent to do work (code, maths, translation)');
  }
  if (all.some((t) => CREDENTIAL.some((r) => r.test(t)))) issue('credential_ask', 'block', 'never ask about keys, passwords, tokens or secrets');
  if (HARD_NEGATION.some((r) => r.test(stem))) issue('negated_stem', 'block', 'ask it positively ("which do you use", not "which do you NOT use")');
  else if (SOFT_NEGATION.test(stem)) issue('negation', 'warn', 'a negative in the question; small models misread these, prefer a positive wording');
  if (ODD_CHARS.test(q.text) || opts.some((o) => ODD_CHARS.test(o))) issue('odd_chars', 'warn', 'unusual characters; models are sensitive to typos and symbols');
  if (words(stem).length > STEM_MAX_WORDS) issue('stem_long', 'warn', `keep the question under ${STEM_MAX_WORDS} words`);
  if ((q.text.match(/\?/g) ?? []).length > 1 || /\band\/or\b/i.test(stem) || DOUBLE.test(stem)) issue('double_barreled', 'warn', 'this asks two things; split it');
  if (LEADING.test(stem)) issue('leading', 'warn', 'leading wording; models agree with the framing');

  if (q.type === 'likert_5') {
    if (!hasLikertAnchors(q.text)) issue('likert_anchors', 'block', 'a 1-5 question must label both ends, e.g. "(1 = never, 5 = very often)"');
    return out;
  }
  // "Neither" after exactly two options is the natural escape ("Card / Crypto / Neither"); with more it is a reference.
  const neitherIsEscape = opts.length === 3 && opts.filter((o) => NEITHER.test(o.trim())).length === 1;
  const isEscape = (o: string) => ESCAPE.test(o.trim()) || (neitherIsEscape && NEITHER.test(o.trim()));
  const substantive = opts.filter((o) => !isEscape(o)).length;
  if (substantive > MAX_SINGLE_CHOICE_OPTIONS || opts.length > MAX_SINGLE_CHOICE_OPTIONS + 1) {
    issue('too_many_options', 'block', `at most ${MAX_SINGLE_CHOICE_OPTIONS} options plus one escape option`);
  }
  const seen = new Set<string>();
  for (const o of opts) {
    const n = norm(o);
    if (!o.trim()) issue('empty_option', 'block', 'empty option');
    else if (n && seen.has(n)) issue('duplicate_option', 'block', `duplicate option "${o}"`);
    seen.add(n);
    if (FREE_TEXT.test(o)) issue('free_text_option', 'block', 'agents cannot type a free answer; use "Other"');
    else if (META_OPTION.test(o.trim()) || (NEITHER.test(o.trim()) && !neitherIsEscape)) issue('meta_option', 'block', `"${o}" refers to other options; spell the combination out instead`);
    if (words(o).length > OPTION_MAX_WORDS) issue('option_long', 'warn', `keep options under ${OPTION_MAX_WORDS} words ("${o}")`);
    if (VAGUE.test(o.trim())) issue('vague_quantifier', 'warn', `"${o}" is a vague quantity; use counts or ranges`);
  }
  const ranges = opts.map((o) => o.match(RANGE)).map((m) => (m ? [num(m[1]), num(m[2])] as const : null));
  const shapes = opts.map(shape);
  for (let i = 0; i < ranges.length; i++) {
    for (let j = i + 1; j < ranges.length; j++) {
      const a = ranges[i], b = ranges[j];
      if (!a || !b || shapes[i] !== shapes[j]) continue;
      if (a[1] === b[0] || b[1] === a[0] || (a[0] < b[1] && b[0] < a[1])) issue('overlapping_ranges', 'block', `"${opts[i]}" and "${opts[j]}" overlap`);
    }
  }
  const lens = opts.map((o) => words(o).length);
  if (lens.length && Math.max(...lens) >= 6 && Math.max(...lens) > 2 * Math.max(1, Math.min(...lens))) issue('option_imbalance', 'warn', 'one option is much longer than the others; models pick the detailed one');
  const set = opts.map(norm);
  if (set.length === 2 && ACQUIESCENCE.some((pair) => pair.every((p) => set.includes(p)))) issue('acquiescence', 'warn', 'yes/no and agree/disagree skew to agreement; name the two situations instead');
  if (opts.length >= 2 && !opts.some(isEscape)) issue('no_escape', 'warn', 'add an option for agents the list does not cover (e.g. "None yet", "Not applicable")');
  return out;
}

export function lintCampaign(spec: Pick<CampaignSpec, 'category' | 'questions'>): LintIssue[] {
  return spec.questions.flatMap(lintQuestion);
}
