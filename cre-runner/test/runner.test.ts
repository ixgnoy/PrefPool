// cre-runner/test/runner.test.ts
import { describe, expect, it } from 'vitest';
import { creCliRunner, pollOnce, simulateArgs } from '../src/runner.js';

const CID = 'ab'.repeat(32);

describe('simulateArgs', () => {
  it('builds a non-interactive simulate command', () => {
    expect(simulateArgs(CID, { target: 'staging-settings', broadcast: false })).toEqual([
      'workflow', 'simulate', 'aggregate', '--target', 'staging-settings', '--non-interactive', '--trigger-index', '0',
      '--http-payload', `{"campaignId":"${CID}"}`,
    ]);
    expect(simulateArgs(CID, { target: 't', broadcast: true }).at(-1)).toBe('--broadcast');
  });
  it('refuses anything that is not a 32-byte hex id (no shell injection)', () => {
    expect(() => simulateArgs('x"; rm -rf /', { target: 't', broadcast: false })).toThrow();
  });
});

describe('creCliRunner', () => {
  it('captures output and exit status of the CLI', async () => {
    const run = creCliRunner({ creDir: '.', target: 't', broadcast: false, creBin: 'echo' });
    const r = await run(CID);
    expect(r.ok).toBe(true);
    expect(r.log).toContain('workflow simulate aggregate');
  });
  it('reports failure when the CLI is missing', async () => {
    const r = await creCliRunner({ creDir: '.', target: 't', broadcast: false, creBin: '/nonexistent/cre' })(CID);
    expect(r.ok).toBe(false);
  });
});

describe('pollOnce', () => {
  it('claims, runs and reports a job', async () => {
    const calls: string[] = [];
    const fetchFn = (async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      if (url.endsWith('/jobs/next')) return new Response(JSON.stringify({ jobId: 'j1', campaignId: CID }), { status: 200 });
      expect(JSON.parse(String(init?.body))).toEqual({ ok: true, log: 'done' });
      return new Response(null, { status: 204 });
    }) as typeof fetch;
    const did = await pollOnce({ serverUrl: 'http://s', token: 't', run: async () => ({ ok: true, log: 'done' }), fetchFn });
    expect(did).toBe(true);
    expect(calls).toEqual(['GET http://s/api/cre/jobs/next', 'POST http://s/api/cre/jobs/j1/result']);
  });
  it('returns false when there is no job', async () => {
    const fetchFn = (async () => new Response(null, { status: 204 })) as unknown as typeof fetch;
    expect(await pollOnce({ serverUrl: 'http://s', token: 't', run: async () => ({ ok: true, log: '' }), fetchFn })).toBe(false);
  });
});
