// shared/src/address.ts: Solana addresses (base58 of 32 bytes) and program-derived addresses, without @solana/web3.js
// so the same code runs in the CRE workflow, the server and the browser.
import { ed25519 } from '@noble/curves/ed25519.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { base58 } from '@scure/base';

/** 32 raw bytes of a base58 Solana address; throws on anything else. */
export function addressBytes(address: string): Uint8Array {
  const b = base58.decode(address);
  if (b.length !== 32) throw new Error('not a Solana address');
  return b;
}
export const addressFromBytes = (b: Uint8Array) => base58.encode(b);
export const isSolanaAddress = (s: unknown): s is string => {
  if (typeof s !== 'string' || s.length < 32 || s.length > 44) return false;
  try { addressBytes(s); return true; } catch { return false; }
};
/** A wallet address: on the ed25519 curve, so it has a private key (PDAs are off-curve). */
export function isOnCurve(b: Uint8Array): boolean {
  try { ed25519.Point.fromBytes(b); return true; } catch { return false; }
}

const PDA_MARKER = new TextEncoder().encode('ProgramDerivedAddress');
/** Solana's find_program_address: highest bump in 255..0 whose hash is off-curve. */
export function findProgramAddress(seeds: Uint8Array[], programId: string): [string, number] {
  const program = addressBytes(programId);
  for (let bump = 255; bump >= 0; bump--) {
    const parts = [...seeds, Uint8Array.of(bump), program, PDA_MARKER];
    const buf = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let o = 0;
    for (const p of parts) { buf.set(p, o); o += p.length; }
    const h = sha256(buf);
    if (!isOnCurve(h)) return [addressFromBytes(h), bump];
  }
  throw new Error('no viable bump');
}

export const CAMPAIGN_SEED = new TextEncoder().encode('campaign');
/** The campaign's escrow account: PDA ["campaign", campaign_id] of the escrow program. */
export const campaignEscrowAddress = (programId: string, campaignIdHex: string) =>
  findProgramAddress([CAMPAIGN_SEED, hexToBytes(campaignIdHex)], programId)[0];

/** Deterministic wallet-style address from a seed (synthetic agents, fixtures). */
export const addressFromSeed = (seed: string) =>
  addressFromBytes(ed25519.getPublicKey(sha256(new TextEncoder().encode(seed))));

export const addressHex = (address: string) => bytesToHex(addressBytes(address));
