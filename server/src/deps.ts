// server/src/deps.ts
import type { Db } from './db.js';
import type { ChainPort } from './chainPort.js';
import type { CampaignView as AgentCampaignView } from './views.js';

export interface ServerConfig {
  envelopePublicKey: string;
  reportPublicKey: string;
  creToken: string;
  runnerToken: string;
  /** Solana cluster and RPC the web app and plugin should use (public config). */
  cluster?: 'devnet';
  rpcUrl?: string;
  /** Fixed platform fee for buying a research report over x402, in USDC (PLATFORM_FEE_USDC). */
  platformFeeUsdc: number;
  /** Wallet receiving the x402 report fee (PLATFORM_FEE_PAY_TO); unset = report fee route answers 503. */
  platformFeePayTo?: string;
  /** Public origin of this API (PUBLIC_BASE_URL); links handed to other agents use it, not the request's Host. */
  publicBaseUrl?: string;
  /** Shown in the dev view (FRONTEND_PRD §5.10). */
  reportRegistryAddress?: string;
  /** World ID seller verification; undefined disables the feature. */
  personhood?: { appId: string; rpId: string; signingKey: string; environment: 'staging' | 'production' };
}
export interface Broadcaster { broadcast(campaign: AgentCampaignView): void }
export interface Deps {
  db: Db;
  chain: ChainPort;
  config: ServerConfig;
  now: () => number;
  relay: Broadcaster;
  /** World's verify API is reached through this (tests inject a fake). Defaults to global fetch. */
  worldFetch?: typeof fetch;
}

export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
