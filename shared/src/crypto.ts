import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import canonicalize from 'canonicalize';

export { bytesToHex, hexToBytes, utf8ToBytes };

/** RFC 8785 canonical JSON. Throws on values JSON cannot represent (bigint, undefined at top level). */
export function jcs(value: unknown): string {
  const s = canonicalize(value);
  if (s === undefined) throw new Error('value is not canonicalizable');
  return s;
}

export function sha256Hex(text: string): string {
  return bytesToHex(sha256(utf8ToBytes(text)));
}

export function randomHex32(): string {
  const b = new Uint8Array(32);
  globalThis.crypto.getRandomValues(b);
  return bytesToHex(b);
}
