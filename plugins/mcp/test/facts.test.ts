// plugins/mcp/test/facts.test.ts
import { describe, expect, it } from 'vitest';
import { deriveSources, factProblem, factsFor, type OwnerFact } from '../src/facts.js';

const f = (id: string, text: string, categories: string[], recordedAt = '2026-10-07T00:00:00Z'): OwnerFact => ({ id, text, categories, recordedAt });

describe('owner facts', () => {
  it('refuses secrets, sensitive categories, empty and oversized facts', () => {
    expect(factProblem('my api key is sk-abc', ['spending'], 0)).toMatch(/secret/);
    expect(factProblem('my password is hunter2', ['spending'], 0)).toMatch(/secret/);
    expect(factProblem('uses token 9fK2xQ7mL4pR8vT1wZ3yB6nC5dE0gH2jA', ['tools_mcp'], 0)).toMatch(/secret/);
    expect(factProblem('I take insulin', ['health'], 0)).toMatch(/categories must be/);
    expect(factProblem('likes it', ['credentials'], 0)).toMatch(/categories must be/);
    expect(factProblem('likes it', ['made_up'], 0)).toMatch(/categories must be/);
    expect(factProblem('likes it', [], 0)).toMatch(/categories must be/);
    expect(factProblem('  ', ['spending'], 0)).toBe('empty fact');
    expect(factProblem('x'.repeat(201), ['spending'], 0)).toMatch(/longer than/);
    expect(factProblem('ok', ['spending'], 200)).toMatch(/full/);
    expect(factProblem('I spend about $40 a month on AI tools', ['spending'], 3)).toBeNull();
    expect(factProblem('runs the GitHub MCP server', ['tools_mcp'], 3)).toBeNull();
    expect(factProblem('uses a password manager', ['tools_mcp'], 3)).toBeNull();
    expect(factProblem('my seed is abandon ability able about above absent absorb abstract absurd abuse access accident', ['tools_mcp'], 0)).toMatch(/secret/);
    expect(factProblem('wallet [12, 34, 255, 7, 0, 18, 99, 120, 3, 4, 5, 6, 7, 8, 9, 10, 11]', ['payments'], 0)).toMatch(/secret/);
    expect(factProblem('prefers sk-learn for ML', ['developer_tools'], 0)).toBeNull();
  });
  it('selects by category only, newest first', () => {
    const facts = [f('a', 'old', ['spending'], '2026-01-01T00:00:00Z'), f('b', 'new', ['spending', 'personal_life']), f('d', 'tools', ['tools_mcp'])];
    expect(factsFor(facts, ['payments', 'spending']).map((x) => x.id)).toEqual(['b', 'a']);
    expect(factsFor(facts, ['blockers'])).toEqual([]);
    expect(factsFor(undefined, ['spending'])).toEqual([]);
  });
  it('downgrades sources the store cannot back', () => {
    const c = { category: 'payments', questions: [
      { id: 'q1', type: 'single_choice' as const, text: 't', options: ['a', 'b'] },
      { id: 'q3', type: 'single_choice' as const, text: 't', options: ['a', 'b'], category: 'spending' },
    ] };
    expect(deriveSources(c, { q1: 'checked', q3: 'owner_told' }, [])).toEqual({ q1: 'checked', q3: 'inferred' });
    expect(deriveSources(c, { q1: 'checked', q3: 'owner_told' }, [f('a', 'spends $40', ['spending'])])).toEqual({ q1: 'checked', q3: 'owner_told' });
    expect(deriveSources(c, { q1: 'owner_told', q3: 'checked' }, [f('a', 'spends $40', ['spending'])])).toEqual({ q1: 'inferred', q3: 'inferred' });
    expect(deriveSources(c, undefined, [])).toEqual({ q1: 'inferred', q3: 'inferred' });
  });
});
