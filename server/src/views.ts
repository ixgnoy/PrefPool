// server/src/views.ts
import type { CampaignSpec } from '@as/shared';

/** What agents receive (C5 AgentCampaignView). */
export interface CampaignView {
  campaignId: string;
  title: string;
  category: string;
  questions: CampaignSpec['questions'];
  /** Who the campaign is for; agents match it against their owner's local profile (shared/audience.ts). */
  audience: CampaignSpec['audience'];
  rewardLamports: string;
  deadlineMs: number;
  envelopePublicKey: string;
  /** Only World ID verified agents may answer (agents abstain otherwise; the server refuses with 403 UNVERIFIED). */
  verifiedHumansOnly: boolean;
  /** Only agents with a current calibration pass may answer. */
  calibratedAgentsOnly: boolean;
}

export interface CampaignRow {
  id: string; spec: CampaignSpec; state: string; buyer_address: string; buyer_pkh: string; buyer_stake: string | null;
  access_token_hash: string; reject_reasons: string[] | null; deadline_ms: string | number | bigint; refund_after_ms: string | number | bigint;
  pending_fund_tx: string | null; fund_tx_hash: string | null; escrow_tx_ref: string | null; settlement_tx_hash: string | null;
  last_error: string | null;
}

export const agentView = (c: CampaignRow, envelopePublicKey: string): CampaignView => ({
  campaignId: c.id, title: c.spec.title, category: c.spec.category, questions: c.spec.questions, audience: c.spec.audience ?? {},
  rewardLamports: c.spec.rewardLamports, deadlineMs: Number(c.deadline_ms), envelopePublicKey,
  verifiedHumansOnly: c.spec.verifiedHumansOnly === true,
  calibratedAgentsOnly: c.spec.calibratedAgentsOnly === true,
});
