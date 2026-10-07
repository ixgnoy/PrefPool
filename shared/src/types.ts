export type Hex = string; // lowercase, no 0x
export type Address = string; // base58 Solana address

export type CampaignState =
  | 'DRAFT' | 'REJECTED' | 'AWAITING_FUNDING' | 'FUNDING_SUBMITTED' | 'FUNDING_FAILED'
  | 'FUNDED' | 'ACTIVE' | 'AGGREGATING' | 'INSUFFICIENT_COHORT' | 'SETTLEMENT_READY'
  | 'SETTLEMENT_SUBMITTED' | 'SETTLEMENT_FAILED' | 'SETTLED' | 'REFUNDED';

export type QuestionType = 'single_choice' | 'likert_5';
export interface Question {
  id: string;
  type: QuestionType;
  text: string;
  options?: string[];
  category?: string;
}
export interface CampaignSpec {
  title: string;
  category: string;
  questions: Question[];
  audience: { country?: string[]; ageBand?: string[]; occupationGroup?: string[] };
  rewardLamports: string;
  maxResponses: number;
  minCohort: number;
  deadlineMs: number;
  /** Only World ID verified agents (one agent per human) may answer. Omitted when false. */
  verifiedHumansOnly?: boolean;
  /** Only agents with a current calibration pass may answer. Omitted when false. */
  calibratedAgentsOnly?: boolean;
}
export type AnswerValue = number;
export type Answers = Record<string, AnswerValue>;

export interface OwnerPolicy {
  allowedCategories: string[];
  blockedCategories: string[];
  minimumRewardSol: number;
  dailyLimit: number;
  approvalMode: 'auto' | 'approve_sensitive' | 'approve_all';
}
export type Decision =
  | { kind: 'answer'; answers: Answers }
  | { kind: 'abstain'; reason: string };

export interface Envelope {
  v: 1;
  campaignId: Hex;
  respondentAddress: Address;
  epk: Hex;
  n: Hex;
  ct: Hex;
}

/** The escrow program's on-chain Campaign account (solana/programs/campaign_escrow/src/state.rs). */
export interface CampaignDatumFields {
  campaignId: Hex;
  /** Funder's wallet: receives the unused budget at settle (or everything via refund). */
  company: Address;
  /** CRE's Ed25519 report key; the escrow only settles to payouts signed with it. */
  reportPk: Hex;
  rewardLamports: bigint;
  budgetLamports: bigint;
  maxResponses: number;
  minCohort: number;
  deadlineMs: number;
  refundAfterMs: number;
}

export interface Payout { address: Address; lamports: string }
export interface SettlementReport {
  schemaVersion: 1;
  campaignId: Hex;
  escrowTxRef: string;
  escrowedLamports: string;
  rewardPerResponseLamports: string;
  acceptedCount: number;
  payouts: Payout[];
  payoutTotalLamports: string;
  refundAddress: Address;
  refundLamports: string;
  rejectionCounts: { malformed: number; duplicate: number; ineligible: number; late: number };
  resultHash: Hex;
  timestamp: string;
  reportHash: Hex;
  signature: Hex;
  /** Ed25519 over the settle payload (settlePayload.ts); the escrow validator verifies it on-chain. */
  settleSignature: Hex;
}
export interface ResearchReport {
  schemaVersion: 1;
  campaignId: Hex;
  validRespondents: number;
  minCohort: number;
  results: Record<string, Record<string, number>>;
  /** Accepted respondents by personhood kind; present only when CRE received personhood data. */
  verifiedHumans?: number;
  simulatedHumans?: number;
  /** Accepted respondents with a calibration pass valid at the deadline; present only when CRE received calibration data. */
  calibratedAgents?: number;
}
