// shared/src/settlePayload.ts: what CRE signs so the escrow program can enforce the settlement on-chain.
// Must match settle_digest in solana/programs/campaign_escrow/src/instructions/settle.rs byte for byte:
// sha256("prefpool:settle:v1" || escrow address || campaign id || report hash || n (u16 LE) || payee addresses).
// The program reads the 32-byte digest from the Ed25519 instruction placed right before `settle`.
import { ed25519 } from '@noble/curves/ed25519.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { addressBytes, isOnCurve } from './address';

export const SETTLE_DOMAIN = new TextEncoder().encode('prefpool:settle:v1');
/** One settle transaction fits this many payees (program constant MAX_PAYEES). */
export const MAX_PAYEES = 20;

/** True when the address can be paid by settle: a wallet (on-curve) address. */
export const settleAddressOk = (address: string) => { try { return isOnCurve(addressBytes(address)); } catch { return false; } };

type Payload = { campaignId: string; escrowTxRef: string; reportHash: string; payouts: { address: string }[] };

/** The 32-byte digest, hex. `escrowTxRef` is the escrow account (PDA) address. */
export function settleDigestHex(r: Payload): string {
  const n = new Uint8Array(2);
  new DataView(n.buffer).setUint16(0, r.payouts.length, true);
  const parts = [SETTLE_DOMAIN, addressBytes(r.escrowTxRef), hexToBytes(r.campaignId), hexToBytes(r.reportHash), n,
    ...r.payouts.map((p) => addressBytes(p.address))];
  const buf = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) { buf.set(p, o); o += p.length; }
  return bytesToHex(sha256(buf));
}

export const signSettlePayload = (r: Payload, skHex: string) => bytesToHex(ed25519.sign(hexToBytes(settleDigestHex(r)), hexToBytes(skHex)));
export const verifySettlePayload = (r: Payload, sigHex: string, pkHex: string) => {
  try { return ed25519.verify(hexToBytes(sigHex), hexToBytes(settleDigestHex(r)), hexToBytes(pkHex)); } catch { return false; }
};
