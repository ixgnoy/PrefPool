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

describe('lintCampaign', () => {
  it('prefixes every message with the question id', () => {
    const issues = lintCampaign({ category: 'payments', questions: [sc('Which?', ['Card', 'Both'], 'q4')] });
    expect(issues.find((i) => i.rule === 'meta_option')!.message).toMatch(/^q4: /);
  });
});
