// server/test/synthetic.test.ts — startup writes the demo agents only when they are missing or their token is stale.
import { describe, expect, it } from 'vitest';
import type { Db } from '../src/db.js';
import { ensureSyntheticAgents } from '../src/synthetic.js';
import { makeDeps } from './helpers.js';

describe('ensureSyntheticAgents', () => {
  it('creates once, then writes nothing; a new SYNTHETIC_SECRET rewrites every token', async () => {
    const { deps } = await makeDeps();
    const writes: string[] = [];
    const db: Db = { ...deps.db, query: (sql, p) => { if (/^\s*insert/i.test(sql)) writes.push(sql); return deps.db.query(sql, p); } };
    await ensureSyntheticAgents(db, 'a'.repeat(64));
    const created = writes.length;
    expect(created).toBeGreaterThan(0);
    await ensureSyntheticAgents(db, 'a'.repeat(64));
    expect(writes.length).toBe(created);
    await ensureSyntheticAgents(db, 'b'.repeat(64));
    expect(writes.length).toBe(created * 2);
  });
});
