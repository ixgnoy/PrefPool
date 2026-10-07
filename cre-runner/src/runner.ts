// cre-runner/src/runner.ts
import { spawn } from 'node:child_process';

export interface Job { jobId: string; campaignId: string }
export interface RunResult { ok: boolean; log: string }
export type RunSimulation = (campaignId: string) => Promise<RunResult>;

/** Build the exact `cre workflow simulate` argv (F12, F13). */
export function simulateArgs(campaignId: string, opts: { target: string; broadcast: boolean }): string[] {
  if (!/^[0-9a-f]{64}$/.test(campaignId)) throw new Error('bad campaignId');
  const args = ['workflow', 'simulate', 'aggregate', '--target', opts.target, '--non-interactive', '--trigger-index', '0',
    '--http-payload', JSON.stringify({ campaignId })];
  if (opts.broadcast) args.push('--broadcast');
  return args;
}

/** Spawn the CRE CLI in the CRE project dir and capture its output (the "CRE Simulation" evidence log). */
export function creCliRunner(opts: { creDir: string; target: string; broadcast: boolean; creBin?: string; timeoutMs?: number }): RunSimulation {
  return (campaignId) =>
    new Promise((resolve) => {
      const child = spawn(opts.creBin ?? 'cre', simulateArgs(campaignId, opts), { cwd: opts.creDir, env: process.env });
      let log = '';
      const append = (b: Buffer) => { log = (log + b.toString()).slice(-200_000); };
      child.stdout.on('data', append);
      child.stderr.on('data', append);
      const timer = setTimeout(() => child.kill('SIGTERM'), opts.timeoutMs ?? 6 * 60_000);
      child.on('error', (e) => { clearTimeout(timer); resolve({ ok: false, log: `${log}\n${e.message}` }); });
      child.on('close', (code) => { clearTimeout(timer); resolve({ ok: code === 0, log }); });
    });
}

/** One poll: claim a job, run it, report the result. Returns false when there was nothing to do. */
export async function pollOnce(deps: {
  serverUrl: string;
  token: string;
  run: RunSimulation;
  fetchFn?: typeof fetch;
}): Promise<boolean> {
  const f = deps.fetchFn ?? fetch;
  const headers = { Authorization: `Bearer ${deps.token}`, 'Content-Type': 'application/json' };
  const res = await f(`${deps.serverUrl}/api/cre/jobs/next`, { headers });
  if (res.status === 204) return false;
  if (!res.ok) throw new Error(`jobs/next -> ${res.status}`);
  const job = (await res.json()) as Job;
  const result = await deps.run(job.campaignId);
  const post = await f(`${deps.serverUrl}/api/cre/jobs/${job.jobId}/result`, { method: 'POST', headers, body: JSON.stringify(result) });
  if (!post.ok) throw new Error(`jobs/result -> ${post.status}`);
  return true;
}
