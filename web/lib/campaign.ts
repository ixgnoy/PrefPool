export type CampaignState =
  | 'DRAFT' | 'AWAITING_FUNDING' | 'FUNDING_SUBMITTED' | 'FUNDING_FAILED' | 'REJECTED'
  | 'FUNDED' | 'ACTIVE' | 'AGGREGATING' | 'SETTLEMENT_READY' | 'SETTLEMENT_SUBMITTED'
  | 'SETTLEMENT_FAILED' | 'SETTLED' | 'INSUFFICIENT_COHORT' | 'REFUNDED';

export type Tone = 'neutral' | 'blue' | 'ok' | 'danger' | 'warn';

/** PRD §7. `step` indexes TIMELINE; null = not on the timeline. */
export const STATE_UI: Record<CampaignState, { label: string; tone: Tone; step: number | null }> = {
  DRAFT: { label: 'Awaiting funding', tone: 'neutral', step: null },
  AWAITING_FUNDING: { label: 'Awaiting funding', tone: 'neutral', step: null },
  FUNDING_SUBMITTED: { label: 'Funding…', tone: 'blue', step: 0 },
  FUNDING_FAILED: { label: 'Funding failed, retry', tone: 'danger', step: null },
  REJECTED: { label: 'Rejected at screening', tone: 'danger', step: null },
  FUNDED: { label: 'Collecting answers', tone: 'blue', step: 1 },
  ACTIVE: { label: 'Collecting answers', tone: 'blue', step: 1 },
  AGGREGATING: { label: 'Private aggregation', tone: 'blue', step: 2 },
  SETTLEMENT_READY: { label: 'Paying out', tone: 'blue', step: 3 },
  SETTLEMENT_SUBMITTED: { label: 'Paying out', tone: 'blue', step: 3 },
  SETTLEMENT_FAILED: { label: 'Payout retrying', tone: 'warn', step: 3 },
  SETTLED: { label: 'Settled', tone: 'ok', step: 4 },
  INSUFFICIENT_COHORT: { label: 'Refunding', tone: 'neutral', step: 4 }, // refund tx not confirmed yet
  REFUNDED: { label: 'Refunded', tone: 'neutral', step: 4 },
};

export const TIMELINE = ['Funded', 'Answering', 'Private aggregation (CRE)', 'Settling', 'Settled'] as const;

/** 1 SOL = 1e9 lamports (not 1e6 like ADA's lovelace). */
export const LAMPORTS = 1_000_000_000;
export const REFUND_DELAY_MS = 24 * 60 * 60 * 1000;

/** Devnet rewards are small (0.01 SOL): trim trailing zeros, 4 decimals (9 for dust). */
export const fmtSol = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: n !== 0 && Math.abs(n) < 0.0001 ? 9 : 4, useGrouping: false });
export const sol = (n: number) => `${fmtSol(n)} SOL`;
export const lamportsToSol = (l: string | number | bigint | null | undefined) => Number(l ?? 0) / LAMPORTS;
/** Lamport string/number straight to "0.01 SOL". */
export const solOf = (l: string | number | bigint | null | undefined) => sol(lamportsToSol(l));
export const short = (s: string, head = 12, tail = 4) => (s.length > head + tail + 1 ? `${s.slice(0, head)}…${s.slice(-tail)}` : s);
export const fmtTime = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
