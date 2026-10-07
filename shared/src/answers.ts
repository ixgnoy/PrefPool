// shared/src/answers.ts
import { sha256Hex } from './crypto';
import type { Answers, Question } from './types';

/** Synthetic owner profile: explicit preferences keyed by question id, plus a seed for everything else. */
export interface SyntheticProfile {
  id: string;
  preferences: Record<string, number>;
}

/** Deterministic answers: a profile preference when present, otherwise a stable hash of (profile, question). */
export function syntheticAnswers(profile: SyntheticProfile, questions: Question[]): Answers {
  const out: Answers = {};
  for (const q of questions) {
    const pref = profile.preferences[q.id];
    const range = q.type === 'likert_5' ? 5 : (q.options?.length ?? 1);
    const hashed = parseInt(sha256Hex(`${profile.id}:${q.id}`).slice(0, 8), 16) % range;
    const v = pref ?? (q.type === 'likert_5' ? hashed + 1 : hashed);
    out[q.id] = v;
  }
  return out;
}
