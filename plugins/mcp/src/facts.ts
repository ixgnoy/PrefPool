// plugins/mcp/src/facts.ts: the owner fact store. Facts stay on this machine; a campaign only ever receives an option index.
import { KNOWN_CATEGORIES, OWNER_FACING_CATEGORIES, SENSITIVE_CATEGORIES, looksLikeSecret, sha256Hex, type AnswerSource, type Question } from '@as/shared';

/** A replaced fact is deleted, not kept: the store only ever holds what the owner currently says is true. */
export interface OwnerFact { id: string; text: string; categories: string[]; recordedAt: string }
export const MAX_FACTS = 200;
export const MAX_FACT_CHARS = 200;
/** Facts may only be filed under askable categories: a sensitive fact has no campaign that could use it. */
export const FACT_CATEGORIES = KNOWN_CATEGORIES.filter((c) => !SENSITIVE_CATEGORIES.includes(c));

/** Why a fact cannot be stored, or null. Credentials are never facts: `credentials` campaigns are rejected, so the store must not become the leak. */
export function factProblem(text: string, categories: string[], count: number): string | null {
  if (!text.trim()) return 'empty fact';
  if (text.length > MAX_FACT_CHARS) return `fact longer than ${MAX_FACT_CHARS} characters`;
  if (looksLikeSecret(text)) return 'looks like a secret or credential; never store those';
  if (!categories.length || categories.some((c) => !FACT_CATEGORIES.includes(c))) return `categories must be among ${FACT_CATEGORIES.join(', ')}`;
  if (count >= MAX_FACTS) return `fact store full (${MAX_FACTS}); forget something first`;
  return null;
}
export const factId = (text: string) => sha256Hex(text.trim().toLowerCase()).slice(0, 12);

/** Facts for a campaign, chosen by the platform's category labels alone, before the model reads any campaign text (AirGapAgent). */
export function factsFor(facts: OwnerFact[] | undefined, categories: string[]): OwnerFact[] {
  return (facts ?? []).filter((f) => f.categories.some((c) => categories.includes(c))).sort((a, b) => b.recordedAt.localeCompare(a.recordedAt));
}

/** The source the plugin seals: the model's claim, downgraded whenever the store cannot back it (Kadavath: self-reports are unreliable). */
export function deriveSources(c: { category: string; questions: Question[] }, declared: Record<string, AnswerSource> | undefined, facts: OwnerFact[] | undefined): Record<string, AnswerSource> {
  const out: Record<string, AnswerSource> = {};
  for (const q of c.questions) {
    const cat = q.category ?? c.category;
    const d = declared?.[q.id] ?? 'inferred';
    if (d === 'owner_told') out[q.id] = factsFor(facts, [cat]).length ? 'owner_told' : 'inferred';
    else if (d === 'checked') out[q.id] = OWNER_FACING_CATEGORIES.includes(cat) ? 'inferred' : 'checked';
    else out[q.id] = 'inferred';
  }
  return out;
}
