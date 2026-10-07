# PrefPool for OpenClaw

Let your OpenClaw agent answer paid research surveys for you. It answers from what it knows about you from your
chats, skips what it doesn't know, and asks you in one short message when needed. Answers are encrypted on your
machine; rewards arrive in SOL (Solana devnet).

Two pieces:

| Piece | What it is |
|---|---|
| MCP server | `plugins/claude-code/dist/server.mjs` (the same bundled server the Claude Code plugin uses): the tools `list_campaigns`, `evaluate_campaign`, `submit_answer`, `get_policy`, `set_policy`, … |
| Skill | `skills/prefpool/SKILL.md`: tells the agent when and how to use the tools (answer only what it knows, abstain otherwise, never reveal the owner). |

## Install

1. **Get an agent token.** Sign in on the PrefPool web app with your Solana wallet (Phantom, Solflare or Backpack) →
   **Agent** → **OpenClaw** tab → **Create new token**. The tab shows this whole snippet filled in with your token and URLs.
2. **Clone this repo** (the MCP server isn't on npm):
   ```bash
   git clone https://github.com/ixgnoy/PrefPool.git
   ```
3. **Add the MCP server** (needs Node 20+):
   ```bash
   openclaw mcp add prefpool --command node --arg <path-to>/PrefPool/plugins/claude-code/dist/server.mjs \
     --env AGENT_SURVEY_SERVER_URL=<server url> \
     --env AGENT_SURVEY_WEB_URL=<web url> \
     --env AGENT_TOKEN=<your agent token> \
     --approval approve
   openclaw mcp doctor --probe
   ```
   `--approval approve` lets heartbeat runs use the tools without a prompt each time. Your rules are still enforced
   by the tools themselves. Use `--approval prompt` if you want to confirm every call. (Check
   `openclaw mcp add --help` if your OpenClaw version names the env flag differently.)
4. **Install the skill** (personal skills folder, or `<workspace>/skills/` for one workspace):
   ```bash
   cp -r <path-to>/PrefPool/plugins/openclaw/skills/prefpool ~/.agents/skills/
   ```
5. **Answer on a schedule:** add the line from [`HEARTBEAT.snippet.md`](HEARTBEAT.snippet.md) to `HEARTBEAT.md` in
   your workspace. Heartbeat runs every 30 minutes by default.
6. **Calibration:** your agent gets 15 questions about you after setup and every 30 days. It answers on its next
   heartbeat and sends you a link; you answer the same questions on the web (10 minutes). Passing unlocks "calibrated
   agents only" campaigns.
7. Optional: **verify you're human** (World ID) on the Agent page, so your agent can answer "verified humans only"
   campaigns.

## Publish to ClawHub (maintainers)

```bash
clawhub skill publish ./plugins/openclaw/skills/prefpool --slug prefpool --name "PrefPool" --version 0.1.0
```

Needs a GitHub account at least one week old. After publishing, users can run `openclaw skills install @<owner>/prefpool`
instead of step 4.
