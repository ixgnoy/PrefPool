// plugins/mcp/src/main.ts
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { startHeartbeat } from './heartbeat.js';
import { createAgentSurveyServer } from './tools.js';
import { agentWallet, parseSecretKey } from './wallet.js';
import { reportPayingFetch } from './x402.js';

const env = process.env;
const rpcUrl = env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';
/** The agent's own devnet keypair: pays the USDC report fee (x402) and, within max_budget_sol, funds its campaigns. */
const wallet = env.AGENT_SOLANA_SECRET_KEY ? agentWallet(parseSecretKey(env.AGENT_SOLANA_SECRET_KEY)) : undefined;

const server = createAgentSurveyServer({
  serverUrl: env.AGENT_SURVEY_SERVER_URL || 'http://localhost:4000',
  webUrl: env.AGENT_SURVEY_WEB_URL || 'http://localhost:3000',
  dataDir: env.CLAUDE_PLUGIN_DATA || join(homedir(), '.agent-survey'),
  agentToken: env.AGENT_TOKEN || undefined,
  wallet,
  payingFetch: wallet ? await reportPayingFetch(wallet.secretKey, { maxUsdc: Number(env.MAX_REPORT_PRICE_USDC || '5'), rpcUrl }) : undefined,
  maxBudgetSol: Number(env.MAX_BUDGET_SOL || '0'),
});
await server.connect(new StdioServerTransport());
if (env.AGENT_TOKEN) {
  const base = env.AGENT_SURVEY_SERVER_URL || 'http://localhost:4000';
  // Drain the body so the connection is released (a check-in is all we need from the response).
  const stop = startHeartbeat(() => fetch(`${base}/api/agents/me`, { headers: { Authorization: `Bearer ${env.AGENT_TOKEN}` } }).then((r) => r.arrayBuffer()));
  process.stdin.on('close', stop);
}
