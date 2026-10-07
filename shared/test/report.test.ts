// shared/test/report.test.ts
import { describe, expect, it } from 'vitest';
import { ed25519 } from '@noble/curves/ed25519.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { LOW_DISPERSION, aggregate, answersValid, clientCounts, dispersion, hashResearch, sourceCounts, signSettlement, verifySettlementReport, type UnsignedSettlement } from '../src/report.js';
import type { Question } from '../src/types.js';
import { addressFromSeed, campaignEscrowAddress } from '../src/address.js';

const sk = ed25519.utils.randomSecretKey();
const pk = bytesToHex(ed25519.getPublicKey(sk));
// Payees must be real wallet addresses: the escrow program pays them from the signed payload.
const addr = (i: number) => addressFromSeed(`payee:${i}`);

function unsigned(n: number): UnsignedSettlement {
  const payouts = Array.from({ length: n }, (_, i) => ({ address: addr(i), lamports: '1500000' }));
  const total = 1_500_000n * BigInt(n);
  return {
    schemaVersion: 1, campaignId: 'cc'.repeat(32), escrowTxRef: campaignEscrowAddress('Cm1NmUPngoFke9pc8zXsK2qebBEfPb76bS3gHfjMS2hN', 'cc'.repeat(32)),
    escrowedLamports: '45000000', rewardPerResponseLamports: '1500000', acceptedCount: n, payouts,
    payoutTotalLamports: total.toString(), refundAddress: addressFromSeed('company'),
    refundLamports: (45_000_000n - total).toString(),
    rejectionCounts: { malformed: 0, duplicate: 0, ineligible: 0, late: 0 },
    resultHash: hashResearch(null), timestamp: '2026-10-07T10:00:00.000Z',
  };
}
const limits = { minCohort: 15, maxResponses: 30 };

describe('settlement report', () => {
  it('signs and verifies a 23-payout report', () => {
    expect(verifySettlementReport(signSettlement(unsigned(23), bytesToHex(sk)), pk, limits)).toEqual([]);
  });
  it('accepts a zero-count full refund', () => {
    expect(verifySettlementReport(signSettlement(unsigned(0), bytesToHex(sk)), pk, limits)).toEqual([]);
  });
  it('hash does not depend on key order', () => {
    const a = signSettlement(unsigned(15), bytesToHex(sk));
    const reordered = Object.fromEntries(Object.entries(a).reverse()) as typeof a;
    expect(verifySettlementReport(reordered, pk, limits)).toEqual([]);
  });
  it('detects tampering, skew, duplicates and bad cohort', () => {
    const r = signSettlement(unsigned(23), bytesToHex(sk));
    expect(verifySettlementReport({ ...r, refundLamports: '1' }, pk, limits)).toContain('reportHash mismatch');
    const skew = unsigned(23);
    skew.payouts[0] = { address: addr(0), lamports: '3000000' };
    skew.payouts.pop();
    expect(verifySettlementReport(signSettlement(skew, bytesToHex(sk)), pk, limits)).toContain('payouts.length != acceptedCount');
    const dup = unsigned(23);
    dup.payouts[1] = { ...dup.payouts[0]! };
    expect(verifySettlementReport(signSettlement(dup, bytesToHex(sk)), pk, limits)).toContain('duplicate payout address');
    expect(verifySettlementReport(signSettlement(unsigned(14), bytesToHex(sk)), pk, limits)).toContain('acceptedCount out of range');
  });
  it('rejects a signature from another key', () => {
    const other = ed25519.utils.randomSecretKey();
    expect(verifySettlementReport(signSettlement(unsigned(23), bytesToHex(other)), pk, limits)).toContain('bad signature');
  });
});

const Q: Question[] = [
  { id: 'q1', type: 'single_choice', text: 'Slogan?', options: ['A', 'B'] },
  { id: 'q2', type: 'likert_5', text: 'Trust?' },
];

describe('aggregate / answersValid', () => {
  it('computes option shares', () => {
    const r = aggregate(Q, [{ q1: 0, q2: 5 }, { q1: 1, q2: 5 }, { q1: 1, q2: 1 }]);
    expect(r.q1).toEqual({ A: 0.3333, B: 0.6667 });
    expect(r.q2).toEqual({ '1': 0.3333, '2': 0, '3': 0, '4': 0, '5': 0.6667 });
  });
  it('validates answers strictly', () => {
    expect(answersValid(Q, { q1: 1, q2: 3 })).toBe(true);
    expect(answersValid(Q, { q1: 2, q2: 3 })).toBe(false);
    expect(answersValid(Q, { q1: 1, q2: 6 })).toBe(false);
    expect(answersValid(Q, { q1: 1 })).toBe(false);
    expect(answersValid(Q, { q1: 1, q2: 3, q9: 1 })).toBe(false);
    expect(answersValid(Q, { q1: 0.5, q2: 3 })).toBe(false);
  });
});

describe('clientCounts', () => {
  it('folds buckets under 3 into other', () => {
    const m = (name: string, modelId?: string) => ({ sources: {}, client: { name, version: '1', ...(modelId ? { modelId } : {}) } });
    expect(clientCounts([m('a'), m('a'), m('a'), m('b', 'rare-7b'), null])).toEqual({ a: 3, other: 2 });
  });
  it('keys by name and model id, sorted, independent of input order', () => {
    const m = (name: string, modelId?: string) => ({ sources: {}, client: { name, version: '1', ...(modelId ? { modelId } : {}) } });
    const metas = [m('z'), m('a', 'm1'), m('z'), null, m('a', 'm1'), null, m('z'), m('a', 'm1'), null];
    const out = clientCounts(metas);
    expect(out).toEqual({ 'a (m1)': 3, unknown: 3, z: 3 });
    expect(Object.keys(out)).toEqual(['a (m1)', 'unknown', 'z']);
    expect(JSON.stringify(clientCounts([...metas].reverse()))).toBe(JSON.stringify(out));
  });
  it('keeps a client literally named __proto__ as a plain key', () => {
    const m = { sources: {}, client: { name: '__proto__', version: '1' } };
    const out = clientCounts([m, m, m]);
    expect(Object.keys(out)).toEqual(['__proto__']);
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
  });
});

describe('sourceCounts', () => {
  it('counts per question; missing, unknown tags and v1 count as unknown', () => {
    const qs: Question[] = [{ id: 'q1', type: 'likert_5', text: 'a' }, { id: 'q2', type: 'likert_5', text: 'b' }];
    const out = sourceCounts(qs, [
      { sources: { q1: 'checked', q2: 'owner_told' }, client: { name: 'a', version: '1' } },
      { sources: { q1: 'inferred' }, client: { name: 'a', version: '1' } },
      { sources: { q1: 'made_up' as never }, client: { name: 'a', version: '1' } },
      null,
    ]);
    expect(out).toEqual({
      q1: { checked: 1, owner_told: 0, inferred: 1, unknown: 2 },
      q2: { checked: 0, owner_told: 1, inferred: 0, unknown: 3 },
    });
  });
});

describe('dispersion', () => {
  it('is 0 when everyone agrees and 1 for an even spread', () => {
    expect(dispersion({ q1: { a: 1, b: 0 }, q2: { a: 0.5, b: 0.5 }, q3: { '1': 0.2, '2': 0.2, '3': 0.2, '4': 0.2, '5': 0.2 } })).toEqual({ q1: 0, q2: 1, q3: 1 });
    expect(dispersion({ q1: { a: 0.9, b: 0.1 } }).q1).toBeLessThan(LOW_DISPERSION + 0.15);
  });
  it('rounds to 4 decimals, keeps question order, and treats single-option questions as 0', () => {
    const d = dispersion({ z: { a: 0.7, b: 0.2, c: 0.1 }, a: { only: 1 } });
    expect(Object.keys(d)).toEqual(['z', 'a']);
    expect(d.z).toBe(Math.round(d.z * 10_000) / 10_000);
    expect(d.a).toBe(0);
  });
});
