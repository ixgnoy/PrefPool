// server/src/facilitator.ts — self-hosted x402 facilitator for Solana devnet (`exact` scheme, @x402/svm).
// The payer signs a USDC TransferChecked; the facilitator verifies it, co-signs as fee payer with the relayer keypair
// (RELAYER_SECRET_KEY, so it needs a little devnet SOL) and broadcasts. Run: `npm run facilitator -w @as/server`.
import { createKeyPairSignerFromBytes } from '@solana/kit';
import { x402Facilitator } from '@x402/core/facilitator';
import { SOLANA_DEVNET_CAIP2 as NETWORK, toFacilitatorSvmSigner } from '@x402/svm';
import { ExactSvmScheme } from '@x402/svm/exact/facilitator';
import { z } from 'zod';
import { parseSecretKey } from './chainAdapter.js';
import { createFacilitatorApp } from './facilitatorApp.js';

const env = z.object({
  RELAYER_SECRET_KEY: z.string().min(64),
  SOLANA_RPC_URL: z.string().url().default('https://api.devnet.solana.com'),
  FACILITATOR_PORT: z.coerce.number().default(4022),
  // Local: loopback only. Railway sets PORT and needs 0.0.0.0.
  FACILITATOR_HOST: z.string().default('127.0.0.1'),
  // Required whenever the facilitator is reachable beyond loopback (Railway); the server sends the same value.
  FACILITATOR_TOKEN: z.string().min(32).optional(),
}).parse({ ...process.env, FACILITATOR_PORT: process.env.FACILITATOR_PORT ?? process.env.PORT });
if (env.FACILITATOR_HOST !== '127.0.0.1' && !env.FACILITATOR_TOKEN) {
  throw new Error('FACILITATOR_TOKEN is required when FACILITATOR_HOST is not 127.0.0.1');
}

const feePayer = await createKeyPairSignerFromBytes(parseSecretKey(env.RELAYER_SECRET_KEY));
const facilitator = new x402Facilitator();
// The fee payer pays every payer-chosen priority fee: cap it (100k µlamports/CU ≈ 0.00002 SOL at 200k CU).
facilitator.register(NETWORK, new ExactSvmScheme(toFacilitatorSvmSigner(feePayer, { defaultRpcUrl: env.SOLANA_RPC_URL }), undefined,
  { maxPriorityFeeMicroLamports: 100_000 }));

createFacilitatorApp(facilitator, env.FACILITATOR_TOKEN).listen(env.FACILITATOR_PORT, env.FACILITATOR_HOST,
  () => console.log(`x402 facilitator on ${env.FACILITATOR_HOST}:${env.FACILITATOR_PORT} (${NETWORK}, fee payer ${feePayer.address}${env.FACILITATOR_TOKEN ? ', token required' : ''})`));
