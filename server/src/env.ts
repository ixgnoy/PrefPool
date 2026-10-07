// server/src/env.ts
import { z } from 'zod';
import { isSolanaAddress } from '@as/shared';
import { ESCROW_PROGRAM_ID } from '@as/chain';

const hex64 = z.string().regex(/^[0-9a-f]{64}$/);
const solanaAddress = z.string().refine(isSolanaAddress, 'not a Solana address');
export const envSchema = z.object({
  PORT: z.coerce.number().default(4000),
  PUBLIC_BASE_URL: z.string().url(),
  SUPABASE_DB_URL: z.string().startsWith('postgres'),
  SOLANA_RPC_URL: z.string().url().default('https://api.devnet.solana.com'),
  ESCROW_PROGRAM_ID: solanaAddress.default(ESCROW_PROGRAM_ID),
  // Relayer wallet: pays settle fees, and is the self-hosted x402 facilitator's fee payer. Base58 or JSON byte array.
  RELAYER_SECRET_KEY: z.string().min(64),
  // x402 report fee (USDC on devnet). Both PLATFORM_FEE_PAY_TO and FACILITATOR_URL unset → the report route answers 503.
  PLATFORM_FEE_USDC: z.coerce.number().positive().default(3),
  PLATFORM_FEE_PAY_TO: solanaAddress.optional(),
  FACILITATOR_URL: z.string().url().optional(),
  FACILITATOR_TOKEN: z.string().min(32).optional(), // must match the facilitator's; required once it is deployed
  ENVELOPE_X25519_PK: hex64,
  REPORT_ED25519_PK: hex64,
  CRE_PLATFORM_TOKEN: hex64,
  CRE_RUNNER_TOKEN: hex64,
  SYNTHETIC_SECRET: hex64,
  // World ID personhood (optional; off unless app id, rp id and signing key are all set). The key never leaves the server.
  WORLD_APP_ID: z.string().startsWith('app_').optional(),
  WORLD_RP_ID: z.string().startsWith('rp_').optional(),
  WORLD_RP_SIGNING_KEY: z.string().regex(/^(0x)?[0-9a-fA-F]+$/).optional(),
  WORLD_ENV: z.enum(['staging', 'production']).default('staging'),
  REPORT_REGISTRY_ADDRESS: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(), // Base Sepolia ReportRegistry, shown in the dev view
});
export type Env = z.infer<typeof envSchema>;
export const loadEnv = (): Env => envSchema.parse(process.env);
