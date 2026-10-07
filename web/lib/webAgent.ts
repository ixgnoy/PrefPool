// web/lib/webAgent.ts — decisions the in-browser demo agent (WebAgentRunner) makes on top of the shared policy check.
import { approvalNeeded, type CampaignSpec, type OwnerPolicy, type PolicyResult } from '@as/shared';

/** Content-free abstain reason recorded when the owner's approval mode asks for an OK the web agent can't get. */
export const NEEDS_APPROVAL_REASON = 'needs owner approval';

/**
 * The web agent answers synthetically and has no chat or local hold queue, so under approve_sensitive (for owner-facing
 * campaigns) or approve_all it must not answer silently: it abstains instead.
 */
export function webAgentApprovalGate(rules: Pick<OwnerPolicy, 'approvalMode'>, c: Pick<CampaignSpec, 'category' | 'questions'>): PolicyResult {
  return approvalNeeded(rules, c) === 'none' ? { ok: true } : { ok: false, reason: NEEDS_APPROVAL_REASON };
}
