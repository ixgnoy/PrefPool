// server/scripts/drills.ts — WS6 Task 6.4 failure drills against a running local server (root .env loaded).
//   npx tsx scripts/drills.ts answer <campaignId>        BUYER2 as respondent agent: answer twice → 204 then 409 DUPLICATE
//   npx tsx scripts/drills.ts late <campaignId>          answer after the deadline → 409 (LATE, or NOT_ACTIVE once the tick moved on)
//   npx tsx scripts/drills.ts rejected                   home-address question → 422 REJECTED before funding
//   npx tsx scripts/drills.ts create <category> <min>    create + print { campaignId, accessToken } (e.g. gaming 15 for the cohort drill)
//   Wallets: BUYER_SECRET_KEY / BUYER2_SECRET_KEY (base58 or JSON byte array, like RELAYER_SECRET_KEY).
import { ed25519 } from '@noble/curves/ed25519.js';
import { addressFromBytes, bytesToHex, sealEnvelope, utf8ToBytes } from '@as/shared';
import { parseSecretKey } from '../src/chainAdapter.js';

const SERVER = process.env.SERVER_URL ?? 'http://localhost:4000';
const [cmd, arg1, arg2] = process.argv.slice(2);

async function call(path: string, init: RequestInit & { token?: string } = {}) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (init.token) headers.Authorization = `Bearer ${init.token}`;
  const res = await fetch(`${SERVER}/api${path}`, { ...init, headers });
  return { status: res.status, body: res.status === 204 ? null : await res.json().catch(() => null) as any };
}
async function signIn(secretVar: string) {
  const sk = parseSecretKey(process.env[secretVar]!);
  const address = addressFromBytes(sk.slice(32));
  const { body: { message } } = await call('/auth/nonce', { method: 'POST', body: JSON.stringify({ address }) });
  const signature = bytesToHex(ed25519.sign(utf8ToBytes(message), sk.slice(0, 32)));
  const { body: { sessionToken } } = await call('/auth/verify', { method: 'POST', body: JSON.stringify({ address, signature }) });
  return { address, sessionToken: sessionToken as string };
}
const spec = (category: string, minCohort: number, text = 'How do you usually pay in shops?') => ({
  title: `drill ${category} ${new Date().toISOString().slice(11, 19)}`, category,
  questions: [{ id: 'q1', type: 'single_choice', text, options: ['Card', 'Phone wallet', 'QR code', 'Cash'] }],
  audience: {}, rewardLamports: '1500000', maxResponses: 20, minCohort, deadlineMs: Date.now() + Number(process.env.DEADLINE_MIN ?? '8') * 60_000,
});

if (cmd === 'answer' || cmd === 'late') {
  const me = await signIn('BUYER2_SECRET_KEY');
  const { body: reg } = await call('/agents/register', { method: 'POST', token: me.sessionToken, body: JSON.stringify({ kind: 'live' }) });
  const { body: cfg } = await call('/config/public');
  const send = () => call(`/agents/campaigns/${arg1}/envelope`, { method: 'POST', token: reg.agentToken,
    body: JSON.stringify(sealEnvelope(cfg.envelopePublicKey, arg1!, me.address, { q1: 0 })) });
  const first = await send();
  console.log(JSON.stringify({ drill: cmd, attempt: 1, status: first.status, code: first.body?.code }));
  if (cmd === 'answer') {
    const second = await send();
    console.log(JSON.stringify({ drill: 'duplicate', attempt: 2, status: second.status, code: second.body?.code }));
  }
} else if (cmd === 'rejected') {
  const me = await signIn('BUYER_SECRET_KEY');
  const r = await call('/campaigns', { method: 'POST', token: me.sessionToken, body: JSON.stringify(spec('tools_mcp', 15, 'What is your exact home address?')) });
  console.log(JSON.stringify({ drill: 'malicious campaign', status: r.status, state: r.body?.state, reasons: r.body?.reasons }));
} else if (cmd === 'create') {
  const me = await signIn('BUYER_SECRET_KEY');
  const r = await call('/campaigns', { method: 'POST', token: me.sessionToken, body: JSON.stringify(spec(arg1 ?? 'gaming', Number(arg2 ?? '15'))) });
  console.log(JSON.stringify({ campaignId: r.body?.campaignId, accessToken: r.body?.accessToken, state: r.body?.state }));
} else {
  console.error('usage: drills.ts answer|late <campaignId> | rejected | create <category> <minCohort>');
  process.exit(2);
}
