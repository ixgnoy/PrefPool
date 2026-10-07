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
/** True when a 1-5 question labels both ends ("(1 = never, 5 = very often)" and the other accepted forms). */
export const hasLikertAnchors = (s: string) => LIKERT_ANCHORS.some((r) => r.test(s));
/** Default end labels for a 1-5 question, appended only when the text has none (web editor prefill). */
export const DEFAULT_LIKERT_ANCHORS = '(1 = not at all, 5 = very much)';
export const withLikertAnchors = (text: string) => (hasLikertAnchors(text) ? text : `${text.trim()} ${DEFAULT_LIKERT_ANCHORS}`.trim());
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
// arithmetic, is labor extraction, not research. Questions about the agent's own work ("Do you translate documents for
// your owner?") pass: the language and grading patterns only apply when the stem is not about "you".
/** Quoted text is the object of a task ("the French for 'thank you'"), not its subject; dropped before looking for "you". */
const QUOTED = /(^|[\s(])['"\u2018\u201C][^'"\u2018\u2019\u201C\u201D]*['"\u2019\u201D]/g;
const ABOUT_YOU = /\b(?:you|your|yours)\b/i;
const FIRST_PERSON = /^(?:I|My|We|Our)\b/;
// A leading work verb is a command; followed by "-" or ":" it is a label ("Debug: how often ...", "Complete onboarding: ...").
const TASK_VERB = /^(?:(?:please|can you|could you|would you)\s+)?(?:write|fix|debug|solve|compute|calculate|translate|summari[sz]e|generate|implement|explain|draft|rewrite|refactor|convert|classify|prove|evaluate|simplify|correct|complete|rank|proofread|paraphrase|transcribe|find the (?:bug|error|mistake))\b(?!\s*[-:\u2013]|\s+[\w-]+\s*:)/i;
const LANGUAGES = 'English|French|Spanish|German|Italian|Portuguese|Dutch|Russian|Polish|Turkish|Greek|Hebrew|Arabic|Persian|Hindi|Urdu|Bengali|Tamil|Thai|Vietnamese|Indonesian|Malay|Tagalog|Filipino|Chinese|Mandarin|Cantonese|Japanese|Korean|Swahili|Latin';
const TASK_ALWAYS = [
  TASK_VERB,
  /_{2,}/, // fill in the blank
  /\b(?:correct|right|valid|bug-free|error-free)\s+(?:translation|answer|version|output|spelling|completion|solution|implementation)s?\b/i,
  // A work object: "this essay?", "the following snippet:", "this function returns ...".
  /\b(?:this|that|these|the following)\s+(?:code|snippets?|functions?|essays?|programs?|quer(?:y|ies)|equations?|scripts?|regex(?:es)?|proofs?)\b(?=\s*(?:[?:.,;!"'\u2018-\u201D]|$)|\s+(?:is|are|has|have|contains?|does|do|did|will|would|should|in|into|from|for|to|and|below|above|prints?|outputs?|returns?|match(?:es)?)\b)/i,
  /\bwhat\s+(?:does|will|would|did)\s+(?:this|that|these|the following)\b[^?]*\b(?:print|output|return|evaluate to|produce|log)\b/i,
  // Vocabulary items: "the French word for cat", "Which Spanish word means 'dog'?", "How do you say 'x' in Japanese?".
  new RegExp(String.raw`\b(?:${LANGUAGES})\s+(?:words?|phrases?|terms?|equivalent)\s+(?:for|means?|meaning)\b|\bwhich\s+(?:\w+\s+)?(?:words?|phrases?)\s+means?\b`, 'i'),
  new RegExp(String.raw`\bhow\s+(?:do|would|does|did|can)\s+(?:you|one|i|we)\s+say\b(?=.*(?:\s['"\u2018\u201C]|\b(?:in|into)\s+(?:${LANGUAGES})\b))`, 'i'),
];
const TASK_UNLESS_ABOUT_YOU = [
  /\btranslat\w*/i,
  new RegExp(String.raw`\b(?:in|into)\s+(?:${LANGUAGES})\b`, 'i'),
  /\b[Ww]hat(?:['\u2019]s|\s+is)\s+the\s+[A-Z][a-z]+\s+(?:word\s+)?for\b/, // "What is the French for ..."; case-sensitive
  /\bbest\s+(?:translation|answer|version|output|completion|solution)s?\b/i,
  /\b(?:this|that|these|the following)\s+(?:statements?|answers?|texts?|sentences?|paragraphs?)\b/i,
  /\b(?:fix(?:es)?|find|spot)\s+the\s+(?:bug|error|mistake|typo)\b/i,
];
// Opinion framing does not make a graded item about the agent: "In your view, which statement is true?".
const OPINION = /\b(?:in\s+your\s+(?:view|opinion|experience|judge?ment)|(?:do|would)\s+you\s+(?:think|say|guess|reckon|believe)|you\s+(?:think|believe))\b/gi;
// Grading items with one right answer: "Which of these SQL statements is correct?". Not when the options describe the
// agent ("I pay by card") or the stem is about "you"; "... is correct for you" is a preference.
const GRADING = /\bwhich\s+(?:(?:of\s+these|of\s+the\s+following|one)\s+)?(?:[\w-]+\s+){0,3}(?:is|are)\s+(?:the\s+)?(?:most\s+)?(?:correct|right|valid|accurate|grammatical|true)(?:\s+answer)?\b(?!\s+(?:for|in|about|of)\b)/i;
// Code, case-sensitive: only structural signals. Words like "function" or "code" and calls like "useState()" are prose;
// "C++", "c++", "g++" and "Notepad++" are names, so only a single-letter variable before ++ counts.
const CODE = /[{}]|=>|\b(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*=|\bfunction\s*[\w$]*\s*\(|\bdef\s+\w+\s*\(|\bprint\s*\((?=[^)]*[\d'"*+])|\b(?:elif|printf|console\.log|System\.out)\b|#include\b|\bSELECT\b.+\bFROM\b|\b(?:for|while|if|switch)\s*\((?=[^)]*[;=<>!]|(?:true|false)\))|\+=|\b[abd-fh-z]\+\+(?!\w)|\b[a-z]\w*\s*=\s*[a-z]\w*\s*[-+*/]\s*\w/;
// Arithmetic. "1-5", "$20-100", "10+ times" and "24/7" are ranges and phrases, not sums: + and / only count with spaces
// on both sides ("2 + 2", "100 / 4") or after "what is". Likert anchors ("1 = 0 times") are stripped before this runs.
const MATH = [
  /\d\s*(?:\*\*|[*\u00D7\u00F7^])\s*\d/,
  /(?<!\b(?:page|step|part|question|section|slide)\s*)(?<![\d.])\d+\s+[+/]\s+\d/i, // "(page 1 / 2)" is pagination
  /\d\s*=\s*-?\d/,
  /\bwhat(?:['\u2019]s|\s+is)\s+-?\d[\d.,]*\s*[-+*/\u00D7\u00F7^x]\s*\d/i,
  /\d\s+(?:times|plus|minus|multiplied\s+by|divided\s+by|to\s+the\s+power\s+of|mod(?:ulo)?)\s+-?\d/i,
  /(?:\b\d+[a-z]|\b[a-z])\s*(?:\*\*|[-+*/^])\s*\d+\s*=/i, // 2x + 3 = 11
  /\bwhat\s+(?:does|do|is)\s+[a-z]\s+equals?\b/i,
  /\bis\s+-?\d[\d,]*\s+(?:a\s+)?(?:prime|even|odd|divisible|perfect\s+square|multiple)\b/i,
  /\b(?:sqrt|square root of|integral of|derivative of|solve for)\b/i,
  /\d\s*%\s+of\s+-?\d/, // "15% of 200"; "10% of your budget" passes
  /\b(?:sum|product|difference|quotient|average|mean|remainder)\s+of\s+-?\d[\d.,]*\s+and\s+-?\d/i,
  /\d\s+(?:squared|cubed)\b/i,
];
// Secrets. Values and the places they live always block; naming an auth mechanism only warns (G4b decision):
// "How do you authenticate to APIs? (API keys / OAuth)" is research, "Where does your owner store API keys?" is not.
const POSSESSIVE_SRC = String.raw`(?:your|owner['\u2019]?s|their|its|the agent['\u2019]?s)`;
const POSSESSIVE = new RegExp(String.raw`\b${POSSESSIVE_SRC}`, 'i');
const SECRET = [
  /\b(?:private|secret|signing|signer)[ _-]?keys?\b|\bclient[ _-]?secrets?\b/i,
  /\b(?:seed|secret|recovery|backup|wallet|mnemonic)\s+(?:phrases?|words?)\b|\bmnemonics?\b|\b(?:12|24|twelve|twenty[ -]four)[ -]word\b/i,
  /\bid\.json\b|\bkey ?files?\b/i,
  /(?:^|\s)\.env\b/i,
  /\b[A-Z][A-Z0-9_]*_(?:KEY|SECRET|TOKEN|PASSWORD|PASSPHRASE|MNEMONIC|SEED)S?\b/, // env var names; case-sensitive
  new RegExp(String.raw`\b${POSSESSIVE_SRC}\s+(?:\w+\s+)?passwords?\b(?!\s+managers?\b)`, 'i'),
  new RegExp(String.raw`\b${POSSESSIVE_SRC}\s+(?:wallet\s+)?seeds?\b`, 'i'), // "your random seed" passes
  new RegExp(String.raw`\b${POSSESSIVE_SRC}\s+(?:\w+\s+)?(?:secrets?|pins?|otps?|2fa|totp)\b(?!\s+(?:apps?|methods?|devices?|providers?|managers?|settings?)\b)`, 'i'),
];
// Probing a secret a few characters at a time: a probe word, a secret-ish noun and a possessive, anywhere, any order.
const PROBE = /\b(?:first|last|\d+(?:st|nd|rd|th))\s+(?:\w+\s+)?(?:char(?:acter)?s?|letters?|digits?|bytes?|words?)\b|\b(?:chars?|characters?|letters?|digits?|bytes?|prefix(?:es)?|suffix(?:es)?)\b|\b(?:letter|character|byte|digit)\s+(?:starts?|begins?|ends?)\b|\b(?:words?|letters?|characters?|digits?)\s+(?:\w+\s+)?(?:comes?|appears?|is)\s+(?:first|last)\b/i;
const SECRETISH_SRC = String.raw`(?:keys?|secrets?|tokens?|seeds?|phrases?|mnemonics?|signers?|pubkeys?|address(?:es)?|wallets?|passwords?|pins?|otps?|key ?files?|backups?|id\.json)`;
const SECRETISH = new RegExp(String.raw`\b${SECRETISH_SRC}(?!\w)`, 'i');
// "starts with" only right after the secret noun: "your tokens start with ghp_" blocks, "your day starts with checking
// their wallet" and "your workflow begins with a wallet connection" pass.
const SECRET_STARTS = new RegExp(String.raw`\b${SECRETISH_SRC}\s+(?:(?:usually|always|normally|still|really|actually)\s+)?(?:starts?|begins?|ends?|starting|beginning|ending)\s+(?:with|in)\b`, 'i');
// The signing key described without naming it: "the key you sign with", "the string you use to sign transactions".
const SIGN_WITH = /\b(?:(?:you|it|your\s+\w+|the agent)\s+(?:uses?\s+to\s+)?signs?\s+(?:\w+\s+)?with|(?:use|uses|used)\s+to\s+sign)\b/i;
const SIGN_PROBE = /\b(?:keep|keeps|kept|contains?|letters?|characters?|chars?|digits?|bytes?)\b/i;
// PINs and passcodes of the owner; "a PIN app" is a product. Upper-case PIN only, so "pin a message" passes.
// Only a value ask counts ("Which PIN does your owner use?", "Does your PIN start with 1?"); naming PIN as a sign-in
// method ("PIN or biometrics", options "Passkey / PIN / Password") does not.
const PIN_ASK = /\b(?:which|what)(?:['\u2019]s|\s+is|\s+are)?\s+(?:the\s+|your\s+|their\s+)?(?:owner['\u2019]?s\s+)?(?:PINs?|pass ?codes?)\b|\b(?:PINs?|pass ?codes?)\s+(?:is|are|starts?|begins?|ends?|contains?|has|have)\b/i;
const PIN = [/\bPINs?\b(?!\s+(?:apps?|pads?|methods?|devices?|settings?|resets?|policy|policies)\b)/, /\bpass ?codes?\b(?!\s+(?:apps?|methods?|devices?|settings?|resets?|policy|policies)\b)/i];
const MECHANISM = /\b(?:(?:api[ _-]?keys?|(?:access|bearer|auth|refresh|session|oauth|api)\s+tokens?|credentials?|env(?:ironment)?\s+var(?:iable)?s?|key ?pairs?|passphrases?|(?:openai|anthropic|github|solana|wallet|ssh|gpg)\s+keys?)\b|passwords?\b(?!\s+managers?\b))/i;
// A mechanism plus "your" plus where/what it is asks for the secret itself.
const VALUE_ASK = /\b(?:stored?|stores|storing|kept|where|values?|contains?|containing|starts?|first|paste|share|send|show|reveal|holds?)\b/i;
// Secret values in first-person text (owner facts): well-known key prefixes, a long random-looking token, or
// "<secret word> is/=/: <value>". Combined with the question patterns above in `looksLikeSecret`.
const SECRET_VALUE = [
  /\bsk[-_][A-Za-z0-9_-]{8,}|\bgh[pousr]_[A-Za-z0-9]{4,}|\bxox[abprs]-|\bAKIA[0-9A-Z]{8,}|\beyJ[A-Za-z0-9_-]{8,}/,
  /(?<![\w+/=-])(?=[\w+/=-]*\d)(?=[\w+/=-]*[A-Za-z])[\w+/=-]{32,}/,
  /\b(?:secrets?|tokens?|pins?|otps?|pass ?codes?|seeds?)\s*(?:is|are|was|=|:)\s*\S/i,
  /\b(?:seed\s+phrases?|private\s+keys?|mnemonics?)\b/i,  /\[\s*(?:\d{1,3}\s*,\s*){15,}\d{1,3}/, // a JSON byte array (solana-keygen id.json, even partial)
];
// A BIP39-style seed phrase written out (any case, comma-separated or numbered): 12+ 3-8 letter words in a row with no
// other digits or punctuation and no English function words (BIP39 has none of these), so ordinary sentences break the run.
const FUNCTION_WORDS = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'from', 'into', 'are', 'was', 'were', 'has', 'have', 'had', 'but', 'not',
  'you', 'your', 'our', 'his', 'her', 'its', 'per', 'they', 'them', 'their', 'what', 'when', 'which', 'who', 'how', 'than', 'then', 'does', 'did',
  'can', 'will', 'would', 'should', 'could', 'also', 'very', 'just', 'some', 'most', 'more', 'every', 'each', 'uses', 'used', 'spends', 'month', 'week']);
const SEED_RUN = 12;
const looksLikeSeedPhrase = (text: string) => {
  let run = 0;
  // Case-folded; commas/semicolons separate words; list numbers ("1.", "2)") are skipped or stripped when glued ("1.abandon").
  for (const token of text.toLowerCase().split(/[\s,;]+/)) {
    if (!token || /^\d{1,2}[.):]?$/.test(token)) continue;
    const w = token.replace(/^\d{1,2}[.):-]/, '');
    run = /^[a-z]{3,8}$/.test(w) && !FUNCTION_WORDS.has(w) ? run + 1 : 0;
    if (run >= SEED_RUN) return true;
  }
  return false;
};
/**
 * True when free text carries or names a credential: key/password/token mentions (except "password manager"), secret
 * values and long random tokens. Used by the plugin's owner fact store so it never becomes the leak.
 */
export const looksLikeSecret = (text: string) =>
  SECRET.some((r) => r.test(text)) || MECHANISM.test(text) || SECRET_VALUE.some((r) => r.test(text)) || looksLikeSeedPhrase(text);
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
  const joined = all.join('\n');
  const stemT = stem.trim();
  const aboutYou = ABOUT_YOU.test(stemT.replace(QUOTED, '$1').replace(OPINION, ' '));
  const described = opts.filter((o) => !ESCAPE.test(o.trim()));
  const firstPerson = described.length > 0 && described.every((o) => FIRST_PERSON.test(o.trim()));
  const mathTexts = [q.type === 'likert_5' ? stripLikertAnchors(q.text) : q.text, ...opts];
  if (
    TASK_ALWAYS.some((r) => r.test(stemT)) ||
    (!aboutYou && TASK_UNLESS_ABOUT_YOU.some((r) => r.test(stemT))) ||
    (!aboutYou && !firstPerson && GRADING.test(stemT)) ||
    all.some((t) => CODE.test(t)) ||
    mathTexts.some((t) => MATH.some((r) => r.test(t)))
  ) {
    issue('task_request', 'block', 'campaigns ask about experience; they must not ask the agent to do work (code, maths, translation)');
  }
  const secret =
    all.some((t) => SECRET.some((r) => r.test(t))) ||
    ((PROBE.test(joined) || SECRET_STARTS.test(joined)) && SECRETISH.test(joined) && POSSESSIVE.test(joined)) ||
    (SIGN_WITH.test(joined) && (PROBE.test(joined) || SIGN_PROBE.test(joined) || VALUE_ASK.test(joined))) ||
    (PIN.some((r) => r.test(joined)) && PIN_ASK.test(joined) && POSSESSIVE.test(joined)) ||
    (MECHANISM.test(joined) && POSSESSIVE.test(joined) && VALUE_ASK.test(joined));
  if (secret) issue('credential_ask', 'block', 'never ask about keys, passwords, tokens or secrets');
  else if (MECHANISM.test(joined)) issue('auth_mechanism', 'warn', "mentions credentials; ask how agents authenticate, never about a secret's value or where it is kept");
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
