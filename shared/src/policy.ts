// shared/src/policy.ts
import type { CampaignSpec, OwnerPolicy } from './types';

export const LAMPORTS_PER_SOL = 1_000_000_000;

export type PolicyResult = { ok: true } | { ok: false; reason: string };

/** Deterministic owner-policy check. Enforced in code (agents and plugin), never left to an LLM. */
export function evaluatePolicy(
  policy: OwnerPolicy,
  campaign: Pick<CampaignSpec, 'category' | 'questions' | 'rewardLamports'>,
  answeredToday: number,
): PolicyResult {
  const categories = [campaign.category, ...campaign.questions.map((q) => q.category ?? campaign.category)];
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
