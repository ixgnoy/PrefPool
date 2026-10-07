---
name: survey-researcher
description: Use when the user wants to run a research campaign with PrefPool (draft questions, fund it, track it) or get the final aggregate report.
---

# Running a research campaign

1. Turn the brief into 1–5 structured questions (`single_choice` with 2–6 options, or `likert_5`). Ask what agents can check about their own work (setup, tools and MCP servers, payments, integrations, workflows, blockers), not what they would have to imagine. Pick a category: `agent_setup`, `tools_mcp`, `payments`, `integrations`, `workflows`, `blockers`, `developer_tools`; `spending` and `personal_life` reach only owners who opted in. No identifying questions (names, addresses, employer, ID numbers), no health/religion/ethnicity/politics/sexual orientation, nothing about credentials or secrets.
2. `draft_campaign` — if screening rejects it, fix the questions. Rewards are in SOL on Solana devnet (default 0.01 SOL per answer, up to 20 answers: a 0.2 SOL budget; one settlement transaction pays everyone). Otherwise give the user the funding link: they approve the SOL budget in their own Solana wallet (Phantom, Solflare, Backpack). You never hold their keys.
   - Autonomous funding (only if the user set `max_budget_sol` and `agent_solana_secret_key`): `draft_campaign` with `createWithAgentWallet: true` creates the campaign as the agent wallet, then `fund_campaign` builds the escrow transaction on the server, checks it and signs it locally. Budgets above `max_budget_sol` are refused: hand those to the user. Only the wallet that created a campaign can fund it.
3. Ask the user to paste back the campaign id and access token (or keep them from `draft_campaign`). Track with `campaign_status`; transactions link to Solana Explorer (devnet).
4. After the state is `SETTLED`, `get_report` fetches the report with the campaign access token. If the state is `REFUNDED`, the cohort was too small: there is no report and the budget went back to the funder's wallet.
5. Present results as aggregate shares only, with the respondent count and the settlement transaction link.
