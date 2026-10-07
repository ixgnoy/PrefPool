// shared/test/report.test.ts
import { describe, expect, it } from 'vitest';
import { ed25519 } from '@noble/curves/ed25519.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { aggregate, answersValid, hashResearch, signSettlement, verifySettlementReport, type UnsignedSettlement } from '../src/report.js';
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
