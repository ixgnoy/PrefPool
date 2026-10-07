// plugins/mcp/src/store.ts
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AudienceProfile, Envelope, OwnerPolicy } from '@as/shared';
import type { OwnerFact } from './facts.js';

/** Local plugin state in ${CLAUDE_PLUGIN_DATA}: the owner policy and profile never leave this machine. */
export interface LocalState {
  policy: OwnerPolicy | null; day: string; answeredToday: number; decided: string[];
  /**
   * Campaigns the agent explicitly declined with abstain_campaign: final, never answered afterwards. Policy and tier
   * abstains (evaluate_campaign) stay in `decided` only, so the owner can still answer after changing policy or verifying.
   */
  abstained?: string[];
  /** Owner-reviewed audience attributes (country, age band, occupation), matched with `matchesAudience` from @as/shared. */
  profile?: AudienceProfile;
  /** Opt-in, like the web agent's "Match campaigns to my profile" toggle. Off: campaigns are not audience-matched. */
  matchAudience?: boolean;
  /** What the owner told the agent about themselves (remember_owner_fact), filed by category. Never sent anywhere. */
  facts?: OwnerFact[];
  /**
   * approve_all: answers sealed but held on this machine until the owner approves them on the web. `envelope` is sealed to the
   * platform key and sent only after approval; `copy` (sealed to the owner's transcript key) is what the owner reviewed.
   * Held answers count toward dailyLimit while they wait.
   */
  pending?: Record<string, { envelope: Envelope; copy: Envelope; deadlineMs: number }>;
}

export const DEFAULT_POLICY: OwnerPolicy = {
  // Agent-native defaults: facts about the agent's own setup and work. `spending` and `personal_life` are opt-in.
  // minimumRewardSol 0.001 = the platform's minimum reward (screening), so any reward passes until the owner raises it.
  allowedCategories: ['agent_setup', 'tools_mcp', 'payments', 'integrations', 'workflows', 'blockers', 'developer_tools'],
  blockedCategories: ['politics', 'health', 'religion', 'ethnicity', 'sexual_orientation', 'credentials'],
  minimumRewardSol: 0.001, dailyLimit: 5, approvalMode: 'auto',
};

export function localStore(dir: string, today: () => string) {
  const file = join(dir, 'agent-survey.json');
  const load = (): LocalState => {
    try {
      const s = JSON.parse(readFileSync(file, 'utf8')) as LocalState;
      return s.day === today() ? s : { ...s, day: today(), answeredToday: 0 };
    } catch {
      return { policy: null, day: today(), answeredToday: 0, decided: [] };
    }
  };
  const save = (s: LocalState) => { mkdirSync(dir, { recursive: true }); writeFileSync(file, JSON.stringify(s, null, 2), { mode: 0o600 }); };
  return { load, save };
}
