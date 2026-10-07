// web/test/webAgent.test.ts: the in-browser demo agent never answers silently when the owner wants to approve first.
import { describe, expect, it } from 'vitest';
import { DEFAULT_POLICY, REASON_LABEL, REASON_RULE, bucketOf } from '../lib/policy';
import { NEEDS_APPROVAL_REASON, webAgentApprovalGate } from '../lib/webAgent';

const tools = { category: 'tools_mcp', questions: [{ id: 'q1', type: 'likert_5' as const, text: 'How useful are your MCP servers?' }] };
const spendQ = { category: 'tools_mcp', questions: [{ id: 'q1', type: 'likert_5' as const, text: 'Monthly spend?', category: 'spending' }] };
const personal = { category: 'personal_life', questions: [{ id: 'q1', type: 'likert_5' as const, text: 'Weekend plans?' }] };

describe('web agent approval gate', () => {
  it('auto: answers', () => {
    for (const c of [tools, spendQ, personal]) expect(webAgentApprovalGate({ approvalMode: 'auto' }, c)).toEqual({ ok: true });
  });
  it('approve_sensitive: abstains only on owner-facing campaigns (including per-question overrides)', () => {
    const p = { ...DEFAULT_POLICY, approvalMode: 'approve_sensitive' as const };
    expect(webAgentApprovalGate(p, tools)).toEqual({ ok: true });
    expect(webAgentApprovalGate(p, spendQ)).toEqual({ ok: false, reason: NEEDS_APPROVAL_REASON });
    expect(webAgentApprovalGate(p, personal)).toEqual({ ok: false, reason: NEEDS_APPROVAL_REASON });
  });
  it('approve_all: abstains on everything with a content-free reason', () => {
    for (const c of [tools, spendQ, personal]) expect(webAgentApprovalGate({ approvalMode: 'approve_all' }, c)).toEqual({ ok: false, reason: NEEDS_APPROVAL_REASON });
    expect(bucketOf(NEEDS_APPROVAL_REASON)).toBe('needs_approval');
    expect(REASON_LABEL.needs_approval).toBe('Needs your approval');
    expect(REASON_RULE.needs_approval.href).toBe('/seller/guardrails#approval');
  });
});
