// shared/src/envelope.ts
import { x25519 } from '@noble/curves/ed25519.js';
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import { ANSWER_SOURCES, type Answers, type Envelope, type EnvelopeMeta } from './types';

const INFO = utf8ToBytes('agent-survey/envelope/v1');

function deriveKey(shared: Uint8Array, ephPub: Uint8Array, recipientPub: Uint8Array): Uint8Array {
  const salt = new Uint8Array(ephPub.length + recipientPub.length);
  salt.set(ephPub, 0);
  salt.set(recipientPub, ephPub.length);
  return hkdf(sha256, shared, salt, INFO, 32);
}

const aadFor = (campaignId: string, respondentAddress: string) =>
  utf8ToBytes(`${campaignId}|${respondentAddress}`);

/**
 * Encrypt answers to the platform-wide envelope public key. Needs crypto.getRandomValues (Node, browser).
 * With meta (answer sources, client) the envelope is v2; without, v1 exactly as before.
 */
export function sealEnvelope(
  recipientPubHex: string,
  campaignId: string,
  respondentAddress: string,
  answers: Answers,
  meta?: EnvelopeMeta,
): Envelope {
  const recipientPub = hexToBytes(recipientPubHex);
  const ephPriv = x25519.utils.randomSecretKey();
  const ephPub = x25519.getPublicKey(ephPriv);
  const key = deriveKey(x25519.getSharedSecret(ephPriv, recipientPub), ephPub, recipientPub);
  const nonce = new Uint8Array(24);
  globalThis.crypto.getRandomValues(nonce);
  const plaintext = utf8ToBytes(JSON.stringify(meta ? { campaignId, respondentAddress, answers, meta } : { campaignId, respondentAddress, answers }));
  const ct = xchacha20poly1305(key, nonce, aadFor(campaignId, respondentAddress)).encrypt(plaintext);
  return { v: meta ? 2 : 1, campaignId, respondentAddress, epk: bytesToHex(ephPub), n: bytesToHex(nonce), ct: bytesToHex(ct) };
}

const isStr = (x: unknown): x is string => typeof x === 'string';
/** Client strings: short, plain characters (they become report bucket keys). */
const CLIENT_STR = /^[\w.@\/:+ -]{1,64}$/;
/** True when x is a client string cleanMeta keeps (name, version, modelId). Clients check before sealing so one bad field doesn't drop all meta. */
export const isClientString = (x: unknown): x is string => isStr(x) && CLIENT_STR.test(x);
const isClientStr = isClientString;
/** Bucket names clientCounts uses itself; a client claiming one must not merge into it. */
const RESERVED_CLIENT_NAMES = new Set(['unknown', 'other']);
const isPlainObject = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

/**
 * Meta is self-reported by the respondent's client, so CRE treats it as untrusted: anything not shaped like
 * EnvelopeMeta is dropped (the answer still counts, its source and client as unknown) rather than failing the run.
 */
function cleanMeta(raw: unknown): EnvelopeMeta | null {
  if (!isPlainObject(raw) || !isPlainObject(raw.sources) || !isPlainObject(raw.client)) return null;
  const { name, version, modelId } = raw.client;
  if (!isClientStr(name) || !isClientStr(version) || (modelId !== undefined && !isClientStr(modelId))) return null;
  if (RESERVED_CLIENT_NAMES.has(name.trim().toLowerCase())) return null;
  const entries = Object.entries(raw.sources);
  if (!entries.every(([, v]) => isStr(v))) return null;
  // Unknown tags are left out; sourceCounts then counts that question as unknown.
  const sources = Object.fromEntries(entries.filter(([, v]) => (ANSWER_SOURCES as readonly string[]).includes(v as string))) as EnvelopeMeta['sources'];
  return { sources, client: modelId === undefined ? { name, version } : { name, version, modelId } };
}

/** Decrypt inside CRE (v1 and v2). No randomness needed. Throws on tamper, wrong key, or swapped outer ids. */
export function openSealed(recipientPrivHex: string, env: Envelope): { answers: Answers; meta: EnvelopeMeta | null } {
  if (env.v !== 1 && env.v !== 2) throw new Error('unsupported envelope version');
  const priv = hexToBytes(recipientPrivHex);
  const recipientPub = x25519.getPublicKey(priv);
  const ephPub = hexToBytes(env.epk);
  const key = deriveKey(x25519.getSharedSecret(priv, ephPub), ephPub, recipientPub);
  const pt = xchacha20poly1305(key, hexToBytes(env.n), aadFor(env.campaignId, env.respondentAddress))
    .decrypt(hexToBytes(env.ct));
  const inner = JSON.parse(new TextDecoder().decode(pt)) as {
    campaignId: string; respondentAddress: string; answers: Answers; meta?: unknown;
  };
  if (inner.campaignId !== env.campaignId || inner.respondentAddress !== env.respondentAddress) {
    throw new Error('envelope id mismatch');
  }
  // Meta comes from the authenticated plaintext, not the outer (unauthenticated) v, so relabelling v2 as v1 can't strip it.
  return { answers: inner.answers, meta: inner.meta !== undefined ? cleanMeta(inner.meta) : null };
}

/** Answers only (v1 and v2); for callers that don't need the meta. */
export const openEnvelope = (recipientPrivHex: string, env: Envelope): Answers => openSealed(recipientPrivHex, env).answers;
