// server/src/synthetic.ts
import { createHash } from 'node:crypto';
import WebSocket from 'ws';
import { evaluatePolicy, matchesAudience, sealEnvelope, syntheticAnswers } from '@as/shared';
import type { Db } from './db.js';
import { hashToken } from './tokens.js';
import { SYNTHETIC_AGENTS, syntheticToken, type SyntheticAgent } from './syntheticProfiles.js';
import type { CampaignView } from './views.js';

/** Upsert the 29 synthetic agents; their tokens are derived from SYNTHETIC_SECRET so restarts keep working. */
export async function ensureSyntheticAgents(db: Db, secret: string) {
  // One read; write only agents that are missing or whose token no longer matches SYNTHETIC_SECRET (normally none).
  // ponytail: edits to an existing profile/policy in syntheticProfiles.ts are not re-synced; change SYNTHETIC_SECRET
  // (or delete the agent rows) to force a rewrite.
  const have = new Map((await db.query<{ id: string; token_hash: string }>(
    `select id, token_hash from agents where id = any($1::text[])`, [SYNTHETIC_AGENTS.map((a) => a.profile.id)])).map((r) => [r.id, r.token_hash]));
  for (const a of SYNTHETIC_AGENTS.filter((a) => have.get(a.profile.id) !== hashToken(syntheticToken(secret, a.profile.id)))) {
    // Demo cohort: simulated personhood with a unique, stable nullifier (reported apart from World ID verified humans).
    await db.query(
      `insert into agents (id, kind, address, token_hash, policy, profile, personhood_kind, personhood_nullifier, calibrated_until) values ($1, $2, $3, $4, $5::jsonb, $6::jsonb, 'simulated', $7, now() + interval '365 days')
       on conflict (id) do update set kind = excluded.kind, address = excluded.address, token_hash = excluded.token_hash, policy = excluded.policy, profile = excluded.profile,
         personhood_kind = excluded.personhood_kind, personhood_nullifier = excluded.personhood_nullifier,
         calibrated_until = excluded.calibrated_until`, // demo cohort: simulated calibration pass, labelled
      [a.profile.id, 'synthetic', a.address, hashToken(syntheticToken(secret, a.profile.id)),
        JSON.stringify(a.policy), JSON.stringify(a.profile), `sim:${createHash('sha256').update(`${secret}:${a.profile.id}`).digest('hex')}`]);
  }
}

/** The deterministic agent brain: policy check, then profile answers sealed to the envelope key. */
export function decide(a: SyntheticAgent, c: CampaignView, answeredToday: number) {
  const policy = evaluatePolicy(a.policy, c, answeredToday);
  const verdict = policy.ok ? matchesAudience(a.audience, c.audience ?? {}) : policy;
  if (!verdict.ok) return { type: 'decision' as const, campaignId: c.campaignId, kind: 'abstain' as const, reason: verdict.reason };
  const answers = syntheticAnswers(a.profile, c.questions);
  return { type: 'envelope' as const, envelope: sealEnvelope(c.envelopePublicKey, c.campaignId, a.address, answers) };
}

/**
 * Connect every synthetic agent to the relay exactly like an external agent would (C6),
 * so the demo exercises the real transport. Staggered replies make the UI "light up".
 */
export function startSyntheticAgents(wsUrl: string, secret: string, opts: { maxDelayMs?: number } = {}) {
  const sockets: WebSocket[] = [];
  for (const a of SYNTHETIC_AGENTS) {
    const seen = new Set<string>();
    let today = 0;
    const connect = () => {
      const ws = new WebSocket(`${wsUrl}?token=${syntheticToken(secret, a.profile.id)}`);
      sockets.push(ws);
      ws.on('message', (data) => {
        const msg = JSON.parse(String(data)) as { type: string; campaign?: CampaignView };
        if (msg.type !== 'campaign' || !msg.campaign || seen.has(msg.campaign.campaignId)) return;
        const campaign = msg.campaign;
        seen.add(campaign.campaignId);
        setTimeout(() => {
          const out = decide(a, campaign, today);
          if (out.type === 'envelope') today++;
          if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(out));
        }, Math.floor(Math.random() * (opts.maxDelayMs ?? 4000)));
      });
      ws.on('close', (code) => { if (code !== 1000 && code !== 4401) setTimeout(connect, 3000); });
      ws.on('error', () => {});
    };
    connect();
  }
  return { stop: () => sockets.forEach((s) => s.close(1000)) };
}
