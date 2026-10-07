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
/**
 * Recorded by an agent that cannot get the OK its owner's approval mode asks for (the in-browser web agent has no chat and
 * no local hold queue). Recoverable, like policy abstains: the owner can change the mode and answer later.
 */
export const NEEDS_APPROVAL_REASON = 'needs owner approval';
