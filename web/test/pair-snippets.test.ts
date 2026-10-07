// web/test/pair-snippets.test.ts: install snippets on the Agent page, incl. OpenClaw (MCP server + PrefPool skill).
import { describe, expect, it } from 'vitest';
import { TABS, snippet } from '../lib/pairSnippets';

const u = { server: 'https://api.example', web: 'https://web.example' };

describe('OpenClaw install snippet', () => {
  it('is offered as a tab', () => {
    expect(TABS).toContain('OpenClaw');
  });
  it('registers our MCP server with the agent token and installs the PrefPool skill', () => {
    const s = snippet('OpenClaw', 'tok123', u);
    expect(s).toContain('openclaw mcp add prefpool --command node');
    expect(s).toContain('plugins/claude-code/dist/server.mjs');
    expect(s).toContain('AGENT_TOKEN=tok123');
    expect(s).toContain('AGENT_SURVEY_SERVER_URL=https://api.example');
    expect(s).toContain('AGENT_SURVEY_WEB_URL=https://web.example');
    expect(s).toContain('plugins/openclaw/skills/prefpool');
    expect(s).toContain('HEARTBEAT.md');
  });
});
