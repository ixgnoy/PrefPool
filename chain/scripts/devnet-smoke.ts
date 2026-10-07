// chain/scripts/devnet-smoke.ts: end-to-end check of the deployed escrow program on devnet with the TypeScript builders:
// fund a campaign, wait for the deadline, settle 15 CRE-signed payouts + refund in one tx, verify balances.
// Usage: SMOKE_KEYPAIR=<path to a funded keypair JSON> npx tsx chain/scripts/devnet-smoke.ts
import { readFileSync } from 'node:fs';
import { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import { ed25519 } from '@noble/curves/ed25519.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import {
  decodeCampaignAccount, hashResearch, randomHex32, signSettlement, type CampaignDatumFields, type SettlementReport,
} from '@as/shared';
import { ESCROW_PROGRAM_ID, buildSignedSettleTx, escrowAddress, fundInstruction, rpcReader } from '../src/index.js';

const rpc = process.env.SOLANA_RPC_URL ?? 'https://api.devnet.solana.com';
const programId = process.env.ESCROW_PROGRAM_ID ?? ESCROW_PROGRAM_ID;
const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(process.env.SMOKE_KEYPAIR!, 'utf8'))));
const connection = new Connection(rpc, 'confirmed');
const link = (sig: string) => `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
const N = 15;
const REWARD = 1_000_000n; // 0.001 SOL, above the rent-exempt minimum of an empty account

const repSk = ed25519.utils.randomSecretKey();
const chainNowMs = async () => 1000 * ((await connection.getBlockTime(await connection.getSlot('confirmed'))) ?? 0);

const now = await chainNowMs();
const datum: CampaignDatumFields = {
  campaignId: randomHex32(), company: payer.publicKey.toBase58(), reportPk: bytesToHex(ed25519.getPublicKey(repSk)),
  rewardLamports: REWARD, budgetLamports: REWARD * 20n, maxResponses: 20, minCohort: N,
  deadlineMs: now + 40_000, refundAfterMs: now + 86_400_000,
};
const escrow = escrowAddress(programId, datum.campaignId).toBase58();
console.log('program ', programId, '\nescrow  ', escrow, '\ncompany ', datum.company);

const fundSig = await sendAndConfirmTransaction(connection, new Transaction().add(fundInstruction(programId, datum)), [payer]);
console.log('fund    ', link(fundSig));
const acc = await rpcReader(connection).fetchEscrow(escrow);
console.log('on-chain terms match:', JSON.stringify(decodeCampaignAccount(acc!.data), (_, v) => typeof v === 'bigint' ? v.toString() : v) ===
  JSON.stringify(datum, (_, v) => typeof v === 'bigint' ? v.toString() : v));

while ((await chainNowMs()) < datum.deadlineMs) await new Promise((r) => setTimeout(r, 3000));

const payees = Array.from({ length: N }, () => Keypair.generate().publicKey.toBase58());
const paid = REWARD * BigInt(N);
const report: SettlementReport = signSettlement({
  schemaVersion: 1, campaignId: datum.campaignId, escrowTxRef: escrow, escrowedLamports: datum.budgetLamports.toString(),
  rewardPerResponseLamports: REWARD.toString(), acceptedCount: N, payouts: payees.map((address) => ({ address, lamports: REWARD.toString() })),
  payoutTotalLamports: paid.toString(), refundAddress: datum.company, refundLamports: (datum.budgetLamports - paid).toString(),
  rejectionCounts: { malformed: 0, duplicate: 0, ineligible: 0, late: 0 }, resultHash: hashResearch(null), timestamp: new Date().toISOString(),
}, bytesToHex(repSk));

const tx = await buildSignedSettleTx(connection, programId, report, datum, payer);
const settleSig = await connection.sendRawTransaction(tx.serialize());
await connection.confirmTransaction(settleSig, 'confirmed');
console.log('settle  ', link(settleSig), `(${tx.serialize().length} bytes)`);

const balances = await Promise.all(payees.map((p) => connection.getBalance(new PublicKey(p))));
console.log('every payee got the reward:', balances.every((b) => BigInt(b) === REWARD));
console.log('escrow closed:', (await rpcReader(connection).fetchEscrow(escrow)) === null);
