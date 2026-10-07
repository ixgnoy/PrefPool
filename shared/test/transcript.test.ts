// shared/test/transcript.test.ts — "encrypt to self": the owner's copy of their agent's answers.
import { describe, expect, it } from 'vitest';
import { openEnvelope, sealEnvelope } from '../src/envelope';
import { transcriptKeyFromSignature, transcriptKeyMessage } from '../src/transcript';

const ADDR = 'addr_test1qqpsxqcrqvpsxqcrqvpsxqcrqvpsxqcrqvpsxqcrqvpsxqcyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqszqfplh6s';
const COSE_SIG = '845846a201276761646472657373583900' + 'ab'.repeat(64); // stands in for a wallet signMessage signature hex

describe('transcript key', () => {
  it('the sign-in message names the app, purpose, version and address', () => {
    expect(transcriptKeyMessage(ADDR)).toBe(`PrefPool · unlock my answers · v1 · ${ADDR}`);
  });
  it('is derived deterministically from the wallet signature (same signature, same key)', () => {
    const a = transcriptKeyFromSignature(COSE_SIG), b = transcriptKeyFromSignature(COSE_SIG);
    expect(a).toEqual(b);
    expect(a.privateKey).toMatch(/^[0-9a-f]{64}$/);
    expect(a.publicKey).toMatch(/^[0-9a-f]{64}$/);
    expect(transcriptKeyFromSignature(COSE_SIG.replace(/ab$/, 'ac')).publicKey).not.toBe(a.publicKey);
  });
  it("an agent seals a copy to the owner's public key; only the derived private key opens it", () => {
    const owner = transcriptKeyFromSignature(COSE_SIG);
    const env = sealEnvelope(owner.publicKey, 'c'.repeat(64), ADDR, { q1: 1, q2: 4 });
    expect(openEnvelope(owner.privateKey, env)).toEqual({ q1: 1, q2: 4 });
    expect(() => openEnvelope(transcriptKeyFromSignature('00').privateKey, env)).toThrow();
  });
});
