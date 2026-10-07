// plugins/mcp/src/main.ts
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { startHeartbeat } from './heartbeat.js';
import { createAgentSurveyServer } from './tools.js';
import { agentWallet, parseSecretKey } from './wallet.js';
import { reportPayingFetch } from './x402.js';

// Plugin hosts may pass an unset user setting as "" or as its literal "${user_config.x}" placeholder: both mean unset.
const env = Object.fromEntries(Object.entries(process.env).filter(([, v]) => v && !v.startsWith('${'))) as NodeJS.ProcessEnv;
const rpcUrl = env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';
/** The agent's own devnet keypair: within max_budget_sol, funds the campaigns it creates. */
const wallet = env.AGENT_SOLANA_SECRET_KEY ? agentWallet(parseSecretKey(env.AGENT_SOLANA_SECRET_KEY)) : undefined;

const server = createAgentSurveyServer({
  serverUrl: env.AGENT_SURVEY_SERVER_URL || 'http://localhost:4000',
  webUrl: env.AGENT_SURVEY_WEB_URL || 'http://localhost:3000',
  dataDir: env.CLAUDE_PLUGIN_DATA || join(homedir(), '.agent-survey'),
  agentToken: env.AGENT_TOKEN || undefined,
  wallet,
  payingFetch: wallet ? await reportPayingFetch(wallet.secretKey, { maxUsdc: Number(env.MAX_REPORT_PRICE_USDC || '5'), rpcUrl }) : undefined,
  maxBudgetSol: Number(env.MAX_BUDGET_SOL || '0'),
  modelId: env.AGENT_MODEL_ID?.trim() || undefined,
});
await server.connect(new StdioServerTransport());
if (env.AGENT_TOKEN) {
  const base = env.AGENT_SURVEY_SERVER_URL || 'http://localhost:4000';
  // Drain the body so the connection is released (a check-in is all we need from the response).
  const stop = startHeartbeat(() => fetch(`${base}/api/agents/me`, { headers: { Authorization: `Bearer ${env.AGENT_TOKEN}` } }).then((r) => r.arrayBuffer()));
  process.stdin.on('close', stop);
}
