// web/test/policy.test.ts: the agent acts on its own; the rules preview never promises an approval step.
import { describe as group, expect, it } from 'vitest';
import { DEFAULT_POLICY, REASON_LABEL, REASON_RULE, bucketOf, describe, evaluatePolicy } from '../lib/policy';

const food = { category: 'tools_mcp', questions: [{ id: 'q1', type: 'likert_5' as const, text: 'How useful are your MCP servers?' }], rewardLamports: '10000000' }; // 0.01 SOL

group('rules preview', () => {
  it('answers on its own even if an old policy still says "ask every time"', () => {
    const d = evaluatePolicy({ ...DEFAULT_POLICY, approvalMode: 'approve_all' }, food);
    expect(d).toEqual({ kind: 'answer' });
    expect(describe(d)).toBe('Would answer');
  });
});

group('agent abstain reasons (abstain_campaign)', () => {
  it('buckets the fixed reason strings the plugin records', () => {
    expect(bucketOf('task request')).toBe('task_request');
    expect(bucketOf('asks for secrets')).toBe('credential_ask');
    expect(bucketOf('does not know the answer')).toBe('unknown_answer');
    expect(bucketOf('asks who the owner is')).toBe('other');
    expect(REASON_LABEL.task_request).toBe('Task request');
    expect(REASON_LABEL.credential_ask).toBe('Asked for secrets');
    expect(REASON_LABEL.unknown_answer).toBe("Didn't know the answer");
    for (const k of ['task_request', 'credential_ask', 'unknown_answer'] as const) expect(REASON_RULE[k].href).toMatch(/^\/seller\//);
  });
});
