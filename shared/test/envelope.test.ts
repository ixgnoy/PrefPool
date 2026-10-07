// shared/test/envelope.test.ts
import { describe, expect, it } from 'vitest';
import { x25519 } from '@noble/curves/ed25519.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { openEnvelope, openSealed, sealEnvelope } from '../src/envelope.js';

const sk = x25519.utils.randomSecretKey();
const pk = bytesToHex(x25519.getPublicKey(sk));
const cid = 'cc'.repeat(32);
const addr = 'Got5vvPkQZbjRC3bLcArjomAHuDDmTfAY8Zmjsbh5MLH';

describe('envelope', () => {
  it('round-trips answers', () => {
    const env = sealEnvelope(pk, cid, addr, { q1: 1, q2: 4 });
    expect(openEnvelope(bytesToHex(sk), env)).toEqual({ q1: 1, q2: 4 });
  });
  it('rejects a swapped respondent address', () => {
    const env = sealEnvelope(pk, cid, addr, { q1: 1 });
    expect(() => openEnvelope(bytesToHex(sk), { ...env, respondentAddress: addr.replace('Got5', 'Got6') })).toThrow();
  });
  it('rejects an envelope replayed into another campaign', () => {
    const env = sealEnvelope(pk, cid, addr, { q1: 1 });
    expect(() => openEnvelope(bytesToHex(sk), { ...env, campaignId: 'dd'.repeat(32) })).toThrow();
  });
  it('rejects the wrong recipient key', () => {
    const env = sealEnvelope(pk, cid, addr, { q1: 1 });
    expect(() => openEnvelope(bytesToHex(x25519.utils.randomSecretKey()), env)).toThrow();
  });
  it('stays under 1 KB so a page of 10 fits the 25 KB CRE consensus limit', () => {
    const long = 'Cm1NmUPngoFke9pc8zXsK2qebBEfPb76bS3gHfjMS2hN';
    const env = sealEnvelope(pk, cid, long, { q1: 2, q2: 5, q3: 1, q4: 0, q5: 3 });
    expect(JSON.stringify({ ...env, receivedAtMs: Date.now() }).length).toBeLessThan(1024);
  });
  it('v2 carries meta; openEnvelope still returns answers; v1 opens with no meta', () => {
    const meta = { sources: { q1: 'checked' as const }, client: { name: 'agent-survey-mcp', version: '0.2.0' } };
    const v2 = sealEnvelope(pk, cid, addr, { q1: 1 }, meta);
    expect(v2.v).toBe(2);
    expect(openSealed(bytesToHex(sk), v2)).toEqual({ answers: { q1: 1 }, meta });
    expect(openEnvelope(bytesToHex(sk), v2)).toEqual({ q1: 1 });
    expect(openSealed(bytesToHex(sk), sealEnvelope(pk, cid, addr, { q1: 1 })).meta).toBeNull();
  });
  it('v2 rejects tamper and swapped ids like v1', () => {
    const v2 = sealEnvelope(pk, cid, addr, { q1: 1 }, { sources: { q1: 'inferred' }, client: { name: 'x', version: '1' } });
    expect(() => openSealed(bytesToHex(sk), { ...v2, campaignId: 'dd'.repeat(32) })).toThrow();
    expect(() => openSealed(bytesToHex(sk), { ...v2, v: 1 })).not.toThrow(); // version is not in the AAD; v1 reading drops meta
    expect(openSealed(bytesToHex(sk), { ...v2, v: 1 }).meta).toBeNull();
    expect(() => openSealed(bytesToHex(sk), { ...v2, v: 3 as 2 })).toThrow('unsupported envelope version');
  });
  it('drops malformed meta instead of failing (a hostile client must not break aggregation)', () => {
    const bad = [
      { sources: 'x', client: { name: 'a', version: '1' } },
      { sources: {}, client: null },
      { sources: {}, client: { name: 7, version: '1' } },
      { sources: { q1: 5 }, client: { name: 'a', version: '1' } },
      { sources: {}, client: { name: 'a', version: '1', modelId: {} } },
      [],
    ];
    for (const m of bad) {
      const env = sealEnvelope(pk, cid, addr, { q1: 1 }, m as never);
      expect(openSealed(bytesToHex(sk), env)).toEqual({ answers: { q1: 1 }, meta: null });
    }
  });
  it('a full v2 envelope (5 questions, model id) stays under 2.4 KB so a page of 10 fits 25 KB', () => {
    const long = 'Cm1NmUPngoFke9pc8zXsK2qebBEfPb76bS3gHfjMS2hN';
    const sources = { q1: 'owner_told', q2: 'owner_told', q3: 'owner_told', q4: 'owner_told', q5: 'owner_told' } as const;
    const env = sealEnvelope(pk, cid, long, { q1: 2, q2: 5, q3: 1, q4: 0, q5: 3 },
      { sources, client: { name: 'agent-survey-mcp', version: '10.20.30', modelId: 'claude-opus-5-5-20261001-extended' } });
    expect(env.ct.length).toBeLessThanOrEqual(2000);
    expect(JSON.stringify({ ...env, receivedAtMs: Date.now() }).length).toBeLessThan(2400);
  });
});
