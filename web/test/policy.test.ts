// web/test/policy.test.ts: the agent acts on its own; the rules preview never promises an approval step.
import { describe as group, expect, it } from 'vitest';
import { DEFAULT_POLICY, describe, evaluatePolicy } from '../lib/policy';

const food = { category: 'tools_mcp', questions: [{ id: 'q1', type: 'likert_5' as const, text: 'How useful are your MCP servers?' }], rewardLamports: '10000000' }; // 0.01 SOL

group('rules preview', () => {
  it('answers on its own even if an old policy still says "ask every time"', () => {
    const d = evaluatePolicy({ ...DEFAULT_POLICY, approvalMode: 'approve_all' }, food);
    expect(d).toEqual({ kind: 'answer' });
    expect(describe(d)).toBe('Would answer');
  });
});
