// plugins/mcp/src/wallet.ts: the agent's own Solana keypair (researcher side): sign-in, funding txs, x402 report fees.
import { ComputeBudgetProgram, Keypair, Transaction } from '@solana/web3.js';
import { base58 } from '@scure/base';
import { ed25519 } from '@noble/curves/ed25519.js';
import { anchorDiscriminator, bytesToHex, campaignEscrowAddress } from '@as/shared';

export interface AgentWallet {
  /** base58 public key: the campaign's company (fee payer, refund address) when the agent funds. */
  address: string;
  /** Hex ed25519 signature over the UTF-8 bytes of the sign-in message (same as Phantom signMessage). */
  signMessage(message: string): string;
  /** Sign a base64 legacy transaction as fee payer; returns the fully signed base64 transaction. */
  signTransaction(unsignedTxBase64: string): string;
  /** 64-byte secret key (seed || public key), for the x402 svm signer. */
  secretKey: Uint8Array;
}

/** Parse AGENT_SOLANA_SECRET_KEY: base58 (64-byte secret key or 32-byte seed) or a JSON byte array (solana-keygen file). */
export function parseSecretKey(raw: string): Uint8Array {
  const s = raw.trim();
  const bytes = s.startsWith('[') ? Uint8Array.from(JSON.parse(s) as number[]) : base58.decode(s);
  if (bytes.length === 64) return bytes;
  if (bytes.length === 32) return Keypair.fromSeed(bytes).secretKey;
  throw new Error('AGENT_SOLANA_SECRET_KEY must be a 64-byte secret key or 32-byte seed (base58 or JSON array)');
}

export function agentWallet(secretKey: Uint8Array): AgentWallet {
  const kp = Keypair.fromSecretKey(secretKey);
  return {
    address: kp.publicKey.toBase58(),
    secretKey: kp.secretKey,
    signMessage: (message) => bytesToHex(ed25519.sign(new TextEncoder().encode(message), kp.secretKey.slice(0, 32))),
    signTransaction: (b64) => {
      const tx = Transaction.from(Buffer.from(b64, 'base64'));
      tx.partialSign(kp);
      return tx.serialize().toString('base64'); // verifies every required signature is present
    },
  };
}

const FUND = anchorDiscriminator('global', 'fund');
const u64At = (b: Uint8Array, o: number) => new DataView(b.buffer, b.byteOffset, b.byteLength).getBigUint64(o, true);

/**
 * What the agent checks before signing a server-built fund tx: it pays the fee, the only instructions are compute budget
 * and one escrow `fund` for this campaign's PDA, and the budget it locks is the expected one. Returns a problem or null.
 */
export function fundTxProblem(unsignedTxBase64: string, want: { feePayer: string; programId: string; campaignId: string; budgetLamports: bigint }): string | null {
  let tx: Transaction;
  try { tx = Transaction.from(Buffer.from(unsignedTxBase64, 'base64')); } catch { return 'not a legacy transaction'; }
  if (tx.feePayer?.toBase58() !== want.feePayer) return 'fee payer is not the agent wallet';
  const escrowIxs = tx.instructions.filter((ix) => ix.programId.toBase58() === want.programId);
  if (tx.instructions.some((ix) => ix.programId.toBase58() !== want.programId && !ix.programId.equals(ComputeBudgetProgram.programId))) {
    return 'transaction calls programs other than the escrow';
  }
  if (escrowIxs.length !== 1) return 'expected exactly one escrow instruction';
  const ix = escrowIxs[0]!;
  const d = ix.data;
  if (d.length < 88 || !FUND.every((x, i) => d[i] === x)) return 'escrow instruction is not fund';
  if (bytesToHex(d.subarray(8, 40)) !== want.campaignId) return 'fund instruction is for another campaign';
  if (ix.keys[0]?.pubkey.toBase58() !== want.feePayer) return 'company is not the agent wallet';
  if (ix.keys[1]?.pubkey.toBase58() !== campaignEscrowAddress(want.programId, want.campaignId)) return 'escrow account is not the campaign PDA';
  if (u64At(d, 80) !== want.budgetLamports) return `budget ${u64At(d, 80)} lamports differs from the expected ${want.budgetLamports}`;
  return null;
}
