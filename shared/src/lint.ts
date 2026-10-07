// shared/src/lint.ts: question quality rules, so that a 1B-8B model answers the same way a frontier model does.
// Deterministic, no model. Evidence per rule: studies/preference-guardrails-review.md (lint appendix).
import type { CampaignSpec, Question } from './types';

export type LintLevel = 'block' | 'warn';
export interface LintIssue { questionId: string; rule: string; level: LintLevel; message: string }

/** 4 -> 10 options costs 16-33% accuracy (MMLU-Pro); surveys rarely need more than 5. */
export const MAX_SINGLE_CHOICE_OPTIONS = 5;
const STEM_MAX_WORDS = 30;
const OPTION_MAX_WORDS = 12;

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean);
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9$%.]+/g, ' ').trim();
/** Likert anchors like "(1 = never, 5 = very often)" are labels, not the question's logic. */
const stemOnly = (s: string) => s.replace(/\([^)]*\)/g, ' ');

// Small models answer "which do you NOT use" as if the NOT were absent (inverse scaling, NeQA).
const HARD_NEGATION = /\bNOT\b|\b(except|least)\b|\b(do|does|did|have|has|are|is|would|will|should|can)\s+(not|never)\b/;
const SOFT_NEGATION = /\b(can't|cannot|don't|doesn't|isn't|aren't|won't|wouldn't|never|no)\b/i;
// Options that point at other options: accuracy collapses 30-50% when "none of the above" is the right answer.
const META_OPTION = /^(all|none|neither|any|both)\s+of\s+(the\s+)?(above|these|them|those)$|^(both|neither)$|^[a-e]\s*(and|&|\+)\s*[a-e]$|\(please specify\)/i;
const LEADING = /\b(don't you (agree|think)|wouldn't you|isn't it (true|obvious)|obviously|clearly|everyone knows|most (people|experts) (agree|think|say))\b/i;
const VAGUE = /^(always|never|all|only|every|frequently|occasionally|sometimes|often|rarely|seldom|a few|some|several|many)\b/i;
const ESCAPE = /^(none|not applicable|n\/a|other\b|don'?t know|not sure|prefer not)/i;
const MARKUP = /https?:\/\/|www\.|`|<\/?[a-z!]|\]\(/i;
// Printable ASCII plus Latin-1/Latin Extended letters, typographic dashes/quotes/ellipsis and the euro sign.
const ODD_CHARS = /[^\x09\x0A\x0D\x20-\x7E -ɏ‐-‧€]/;
const LIKERT_ANCHORS = /\b1\s*=\s*[^,;)]+[,;][^)]*\b5\s*=/;
const RANGE = /(\d+(?:\.\d+)?)\s*[-–]\s*\$?(\d+(?:\.\d+)?)/;
const DOUBLE = /\b(how|what|which|do|does|did|are|is|would)\b[^?]*\band\b[^?]*\b(how|what|which|do|does|did|are|is|would)\b/i;
const ACQUIESCENCE = [['yes', 'no'], ['true', 'false'], ['agree', 'disagree']];

export function lintQuestion(q: Question): LintIssue[] {
  const out: LintIssue[] = [];
  const issue = (rule: string, level: LintLevel, message: string) => out.push({ questionId: q.id, rule, level, message: `${q.id}: ${message}` });
  const stem = stemOnly(q.text);
  const opts = q.options ?? [];

  if (MARKUP.test(q.text) || opts.some((o) => MARKUP.test(o))) issue('markup', 'block', 'no links, HTML or code in a question');
  if (HARD_NEGATION.test(stem)) issue('negated_stem', 'block', 'ask it positively ("which do you use", not "which do you NOT use")');
  else if (SOFT_NEGATION.test(stem)) issue('negation', 'warn', 'a negative in the question; small models misread these, prefer a positive wording');
  if (ODD_CHARS.test(q.text) || opts.some((o) => ODD_CHARS.test(o))) issue('odd_chars', 'warn', 'unusual characters; models are sensitive to typos and symbols');
  if (words(stem).length > STEM_MAX_WORDS) issue('stem_long', 'warn', `keep the question under ${STEM_MAX_WORDS} words`);
  if ((q.text.match(/\?/g) ?? []).length > 1 || /\band\/or\b/i.test(stem) || DOUBLE.test(stem)) issue('double_barreled', 'warn', 'this asks two things; split it');
  if (LEADING.test(stem)) issue('leading', 'warn', 'leading wording; models agree with the framing');

  if (q.type === 'likert_5') {
    if (!LIKERT_ANCHORS.test(q.text)) issue('likert_anchors', 'block', 'a 1-5 question must label both ends, e.g. "(1 = never, 5 = very often)"');
    return out;
  }
  if (opts.length > MAX_SINGLE_CHOICE_OPTIONS) issue('too_many_options', 'block', `at most ${MAX_SINGLE_CHOICE_OPTIONS} options`);
  const seen = new Set<string>();
  for (const o of opts) {
    const n = norm(o);
    if (!n) issue('empty_option', 'block', 'empty option');
    else if (seen.has(n)) issue('duplicate_option', 'block', `duplicate option "${o}"`);
    seen.add(n);
    if (META_OPTION.test(o.trim())) issue('meta_option', 'block', `"${o}" refers to other options; spell the combination out instead`);
    if (words(o).length > OPTION_MAX_WORDS) issue('option_long', 'warn', `keep options under ${OPTION_MAX_WORDS} words ("${o}")`);
    if (VAGUE.test(o.trim())) issue('vague_quantifier', 'warn', `"${o}" is a vague quantity; use counts or ranges`);
  }
  const ranges = opts.map((o) => o.match(RANGE)).map((m) => (m ? [Number(m[1]), Number(m[2])] as const : null));
  for (let i = 0; i < ranges.length; i++) {
    for (let j = i + 1; j < ranges.length; j++) {
      const a = ranges[i], b = ranges[j];
      if (a && b && (a[1] === b[0] || b[1] === a[0] || (a[0] < b[1] && b[0] < a[1]))) issue('overlapping_ranges', 'block', `"${opts[i]}" and "${opts[j]}" overlap`);
    }
  }
  const lens = opts.map((o) => words(o).length);
  if (lens.length && Math.max(...lens) >= 6 && Math.max(...lens) > 2 * Math.max(1, Math.min(...lens))) issue('option_imbalance', 'warn', 'one option is much longer than the others; models pick the detailed one');
  const set = opts.map(norm);
  if (set.length === 2 && ACQUIESCENCE.some((pair) => pair.every((p) => set.includes(p)))) issue('acquiescence', 'warn', 'yes/no and agree/disagree skew to agreement; name the two situations instead');
  if (opts.length >= 2 && !opts.some((o) => ESCAPE.test(o.trim()))) issue('no_escape', 'warn', 'add an option for agents the list does not cover (e.g. "None yet", "Not applicable")');
  return out;
}

export function lintCampaign(spec: Pick<CampaignSpec, 'category' | 'questions'>): LintIssue[] {
  return spec.questions.flatMap(lintQuestion);
}
