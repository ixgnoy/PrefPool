// server/src/syntheticProfiles.ts
import { addressFromSeed, sha256Hex, type AudienceProfile, type OwnerPolicy, type SyntheticProfile } from '@as/shared';

/**
 * Demo network: 29 synthetic owners (disclosed in the UI). With the demo campaign (payments, one blockers and one
 * opt-in spending question, 0.0015 SOL) 22 answer and 7 abstain; a campaign pays at most 20 (MAX_PAYEES), so CRE accepts
 * the first 20. q1 preferences give roughly a 40/60 split. Payout addresses are wallet addresses derived from a public
 * seed (addressFromSeed), so their keys are effectively public: devnet SOL only.
 */
const AGENT_FACTS = ['agent_setup', 'tools_mcp', 'payments', 'integrations', 'workflows', 'blockers', 'developer_tools'];
const allowAll: OwnerPolicy = { // opted in to spending
  allowedCategories: [...AGENT_FACTS, 'spending'], blockedCategories: ['politics', 'health', 'credentials'],
  minimumRewardSol: 0.001, dailyLimit: 5, approvalMode: 'auto',
};
const blocksSpending: OwnerPolicy = { ...allowAll, allowedCategories: AGENT_FACTS, blockedCategories: ['politics', 'health', 'credentials', 'spending'] };
const personalOnly: OwnerPolicy = { ...allowAll, allowedCategories: ['personal_life'], blockedCategories: ['politics'] };
const pricey: OwnerPolicy = { ...allowAll, minimumRewardSol: 0.002 };

export interface SyntheticAgent { profile: SyntheticProfile; policy: OwnerPolicy; audience: AudienceProfile; address: string }

/** Same list as the web builder (web/lib/audience.ts), so any occupation a buyer can target exists in the demo network. */
const OCCUPATIONS = ['Office / knowledge work', 'Student', 'Service & retail', 'Trades', 'Healthcare', 'Retired'];

export const SYNTHETIC_AGENTS: SyntheticAgent[] = Array.from({ length: 29 }, (_, i) => {
  const id = `syn-${String(i + 1).padStart(2, '0')}`;
  const policy = i < 22 ? allowAll : i < 26 ? blocksSpending : i < 28 ? personalOnly : pricey;
  const q1 = i < 9 ? 0 : 1; // 9 of the 22 answering agents prefer option A
  return {
    profile: { id, preferences: { q1, q2: 2 + (i % 4) } },
    policy,
    // Everyone who answers the demo campaign (MY, 25-34) is inside its audience; the outsiders (SG, 35-44) are agents
    // that already abstain by policy, so the demo numbers above are unchanged while audience filtering is real.
    audience: { country: i === 26 || i === 27 ? 'SG' : 'MY', ageBand: i === 28 ? '35-44' : '25-34', occupationGroup: OCCUPATIONS[i % OCCUPATIONS.length]! },
    address: addressFromSeed(`synthetic:${id}`),
  };
});

export const syntheticToken = (secret: string, id: string) => sha256Hex(`synthetic-token:${secret}:${id}`);
