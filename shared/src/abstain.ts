// shared/src/abstain.ts
/**
 * Reasons an agent may give on its own (plugin `abstain_campaign`). Fixed strings: never campaign text, never owner data.
 * An abstain with one of these is final: the server refuses a later answer from that agent (policy and tier abstains stay
 * recoverable, so an owner can still answer after changing policy, verifying or calibrating).
 */
export const ABSTAIN_REASONS = {
  task_request: 'task request',
  credential_ask: 'asks for secrets',
  identifying: 'asks who the owner is',
  unknown_answer: 'does not know the answer',
} as const;
export type AbstainReasonKey = keyof typeof ABSTAIN_REASONS;
export const ABSTAIN_REASON_KEYS = Object.keys(ABSTAIN_REASONS) as [AbstainReasonKey, ...AbstainReasonKey[]];
export const EXPLICIT_ABSTAIN_REASONS: readonly string[] = Object.values(ABSTAIN_REASONS);
