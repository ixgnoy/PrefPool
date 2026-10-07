// shared/test/lint.test.ts
import { describe, expect, it } from 'vitest';
import { lintCampaign, lintQuestion } from '../src/lint.js';
import type { Question } from '../src/types.js';

const sc = (text: string, options: string[], id = 'q1'): Question => ({ id, type: 'single_choice', text, options });
const rules = (q: Question, level?: 'block' | 'warn') => lintQuestion(q).filter((i) => !level || i.level === level).map((i) => i.rule);

describe('lintQuestion blocks what small models answer wrong', () => {
  it('passes the demo questions', () => {
    expect(rules(sc("Which ways can you pay for things on your owner's behalf today?", ['Card through a payment service', 'Crypto wallet', 'Card and crypto wallet', 'None yet']), 'block')).toEqual([]);
    expect(rules({ id: 'q2', type: 'likert_5', text: "How often is a task blocked because you can't log in or pay? (1 = never, 5 = very often)" }, 'block')).toEqual([]);
    expect(rules(sc('Roughly how much does your owner spend on AI tools per month?', ['Under $20', '$20-100', 'Over $100']), 'block')).toEqual([]);
  });
  it('blocks negated stems but not negatives inside likert anchors', () => {
    expect(rules(sc('Which of these tools do you NOT use?', ['a', 'b', 'None yet']), 'block')).toContain('negated_stem');
    expect(rules(sc('Which tool is the least useful?', ['a', 'b', 'None yet']), 'block')).toContain('negated_stem');
    expect(rules({ id: 'q', type: 'likert_5', text: 'How often do you pay online? (1 = never, 5 = daily)' }, 'block')).toEqual([]);
  });
  it('blocks options that refer to other options', () => {
    expect(rules(sc('Which do you use?', ['Card', 'Crypto', 'Both']), 'block')).toContain('meta_option');
    expect(rules(sc('Which do you use?', ['Card', 'Crypto', 'None of the above']), 'block')).toContain('meta_option');
    expect(rules(sc('Which do you use?', ['Card', 'Crypto', 'A and B']), 'block')).toContain('meta_option');
    expect(rules(sc('Which do you use?', ['Card', 'Crypto', 'None']), 'block')).toEqual([]); // "None" is an escape, not a reference
  });
  it('blocks too many, duplicate, empty and overlapping options', () => {
    expect(rules(sc('Pick one', ['a', 'b', 'c', 'd', 'e', 'f']), 'block')).toContain('too_many_options');
    expect(rules(sc('Pick one', ['Card', 'card ', 'Crypto']), 'block')).toContain('duplicate_option');
    expect(rules(sc('Pick one', ['Card', ' ', 'Crypto']), 'block')).toContain('empty_option');
    expect(rules(sc('Age?', ['18-25', '25-34', '35-44']), 'block')).toContain('overlapping_ranges');
    expect(rules(sc('Age?', ['18-24', '25-34', '35-44']), 'block')).toEqual([]);
  });
  it('blocks unlabeled likert scales and markup', () => {
    expect(rules({ id: 'q', type: 'likert_5', text: 'How much do you trust your tools?' }, 'block')).toContain('likert_anchors');
    expect(rules(sc('See https://x.y and pick', ['a', 'b']), 'block')).toContain('markup');
    expect(rules(sc('Pick', ['<b>a</b>', 'b']), 'block')).toContain('markup');
  });
});

describe('lintQuestion warns on wording that skews answers', () => {
  it('flags double-barreled, leading, vague, acquiescence and missing escape options', () => {
    expect(rules(sc('How do you pay and which wallet do you use?', ['Card', 'Crypto', 'None yet']), 'warn')).toContain('double_barreled');
    expect(rules(sc("Don't you agree crypto is better?", ['Yes', 'No']), 'warn')).toEqual(expect.arrayContaining(['leading', 'acquiescence', 'no_escape']));
    expect(rules(sc('How often?', ['Often', 'Sometimes', 'Never']), 'warn')).toContain('vague_quantifier');
  });
  it('flags long stems and unbalanced options', () => {
    expect(rules(sc(Array(31).fill('word').join(' ') + '?', ['a', 'b', 'None yet']), 'warn')).toContain('stem_long');
    expect(rules(sc('Pick', ['Card', 'Crypto wallet connected through a browser extension', 'None yet']), 'warn')).toContain('option_imbalance');
  });
});

describe('lint regressions from review (no false blocks, no missed negations)', () => {
  it('only compares ranges with the same shape and parses thousands separators', () => {
    expect(rules(sc('How often?', ['1-2 times a week', '1-2 times a month', 'Not at all']), 'block')).toEqual([]);
    expect(rules(sc('How long?', ['1-5 minutes', '1-5 hours', 'Not sure']), 'block')).toEqual([]);
    expect(rules(sc('Company size?', ['1-10', '11-50', '51-200', '201-1,000', '1,001-5,000']), 'block')).toEqual([]);
    expect(rules(sc('Which model?', ['GPT-4', 'Claude 3-5', 'Llama 3-8B', 'Not sure']), 'block')).toEqual([]);
    expect(rules(sc('Age?', ['18-25', '25-34', 'Prefer not to say']), 'block')).toContain('overlapping_ranges');
    expect(rules(sc('Spend?', ['$0-$20', '$20-$100', 'Not sure']), 'block')).toContain('overlapping_ranges');
    expect(rules(sc('Company size?', ['1-1,000', '500-5,000', 'Not sure']), 'block')).toContain('overlapping_ranges');
  });
  it('normalizes options without dropping symbols or non-Latin letters', () => {
    expect(rules(sc('Which language?', ['C++', 'C#', 'C', 'Other']), 'block')).toEqual([]);
    expect(rules(sc('Как вы платите?', ['Карта', 'Крипто', 'Нет']), 'block')).toEqual([]);
    expect(rules(sc('Pick one', ['Card', 'ＣＡＲＤ', 'Other']), 'block')).toContain('duplicate_option');
  });
  it('blocks lower-case negations with a subject between auxiliary and not', () => {
    expect(rules(sc('Which of these tools do you not use?', ['a', 'b', 'None yet']), 'block')).toContain('negated_stem');
    expect(rules(sc('Which tools are you not using?', ['a', 'b', 'None yet']), 'block')).toContain('negated_stem');
    expect(rules(sc('Which tools have you not been able to install?', ['a', 'b', 'None yet']), 'block')).toContain('negated_stem');
    expect(rules(sc('Which tools has your owner never paid for?', ['a', 'b', 'None yet']), 'block')).toContain('negated_stem');
  });
  it('does not treat "at least" as a negation', () => {
    expect(rules(sc('Do you pay for at least one AI tool?', ['Yes, one or more', 'No AI tools paid', 'Not sure']), 'block')).toEqual([]);
  });
  it('lets brand names with & pass and splits out free-text options', () => {
    expect(rules(sc('Which channel?', ['A&E', 'B&B', 'D&D', 'None']), 'block')).toEqual([]);
    expect(rules(sc('Which?', ['Card', 'Crypto', 'A & B']), 'block')).toContain('meta_option');
    expect(rules(sc('Which?', ['Card', 'Crypto', 'A+B']), 'block')).toContain('meta_option');
    const free = lintQuestion(sc('Which?', ['Card', 'Crypto', 'Other (please specify)']));
    expect(free.map((i) => i.rule)).toContain('free_text_option');
    expect(free.map((i) => i.rule)).not.toContain('meta_option');
    expect(free.find((i) => i.rule === 'free_text_option')!.message).toBe('q1: agents cannot type a free answer; use "Other"');
  });
  it('treats "Neither" as an escape when it follows exactly two options', () => {
    expect(rules(sc('Which do you prefer?', ['Card', 'Crypto', 'Neither']))).not.toEqual(expect.arrayContaining(['meta_option']));
    expect(rules(sc('Which do you prefer?', ['Card', 'Crypto', 'Neither']), 'warn')).not.toContain('no_escape');
    expect(rules(sc('Which do you prefer?', ['Card', 'Crypto', 'Wallet', 'Neither']), 'block')).toContain('meta_option');
  });
  it('accepts common likert anchor formats and still rejects unlabeled scales', () => {
    const lk = (text: string) => rules({ id: 'q', type: 'likert_5', text }, 'block');
    expect(lk('How often do you pay online? (1 - never ... 5 - always)')).toEqual([]);
    expect(lk('How often do you pay online? (1: never, 5: always)')).toEqual([]);
    expect(lk('On a scale from 1 (never) to 5 (always), how often do you pay online?')).toEqual([]);
    expect(lk('How often do you pay online? (1 = never 5 = always)')).toEqual([]);
    expect(lk('How often do you pay online? (1 \u2013 never, 5 \u2013 always)')).toEqual([]);
    expect(lk('How often do you pay online?')).toContain('likert_anchors');
    expect(lk('On a 1-5 scale, how often do you pay online?')).toContain('likert_anchors');
  });
  it('ignores negatives inside likert anchors even without parentheses', () => {
    expect(rules({ id: 'q', type: 'likert_5', text: 'How useful is your wallet? 1 = NOT useful, 5 = very useful' }, 'block')).toEqual([]);
  });
  it('allows five substantive options plus one escape option', () => {
    expect(rules(sc('Pick one', ['a', 'b', 'c', 'd', 'e', 'None yet']), 'block')).toEqual([]);
    expect(rules(sc('Pick one', ['a', 'b', 'c', 'd', 'e', 'f', 'None yet']), 'block')).toContain('too_many_options');
    expect(rules(sc('Pick one', ['a', 'b', 'c', 'd', 'e', 'None yet', 'Not sure']), 'block')).toContain('too_many_options');
  });
  it('accepts curly apostrophes', () => {
    expect(rules(sc('Don\u2019t you agree crypto is better?', ['Crypto is better', 'Cards are better', 'Don\u2019t know']), 'warn')).toContain('leading');
    expect(rules(sc('Don\u2019t you agree crypto is better?', ['Crypto is better', 'Cards are better', 'Don\u2019t know']), 'block')).toContain('negated_stem');
    expect(rules(sc('Don\u2019t you agree crypto is better?', ['Crypto is better', 'Cards are better', 'Don\u2019t know']), 'warn')).not.toContain('no_escape');
    expect(rules(sc('How often is a task blocked because you can\u2019t pay?', ['Daily', 'Weekly', 'None yet']), 'warn')).toContain('negation');
  });
  it('does not treat comparison signs as markup', () => {
    expect(rules(sc('How fast is checkout?', ['< a second', '<1s', '<a few ms', 'Not sure']), 'block')).toEqual([]);
    expect(rules(sc('Pick', ['<script>x', 'b']), 'block')).toContain('markup');
    expect(rules(sc('Pick', ['<!-- hi -->', 'b']), 'block')).toContain('markup');
  });
});

describe('lint re-review regressions (contracted negations, broader anchors)', () => {
  it('blocks contracted negations followed by a subject', () => {
    const blocks = (text: string) => rules(sc(text, ['a', 'b', 'None yet']), 'block');
    expect(blocks("Which tools don't you use?")).toContain('negated_stem');
    expect(blocks("Which payment rails can't you access today?")).toContain('negated_stem');
    expect(blocks('Which payment rails can\u2019t you access today?')).toContain('negated_stem');
    expect(blocks('Which rails cannot you access?')).toContain('negated_stem');
    expect(blocks("Which tools won't your owner allow?")).toContain('negated_stem');
    expect(blocks("Why don't you pay with crypto?")).toContain('negated_stem');
  });
  it('keeps the demo likert stem a soft negation', () => {
    const q: Question = { id: 'q2', type: 'likert_5', text: "How often is a task blocked because you can't log in or pay? (1 = never, 5 = very often)" };
    expect(rules(q, 'block')).toEqual([]);
    expect(rules(q, 'warn')).toContain('negation');
  });
  it('accepts likert labels in any script and numeric labels', () => {
    const lk = (text: string) => rules({ id: 'q', type: 'likert_5', text }, 'block');
    expect(lk('Как часто вы платите онлайн? (1 = никогда, 5 = ежедневно)')).toEqual([]);
    expect(lk('How many failed payments last month? (1 = 0 times, 5 = 10+ times)')).toEqual([]);
    expect(lk('How satisfied are you with checkout? 1 Very dissatisfied - 5 Very satisfied')).toEqual([]);
    expect(lk('How satisfied are you with checkout?')).toContain('likert_anchors');
    expect(lk('On a 1-5 scale, how satisfied are you with checkout?')).toContain('likert_anchors');
    expect(lk('From 1 to 5 how satisfied are you with checkout?')).toContain('likert_anchors');
  });
  it('only strips anchor text from likert questions', () => {
    expect(rules(sc('Which 1 tool do you NOT use out of these 5 tools?', ['a', 'b', 'None yet']), 'block')).toContain('negated_stem');
  });
});

describe('lint: space-only likert anchors need a capitalized label', () => {
  const lk = (text: string) => rules({ id: 'q', type: 'likert_5', text }, 'block');
  it('does not read ordinary numbers in a sentence as anchors', () => {
    expect(lk('In the last 1 month, how often did checkout take over 5 minutes?')).toContain('likert_anchors');
  });
  it('does not strip a negation that sits between a stray 1 and 5', () => {
    expect(lk('In 1 week, how often do you NOT pay within 5 days? (1 = never, 5 = always)')).toContain('negated_stem');
  });
  it('still accepts a space-only anchor with capitalized labels', () => {
    expect(lk('How satisfied are you with checkout? 1 Very dissatisfied - 5 Very satisfied')).toEqual([]);
    expect(lk('How satisfied are you with checkout? 1 very dissatisfied - 5 very satisfied')).toContain('likert_anchors');
  });
});

describe('lintCampaign', () => {
  it('prefixes every message with the question id', () => {
    const issues = lintCampaign({ category: 'payments', questions: [sc('Which?', ['Card', 'Both'], 'q4')] });
    expect(issues.find((i) => i.rule === 'meta_option')!.message).toMatch(/^q4: /);
  });
});
