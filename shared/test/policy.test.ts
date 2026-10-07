// shared/test/policy.test.ts
import { describe, expect, it } from 'vitest';
import { approvalNeeded, evaluatePolicy } from '../src/policy.js';
import { screenCampaign } from '../src/screening.js';
import { syntheticAnswers } from '../src/answers.js';
import type { CampaignSpec, OwnerPolicy } from '../src/types.js';

const policy: OwnerPolicy = {
  allowedCategories: ['agent_setup', 'tools_mcp', 'payments', 'integrations', 'workflows', 'blockers', 'developer_tools'],
  blockedCategories: ['spending'],
  minimumRewardSol: 0.001, dailyLimit: 5, approvalMode: 'auto',
};
const now = 1_760_000_000_000;
const spec: CampaignSpec = {
  title: 'State of agent payments & tools', category: 'payments',
  questions: [
    { id: 'q1', type: 'single_choice', text: "Which ways can you pay for things on your owner's behalf today?", options: ['Card through a payment service', 'Crypto wallet', 'Both', 'None yet'] },
    { id: 'q2', type: 'likert_5', category: 'blockers', text: "How often is a task blocked because you can't log in or pay? (1 = never, 5 = very often)" },
    { id: 'q3', type: 'single_choice', category: 'spending', text: 'Roughly how much does your owner spend on AI tools per month?', options: ['Under $20', '$20-100', 'Over $100'] },
  ],
  audience: { country: ['MY'], ageBand: ['25-34'] },
  rewardLamports: '1500000', maxResponses: 20, minCohort: 15, deadlineMs: now + 600_000,
};

describe('evaluatePolicy', () => {
  it('abstains on a blocked question category', () => {
    expect(evaluatePolicy(policy, spec, 0)).toEqual({ ok: false, reason: 'blocked category: spending' });
  });
  it('accepts when every category is allowed', () => {
    expect(evaluatePolicy({ ...policy, blockedCategories: [], allowedCategories: [...policy.allowedCategories, 'spending'] }, spec, 0)).toEqual({ ok: true });
  });
  it('enforces minimum reward and daily limit', () => {
    const ok = { ...policy, blockedCategories: [], allowedCategories: ['payments', 'blockers', 'spending'] };
    expect(evaluatePolicy({ ...ok, minimumRewardSol: 0.01 }, spec, 0)).toMatchObject({ ok: false });
    expect(evaluatePolicy(ok, spec, 5)).toEqual({ ok: false, reason: 'daily limit 5 reached' });
  });
});

describe('screenCampaign', () => {
  it('passes the demo campaign', () => {
    expect(screenCampaign(spec, now)).toEqual([]);
  });
  it('rejects identifying asks and sensitive categories', () => {
    const bad = { ...spec, questions: [{ id: 'q1', type: 'single_choice' as const, text: 'What is your exact home address?', options: ['a', 'b'] }] };
    expect(screenCampaign(bad, now)).toContain('identifying question: q1');
    expect(screenCampaign({ ...spec, category: 'health' }, now)).toContain('sensitive category: health');
  });
  it('rejects location, contact and account asks', () => {
    const ask = (text: string) => ({ ...spec, questions: [{ id: 'q1', type: 'single_choice' as const, text, options: ['Yes', 'No', 'Not sure'] }] });
    expect(screenCampaign(ask('Does your owner live in Kuala Lumpur?'), now)).toContain('identifying question: q1');
    expect(screenCampaign(ask("What is your owner's email address?"), now)).toContain('identifying question: q1');
    expect(screenCampaign(ask("Does your owner's wallet address start with A?"), now)).toContain('identifying question: q1');
    expect(screenCampaign(ask('What is your owner\'s date of birth?'), now)).toContain('identifying question: q1');
    expect(screenCampaign(ask('What is your Solana account?'), now)).toContain('identifying question: q1');
    expect(screenCampaign(ask('Which letter does your wallet start with?'), now)).toContain('identifying question: q1');
  });
  it('does not treat wallets, email tools or birthdays in general as identifying', () => {
    const ask = (text: string) => ({ ...spec, questions: [{ id: 'q1', type: 'single_choice' as const, text, options: ['Yes', 'No', 'Not sure'] }] });
    expect(screenCampaign(ask('Do you use a crypto wallet to pay for things?'), now)).toEqual([]);
    expect(screenCampaign(ask("Do you send email on your owner's behalf?"), now)).toEqual([]);
    expect(screenCampaign(ask('Do you use tools that live in the browser?'), now)).toEqual([]);
    expect(screenCampaign(ask('Do you remind your owner of birthdays?'), now)).toEqual([]);
    expect(screenCampaign(ask('Do you use public key authentication for SSH?'), now)).toEqual([]);
  });
  it('rejects questions about credentials (keys, passwords, how secrets are stored)', () => {
    expect(screenCampaign({ ...spec, category: 'credentials' }, now)).toContain('sensitive category: credentials');
  });
  it('rejects bad economics and deadlines', () => {
    expect(screenCampaign({ ...spec, rewardLamports: '500000' }, now)).toContain('reward below 0.001 SOL');
    expect(screenCampaign({ ...spec, maxResponses: 21 }, now)).toContain('maxResponses must be 1..20');
    expect(screenCampaign({ ...spec, deadlineMs: now }, now)).toContain('deadline must be at least 1 minute ahead');
  });
});

describe('syntheticAnswers', () => {
  it('is deterministic and respects preferences', () => {
    const p = { id: 'syn-01', preferences: { q1: 1 } };
    const a = syntheticAnswers(p, spec.questions);
    expect(a).toEqual(syntheticAnswers(p, spec.questions));
    expect(a.q1).toBe(1);
    expect(a.q2).toBeGreaterThanOrEqual(1);
    expect(a.q2).toBeLessThanOrEqual(5);
    expect(a.q3).toBeLessThan(3);
  });
});

describe('approvalNeeded', () => {
  const agentOnly = { category: 'payments', questions: [{ id: 'q1', type: 'likert_5' as const, text: 'x (1 = never, 5 = always)' }] };
  it('auto never asks', () => {
    expect(approvalNeeded({ approvalMode: 'auto' }, spec)).toBe('none');
  });
  it('approve_sensitive asks in chat only when a question is about the owner', () => {
    expect(approvalNeeded({ approvalMode: 'approve_sensitive' }, spec)).toBe('chat'); // q3 is spending
    expect(approvalNeeded({ approvalMode: 'approve_sensitive' }, agentOnly)).toBe('none');
  });
  it('approve_all always goes to the web queue', () => {
    expect(approvalNeeded({ approvalMode: 'approve_all' }, agentOnly)).toBe('web');
  });
});
