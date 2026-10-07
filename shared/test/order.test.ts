// shared/test/order.test.ts
import { describe, expect, it } from 'vitest';
import { canonicalAnswers, optionOrder, orderKey, shownQuestion } from '../src/order.js';
import type { Question } from '../src/types.js';

describe('optionOrder', () => {
  it('is a deterministic permutation', () => {
    const a = optionOrder('k1', 5);
    expect([...a].sort()).toEqual([0, 1, 2, 3, 4]);
    expect(optionOrder('k1', 5)).toEqual(a);
  });
  it('differs between agents', () => {
    const orders = new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((k) => optionOrder(orderKey(k, 'camp', 'q1'), 4).join('')));
    expect(orders.size).toBeGreaterThan(1);
  });
  it('maps shown positions back to canonical indexes and leaves likert alone', () => {
    const qs: Question[] = [
      { id: 'q1', type: 'single_choice', text: 't', options: ['a', 'b', 'c', 'd'] },
      { id: 'q2', type: 'likert_5', text: 't (1 = never, 5 = always)' },
    ];
    const { question, order } = shownQuestion(qs[0]!, 'agent', 'camp');
    const shownIdx = question.options!.indexOf('c');
    expect(order![shownIdx]).toBe(2);
    expect(canonicalAnswers(qs, 'agent', 'camp', { q1: shownIdx, q2: 4 })).toEqual({ q1: 2, q2: 4 });
    expect(canonicalAnswers(qs, 'agent', 'camp', { q1: 9, q2: 4 }).q1).toBe(-1); // out of range fails answersValid later
    expect(shownQuestion(qs[1]!, 'agent', 'camp')).toEqual({ question: qs[1], order: null });
  });
});
