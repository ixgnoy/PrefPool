// cre-runner/src/main.ts
import { fileURLToPath } from 'node:url';
import { creCliRunner, pollOnce } from './runner.js';

const serverUrl = process.env.SERVER_URL ?? 'http://localhost:4000';
const token = process.env.CRE_RUNNER_TOKEN ?? '';
if (!token) throw new Error('CRE_RUNNER_TOKEN is required');
const run = creCliRunner({
  creDir: fileURLToPath(new URL('../../cre', import.meta.url)),
  target: process.env.CRE_TARGET ?? 'staging-settings',
  broadcast: process.env.CRE_BROADCAST === 'true',
});
console.log(`cre-runner polling ${serverUrl} (broadcast=${process.env.CRE_BROADCAST === 'true'})`);
for (;;) {
  try {
    if (!(await pollOnce({ serverUrl, token, run }))) await new Promise((r) => setTimeout(r, 5_000));
  } catch (e) {
    console.error(e);
    await new Promise((r) => setTimeout(r, 10_000));
  }
}
