// server/scripts/calibration-bank-sql.ts: turn supabase/seed/calibration_bank_v<N>.json into the migration's insert
// statements (spec 2026-10-07-agent-calibration-design.md §1). Usage: npx tsx scripts/calibration-bank-sql.ts > bank.sql
import { readFileSync } from 'node:fs';

const file = new URL('../../supabase/seed/calibration_bank_v1.json', import.meta.url);
const { bankVersion, questions } = JSON.parse(readFileSync(file, 'utf8')) as {
  bankVersion: number; questions: { id: string; text: string; type: string; options?: string[]; category: string; prior: number[] }[];
};
const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;
const json = (v: unknown) => `${lit(JSON.stringify(v))}::jsonb`;
console.log(`insert into calibration_questions (id, bank_version, text, type, options, category, prior) values`);
console.log(questions.map((q) => `  (${lit(q.id)}, ${bankVersion}, ${lit(q.text)}, ${lit(q.type)}, ${q.options ? json(q.options) : 'null'}, ${lit(q.category)}, ${json(q.prior)})`).join(',\n') + ';');
