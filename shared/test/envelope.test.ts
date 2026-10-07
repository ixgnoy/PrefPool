// shared/test/envelope.test.ts
import { describe, expect, it } from 'vitest';
import { x25519 } from '@noble/curves/ed25519.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { openEnvelope, sealEnvelope } from '../src/envelope.js';

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
});
