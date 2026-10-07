// server/src/chainAdapter.ts
import {
  ComputeBudgetProgram, Connection, Ed25519Program, Keypair, PublicKey, SystemProgram, Transaction,
} from '@solana/web3.js';
import bs58 from 'bs58';
import {
  buildFundTx, buildRefundTx, buildSignedSettleTx, escrowAddress, escrowInstructionName, refundInstruction, rpcReader, settleFromReport, submitSignedTx,
} from '@as/chain';
import type { ChainPort, TxStatus, TxTrace } from './chainPort.js';

/** RELAYER_SECRET_KEY: base58 (Phantom export) or a JSON byte array (solana-keygen file), 64 bytes either way. */
export function parseSecretKey(s: string): Uint8Array {
  const t = s.trim();
  const bytes = t.startsWith('[') ? Uint8Array.from(JSON.parse(t) as number[]) : bs58.decode(t);
  if (bytes.length !== 64) throw new Error('secret key must be 64 bytes (base58 or JSON array)');
  return bytes;
}

/**
 * The refund check (pure): exactly one instruction of the escrow program, and it is `refund` of this campaign's escrow
 * by `company`, whose signature on the tx is valid. Other programs' instructions (compute budget) are the wallet's business.
 */
export function refundTxOk(signedTx: string, programId: string, campaignId: string, company: string): boolean {
  let tx: Transaction;
  try { tx = Transaction.from(Buffer.from(signedTx, 'base64')); } catch { return false; }
  const program = new PublicKey(programId);
  const ours = tx.instructions.filter((ix) => ix.programId.equals(program));
  if (ours.length !== 1 || escrowInstructionName(ours[0]!.data) !== 'refund') return false;
  const want = refundInstruction(programId, campaignId, company);
  if (ours[0]!.keys.length !== want.keys.length || !ours[0]!.keys.every((k, i) => k.pubkey.equals(want.keys[i]!.pubkey))) return false;
  const sig = tx.signatures.find((s) => s.publicKey.toBase58() === company)?.signature;
  return !!sig && tx.verifySignatures(true);
}

const PROGRAM_LABELS: Record<string, string> = {
  [SystemProgram.programId.toBase58()]: 'system',
  [ComputeBudgetProgram.programId.toBase58()]: 'compute-budget',
  [Ed25519Program.programId.toBase58()]: 'ed25519-verify',
  TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA: 'spl-token',
  ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL: 'associated-token',
  MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr: 'memo',
};

/** Dev-view decoding from RPC getTransaction. Confirmed txs never change, so results are cached. */
function txDescriber(connection: Connection, programId: string) {
  const cache = new Map<string, TxTrace>(); // ponytail: unbounded, fine for a demo's few hundred txs; LRU if it grows
  return async (signature: string): Promise<TxTrace | null> => {
    const hit = cache.get(signature);
    if (hit) return hit;
    const tx = await connection.getTransaction(signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
    if (!tx) return null;
    const keys = tx.transaction.message.getAccountKeys({ accountKeysFromLookups: tx.meta?.loadedAddresses });
    const trace: TxTrace = {
      signature, slot: tx.slot, blockTime: tx.blockTime ?? null, fee: tx.meta ? String(tx.meta.fee) : null, err: tx.meta?.err ?? null,
      instructions: tx.transaction.message.compiledInstructions.map((ix) => {
        const pid = keys.get(ix.programIdIndex)?.toBase58() ?? '?';
        return pid === programId
          ? { program: 'campaign_escrow', programId: pid, name: escrowInstructionName(ix.data) ?? 'unknown' }
          : { program: PROGRAM_LABELS[pid] ?? pid, programId: pid, name: '' };
      }),
      logMessages: tx.meta?.logMessages ?? [],
    };
    cache.set(signature, trace);
    return trace;
  };
}

/** Production ChainPort: Solana RPC + the relayer keypair (pays settle fees). */
export function createChainAdapter(opts: { rpcUrl: string; programId: string; relayerSecretKey: string; reportPublicKey: string }): ChainPort {
  const connection = new Connection(opts.rpcUrl, 'confirmed');
  const relayer = Keypair.fromSecretKey(parseSecretKey(opts.relayerSecretKey));
  const reader = rpcReader(connection);
  const { programId } = opts;
  const status = async (signature: string): Promise<TxStatus | null> => {
    const s = (await connection.getSignatureStatuses([signature], { searchTransactionHistory: true })).value[0];
    if (!s) return null;
    if (s.err) return 'failed';
    return s.confirmationStatus === 'confirmed' || s.confirmationStatus === 'finalized' ? 'landed' : 'pending';
  };
  return {
    programId,
    relayerAddress: relayer.publicKey.toBase58(),
    buildFundTx: async (datum) => {
      const { unsignedTx, lastValidBlockHeight } = await buildFundTx(connection, programId, datum);
      return { unsignedTx, lastValidBlockHeight };
    },
    submitSignedTx: (signedTx) => submitSignedTx(connection, signedTx),
    fetchEscrow: (campaignId) => reader.fetchEscrow(escrowAddress(programId, campaignId).toBase58()),
    async txStatus(signature, blockhash) {
      const s = await status(signature);
      if (s) return s;
      if ((await connection.isBlockhashValid(blockhash, { commitment: 'confirmed' })).value) return 'pending';
      // The blockhash expired: one more look (the status may have arrived meanwhile), then it can never land.
      return (await status(signature)) ?? 'expired';
    },
    closedBy: (address) => reader.closedBy(address),
    settle: (report) => settleFromReport({
      report, reader, ctx: { reportPublicKey: opts.reportPublicKey, programId },
      submit: async (datum) => {
        const tx = await buildSignedSettleTx(connection, programId, report, datum, relayer);
        return connection.sendRawTransaction(tx.serialize(), { preflightCommitment: 'confirmed' });
      },
    }),
    buildRefundTx: async (campaignId, company) => {
      const { unsignedTx, lastValidBlockHeight } = await buildRefundTx(connection, programId, campaignId, company);
      return { unsignedTx, lastValidBlockHeight };
    },
    isRefundTx: (signedTx, campaignId, company) => refundTxOk(signedTx, programId, campaignId, company),
    describeTx: txDescriber(connection, programId),
  };
}
