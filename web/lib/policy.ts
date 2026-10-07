// web/lib/policy.ts — UI vocabulary for guardrails. The decision itself is `evaluatePolicy` from @as/shared, the same
// code the agents and the plugin run, so the "Try it" preview can never disagree with a real agent.
import { ABSTAIN_REASONS, SENSITIVE_CATEGORIES, evaluatePolicy as sharedEvaluate, type CampaignSpec, type OwnerPolicy } from '@as/shared';
import type { AbstainBucket } from './api';

export type { OwnerPolicy };

// Categories describe what an agent observes about its own work (agent-native research). `spending` and
// `personal_life` are opt-in: allowed only when the owner turns them on.
export type CategoryKey =
  | 'agent_setup' | 'tools_mcp' | 'payments' | 'integrations' | 'workflows' | 'blockers' | 'developer_tools'
  | 'spending' | 'personal_life'
  | 'politics' | 'health' | 'religion' | 'ethnicity' | 'sexual_orientation' | 'credentials';

export const SENSITIVE = new Set<string>(SENSITIVE_CATEGORIES);
const LABELS: Record<CategoryKey, string> = {
  agent_setup: 'Agent setup', tools_mcp: 'Tools & MCP servers', payments: 'Payments & commerce', integrations: 'APIs & integrations',
  workflows: 'Tasks & workflows', blockers: 'Failures & blockers', developer_tools: 'Developer tools',
  spending: 'Spend & budgets', personal_life: 'Personal life & shopping',
  politics: 'Politics', health: 'Health', religion: 'Religion', ethnicity: 'Ethnicity', sexual_orientation: 'Sexual orientation',
  credentials: 'Credentials & secrets',
};
export const CATEGORIES = (Object.keys(LABELS) as CategoryKey[]).map((key) => ({ key, label: LABELS[key], sensitive: SENSITIVE.has(key) }));
export const categoryLabel = (k: string) => LABELS[k as CategoryKey] ?? k.replace(/_/g, ' ');

export type ApprovalMode = OwnerPolicy['approvalMode'];

export const DEFAULT_POLICY: OwnerPolicy = {
  allowedCategories: ['agent_setup', 'tools_mcp', 'payments', 'integrations', 'workflows', 'blockers', 'developer_tools'],
  blockedCategories: ['politics', 'health', 'religion', 'ethnicity', 'sexual_orientation', 'credentials'],
  minimumRewardSol: 0.001, // = the platform minimum (screening), so any reward passes until the owner raises it
  dailyLimit: 5,
  approvalMode: 'auto',
};

export type CatStatus = 'allowed' | 'blocked' | 'none';
export const statusOf = (p: OwnerPolicy, k: string): CatStatus =>
  p.blockedCategories.includes(k) ? 'blocked' : p.allowedCategories.includes(k) ? 'allowed' : 'none';

export function withStatus(p: OwnerPolicy, k: string, s: CatStatus): OwnerPolicy {
  if (s === 'allowed' && SENSITIVE.has(k)) return p;
  return {
    ...p,
    allowedCategories: s === 'allowed' ? [...new Set([...p.allowedCategories, k])] : p.allowedCategories.filter((x) => x !== k),
    blockedCategories: s === 'blocked' ? [...new Set([...p.blockedCategories, k])] : p.blockedCategories.filter((x) => x !== k),
  };
}

/** Same buckets as the server's activity totals (GET /api/agents/mine/activity). */
export type AbstainReason = AbstainBucket;
export const REASON_LABEL: Record<AbstainReason, string> = {
  blocked_category: 'Blocked category',
  category_not_allowed: 'Category not allowed',
  reward_below_minimum: 'Reward below minimum',
  daily_limit: 'Daily limit reached',
  no_matching_profile: 'No matching profile',
  unverified: 'Not a verified human',
  uncalibrated: 'Agent not calibrated',
  task_request: 'Task request',
  credential_ask: 'Asked for secrets',
  unknown_answer: "Didn't know the answer",
  other: 'Other',
};
/** Where each abstain reason is controlled, for "edit rule" links. */
export const REASON_RULE: Record<AbstainReason, { label: string; href: string }> = {
  blocked_category: { label: 'Categories', href: '/seller/guardrails#categories' },
  category_not_allowed: { label: 'Categories', href: '/seller/guardrails#categories' },
  reward_below_minimum: { label: 'Minimum reward', href: '/seller/guardrails#min-reward' },
  daily_limit: { label: 'Daily limit', href: '/seller/guardrails#daily-limit' },
  no_matching_profile: { label: 'Profile', href: '/seller/guardrails#profile' },
  unverified: { label: 'Verify with World ID', href: '/seller/agent#personhood' },
  uncalibrated: { label: 'Calibrate your agent', href: '/seller/calibration' },
  // Declined by the agent itself (abstain_campaign): nothing to loosen, the guardrails page explains the limits.
  task_request: { label: 'Guardrails', href: '/seller/guardrails' },
  credential_ask: { label: 'Guardrails', href: '/seller/guardrails' },
  unknown_answer: { label: 'Guardrails', href: '/seller/guardrails' },
  other: { label: 'Guardrails', href: '/seller/guardrails' },
};
export const bucketOf = (reason: string | null): AbstainReason =>
  reason?.startsWith('blocked category') ? 'blocked_category'
    : reason?.startsWith('category not allowed') ? 'category_not_allowed'
      : reason?.startsWith('reward') ? 'reward_below_minimum'
        : reason?.startsWith('daily limit') ? 'daily_limit' : reason?.startsWith('no matching profile') ? 'no_matching_profile'
          : reason?.startsWith('unverified') ? 'unverified' : reason?.startsWith('uncalibrated') ? 'uncalibrated'
            : reason === ABSTAIN_REASONS.task_request ? 'task_request' : reason === ABSTAIN_REASONS.credential_ask ? 'credential_ask'
              : reason === ABSTAIN_REASONS.unknown_answer ? 'unknown_answer' : 'other';

export type PreviewCampaign = Pick<CampaignSpec, 'category' | 'questions' | 'rewardLamports'>;
export type Decision = { kind: 'answer' } | { kind: 'abstain'; reason: AbstainReason; text: string };

/** The shared policy check. The agent acts on its own: it answers or abstains, it never waits for the owner. */
export function evaluatePolicy(p: OwnerPolicy, c: PreviewCampaign, todayCount = 0): Decision {
  const r = sharedEvaluate(p, c, todayCount);
  return r.ok ? { kind: 'answer' } : { kind: 'abstain', reason: bucketOf(r.reason), text: r.reason };
}

export function describe(d: Decision): string {
  if (d.kind === 'answer') return 'Would answer';
  return `Would abstain: ${d.text}`;
}
