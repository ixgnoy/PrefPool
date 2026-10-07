// chain/src/txs.ts: unsigned transactions for a browser wallet (base64), and the relayer's signed settle.
import { ComputeBudgetProgram, PublicKey, Transaction, type Connection, type Keypair } from '@solana/web3.js';
import { CAMPAIGN_ACCOUNT_SIZE, type CampaignDatumFields, type SettlementReport } from '@as/shared';
import { fundInstruction, refundInstruction, settleInstructions } from './program.js';

export class FundingError extends Error {
  constructor(public code: 'INSUFFICIENT_FUNDS', message: string) { super(message); }
}

/** The fee payer's view of an unsigned tx: base64 wire bytes plus when its blockhash stops being valid. */
export interface UnsignedTx { unsignedTx: string; blockhash: string; lastValidBlockHeight: number }

const serializeUnsigned = (tx: Transaction) => tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64');

async function unsigned(connection: Connection, feePayer: string, ixs: Transaction['instructions']): Promise<UnsignedTx> {
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
  const tx = new Transaction({ feePayer: new PublicKey(feePayer), blockhash, lastValidBlockHeight }).add(...ixs);
  return { unsignedTx: serializeUnsigned(tx), blockhash, lastValidBlockHeight };
}

/** Rent the escrow account holds on top of the budget; it goes back to the company when the escrow closes. */
export const escrowRentLamports = (connection: Connection) => connection.getMinimumBalanceForRentExemption(CAMPAIGN_ACCOUNT_SIZE);

/** Funding tx for the company's wallet. Fails early (with a message for the user) when the wallet can't cover it. */
export async function buildFundTx(connection: Connection, programId: string, d: CampaignDatumFields): Promise<UnsignedTx> {
  const [balance, rent] = await Promise.all([connection.getBalance(new PublicKey(d.company), 'confirmed'), escrowRentLamports(connection)]);
  const need = d.budgetLamports + BigInt(rent) + 10_000n; // + fees
  if (BigInt(balance) < need) {
    throw new FundingError('INSUFFICIENT_FUNDS',
      `Your wallet has ${balance / 1e9} SOL on devnet but this campaign needs ${Number(need) / 1e9} SOL. Switch the wallet to Devnet and get test SOL from faucet.solana.com.`);
  }
  return unsigned(connection, d.company, [fundInstruction(programId, d)]);
}

/** Company escape hatch after refund_after. */
export const buildRefundTx = (connection: Connection, programId: string, campaignId: string, company: string) =>
  unsigned(connection, company, [refundInstruction(programId, campaignId, company)]);

/** The settle tx, paid and signed by the relayer (permissionless: the program only pays the CRE-signed payees). */
export async function buildSignedSettleTx(
  connection: Connection, programId: string, report: SettlementReport, campaign: Pick<CampaignDatumFields, 'reportPk' | 'company'>, relayer: Keypair,
): Promise<Transaction> {
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
  const tx = new Transaction({ feePayer: relayer.publicKey, blockhash, lastValidBlockHeight })
    // 20 payees: one Ed25519 verify + 20 lamport moves; the default 200k CU is plenty, the explicit limit keeps fees predictable
    .add(ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }))
    .add(...settleInstructions(programId, report, campaign, relayer.publicKey.toBase58()));
  tx.sign(relayer);
  return tx;
}

export const BLOCKHASH_NOT_FOUND = /blockhash not found/i;

/** Signed tx from a browser wallet (base64) -> submitted signature. "Blockhash not found" in preflight is usually a
 *  public-RPC node a few slots behind the one that issued the blockhash: retry briefly before giving up. */
export async function submitSignedTx(connection: Connection, signedTxBase64: string, retries = 4, delayMs = 600): Promise<string> {
  const raw = Buffer.from(signedTxBase64, 'base64');
  for (let attempt = 0; ; attempt++) {
    try {
      return await connection.sendRawTransaction(raw, { skipPreflight: false, preflightCommitment: 'confirmed' });
    } catch (e) {
      if (attempt >= retries || !BLOCKHASH_NOT_FOUND.test(String((e as Error)?.message ?? e))) throw e;
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}

/** The user-facing reason for a refused submit: an expired blockhash just needs a fresh tx. */
export const submitErrorMessage = (e: unknown) => {
  const msg = String((e as Error)?.message ?? e);
  return BLOCKHASH_NOT_FOUND.test(msg)
    ? 'the transaction expired before it reached the network (approval or connection took too long). Nothing was sent: please try again.'
    : `the network refused the transaction: ${msg.slice(0, 300)}`;
};
