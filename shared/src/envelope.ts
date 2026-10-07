// shared/src/envelope.ts
import { x25519 } from '@noble/curves/ed25519.js';
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import type { Answers, Envelope } from './types';

const INFO = utf8ToBytes('agent-survey/envelope/v1');

function deriveKey(shared: Uint8Array, ephPub: Uint8Array, recipientPub: Uint8Array): Uint8Array {
  const salt = new Uint8Array(ephPub.length + recipientPub.length);
  salt.set(ephPub, 0);
  salt.set(recipientPub, ephPub.length);
  return hkdf(sha256, shared, salt, INFO, 32);
}

const aadFor = (campaignId: string, respondentAddress: string) =>
  utf8ToBytes(`${campaignId}|${respondentAddress}`);

/** Encrypt answers to the platform-wide envelope public key. Needs crypto.getRandomValues (Node, browser). */
export function sealEnvelope(
  recipientPubHex: string,
  campaignId: string,
  respondentAddress: string,
  answers: Answers,
): Envelope {
  const recipientPub = hexToBytes(recipientPubHex);
  const ephPriv = x25519.utils.randomSecretKey();
  const ephPub = x25519.getPublicKey(ephPriv);
  const key = deriveKey(x25519.getSharedSecret(ephPriv, recipientPub), ephPub, recipientPub);
  const nonce = new Uint8Array(24);
  globalThis.crypto.getRandomValues(nonce);
  const plaintext = utf8ToBytes(JSON.stringify({ campaignId, respondentAddress, answers }));
  const ct = xchacha20poly1305(key, nonce, aadFor(campaignId, respondentAddress)).encrypt(plaintext);
  return { v: 1, campaignId, respondentAddress, epk: bytesToHex(ephPub), n: bytesToHex(nonce), ct: bytesToHex(ct) };
}

/** Decrypt inside CRE. No randomness needed. Throws on tamper, wrong key, or swapped outer ids. */
export function openEnvelope(recipientPrivHex: string, env: Envelope): Answers {
  if (env.v !== 1) throw new Error('unsupported envelope version');
  const priv = hexToBytes(recipientPrivHex);
  const recipientPub = x25519.getPublicKey(priv);
  const ephPub = hexToBytes(env.epk);
  const key = deriveKey(x25519.getSharedSecret(priv, ephPub), ephPub, recipientPub);
  const pt = xchacha20poly1305(key, hexToBytes(env.n), aadFor(env.campaignId, env.respondentAddress))
    .decrypt(hexToBytes(env.ct));
  const inner = JSON.parse(new TextDecoder().decode(pt)) as {
    campaignId: string; respondentAddress: string; answers: Answers;
  };
  if (inner.campaignId !== env.campaignId || inner.respondentAddress !== env.respondentAddress) {
    throw new Error('envelope id mismatch');
  }
  return inner.answers;
}
