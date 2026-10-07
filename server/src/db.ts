// server/src/db.ts
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import postgres from 'postgres';

/** The only DB surface the server uses: parameterized SQL. Same SQL runs on Supabase Postgres and on PGlite in tests. */
export interface Db {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  exec(sql: string): Promise<void>;
}

/**
 * Supabase Postgres via a direct connection string (Settings -> Database -> Connection string).
 * Use the session pooler (port 5432) or direct host; `prepare: false` keeps the transaction pooler (6543) working too.
 */
export function postgresDb(url: string): Db {
  // Callers pass JSON.stringify(...) for $n::jsonb; postgres.js would JSON-encode that string again and store a jsonb string.
  // Pass strings through unchanged (PGlite, used in tests, already does this).
  const json = { to: 3802, from: [114, 3802], serialize: (x: unknown) => (typeof x === "string" ? x : JSON.stringify(x)), parse: (x: string) => JSON.parse(x) };
  const sql = postgres(url, { prepare: false, max: 5, types: { bigint: postgres.BigInt, json } });
  return {
    query: async (text, params = []) => (await sql.unsafe(text, params as never[])) as never,
    exec: async (text) => { await sql.unsafe(text); },
  };
}

/** Apply every supabase/migrations/*.sql in name order (tests and local dev; production uses `supabase db push`). */
export async function migrate(db: Db, dir: string): Promise<void> {
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.sql')).sort()) await db.exec(readFileSync(join(dir, f), 'utf8'));
}

/** Postgres unique_violation (23505), from postgres.js or PGlite. */
export const isUniqueViolation = (e: unknown) =>
  (e as { code?: string })?.code === '23505' || /duplicate key value|unique constraint/i.test(String((e as Error)?.message));
