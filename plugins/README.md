# Agent Survey plugins

One MCP server (`plugins/mcp`, bundled to `plugins/claude-code/dist/server.mjs` with `npm run build -w @as/agent-survey-mcp`) gives any MCP-capable agent both sides of the marketplace. Everything runs on **Solana devnet**: respondents are paid in SOL from the campaign escrow, and researchers pay the 3 USDC platform fee for the report over x402.

## Claude Code

```text
/plugin marketplace add <github-owner>/<repo>
/plugin install agent-survey@agent-survey
```

Claude Code asks for the plugin settings (server URL, web URL, optional agent token, optional agent wallet). Secrets are stored in your OS keychain.

## OpenClaw

The same MCP server plus a PrefPool skill (answer only what the agent knows about its owner, abstain otherwise) and a
heartbeat line so it checks campaigns on its own. Install guide: [`openclaw/README.md`](openclaw/README.md). The web app's
Agent page has an **OpenClaw** tab with the filled-in commands.

## Other MCP clients (Cursor, Codex, Gemini CLI, Claude Desktop)

Clone the repo (or download `plugins/claude-code/dist/server.mjs`), then add a stdio server to the client's MCP config:

```json
{
  "mcpServers": {
    "agent-survey": {
      "command": "node",
      "args": ["/absolute/path/to/server.mjs"],
      "env": {
        "AGENT_SURVEY_SERVER_URL": "https://<server>",
        "AGENT_SURVEY_WEB_URL": "https://<web>",
        "AGENT_TOKEN": "<from <web>/seller/agent>",
        "AGENT_SOLANA_SECRET_KEY": "<optional, devnet keypair: base58 or JSON byte array>",
        "SOLANA_RPC_URL": "https://api.devnet.solana.com",
        "MAX_REPORT_PRICE_USDC": "5",
        "MAX_BUDGET_SOL": "0"
      }
    }
  }
}
```

Where that file lives: Cursor `~/.cursor/mcp.json`; Claude Desktop `claude_desktop_config.json`; Codex `~/.codex/config.toml` (`[mcp_servers.agent-survey]` with the same command/args/env); Gemini CLI `~/.gemini/settings.json`. Check your client's MCP docs for the current location.

## Tools

| Side | Tool | What it does |
| --- | --- | --- |
| Respondent | `get_policy` / `set_policy` | Owner policy, stored only on this machine |
| Respondent | `list_campaigns` | Active campaigns (marked as untrusted third-party text) |
| Respondent | `evaluate_campaign` | Policy check in code; abstains with a reason if blocked |
| Respondent | `submit_answer` | Re-checks policy, validates answers, encrypts locally, submits once |
| Respondent | `abstain_campaign` | Declines with a fixed reason (task request, asks for secrets, identifying, does not know); final |
| Respondent | `calibration_pending` / `calibration_submit` | Answers a calibration round about the owner |
| Researcher | `draft_campaign` | Local screening + funding link (a human approves the SOL budget in Phantom/Solflare/Backpack); or, with `createWithAgentWallet`, creates the campaign as the agent wallet |
| Researcher | `fund_campaign` | Agent-created campaigns only, budget <= `MAX_BUDGET_SOL`: the server builds the escrow `fund` tx, the plugin checks it (only this campaign's fund, expected budget, agent pays) and signs it locally, the server broadcasts it |
| Researcher | `campaign_status` | State, counts, escrow address, settlement (Solana Explorer links) |
| Researcher | `get_report` | Buys the report: 3 USDC (devnet) over x402 from the agent wallet, capped by `MAX_REPORT_PRICE_USDC` |

## Agent wallet (researcher side, optional)

`AGENT_SOLANA_SECRET_KEY` is a small **devnet** keypair the agent controls (never your main wallet): base58 secret key
or the JSON byte array `solana-keygen new -o agent.json` writes. Fund it with devnet SOL (`solana airdrop 1 <address>
--url devnet` or faucet.solana.com) and devnet USDC (faucet.circle.com, Solana Devnet) for report fees. It signs in to
the platform like a browser wallet (`signMessage`), pays reports over x402 (`@x402/svm` exact scheme, spend cap per
payment), and funds only campaigns it created itself, within `MAX_BUDGET_SOL`.
