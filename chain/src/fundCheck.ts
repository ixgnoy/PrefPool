// chain/src/fundCheck.ts: pre-broadcast check on a wallet-signed funding tx. The server only broadcasts a tx that
// does exactly what it issued: one `fund` of this campaign with the issued terms, paid and signed by the company.
import { ComputeBudgetProgram, Transaction } from '@solana/web3.js';
import bs58 from 'bs58';
import type { CampaignDatumFields } from '@as/shared';
import { fundInstruction } from './program.js';

export type FundingCheckReason = 'UNPARSEABLE' | 'BAD_SIGNATURE' | 'FEE_PAYER' | 'EXTRA_INSTRUCTIONS' | 'FUND_MISMATCH';
export type FundingCheck = { ok: true; txId: string } | { ok: false; reason: FundingCheckReason };

export function checkFundingTx(signedTxBase64: string, expected: { programId: string; datum: CampaignDatumFields }): FundingCheck {
  let tx: Transaction;
  try { tx = Transaction.from(Buffer.from(signedTxBase64, 'base64')); } catch { return { ok: false, reason: 'UNPARSEABLE' }; }
  if (!tx.signature || !tx.verifySignatures(true)) return { ok: false, reason: 'BAD_SIGNATURE' };
  if (tx.feePayer?.toBase58() !== expected.datum.company) return { ok: false, reason: 'FEE_PAYER' };
  // Wallets may prepend compute-budget instructions (priority fees); anything else is refused.
  const ixs = tx.instructions.filter((ix) => !ix.programId.equals(ComputeBudgetProgram.programId));
  if (ixs.length !== 1) return { ok: false, reason: 'EXTRA_INSTRUCTIONS' };
  const want = fundInstruction(expected.programId, expected.datum);
  const got = ixs[0]!;
  const sameKeys = got.keys.length === want.keys.length && got.keys.every((k, i) => k.pubkey.equals(want.keys[i]!.pubkey));
  if (!got.programId.equals(want.programId) || !sameKeys || !got.data.equals(want.data)) return { ok: false, reason: 'FUND_MISMATCH' };
  return { ok: true, txId: bs58.encode(tx.signature) };
}
