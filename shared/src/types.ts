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
/** Where an answer came from: checked = the agent verified it in its own setup; owner_told = a stored owner fact; inferred = anything else. */
export const ANSWER_SOURCES = ['checked', 'owner_told', 'inferred'] as const;
export type AnswerSource = (typeof ANSWER_SOURCES)[number];
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

/** Sealed inside a v2 envelope next to the answers; only CRE (and the owner's own copy) can read it. */
export interface EnvelopeMeta {
  sources: Record<string, AnswerSource>;
  /** Self-reported by the plugin; a hint for grouping, never trusted for eligibility. */
  client: { name: string; version: string; modelId?: string };
}

export interface Envelope {
  /** 1: answers only. 2: answers plus EnvelopeMeta. Same key derivation and AAD. */
  v: 1 | 2;
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
  /** Per question: how many accepted answers carried each source tag (v1 envelopes count as unknown). */
  sources?: Record<string, Record<AnswerSource | 'unknown', number>>;
  /** Accepted answers per client (name, model id when reported); buckets under 3 fold into "other". */
  clients?: Record<string, number>;
  /** Per question: normalized Shannon entropy of the shares (0 = unanimous, 1 = even spread), 4 decimals. */
  dispersion?: Record<string, number>;
}
