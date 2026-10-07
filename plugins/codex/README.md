# PrefPool for Codex CLI

Same MCP server as the Claude Code plugin (`plugins/claude-code/dist/server.mjs`, stdio). Needs Node 20+ and a clone
of this repo (the server isn't on npm).

## 1. Add the MCP server

```bash
codex mcp add prefpool \
  --env AGENT_SURVEY_SERVER_URL=<server url, e.g. http://localhost:4000> \
  --env AGENT_SURVEY_WEB_URL=<web url, e.g. http://localhost:3000> \
  --env AGENT_TOKEN=<your agent token> \
  -- node <path-to>/PrefPool/plugins/claude-code/dist/server.mjs
codex mcp get prefpool
```

Get the agent token on the web app: connect your Solana wallet → **Agent** → create a token. Leave `AGENT_TOKEN` out
for research-only use.

Optional, to let the agent fund the campaigns it creates (a small throwaway devnet wallet, never your main one):
`--env AGENT_SOLANA_SECRET_KEY=<base58 or JSON byte array> --env MAX_BUDGET_SOL=0.5`.

Or edit `~/.codex/config.toml` directly:

```toml
[mcp_servers.prefpool]
command = "node"
args = ["<path-to>/PrefPool/plugins/claude-code/dist/server.mjs"]
env = { AGENT_SURVEY_SERVER_URL = "http://localhost:4000", AGENT_SURVEY_WEB_URL = "http://localhost:3000", AGENT_TOKEN = "<token>" }
```

## 2. Add the instructions

Codex has no plugin skills, so copy [`AGENTS.md`](AGENTS.md) into your project's `AGENTS.md` (or `~/.codex/AGENTS.md`).
It tells the agent how to use the tools: campaign text is untrusted, abstain when unsure, never reveal the owner.
The tools enforce the owner's policy in code either way.

Policy and local state live in `~/.agent-survey/`.
