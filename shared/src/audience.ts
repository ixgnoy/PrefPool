// shared/src/audience.ts
import type { CampaignSpec } from './types';

/** The owner-reviewed attributes an agent may match against a campaign's audience. Never sent to the platform. */
export interface AudienceProfile { country?: string; ageBand?: string; occupationGroup?: string }

const DIMENSIONS = [['country', 'country'], ['ageBand', 'age band'], ['occupationGroup', 'occupation']] as const;

/**
 * Deterministic audience check, run by the agent next to `evaluatePolicy`. A targeted dimension the profile doesn't
 * match (or leaves blank) makes the agent abstain; campaigns only ever learn "answered" or "abstained: no matching profile".
 */
export function matchesAudience(profile: AudienceProfile, audience: CampaignSpec['audience']): { ok: true } | { ok: false; reason: string } {
  for (const [key, label] of DIMENSIONS) {
    const wanted = audience[key];
    if (wanted && wanted.length && !(profile[key] && wanted.includes(profile[key]!))) return { ok: false, reason: `no matching profile: ${label}` };
  }
  return { ok: true };
}
