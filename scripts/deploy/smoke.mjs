#!/usr/bin/env node
// Post-deploy smoke test for the hosted stack (Task 8.14). Node >= 22 (global fetch + WebSocket), no dependencies.
//
//   SERVER_URL=https://… WEB_URL=https://… node scripts/deploy/smoke.mjs
//
// Every URL is optional, but at least one of SERVER_URL / WEB_URL is required; checks for an unset URL are skipped
// (SERVER_URL empty = Railway unlinked: web only).
// Retries every check until it passes or SMOKE_TIMEOUT_S (default 300) runs out, because a fresh deploy
// may still be swapping containers when this starts. Exits 1 if any check never passes.

const env = (k) => (process.env[k] ?? '').trim().replace(/\/+$/, '');
const SERVER = env('SERVER_URL');
const WEB = env('WEB_URL');
const TIMEOUT_S = Number(process.env.SMOKE_TIMEOUT_S ?? 300);
if (!SERVER && !WEB) { console.error('set SERVER_URL and/or WEB_URL'); process.exit(2); }

const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
async function get(url, init = {}) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(20_000), redirect: 'follow' });
  return { res, text: await res.text() };
}
const json = (text) => { try { return JSON.parse(text); } catch { throw new Error(`not JSON: ${text.slice(0, 120)}`); } };

const checks = !SERVER ? [] : [
  ['server config (devnet, escrow program)', async () => {
    const { res, text } = await get(`${SERVER}/api/config/public`);
    assert(res.status === 200, `status ${res.status}`);
    const c = json(text);
    assert(c.cluster === 'devnet', `cluster ${c.cluster}`);
    assert(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(c.programId ?? ''), 'programId missing');
    return `program ${c.programId.slice(0, 12)}…`;
  }],
  ['server database (campaign list)', async () => {
    const { res, text } = await get(`${SERVER}/api/campaigns?latest=1`);
    assert(res.status === 200, `status ${res.status}: ${text.slice(0, 120)}`);
    return 'query OK';
  }],
  ['agent WebSocket through the proxy', () => new Promise((resolve, reject) => {
    // A bad token is looked up in the DB and closed with 4401: proves the upgrade path and the DB in one go.
    const ws = new WebSocket(`${SERVER.replace(/^http/, 'ws')}/ws/agents?token=smoke-invalid`);
    const t = setTimeout(() => { ws.close(); reject(new Error('no close within 15 s')); }, 15_000);
    ws.addEventListener('close', (e) => {
      clearTimeout(t);
      e.code === 4401 ? resolve('closed 4401 as expected') : reject(new Error(`closed with ${e.code} ${e.reason}`));
    });
    ws.addEventListener('error', () => {});
  })],
];

if (WEB) {
  checks.push(['web app pages', async () => {
    for (const path of ['/', '/connect', '/seller', '/research']) {
      const { res } = await get(`${WEB}${path}`);
      assert(res.status === 200, `${path} → ${res.status}`);
    }
    return '/, /connect, /seller, /research → 200';
  }]);
  if (SERVER) checks.push(['CORS allows the web origin', async () => {
    const { res } = await get(`${SERVER}/api/config/public`, { headers: { Origin: WEB } });
    const allow = res.headers.get('access-control-allow-origin');
    assert(allow === WEB || allow === '*', `allow-origin is ${allow}; set WEB_ORIGIN=${WEB} on the server`);
    return `allow-origin ${allow}`;
  }]);
}

const deadline = Date.now() + TIMEOUT_S * 1000;
let failed = 0;
for (const [name, fn] of checks) {
  for (;;) {
    try {
      console.log(`PASS  ${name}  (${await fn()})`);
      break;
    } catch (e) {
      if (Date.now() > deadline) { failed++; console.log(`FAIL  ${name}  (${e.message})`); break; }
      await new Promise((r) => setTimeout(r, 10_000));
    }
  }
}
console.log(failed ? `\n${failed} of ${checks.length} checks failed` : `\nall ${checks.length} checks passed`);
process.exit(failed ? 1 : 0);
