// server/src/chainPort.ts
import type { CampaignDatumFields, EscrowAccount, SettlementReport } from '@as/shared';

/** A Solana transaction for the dev view (FRONTEND_PRD §5.10), read from RPC getTransaction. Fee in lamports. */
export interface TxTrace {
  signature: string;
  slot: number | null;
  /** Unix seconds, as RPC reports it. */
  blockTime: number | null;
  fee: string | null;
  /** RPC's TransactionError, null when the tx succeeded. */
  err: unknown | null;
  /** Top-level instructions: program label and, for the escrow program, the instruction name. */
  instructions: { program: string; programId: string; name: string }[];
  logMessages: string[];
}

export type SettleOutcome =
  | { status: 'submitted'; txHash: string }
  | { status: 'already-spent'; txHash: string }
  | { status: 'rejected'; errors: string[] };

/** Where a broadcast funding tx stands: `expired` = its blockhash left the validity window and it never landed. */
export type TxStatus = 'landed' | 'failed' | 'pending' | 'expired';

/** An unsigned legacy tx (base64 wire bytes) for the buyer's wallet. */
export interface UnsignedTx { unsignedTx: string; lastValidBlockHeight: number }

/** Everything the server needs from Solana. Production: chainAdapter.ts (RPC + relayer keypair); tests: a fake. */
export interface ChainPort {
  /** The campaign_escrow program; a campaign's escrow is its PDA ["campaign", campaign_id]. */
  programId: string;
  /** The relayer wallet: pays settle fees (and is the x402 facilitator's fee payer). */
  relayerAddress: string;
  /** Unsigned `fund` tx paid and signed by `datum.company`. Throws FundingError when the wallet can't cover it. */
  buildFundTx(datum: CampaignDatumFields): Promise<UnsignedTx>;
  /** Broadcast a wallet-signed tx (after the caller checked it); returns its signature. */
  submitSignedTx(signedTx: string): Promise<string>;
  /** The campaign's escrow account; null while it doesn't exist (not funded yet, or closed by settle/refund). */
  fetchEscrow(campaignId: string): Promise<EscrowAccount | null>;
  /** Status of a broadcast tx; `blockhash` is its recent blockhash (decides `expired`). */
  txStatus(signature: string, blockhash: string): Promise<TxStatus>;
  /** Signature of the tx that closed the escrow (settle or refund), or null while it is open. */
  closedBy(escrowAddress: string): Promise<string | null>;
  settle(report: SettlementReport): Promise<SettleOutcome>;
  /** Company escape hatch after refund_after: an unsigned `refund` tx for the buyer's wallet. */
  buildRefundTx(campaignId: string, company: string): Promise<UnsignedTx>;
  /** True when the signed tx's only escrow instruction is `refund` of this campaign's escrow, validly signed by `company`. */
  isRefundTx(signedTx: string, campaignId: string, company: string): boolean;
  /** Decoded tx for the dev view; null if RPC doesn't know it (yet). */
  describeTx(signature: string): Promise<TxTrace | null>;
}
