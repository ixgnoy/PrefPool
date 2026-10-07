// web/lib/webAgent.ts — decisions the in-browser demo agent (WebAgentRunner) makes on top of the shared policy check.
import { NEEDS_APPROVAL_REASON, approvalNeeded, type CampaignSpec, type OwnerPolicy, type PolicyResult } from '@as/shared';

export { NEEDS_APPROVAL_REASON };

/**
 * The web agent answers synthetically and has no chat or local hold queue, so under approve_sensitive (for owner-facing
 * campaigns) or approve_all it must not answer silently: it abstains instead.
 */
export function webAgentApprovalGate(rules: Pick<OwnerPolicy, 'approvalMode'>, c: Pick<CampaignSpec, 'category' | 'questions'>): PolicyResult {
  return approvalNeeded(rules, c) === 'none' ? { ok: true } : { ok: false, reason: NEEDS_APPROVAL_REASON };
}
