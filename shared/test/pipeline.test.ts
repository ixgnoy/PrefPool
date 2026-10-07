// shared/test/pipeline.test.ts
import { describe, expect, it } from 'vitest';
import { ed25519, x25519 } from '@noble/curves/ed25519.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { addressFromSeed, campaignEscrowAddress } from '../src/address.js';
import { encodeCampaignAccount, type EscrowAccount } from '../src/escrowAccount.js';
import { sealEnvelope } from '../src/envelope.js';
import { runPipeline, type CreContext, type ReceivedEnvelope } from '../src/pipeline.js';
import { verifySettlementReport } from '../src/report.js';
import type { Question } from '../src/types.js';
import { base64 } from '@scure/base';

const PROGRAM = 'Cm1NmUPngoFke9pc8zXsK2qebBEfPb76bS3gHfjMS2hN';
const CAMPAIGN = 'cc'.repeat(32);
const ESCROW = campaignEscrowAddress(PROGRAM, CAMPAIGN);
const COMPANY = addressFromSeed('company');
const encSk = x25519.utils.randomSecretKey();
const encPk = bytesToHex(x25519.getPublicKey(encSk));
const repSk = ed25519.utils.randomSecretKey();
const repPk = bytesToHex(ed25519.getPublicKey(repSk));
const Q: Question[] = [
  { id: 'q1', type: 'single_choice', text: 'Slogan?', options: ['Pay less, live more', 'Your money, faster'] },
  { id: 'q2', type: 'likert_5', text: 'Trust?' },
];
const respondent = (i: number) => addressFromSeed(`respondent:${i}`);
// reward 0.0015 SOL, budget 0.045 SOL, max 30, min 15, deadline 1_000_000
const escrow: EscrowAccount = { address: ESCROW, owner: PROGRAM, lamports: '46500000', data: base64.encode(encodeCampaignAccount({
  campaignId: CAMPAIGN, company: COMPANY, reportPk: repPk, rewardLamports: 1_500_000n, budgetLamports: 45_000_000n,
  maxResponses: 30, minCohort: 15, deadlineMs: 1_000_000, refundAfterMs: 87_400_000 })) };

function input(n: number, extra: Partial<{ envelopes: ReceivedEnvelope[]; escrow: EscrowAccount | null }> = {}) {
  const addrs = Array.from({ length: n }, (_, i) => respondent(i + 1));
  const context: CreContext = { campaignId: CAMPAIGN, escrowTxRef: ESCROW, questions: Q, deadlineMs: 1_000_000, registered: addrs };
  const envelopes = addrs.map((a, i) => ({ ...sealEnvelope(encPk, context.campaignId, a, { q1: i % 2, q2: 4 }), receivedAtMs: 900_000 + i }));
  return {
    context, escrow, programId: PROGRAM, envelopes, envelopeSecretKey: bytesToHex(encSk), reportSecretKey: bytesToHex(repSk),
    nowIso: '2026-10-07T10:00:00.000Z', ...extra,
  };
}

describe('runPipeline', () => {
  it('pays 23 accepted respondents and refunds the rest to the company, with a verifiable report', () => {
    const { settlement, research } = runPipeline(input(23));
    expect(settlement.acceptedCount).toBe(23);
    expect(settlement.refundLamports).toBe('10500000');
    expect(settlement.refundAddress).toBe(COMPANY);
    expect(verifySettlementReport(settlement, repPk, { minCohort: 15, maxResponses: 30 })).toEqual([]);
    expect(research!.results.q1).toEqual({ 'Pay less, live more': 0.5217, 'Your money, faster': 0.4783 });
  });
  it('emits a zero-count full refund and no research below the cohort', () => {
    const { settlement, research } = runPipeline(input(14));
    expect(settlement.acceptedCount).toBe(0);
    expect(settlement.payouts).toEqual([]);
    expect(settlement.refundLamports).toBe('45000000');
    expect(research).toBeNull();
  });
  it('drops envelopes received after deadline', () => {
    const base = input(16);
    base.envelopes[0]!.receivedAtMs = 1_000_001;
    const { settlement } = runPipeline(base);
    expect(settlement.rejectionCounts.late).toBe(1);
    expect(settlement.acceptedCount).toBe(15);
  });
  it('keeps the first envelope per address and rejects unregistered, tampered and malformed ones', () => {
    const base = input(18);
    const dupe = { ...sealEnvelope(encPk, base.context.campaignId, base.context.registered[0]!, { q1: 1, q2: 1 }), receivedAtMs: 950_000 };
    const stranger = { ...sealEnvelope(encPk, base.context.campaignId, respondent(99), { q1: 1, q2: 1 }), receivedAtMs: 950_001 };
    const ct = base.envelopes[1]!.ct;
    base.envelopes[1] = { ...base.envelopes[1]!, ct: (parseInt(ct.slice(0, 2), 16) ^ 0xff).toString(16).padStart(2, '0') + ct.slice(2) };
    base.envelopes[2] = { ...sealEnvelope(encPk, base.context.campaignId, base.context.registered[2]!, { q1: 7, q2: 9 }), receivedAtMs: 900_002 };
    const { settlement } = runPipeline({ ...base, envelopes: [...base.envelopes, dupe, stranger] });
    expect(settlement.rejectionCounts).toEqual({ malformed: 2, duplicate: 1, ineligible: 1, late: 0 });
    expect(settlement.acceptedCount).toBe(16);
  });
  it('is deterministic regardless of envelope order (DON consensus)', () => {
    const base = input(20);
    const a = runPipeline(base);
    const b = runPipeline({ ...base, envelopes: [...base.envelopes].reverse() });
    expect(b.settlement.reportHash).toBe(a.settlement.reportHash);
  });
  it('refuses closed, foreign or misplaced escrows', () => {
    expect(() => runPipeline(input(20, { escrow: null }))).toThrow(/not found/);
    expect(() => runPipeline(input(20, { escrow: { ...escrow, owner: respondent(5) } }))).toThrow(/not owned/);
    expect(() => runPipeline(input(20, { escrow: { ...escrow, address: respondent(5) } }))).toThrow(/differs/);
    const other = input(20);
    expect(() => runPipeline({ ...other, context: { ...other.context, campaignId: 'dd'.repeat(32) } })).toThrow(/another campaign/);
  });
});

describe('runPipeline: personhood', () => {
  it('pays one human once even when they answer through two agents', () => {
    const base = input(16);
    const [a0, a1] = base.context.registered;
    base.context.personhood = { [a0!]: { kind: 'world', nullifier: '0xaa' }, [a1!]: { kind: 'world', nullifier: '0xaa' } };
    const { settlement, research } = runPipeline(base);
    expect(settlement.rejectionCounts.duplicate).toBe(1);
    expect(settlement.acceptedCount).toBe(15);
    expect(settlement.payouts.map((p) => p.address)).not.toContain(a1);
    expect(research).toMatchObject({ verifiedHumans: 1, simulatedHumans: 0 });
  });
  it('rejects unverified respondents as ineligible on a verified-humans-only campaign', () => {
    const base = input(18);
    base.context.verifiedHumansOnly = true;
    base.context.personhood = Object.fromEntries(base.context.registered.slice(0, 16)
      .map((a, i) => [a, { kind: i < 2 ? 'world' as const : 'simulated' as const, nullifier: `n${i}` }]));
    const { settlement, research } = runPipeline(base);
    expect(settlement.rejectionCounts.ineligible).toBe(2);
    expect(settlement.acceptedCount).toBe(16);
    expect(research).toMatchObject({ verifiedHumans: 2, simulatedHumans: 14 });
  });
  it('produces the same report as before when no personhood data is given', () => {
    const { research } = runPipeline(input(16));
    expect(research).not.toHaveProperty('verifiedHumans');
    expect(research).not.toHaveProperty('simulatedHumans');
  });
});

describe('runPipeline: calibration', () => {
  it('rejects uncalibrated respondents on a calibrated-agents-only campaign and counts calibrated ones', () => {
    const base = input(18);
    base.context.calibratedAgentsOnly = true;
    base.context.calibratedUntil = Object.fromEntries(base.context.registered.slice(0, 16).map((a, i) => [a, i === 0 ? 999_999 : 2_000_000]));
    const { settlement, research } = runPipeline(base);
    expect(settlement.rejectionCounts.ineligible).toBe(3); // two with no pass, one expired before the deadline (1_000_000)
    expect(settlement.acceptedCount).toBe(15);
    expect(research).toMatchObject({ calibratedAgents: 15 });
  });
  it('leaves the report unchanged when no calibration data is given', () => {
    expect(runPipeline(input(16)).research).not.toHaveProperty('calibratedAgents');
  });
});

describe('runPipeline: on-chain settlement signature', () => {
  it('signs the settle payload with the report key, so the escrow can verify it', async () => {
    const { verifySettlePayload } = await import('../src/settlePayload.js');
    const { settlement } = runPipeline(input(16));
    expect(settlement.settleSignature).toMatch(/^[0-9a-f]{128}$/);
    expect(verifySettlePayload(settlement, settlement.settleSignature, repPk)).toBe(true);
    expect(verifySettlementReport(settlement, repPk, { minCohort: 15, maxResponses: 30 })).toEqual([]);
  });
  it('flags a report whose on-chain signature does not match its payouts', () => {
    const { settlement } = runPipeline(input(16));
    const tampered = { ...settlement, settleSignature: settlement.settleSignature.replace(/^../, '00') };
    expect(verifySettlementReport(tampered, repPk, { minCohort: 15, maxResponses: 30 })).toContain('bad settle signature');
  });
  it('reports answer sources and clients from v2 envelopes', () => {
    const base = input(16);
    const meta = { sources: { q1: 'owner_told' as const, q2: 'checked' as const }, client: { name: 'agent-survey-mcp', version: '0.2.0' } };
    base.envelopes = base.envelopes.map((e, i) => ({ ...sealEnvelope(encPk, CAMPAIGN, base.context.registered[i]!, { q1: i % 2, q2: 4 }, meta), receivedAtMs: e.receivedAtMs }));
    const { research, settlement } = runPipeline(base);
    expect(research!.sources!.q1).toEqual({ checked: 0, owner_told: 16, inferred: 0, unknown: 0 });
    expect(research!.sources!.q2).toEqual({ checked: 16, owner_told: 0, inferred: 0, unknown: 0 });
    expect(research!.clients).toEqual({ 'agent-survey-mcp': 16 });
    // Same envelopes in another arrival order on the wire: byte-identical report.
    const again = runPipeline({ ...base, envelopes: [...base.envelopes].reverse() });
    expect(again.settlement.resultHash).toBe(settlement.resultHash);
  });
  it('counts v1 envelopes as unknown source and client', () => {
    const { research } = runPipeline(input(16));
    expect(research!.sources!.q2.unknown).toBe(16);
    expect(research!.clients).toEqual({ unknown: 16 });
  });
});
