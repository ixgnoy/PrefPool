// chain/test/chain.test.ts
import { describe, expect, it } from 'vitest';
import { ComputeBudgetProgram, Keypair, SystemProgram, Transaction } from '@solana/web3.js';
import { ed25519 } from '@noble/curves/ed25519.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { base64 } from '@scure/base';
import {
  addressFromSeed, campaignEscrowAddress, encodeCampaignAccount, hashResearch, settleDigestHex, signSettlement,
  type CampaignDatumFields, type EscrowAccount, type SettlementReport,
} from '@as/shared';
import {
  ESCROW_PROGRAM_ID, checkFundingTx, checkReportAgainstChain, escrowInstructionName, fundInstruction, refundInstruction,
  settleFromReport, settleInstructions, submitErrorMessage, submitSignedTx, type ChainReader,
} from '../src/index.js';

const repSk = ed25519.utils.randomSecretKey();
const repPk = bytesToHex(ed25519.getPublicKey(repSk));
const company = Keypair.generate();
const datum: CampaignDatumFields = {
  campaignId: 'cc'.repeat(32), company: company.publicKey.toBase58(), reportPk: repPk,
  rewardLamports: 10_000_000n, budgetLamports: 200_000_000n, maxResponses: 20, minCohort: 15,
  deadlineMs: 1_800_000_000_000, refundAfterMs: 1_800_086_400_000,
};
const ESCROW = campaignEscrowAddress(ESCROW_PROGRAM_ID, datum.campaignId);
const escrow: EscrowAccount = { address: ESCROW, owner: ESCROW_PROGRAM_ID, lamports: '201000000', data: base64.encode(encodeCampaignAccount(datum)) };

function report(n: number, over: Partial<SettlementReport> = {}): SettlementReport {
  const payouts = Array.from({ length: n }, (_, i) => ({ address: addressFromSeed(`p${i}`), lamports: '10000000' }));
  const paid = 10_000_000n * BigInt(n);
  return signSettlement({
    schemaVersion: 1, campaignId: datum.campaignId, escrowTxRef: ESCROW, escrowedLamports: '200000000',
    rewardPerResponseLamports: '10000000', acceptedCount: n, payouts, payoutTotalLamports: paid.toString(),
    refundAddress: datum.company, refundLamports: (200_000_000n - paid).toString(),
    rejectionCounts: { malformed: 0, duplicate: 0, ineligible: 0, late: 0 }, resultHash: hashResearch(null),
    timestamp: '2026-10-07T00:00:00.000Z', ...over,
  }, bytesToHex(repSk));
}

function signedFundTx(ixs: Transaction['instructions'], payer = company) {
  const tx = new Transaction({ feePayer: payer.publicKey, blockhash: '11111111111111111111111111111111', lastValidBlockHeight: 1 }).add(...ixs);
  tx.sign(payer);
  return tx.serialize().toString('base64');
}

describe('instruction encoding', () => {
  it('fund carries the Anchor discriminator and the FundArgs layout (8 + 32 + 32 + 8 + 8 + 2 + 2 + 8 + 8 bytes)', () => {
    const ix = fundInstruction(ESCROW_PROGRAM_ID, datum);
    expect(escrowInstructionName(ix.data)).toBe('fund');
    expect(ix.data.length).toBe(108);
    expect(ix.keys.map((k) => k.pubkey.toBase58())).toEqual([datum.company, ESCROW, SystemProgram.programId.toBase58()]);
  });
  it('settle puts the Ed25519 check first, over the shared settle digest, and the payees last in signed order', () => {
    const r = report(16);
    const relayer = Keypair.generate();
    const [verify, settle] = settleInstructions(ESCROW_PROGRAM_ID, r, datum, relayer.publicKey.toBase58());
    expect(bytesToHex(verify!.data.subarray(112))).toBe(settleDigestHex(r));
    expect(escrowInstructionName(settle!.data)).toBe('settle');
    expect(settle!.keys.slice(4).map((k) => k.pubkey.toBase58())).toEqual(r.payouts.map((p) => p.address));
  });
  it('a 20-payee settle fits one legacy transaction', () => {
    const relayer = Keypair.generate();
    const tx = new Transaction({ feePayer: relayer.publicKey, blockhash: '11111111111111111111111111111111', lastValidBlockHeight: 1 })
      .add(ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }))
      .add(...settleInstructions(ESCROW_PROGRAM_ID, report(20), datum, relayer.publicKey.toBase58()));
    tx.sign(relayer);
    expect(tx.serialize().length).toBeLessThanOrEqual(1232);
  });
  it('refund is signed by the company', () => {
    const ix = refundInstruction(ESCROW_PROGRAM_ID, datum.campaignId, datum.company);
    expect(escrowInstructionName(ix.data)).toBe('refund');
    expect(ix.keys[0]).toMatchObject({ isSigner: true });
  });
});

describe('checkFundingTx', () => {
  const expected = { programId: ESCROW_PROGRAM_ID, datum };
  it('accepts the issued fund instruction, with or without wallet priority-fee instructions', () => {
    expect(checkFundingTx(signedFundTx([fundInstruction(ESCROW_PROGRAM_ID, datum)]), expected)).toMatchObject({ ok: true });
    const withFee = [ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1000 }), fundInstruction(ESCROW_PROGRAM_ID, datum)];
    expect(checkFundingTx(signedFundTx(withFee), expected)).toMatchObject({ ok: true });
  });
  it('refuses changed terms, extra instructions, another payer and garbage', () => {
    const cheaper = fundInstruction(ESCROW_PROGRAM_ID, { ...datum, budgetLamports: 1n });
    expect(checkFundingTx(signedFundTx([cheaper]), expected)).toEqual({ ok: false, reason: 'FUND_MISMATCH' });
    const drain = SystemProgram.transfer({ fromPubkey: company.publicKey, toPubkey: Keypair.generate().publicKey, lamports: 1 });
    expect(checkFundingTx(signedFundTx([fundInstruction(ESCROW_PROGRAM_ID, datum), drain]), expected)).toEqual({ ok: false, reason: 'EXTRA_INSTRUCTIONS' });
    const other = Keypair.generate();
    expect(checkFundingTx(signedFundTx([fundInstruction(ESCROW_PROGRAM_ID, { ...datum, company: other.publicKey.toBase58() })], other), expected))
      .toEqual({ ok: false, reason: 'FEE_PAYER' });
    expect(checkFundingTx('bm90IGEgdHg=', expected)).toEqual({ ok: false, reason: 'UNPARSEABLE' });
  });
});

describe('relayer', () => {
  const ctx = { reportPublicKey: repPk, programId: ESCROW_PROGRAM_ID };
  const reader = (acc: EscrowAccount | null, closed: string | null = null): ChainReader => ({
    fetchEscrow: async () => acc, closedBy: async () => closed,
  });
  it('accepts a consistent report', () => {
    expect(checkReportAgainstChain(report(16), escrow, datum, ctx)).toEqual([]);
  });
  it('rejects a report that disagrees with the escrow', () => {
    expect(checkReportAgainstChain(report(16, { refundAddress: addressFromSeed('thief') }), escrow, datum, ctx)).toContain('refundAddress != escrow company');
    expect(checkReportAgainstChain(report(16), { ...escrow, owner: addressFromSeed('x') }, datum, ctx)).toContain('escrow not owned by the escrow program');
  });
  it('is idempotent: a closed escrow reports the closing tx instead of settling again', async () => {
    let submitted = 0;
    const out = await settleFromReport({ report: report(16), reader: reader(null, 'sig-of-settle'), ctx, submit: async () => { submitted++; return 'x'; } });
    expect(out).toEqual({ status: 'already-spent', txHash: 'sig-of-settle' });
    expect(submitted).toBe(0);
  });
  it('submits when the escrow is open and the report checks out', async () => {
    const out = await settleFromReport({ report: report(16), reader: reader(escrow), ctx, submit: async (d) => `settled ${d.campaignId.slice(0, 4)}` });
    expect(out).toEqual({ status: 'submitted', txHash: 'settled cccc' });
  });
});

describe('submitSignedTx', () => {
  const tx = Buffer.from('x').toString('base64');
  const conn = (failures: number, msg = 'Transaction simulation failed: Blockhash not found') => {
    let calls = 0;
    return { calls: () => calls, c: { sendRawTransaction: async () => { calls++; if (calls <= failures) throw new Error(msg); return 'sig'; } } as never };
  };
  it('retries a lagging "Blockhash not found", but not other errors', async () => {
    const a = conn(2);
    expect(await submitSignedTx(a.c, tx, 4, 1)).toBe('sig');
    expect(a.calls()).toBe(3);
    const b = conn(9);
    await expect(submitSignedTx(b.c, tx, 2, 1)).rejects.toThrow(/Blockhash not found/);
    expect(b.calls()).toBe(3);
    const c = conn(1, 'insufficient funds');
    await expect(submitSignedTx(c.c, tx, 4, 1)).rejects.toThrow(/insufficient/);
    expect(c.calls()).toBe(1);
    expect(submitErrorMessage(new Error('Blockhash not found'))).toMatch(/expired.*try again/);
  });
});
