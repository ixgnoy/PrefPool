// server/src/index.ts
import { createServer } from 'node:http';
import { createApp } from './app.js';
import { createChainAdapter } from './chainAdapter.js';
import { postgresDb } from './db.js';
import type { Broadcaster, Deps } from './deps.js';
import { loadEnv } from './env.js';
import { tick } from './lifecycle.js';
import { mountReportRoute } from './x402.js';
import { attachRelay } from './relay.js';
import { ensureSyntheticAgents, startSyntheticAgents } from './synthetic.js';

const env = loadEnv();
const db = postgresDb(env.SUPABASE_DB_URL);
const chain = createChainAdapter({ rpcUrl: env.SOLANA_RPC_URL, programId: env.ESCROW_PROGRAM_ID,
  relayerSecretKey: env.RELAYER_SECRET_KEY, reportPublicKey: env.REPORT_ED25519_PK });
const relayRef: { current?: Broadcaster } = {};
const deps: Deps = {
  db, chain, now: () => Date.now(),
  relay: { broadcast: (c) => relayRef.current?.broadcast(c) },
  config: { envelopePublicKey: env.ENVELOPE_X25519_PK, reportPublicKey: env.REPORT_ED25519_PK, creToken: env.CRE_PLATFORM_TOKEN,
    runnerToken: env.CRE_RUNNER_TOKEN, cluster: 'devnet', rpcUrl: env.SOLANA_RPC_URL,
    platformFeeUsdc: env.PLATFORM_FEE_USDC, platformFeePayTo: env.PLATFORM_FEE_PAY_TO,
    publicBaseUrl: env.PUBLIC_BASE_URL.replace(/\/+$/, ''),
    reportRegistryAddress: env.REPORT_REGISTRY_ADDRESS,
    personhood: env.WORLD_APP_ID && env.WORLD_RP_ID && env.WORLD_RP_SIGNING_KEY
      ? { appId: env.WORLD_APP_ID, rpId: env.WORLD_RP_ID, signingKey: env.WORLD_RP_SIGNING_KEY, environment: env.WORLD_ENV }
      : undefined },
};
const app = createApp(deps, (a) =>
  mountReportRoute(a, deps, { facilitatorUrl: env.FACILITATOR_URL, facilitatorToken: env.FACILITATOR_TOKEN, rpcUrl: env.SOLANA_RPC_URL }));
const server = createServer(app);
relayRef.current = attachRelay(server, () => deps);
await ensureSyntheticAgents(db, env.SYNTHETIC_SECRET);
server.listen(env.PORT, () => {
  console.log(`server on :${env.PORT}, relayer ${chain.relayerAddress}, escrow program ${chain.programId}`);
  startSyntheticAgents(`ws://127.0.0.1:${env.PORT}/ws/agents`, env.SYNTHETIC_SECRET);
});
let ticking = false; // a tick can outlast the interval (chain calls); never run two at once
setInterval(async () => {
  if (ticking) return;
  ticking = true;
  try {
    await tick(deps).catch((e) => console.error('tick', e));
  } finally { ticking = false; }
}, 5_000);
