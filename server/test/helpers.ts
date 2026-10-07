// server/test/helpers.ts
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { Keypair, PublicKey, Transaction } from '@solana/web3.js';
import bs58 from 'bs58';
import { ed25519, x25519 } from '@noble/curves/ed25519.js';
import { ESCROW_PROGRAM_ID, fundInstruction, refundInstruction } from '@as/chain';
import {
  addressFromSeed, bytesToHex, campaignEscrowAddress, encodeCampaignAccount, utf8ToBytes,
  type CampaignDatumFields, type CampaignSpec, type EscrowAccount, type SettlementReport,
} from '@as/shared';
import request from 'supertest';
import { afterEach } from 'vitest';
import { createApp } from '../src/app.js';
import { refundTxOk } from '../src/chainAdapter.js';
import type { ChainPort, SettleOutcome, TxStatus, TxTrace } from '../src/chainPort.js';
import { migrate, type Db } from '../src/db.js';
import type { Broadcaster, Deps } from '../src/deps.js';
import { attachRelay } from '../src/relay.js';

export const keys = (() => {
  const encSk = x25519.utils.randomSecretKey();
  const repSk = ed25519.utils.randomSecretKey();
  return { encSk: bytesToHex(encSk), encPk: bytesToHex(x25519.getPublicKey(encSk)), repSk: bytesToHex(repSk), repPk: bytesToHex(ed25519.getPublicKey(repSk)) };
})();
export const CRE_TOKEN = 'c'.repeat(64);
export const RUNNER_TOKEN = 'r'.repeat(64);

/** Each PGlite instance holds ~220 MB of WASM memory and is never freed unless closed; close them after every test. */
const openPglites: PGlite[] = [];
afterEach(async () => { await Promise.all(openPglites.splice(0).map((pg) => pg.close())); });

export async function pgliteDb(): Promise<Db> {
  const pg = await PGlite.create();
  openPglites.push(pg);
  const db: Db = {
    query: async (sql, params = []) => (await pg.query(sql, params as never[])).rows as never,
    exec: async (sql) => { await pg.exec(sql); },
  };
  await migrate(db, fileURLToPath(new URL('../../supabase/migrations', import.meta.url)));
  return db;
}

/** Any 32 bytes work as a blockhash offline; signatures and the server's checks don't care. */
export const FAKE_BLOCKHASH = bs58.encode(new Uint8Array(32).fill(7));
const RENT_LAMPORTS = 1_858_320n; // rent-exempt minimum of the 139-byte Campaign account: (139 + 128) * 6960

/** Unsigned legacy tx paid by `feePayer`, as the real builders produce it (base64). */
const unsignedTx = (feePayer: string, ix: ReturnType<typeof fundInstruction>) =>
  new Transaction({ feePayer: new PublicKey(feePayer), blockhash: FAKE_BLOCKHASH, lastValidBlockHeight: 1_000 }).add(ix)
    .serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64');

/** The escrow PDA as RPC would return it once `datum` was funded. */
export const escrowFor = (datum: CampaignDatumFields, programId = ESCROW_PROGRAM_ID): EscrowAccount => ({
  address: campaignEscrowAddress(programId, datum.campaignId), owner: programId,
  lamports: String(datum.budgetLamports + RENT_LAMPORTS), data: Buffer.from(encodeCampaignAccount(datum)).toString('base64'),
});

/** Fake chain: real (offline) txs and checks, recorded calls; tests flip `escrow`, `closedBy`, `txStatus`, `settleResult`. */
export function fakeChain() {
  const programId = ESCROW_PROGRAM_ID;
  const state = {
    escrow: null as EscrowAccount | null,
    closedBy: null as string | null,
    txStatus: 'pending' as TxStatus,
    settleResult: { status: 'submitted', txHash: 'f'.repeat(64) } as SettleOutcome,
    settled: [] as SettlementReport[],
    built: [] as CampaignDatumFields[],
    submitted: [] as string[],
    refunds: 0,
    txs: {} as Record<string, TxTrace>,
  };
  const chain: ChainPort = {
    programId,
    relayerAddress: addressFromSeed('test-relayer'),
    buildFundTx: async (datum) => {
      state.built.push(datum);
      return { unsignedTx: unsignedTx(datum.company, fundInstruction(programId, datum)), lastValidBlockHeight: 1_000 };
    },
    submitSignedTx: async (signed) => {
      state.submitted.push(signed);
      return bs58.encode(Transaction.from(Buffer.from(signed, 'base64')).signature!);
    },
    fetchEscrow: async () => state.escrow,
    txStatus: async () => state.txStatus,
    closedBy: async () => state.closedBy,
    settle: async (r) => { state.settled.push(r); return state.settleResult; },
    buildRefundTx: async (campaignId, company) => {
      state.refunds++;
      return { unsignedTx: unsignedTx(company, refundInstruction(programId, campaignId, company)), lastValidBlockHeight: 1_000 };
    },
    isRefundTx: (signed, campaignId, company) => refundTxOk(signed, programId, campaignId, company),
    describeTx: async (sig) => state.txs[sig] ?? { signature: sig, slot: null, blockTime: null, fee: null, err: null, instructions: [], logMessages: [] },
  };
  return { chain, state };
}

export async function makeDeps(start = Date.UTC(2026, 9, 6, 9, 0)) {
  const clock = { now: start };
  const { chain, state } = fakeChain();
  const relayRef: { current?: Broadcaster } = {};
  const deps: Deps = {
    db: await pgliteDb(), chain, now: () => clock.now,
    relay: { broadcast: (c) => relayRef.current?.broadcast(c) },
    config: { envelopePublicKey: keys.encPk, reportPublicKey: keys.repPk, creToken: CRE_TOKEN, runnerToken: RUNNER_TOKEN, platformFeeUsdc: 3 },
  };
  const app = createApp(deps);
  return { deps, app, clock, chainState: state, relayRef };
}

export async function listen(app: ReturnType<typeof createApp>, deps: Deps, relayRef: { current?: Broadcaster }) {
  const server: Server = createServer(app);
  relayRef.current = attachRelay(server, () => deps);
  await new Promise<void>((r) => server.listen(0, r));
  const port = (server.address() as AddressInfo).port;
  return { server, wsUrl: `ws://127.0.0.1:${port}/ws/agents`, close: () => new Promise<void>((r) => server.close(() => r())) };
}

/** A fresh Solana wallet. `signMessage` is what Phantom's signMessage returns (64-byte ed25519), hex. */
export async function wallet() {
  const kp = Keypair.generate();
  return {
    kp, address: kp.publicKey.toBase58(),
    signMessage: (message: string) => bytesToHex(ed25519.sign(utf8ToBytes(message), kp.secretKey.slice(0, 32))),
    /** The wallet signs an unsigned tx from the server (signTransaction) and returns it base64. */
    signTx: (unsigned: string) => {
      const tx = Transaction.from(Buffer.from(unsigned, 'base64'));
      tx.partialSign(kp);
      return tx.serialize().toString('base64');
    },
  };
}

/** Sign in like the browser: nonce + message -> signMessage -> verify. */
export async function login(app: ReturnType<typeof createApp>, who: Awaited<ReturnType<typeof wallet>>) {
  const { body } = await request(app).post('/api/auth/nonce').send({ address: who.address }).expect(200);
  const res = await request(app).post('/api/auth/verify').send({ address: who.address, signature: who.signMessage(body.message) }).expect(200);
  return res.body.sessionToken as string;
}

export const demoSpec = (deadlineMs: number): CampaignSpec => ({
  title: 'State of agent payments & tools', category: 'payments',
  questions: [
    { id: 'q1', type: 'single_choice', text: "Which ways can you pay for things on your owner's behalf today?", options: ['Card through a payment service', 'Crypto wallet', 'Both', 'None yet'] },
    { id: 'q2', type: 'likert_5', category: 'blockers', text: "How often is a task blocked because you can't log in or pay? (1 = never, 5 = very often)" },
    { id: 'q3', type: 'single_choice', category: 'spending', text: 'Roughly how much does your owner spend on AI tools per month?', options: ['Under $20', '$20-100', 'Over $100'] },
  ],
  audience: { country: ['MY'], ageBand: ['25-34'] },
  rewardLamports: '1500000', maxResponses: 20, minCohort: 15, deadlineMs,
});
