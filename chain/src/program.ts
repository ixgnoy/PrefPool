// chain/src/program.ts: instructions of solana/programs/campaign_escrow, encoded by hand (Anchor layout) so the
// browser, server and scripts share one small encoder instead of an IDL client.
import {
  Ed25519Program, PublicKey, SYSVAR_INSTRUCTIONS_PUBKEY, SystemProgram, TransactionInstruction,
} from '@solana/web3.js';
import { anchorDiscriminator, campaignEscrowAddress, settleDigestHex, type CampaignDatumFields, type SettlementReport } from '@as/shared';
import { hexToBytes } from '@noble/hashes/utils.js';

/** Default program on devnet; servers pass their own via config. */
export const ESCROW_PROGRAM_ID = 'Cm1NmUPngoFke9pc8zXsK2qebBEfPb76bS3gHfjMS2hN';

const u64 = (x: bigint) => { const b = new Uint8Array(8); new DataView(b.buffer).setBigUint64(0, x, true); return b; };
const i64 = (x: number) => { const b = new Uint8Array(8); new DataView(b.buffer).setBigInt64(0, BigInt(x), true); return b; };
const u16 = (x: number) => { const b = new Uint8Array(2); new DataView(b.buffer).setUint16(0, x, true); return b; };
const concat = (parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return Buffer.from(out);
};

export const escrowAddress = (programId: string, campaignId: string) => new PublicKey(campaignEscrowAddress(programId, campaignId));

/** `fund(args: FundArgs)`: the company locks `budgetLamports` in the campaign's escrow PDA. */
export function fundInstruction(programId: string, d: CampaignDatumFields): TransactionInstruction {
  const data = concat([
    anchorDiscriminator('global', 'fund'),
    hexToBytes(d.campaignId), hexToBytes(d.reportPk),
    u64(d.rewardLamports), u64(d.budgetLamports), u16(d.maxResponses), u16(d.minCohort), i64(d.deadlineMs), i64(d.refundAfterMs),
  ]);
  return new TransactionInstruction({
    programId: new PublicKey(programId), data,
    keys: [
      { pubkey: new PublicKey(d.company), isSigner: true, isWritable: true },
      { pubkey: escrowAddress(programId, d.campaignId), isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
  });
}

/**
 * `settle(report_hash)` preceded by the Ed25519 precompile instruction carrying CRE's signature over the settle digest.
 * The payees are the remaining accounts, in the signed order.
 */
export function settleInstructions(programId: string, report: SettlementReport, campaign: Pick<CampaignDatumFields, 'reportPk' | 'company'>, submitter: string): TransactionInstruction[] {
  const verify = Ed25519Program.createInstructionWithPublicKey({
    publicKey: Buffer.from(hexToBytes(campaign.reportPk)),
    message: Buffer.from(hexToBytes(settleDigestHex(report))),
    signature: Buffer.from(hexToBytes(report.settleSignature)),
  });
  const settle = new TransactionInstruction({
    programId: new PublicKey(programId),
    data: concat([anchorDiscriminator('global', 'settle'), hexToBytes(report.reportHash)]),
    keys: [
      { pubkey: new PublicKey(submitter), isSigner: true, isWritable: false },
      { pubkey: new PublicKey(report.escrowTxRef), isSigner: false, isWritable: true },
      { pubkey: new PublicKey(campaign.company), isSigner: false, isWritable: true },
      { pubkey: SYSVAR_INSTRUCTIONS_PUBKEY, isSigner: false, isWritable: false },
      ...report.payouts.map((p) => ({ pubkey: new PublicKey(p.address), isSigner: false, isWritable: true })),
    ],
  });
  return [verify, settle];
}

/** `refund()`: the company takes the whole escrow back after refund_after. */
export function refundInstruction(programId: string, campaignId: string, company: string): TransactionInstruction {
  return new TransactionInstruction({
    programId: new PublicKey(programId),
    data: Buffer.from(anchorDiscriminator('global', 'refund')),
    keys: [
      { pubkey: new PublicKey(company), isSigner: true, isWritable: true },
      { pubkey: escrowAddress(programId, campaignId), isSigner: false, isWritable: true },
    ],
  });
}

/** Which escrow instruction `data` encodes, by discriminator. */
export function escrowInstructionName(data: Uint8Array): 'fund' | 'settle' | 'refund' | null {
  for (const name of ['fund', 'settle', 'refund'] as const) {
    const d = anchorDiscriminator('global', name);
    if (data.length >= 8 && d.every((x, i) => data[i] === x)) return name;
  }
  return null;
}
