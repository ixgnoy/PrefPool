// web/lib/api.ts — typed client for the Express API (README C5 + FRONTEND_PRD Appendix A).
import { bytesToHex, type CampaignSpec, type Envelope, type EscrowAccount, type OwnerPolicy, type ResearchReport, type SettlementReport } from '@as/shared';

export const SERVER = process.env.NEXT_PUBLIC_SERVER_URL ?? 'http://localhost:4000';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public body?: unknown) { super(message); }
}

export async function api<T>(path: string, init: RequestInit & { token?: string } = {}): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(init.headers as Record<string, string>) };
  if (init.token) headers.Authorization = `Bearer ${init.token}`;
  const res = await fetch(`${SERVER}/api${path}`, { ...init, headers });
  const body = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, body?.code ?? 'HTTP', body?.error ?? (body?.reasons ? `Rejected: ${body.reasons.join('; ')}` : `HTTP ${res.status}`), body);
  return body as T;
}
const post = <T>(path: string, body: unknown, token?: string) => api<T>(path, { method: 'POST', body: JSON.stringify(body), token });

/** nonce → wallet signMessage over the server's UTF-8 message (ed25519) → hex signature → session token. */
export async function signIn(wallet: { address: string; signMessage(message: Uint8Array): Promise<Uint8Array> }) {
  const { message } = await post<{ nonce: string; message: string }>('/auth/nonce', { address: wallet.address });
  const signature = bytesToHex(await wallet.signMessage(new TextEncoder().encode(message)));
  const { sessionToken } = await post<{ sessionToken: string }>('/auth/verify', { address: wallet.address, signature });
  return sessionToken;
}

// ---- public config -------------------------------------------------------------------------------------------
export interface PublicConfig {
  /** Escrow program (campaign_escrow); each campaign's escrow is its PDA ["campaign", campaign_id]. */
  programId: string; cluster: 'devnet' | 'testnet' | 'mainnet-beta'; rpcUrl: string;
  /** Fixed platform fee for buying a research report over x402 (USDC on Devnet). */
  platformFeeUsdc: number;
  envelopePublicKey: string; reportPublicKey: string; rewardLamports?: string;
  relayerAddress?: string | null; platformFeePayTo?: string | null;
  personhood: { appId: string; environment: string; action: string } | null;
}
export const getConfig = () => api<PublicConfig>('/config/public');

// ---- seller ---------------------------------------------------------------------------------------------------
export type Personhood = { kind: 'world' | 'simulated'; verifiedAt: number | null } | null;
export interface MyAgent {
  agentId: string; kind: 'live' | 'plugin' | 'synthetic'; address: string; policy: OwnerPolicy | null; paused: boolean;
  lastSeenAt: number | null; connected: boolean; personhood: Personhood;
  /** online: checked in within 2 min · idle: within 24 h (plugin/OpenClaw agents check in when they work) · offline */
  status: 'online' | 'idle' | 'offline';
  calibration: { calibratedUntil: number | null };
}
export interface PersonhoodRequest {
  appId: `app_${string}`; action: string; environment: 'staging' | 'production'; signal: string;
  rpContext: { rp_id: string; nonce: string; created_at: number; expires_at: number; signature: string };
}
export const personhoodRequest = (token: string) => post<PersonhoodRequest>('/personhood/request', {}, token);
export interface CalibrationQ { id: string; text: string; type: 'single_choice' | 'likert_5'; options?: string[] }
/** abstainRate: share of the owner-marked probes where the agent said "unknown"; null when none were marked. */
export interface CalibrationResult { agreement: number; baseline: number; lift: number; abstainRate: number | null; passed: boolean }
export interface CalibrationStatus {
  calibratable: boolean; calibratedUntil: number | null;
  round: { roundId: string; state: 'CREATED' | 'AGENT_ANSWERED' | 'OWNER_ANSWERING'; createdAt: number; ownerDeadline: number | null } | null;
  last: (CalibrationResult & { scoredAt: number }) | null;
}
export const getCalibration = (token: string) => api<CalibrationStatus>('/agents/mine/calibration', { token });
export const startCalibration = (token: string) => post<{ roundId: string }>('/agents/mine/calibration', {}, token);
export const openCalibration = (token: string, id: string) => post<{ questions: CalibrationQ[]; deadline: number }>(`/agents/mine/calibration/${id}/open`, {}, token);
export const submitCalibration = (token: string, id: string, answers: Record<string, number>, unknowable: string[] = []) =>
  post<{ result: CalibrationResult }>(`/agents/mine/calibration/${id}/answers`, { answers, unknowable }, token);
export const personhoodVerify = (token: string, result: unknown) => post<{ personhood: { kind: 'world' } }>('/personhood/verify', result, token);
export const getMyAgent = (token: string) => api<{ agent: MyAgent | null }>('/agents/mine', { token }).then((r) => r.agent);
export const registerAgent = (token: string, kind: 'live' | 'plugin', policy?: OwnerPolicy) =>
  post<{ agentId: string; agentToken: string }>('/agents/register', { kind, policy }, token);
export const updateMyAgent = (token: string, patch: { policy?: OwnerPolicy; paused?: boolean }) =>
  api<{ ok: true }>('/agents/mine', { method: 'PUT', body: JSON.stringify(patch), token });

export type AbstainBucket = 'blocked_category' | 'category_not_allowed' | 'reward_below_minimum' | 'daily_limit' | 'no_matching_profile' | 'unverified' | 'uncalibrated'
  | 'task_request' | 'credential_ask' | 'unknown_answer' | 'needs_approval' | 'other';
export interface ActivityItem {
  campaignId: string; title: string; category: string; decidedAt: number; kind: 'answer' | 'abstain'; reason: string | null;
  rewardLamports: string; settlementTx: string | null; outcome: 'abstained' | 'pending' | 'paid' | 'not_paid';
  notPaidReason?: string; payoutLamports?: string; paidAt?: number;
}
export interface ActivityTotals {
  earnedLamports: string; pendingLamports: string; seen: number; answered: number; abstained: number;
  abstainReasons: Record<AbstainBucket, number>; todayCount: number; dailyLimit: number | null; earningsByDay: { day: number; lamports: string }[];
  byCategory: { category: string; seen: number; answered: number; earnedLamports: string }[];
}
export const getActivity = (token: string) => api<{ items: ActivityItem[]; totals: ActivityTotals | null }>('/agents/mine/activity', { token });

// ---- encrypt to self (owner transcripts) ----------------------------------------------------------------------
export interface AnswerCopy { campaignId: string; title: string; category: string; questions: CampaignSpec['questions']; state: string; envelope: Envelope; receivedAtMs: number }
export const getAnswerCopies = (token: string) => api<{ transcriptPublicKey: string | null; copies: AnswerCopy[] }>('/agents/mine/answer-copies', { token });
export const setTranscriptPublicKey = (token: string, publicKey: string) =>
  api<{ ok: true }>('/agents/mine/transcript-key', { method: 'PUT', body: JSON.stringify({ publicKey }), token });

// ---- approval queue (policy approve_all) ----------------------------------------------------------------------
/** An answer the owner's plugin holds locally until the owner decides. `envelope` is the owner's copy (transcript key). */
export interface PendingApproval { campaignId: string; title: string; category: string; questions: CampaignSpec['questions']; envelope: Envelope; requestedAtMs: number; deadlineMs: number }
export const getApprovals = (token: string) => api<{ transcriptPublicKey: string | null; pending: PendingApproval[] }>('/agents/mine/approvals', { token });
export const decideApproval = (token: string, campaignId: string, decision: 'approve' | 'reject') =>
  api<void>(`/agents/mine/approvals/${encodeURIComponent(campaignId)}`, { method: 'POST', token, body: JSON.stringify({ decision }) });

// ---- buyer analytics -----------------------------------------------------------------------------------------
export interface BuyerAnalytics {
  campaigns: number; funded: number; byState: Record<string, number>;
  budgetLockedLamports: string; inEscrowLamports: string; paidOutLamports: string; refundedLamports: string; acceptedAnswers: number; costPerAnswerLamports: string | null;
  answered: number; abstained: number; rejections: Record<'malformed' | 'duplicate' | 'ineligible' | 'late', number>;
  declines: Partial<Record<AbstainBucket, number>>; topDeclineReasons: { reason: string; count: number }[];
  byCategory: { category: string; campaigns: number; acceptedAnswers: number; paidLamports: string; lockedLamports: string }[];
  payoutsByDay: { day: number; lamports: string }[];
}
export const getBuyerAnalytics = (token: string) => api<BuyerAnalytics>('/campaigns/analytics', { token });

// ---- campaigns ------------------------------------------------------------------------------------------------
export interface AgentTile { tag: string; kind: 'answer' | 'abstain'; reason: string | null; live: boolean; personhood: 'world' | 'simulated' | null }
export interface CampaignView {
  campaignId: string; state: string; title: string; category: string; questions: CampaignSpec['questions'];
  rewardLamports: string; maxResponses: number; minCohort: number; deadlineMs: number; refundAfterMs: number; rejectReasons: string[];
  answered: number; abstained: { reason: string | null; count: number }[]; envelopes: number;
  fundTxHash: string | null; escrowTxRef: string | null; settlementTxHash: string | null; lastError: string | null;
  report: { acceptedCount: number; rejectionCounts: Record<string, number>; reportHash: string } | null;
  cre: { status: string; log: string } | null;
  agents: AgentTile[]; networkSize: number;
  verifiedHumansOnly: boolean; calibratedAgentsOnly: boolean; humans: { world: number; simulated: number } | null;
}
export const getCampaign = (id: string) => api<CampaignView>(`/campaigns/${id}`);
export const listMyCampaigns = (token: string) => api<{ campaigns: CampaignView[] }>('/campaigns?mine=1', { token }).then((r) => r.campaigns);
export const latestCampaign = () => api<{ campaigns: CampaignView[] }>('/campaigns?latest=1').then((r) => r.campaigns[0] ?? null);
export const getResults = (id: string, token: string) => api<ResearchReport & { settlementTx: string | null }>(`/campaigns/${id}/results`, { token });

/** `warnings`: non-blocking wording advice from screening (shared lint), shown to the buyer before funding. */
export type ScreeningResult = { ok: true; campaignId: string; accessToken: string; warnings: string[] } | { ok: false; reasons: string[] };
/** POST /campaigns → 201 created (AWAITING_FUNDING) or 422 rejected at screening with reasons. */
export async function createCampaign(spec: CampaignSpec, token: string): Promise<ScreeningResult> {
  try {
    const r = await post<{ campaignId: string; accessToken: string; warnings?: string[] }>('/campaigns', spec, token);
    return { ok: true, campaignId: r.campaignId, accessToken: r.accessToken, warnings: r.warnings ?? [] };
  } catch (e) {
    if (e instanceof ApiError && e.status === 422) return { ok: false, reasons: (e.body as { reasons?: string[] })?.reasons ?? [e.message] };
    throw e;
  }
}

/** How the new-campaign page shows a createCampaign error: the draft throttle (429) is not a screening result to retry now. */
export function createCampaignError(e: unknown): { throttled: boolean; message: string } {
  if (e instanceof ApiError && e.code === 'TOO_MANY_REJECTED') return { throttled: true, message: e.message };
  return { throttled: false, message: (e as Error)?.message ?? String(e) };
}

// ---- dev view -------------------------------------------------------------------------------------------------
/** A Solana transaction as the server reads it from RPC (getTransaction). */
export interface TxTrace {
  signature: string; slot: number | null; blockTime: number | null; fee: string | null; err: unknown | null;
  instructions: { program: string; name: string }[]; logMessages: string[];
}
export interface CampaignTrace {
  campaignId: string; state: string; createdAt: number; updatedAt: number; spec: CampaignSpec; rejectReasons: string[];
  deadlineMs: number; refundAfterMs: number; escrowTxRef: string | null; buyerAddress: string;
  /** The escrow PDA as read from RPC (base64 Anchor account); null before funding confirms and after settle/refund closes it. */
  escrow?: EscrowAccount | null;
  envelopes: { count: number; firstAtMs: number | null; lastAtMs: number | null; sample: { epk: string; n: string; ciphertextBytes: number } | null };
  creJob: { id: string; status: string; log: string } | null;
  settlementReport: SettlementReport | null; researchReport: ResearchReport | null;
  fundTx: TxTrace | null; settlementTx: TxTrace | null;
}
export const getTrace = (id: string, token?: string) => api<CampaignTrace>(`/campaigns/${id}/trace`, { token });

// ---- explorers ------------------------------------------------------------------------------------------------
export { explorerTx, explorerAddress } from './config';
