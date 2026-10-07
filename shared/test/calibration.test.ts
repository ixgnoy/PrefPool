import { describe, expect, it } from 'vitest';
import { CALIBRATION_MIN_AGREEMENT, CALIBRATION_MIN_LIFT, UNCALIBRATED_REASON, calibrationGate, majorityAnswer, majorityShare, scoreRound, type CalibrationQuestion } from '../src/calibration.js';

const sc = (id: string, prior = [0.6, 0.3, 0.1]): CalibrationQuestion => ({ id, text: id, type: 'single_choice', options: ['a', 'b', 'c'], category: 'food', prior });
const lk = (id: string): CalibrationQuestion => ({ id, text: id, type: 'likert_5', category: 'tech', prior: [0.1, 0.1, 0.2, 0.3, 0.3] });

describe('majorityAnswer', () => {
  it('uses the prior until a question has 30 answers, then the counts', () => {
    expect(majorityAnswer(sc('q'), undefined)).toBe(0);
    expect(majorityAnswer(sc('q'), [1, 20, 0])).toBe(0); // 21 answers: still the prior
    expect(majorityAnswer(sc('q'), [5, 25, 2])).toBe(1);
  });
  it('uses the rounded mean for likert (1..5)', () => {
    expect(majorityAnswer(lk('l'), undefined)).toBe(4); // 0.1*1+0.1*2+0.2*3+0.3*4+0.3*5 = 3.6
    expect(majorityAnswer(lk('l'), [0, 0, 30, 0, 0])).toBe(3);
  });
});

describe('scoreRound', () => {
  const qs = [sc('a'), sc('b'), sc('c'), lk('d')];
  const owner = { a: 1, b: 2, c: 0, d: 5 };
  const majority = { a: 0, b: 0, c: 0, d: 4 };
  it('passes an agent that knows its owner', () => {
    const r = scoreRound(qs, { a: 1, b: 2, c: 0, d: 5 }, owner, majority);
    expect(r).toMatchObject({ agreement: 1, passed: true });
    expect(r.baseline).toBeCloseTo((0 + 0 + 1 + 0.75) / 4);
  });
  it('fails a generic agent that gives the popular answer (no lift)', () => {
    const r = scoreRound(qs, majority, owner, majority);
    expect(r.lift).toBe(0);
    expect(r.passed).toBe(false);
  });
  it('scores unknown as a miss, and likert by distance', () => {
    expect(scoreRound(qs, { a: 'unknown', b: 'unknown', c: 'unknown', d: 'unknown' }, owner, majority).agreement).toBe(0);
    expect(scoreRound([lk('d')], { d: 4 }, { d: 5 }, { d: 1 }).agreement).toBe(0.75);
  });
  it('needs both 70% agreement and 20 points of lift', () => {
    expect([CALIBRATION_MIN_AGREEMENT, CALIBRATION_MIN_LIFT]).toEqual([0.7, 0.2]);
    const ten = Array.from({ length: 10 }, (_, i) => sc(`q${i}`));
    const own = Object.fromEntries(ten.map((q) => [q.id, 1]));
    const maj = Object.fromEntries(ten.map((q, i) => [q.id, i < 5 ? 1 : 0])); // baseline 0.5
    const agentN = (n: number) => Object.fromEntries(ten.map((q, i) => [q.id, i < n ? 1 : 2]));
    expect(scoreRound(ten, agentN(7), own, maj).passed).toBe(true);   // 0.7 agreement, 0.2 lift
    expect(scoreRound(ten, agentN(6), own, maj).passed).toBe(false);  // 0.6
  });
});

describe('calibrationGate', () => {
  it('only restricts calibrated-only campaigns, by validity at the given time', () => {
    expect(calibrationGate({}, null, 1)).toEqual({ ok: true });
    expect(calibrationGate({ calibratedAgentsOnly: true }, null, 1)).toEqual({ ok: false, reason: UNCALIBRATED_REASON });
    expect(calibrationGate({ calibratedAgentsOnly: true }, 100, 200)).toEqual({ ok: false, reason: UNCALIBRATED_REASON });
    expect(calibrationGate({ calibratedAgentsOnly: true }, 300, 200)).toEqual({ ok: true });
  });
});

describe('majorityShare', () => {
  it('uses counts once there are enough, else the prior', () => {
    const q = { type: 'single_choice' as const, prior: [0.35, 0.35, 0.3] };
    expect(majorityShare(q, undefined)).toBe(0.35);
    expect(majorityShare(q, [27, 2, 1])).toBe(0.9);
    expect(majorityShare(q, [9, 0, 0])).toBe(0.35); // 9 < CALIBRATION_MIN_COUNTS
  });
});
