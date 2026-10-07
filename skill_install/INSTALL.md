# Skill Install Guide (for coding agents)

Skills installed: Cardano dev skills (18), Masumi, Chainlink CRE.

## 1. Claude Code

Cardano (plugin, 18 skills):
```
/plugin marketplace add cardano-foundation/cardano-dev-skills
/plugin install cardano-dev-skills@cardano-dev-skills
/reload-plugins
```
Skills appear as `cardano-dev-skills:<name>`. In a project, run `/cardano-dev-skills:cardano-context` to make the agent consult them automatically.

Masumi + Chainlink CRE (via `npx skills`, `-g` = global, `-y` = no prompts):
```
npx skills add https://github.com/masumi-network/masumi-skills --skill masumi -g -y
npx skills add https://github.com/smartcontractkit/chainlink-agent-skills --skill chainlink-cre-skill -g -y
```
Then `/reload-skills`. Files land in `~/.agents/skills/<name>`, symlinked into `~/.claude/skills/`.

## 2. Other agents (Cursor, Gemini CLI, Copilot, OpenCode, Codex, ...)

The `npx skills` commands above install for all supported agents at once. To target one agent, add `-a <agent>`. Run `npx skills add --help` for the list.

Cardano skills are plain markdown. Clone and copy the folders:
```
git clone https://github.com/cardano-foundation/cardano-dev-skills
cp -r cardano-dev-skills/skills/* ~/.agents/skills/
```
(or into your agent's own skills directory).

## Verify

- Claude Code: the skill names show up in the skill list after reload.
- Others: `ls ~/.agents/skills` shows `masumi` and `chainlink-cre-skill`.

## Notes

- Review third-party skills before installing. They run with full agent permissions.
- Update `npx skills` installs: `npx skills update`. Update the Cardano plugin: `/plugin marketplace update`.
- Remove: `npx skills remove <name> -g`, or `/plugin uninstall cardano-dev-skills`.
