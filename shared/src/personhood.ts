// shared/src/personhood.ts: World ID "verified human" tier (spec 2026-10-07-world-id-personhood-design.md).
export type PersonhoodKind = 'world' | 'simulated';
/** World ID action every seller proves once; its nullifier is a stable anonymous per-app person id. */
export const PERSONHOOD_ACTION = 'cardanofish-seller';
export const UNVERIFIED_REASON = 'unverified: campaign requires verified humans';

/** Every agent runtime (web, plugin, synthetic) asks this before answering. */
export function personhoodGate(c: { verifiedHumansOnly?: boolean }, verified: boolean): { ok: true } | { ok: false; reason: string } {
  return c.verifiedHumansOnly && !verified ? { ok: false, reason: UNVERIFIED_REASON } : { ok: true };
}
