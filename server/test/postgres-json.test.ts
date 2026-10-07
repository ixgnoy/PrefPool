// server/test/postgres-json.test.ts — runs only when TEST_PG_URL points at a real Postgres (PGlite does not reproduce the bug).
import { describe, expect, it } from 'vitest';
import { postgresDb } from '../src/db.js';

const url = process.env.TEST_PG_URL;
describe.skipIf(!url)('postgresDb jsonb parameters (real Postgres)', () => {
  it('stores JSON.stringify(...) passed to $1::jsonb as an object, not a jsonb string', async () => {
    const db = postgresDb(url!);
    const [row] = await db.query<{ t: string; v: { a: number } }>(`select jsonb_typeof($1::jsonb) as t, $1::jsonb as v`, [JSON.stringify({ a: 1 })]);
    expect(row!.t).toBe('object');
    expect(row!.v).toEqual({ a: 1 });
  });
});
