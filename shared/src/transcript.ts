// shared/src/transcript.ts — "encrypt to self": owners read their own agent's answers on any device.
// Agents seal a second envelope (same sealEnvelope as for CRE) to the owner's transcript public key. The owner's browser
// rebuilds the private key from a wallet signMessage signature over a fixed message: Ed25519 signatures are deterministic,
// so the same wallet signing the same message always yields the same key. The server only ever stores ciphertext.
import { x25519 } from '@noble/curves/ed25519.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes, utf8ToBytes } from './crypto';

export const transcriptKeyMessage = (address: string) => `PrefPool · unlock my answers · v1 · ${address}`;

/** X25519 key pair derived from the hex of the wallet's Ed25519 signMessage signature over transcriptKeyMessage. */
export function transcriptKeyFromSignature(signatureHex: string): { privateKey: string; publicKey: string } {
  const sk = hkdf(sha256, hexToBytes(signatureHex), utf8ToBytes('prefpool-transcript'), utf8ToBytes('x25519 v1'), 32);
  return { privateKey: bytesToHex(sk), publicKey: bytesToHex(x25519.getPublicKey(sk)) };
}
