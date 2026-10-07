// chain/src/relayer.ts
import { PublicKey, type Connection } from '@solana/web3.js';
import {
  MAX_PAYEES, decodeCampaignAccount, settleAddressOk, verifySettlementReport,
  type CampaignDatumFields, type EscrowAccount, type SettlementReport,
} from '@as/shared';

/** Read side the relayer needs; RPC in production, stubbed in tests. */
export interface ChainReader {
  /** The escrow account, or null if it doesn't exist (never funded, or closed by settle/refund). */
  fetchEscrow(address: string): Promise<EscrowAccount | null>;
  /** Signature of the tx that closed the escrow, or null while it is open (or was never funded). */
  closedBy(address: string): Promise<string | null>;
}

/** Every check the relayer runs before it will build a settle tx. Empty array = safe to settle. */
export function checkReportAgainstChain(
  report: SettlementReport,
  escrow: EscrowAccount,
  datum: CampaignDatumFields,
  ctx: { reportPublicKey: string; programId: string },
): string[] {
  const errs = verifySettlementReport(report, ctx.reportPublicKey, datum);
  if (escrow.owner !== ctx.programId) errs.push('escrow not owned by the escrow program');
  if (escrow.address !== report.escrowTxRef) errs.push('escrow address != report');
  if (BigInt(report.escrowedLamports) !== datum.budgetLamports) errs.push('escrowedLamports != on-chain budget');
  if (report.campaignId !== datum.campaignId) errs.push('campaignId != escrow');
  if (BigInt(report.rewardPerResponseLamports) !== datum.rewardLamports) errs.push('reward != escrow');
  if (report.refundAddress !== datum.company) errs.push('refundAddress != escrow company');
  if (datum.reportPk !== ctx.reportPublicKey) errs.push('escrow names a different report key');
  if (report.payouts.length > MAX_PAYEES) errs.push(`more than ${MAX_PAYEES} payouts do not fit one settle tx`);
  if (report.payouts.some((p) => !settleAddressOk(p.address))) errs.push('payout to an address the escrow cannot pay');
  return errs;
}

export type RelayerOutcome =
  | { status: 'submitted'; txHash: string }
  | { status: 'already-spent'; txHash: string }
  | { status: 'rejected'; errors: string[] };

/**
 * Idempotent settlement: if the escrow is already closed, report that tx and stop.
 * `submit` is injected so this stays testable without a network.
 */
export async function settleFromReport(opts: {
  report: SettlementReport;
  reader: ChainReader;
  ctx: { reportPublicKey: string; programId: string };
  submit: (datum: CampaignDatumFields) => Promise<string>;
}): Promise<RelayerOutcome> {
  const ref = opts.report.escrowTxRef;
  const escrow = await opts.reader.fetchEscrow(ref);
  if (!escrow) {
    const closedBy = await opts.reader.closedBy(ref);
    return closedBy ? { status: 'already-spent', txHash: closedBy } : { status: 'rejected', errors: ['escrow account not found'] };
  }
  let datum: CampaignDatumFields;
  try { datum = decodeCampaignAccount(escrow.data); } catch (e) { return { status: 'rejected', errors: [String(e)] }; }
  const errors = checkReportAgainstChain(opts.report, escrow, datum, opts.ctx);
  if (errors.length) return { status: 'rejected', errors };
  return { status: 'submitted', txHash: await opts.submit(datum) };
}

/** RPC implementation of ChainReader. */
export function rpcReader(connection: Connection): ChainReader {
  return {
    async fetchEscrow(address) {
      const acc = await connection.getAccountInfo(new PublicKey(address), 'confirmed');
      if (!acc || acc.lamports === 0) return null;
      return { address, owner: acc.owner.toBase58(), lamports: String(acc.lamports), data: acc.data.toString('base64') };
    },
    async closedBy(address) {
      if (await connection.getAccountInfo(new PublicKey(address), 'confirmed')) return null;
      // Newest first: the last successful tx touching a closed escrow is the settle or refund that closed it.
      const sigs = await connection.getSignaturesForAddress(new PublicKey(address), { limit: 10 }, 'confirmed');
      return sigs.find((s) => s.err === null)?.signature ?? null;
    },
  };
}
