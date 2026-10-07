// shared/src/policy.ts
import { OWNER_FACING_CATEGORIES } from './categories';
import type { CampaignSpec, OwnerPolicy } from './types';

export const LAMPORTS_PER_SOL = 1_000_000_000;

export type PolicyResult = { ok: true } | { ok: false; reason: string };

export type ApprovalNeed = 'none' | 'chat' | 'web';
/** Campaign category plus every per-question override. */
export const categoriesOf = (c: Pick<CampaignSpec, 'category' | 'questions'>) => [c.category, ...c.questions.map((q) => q.category ?? c.category)];

/**
 * approve_sensitive: campaigns that ask about the owner (spending, personal life) need the owner's OK in the
 * conversation. approve_all: every answer waits, sealed, in the owner's web approval queue. Decided in code.
 */
export function approvalNeeded(policy: Pick<OwnerPolicy, 'approvalMode'>, c: Pick<CampaignSpec, 'category' | 'questions'>): ApprovalNeed {
  if (policy.approvalMode === 'approve_all') return 'web';
  if (policy.approvalMode === 'approve_sensitive' && categoriesOf(c).some((x) => OWNER_FACING_CATEGORIES.includes(x))) return 'chat';
  return 'none';
}

/** Deterministic owner-policy check. Enforced in code (agents and plugin), never left to an LLM. */
export function evaluatePolicy(
  policy: OwnerPolicy,
  campaign: Pick<CampaignSpec, 'category' | 'questions' | 'rewardLamports'>,
  answeredToday: number,
): PolicyResult {
  const categories = categoriesOf(campaign);
  for (const c of categories) {
    if (policy.blockedCategories.includes(c)) return { ok: false, reason: `blocked category: ${c}` };
  }
  for (const c of categories) {
    if (!policy.allowedCategories.includes(c)) return { ok: false, reason: `category not allowed: ${c}` };
  }
  const rewardSol = Number(BigInt(campaign.rewardLamports)) / LAMPORTS_PER_SOL;
  if (rewardSol < policy.minimumRewardSol) {
    return { ok: false, reason: `reward ${rewardSol} SOL below minimum ${policy.minimumRewardSol} SOL` };
  }
  if (answeredToday >= policy.dailyLimit) return { ok: false, reason: `daily limit ${policy.dailyLimit} reached` };
  return { ok: true };
}
