// web/lib/pairSnippets.ts: install snippets for the Agent page (one per MCP client), kept pure so they can be tested.
import { PLUGIN_REPO } from './config';

export const TABS = ['Claude Code', 'OpenClaw', 'Cursor', 'Codex', 'Gemini CLI', 'Claude Desktop'] as const;
export type Tab = (typeof TABS)[number];
export type Urls = { server: string; web: string };

/** Plugin entry inside a clone of PLUGIN_REPO. The MCP server isn't on npm (plugins/mcp is private), so non-Claude-Code
 *  clients run the bundled file directly. Server and web URLs are this site's, so snippets work on localhost and in prod. */
const ENTRY = '<path-to>/PrefPool/plugins/claude-code/dist/server.mjs';
const SKILL = '<path-to>/PrefPool/plugins/openclaw/skills/prefpool';
const envFor = (token: string, u: Urls) => ({ AGENT_SURVEY_SERVER_URL: u.server, AGENT_SURVEY_WEB_URL: u.web, AGENT_TOKEN: token });

export function snippet(tab: Tab, token: string, u: Urls): string {
  const json = (file: string) => `// ${file}  (clone ${PLUGIN_REPO} first)\n${JSON.stringify({ mcpServers: { 'agent-survey': { command: 'node', args: [ENTRY], env: envFor(token, u) } } }, null, 2)}`;
  switch (tab) {
    case 'Claude Code': return [
      `/plugin marketplace add ${PLUGIN_REPO}`,
      '/plugin install agent-survey@agent-survey',
      '# When Claude Code asks for the plugin settings:',
      `#   server_url  = ${u.server}`,
      `#   web_url     = ${u.web}`,
      `#   agent_token = ${token}`,
    ].join('\n');
    case 'OpenClaw': return [
      `# clone ${PLUGIN_REPO} first, then:`,
      `openclaw mcp add prefpool --command node --arg ${ENTRY} \\`,
      ...Object.entries(envFor(token, u)).map(([k, v]) => `  --env ${k}=${v} \\`),
      '  --approval approve   # the tools enforce your rules in code',
      `cp -r ${SKILL} ~/.agents/skills/`,
      '# answer campaigns on a schedule: add this line to your workspace HEARTBEAT.md',
      '#   - Check PrefPool for new research campaigns (prefpool skill).',
    ].join('\n');
    case 'Cursor': return json('~/.cursor/mcp.json');
    case 'Codex': return `# ~/.codex/config.toml  (clone ${PLUGIN_REPO} first)\n[mcp_servers.agent-survey]\ncommand = "node"\nargs = ["${ENTRY}"]\nenv = { ${Object.entries(envFor(token, u)).map(([k, v]) => `${k} = "${v}"`).join(', ')} }`;
    case 'Gemini CLI': return json('~/.gemini/settings.json');
    case 'Claude Desktop': return json('claude_desktop_config.json');
  }
}
