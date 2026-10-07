// server/src/agentApi.ts
import { Router } from 'express';
import { z } from 'zod';
import { requireAgent, requireSession, type AuthedRequest } from './auth.js';
import { onboardingRound } from './calibration.js';
import { acceptAnswerCopy, acceptEnvelope, activeCampaignViews, recordDecision } from './agentService.js';
import type { Deps } from './deps.js';
import { personhoodOf } from './ownerApi.js';
import { hashToken, newToken } from './tokens.js';

const policySchema = z.object({
  allowedCategories: z.array(z.string()), blockedCategories: z.array(z.string()),
  minimumRewardSol: z.number().nonnegative(), dailyLimit: z.number().int().positive(),
  approvalMode: z.enum(['auto', 'approve_sensitive', 'approve_all']),
});

export function agentRoutes(deps: Deps): Router {
  const r = Router();
  /** Register (or re-key) the agent for the signed-in wallet. Plugins keep policy locally and send none. */
  r.post('/agents/register', requireSession(deps), async (req: AuthedRequest, res) => {
    const body = z.object({ kind: z.enum(['live', 'plugin']), policy: policySchema.optional() }).parse(req.body);
    const agentToken = newToken();
    const id = `agent-${req.address!.slice(-12)}`;
    await deps.db.query(
      `insert into agents (id, kind, address, token_hash, policy, created_at) values ($1, $2, $3, $4, $5::jsonb, to_timestamp($6 / 1000.0))
       on conflict (address) do update set token_hash = excluded.token_hash, kind = excluded.kind, policy = excluded.policy, last_seen_at = null`,
      [id, body.kind, req.address, hashToken(agentToken), body.policy ? JSON.stringify(body.policy) : null, deps.now()]);
    const [a] = await deps.db.query<{ id: string }>(`select id from agents where address = $1`, [req.address]);
    // Calibration starts at onboarding: a plugin/OpenClaw agent's first registration opens its first round.
    if (body.kind === 'plugin') await onboardingRound(deps, a!.id);
    res.json({ agentId: a!.id, agentToken });
  });
  r.get('/agents/me', requireAgent(deps), async (req: AuthedRequest, res) => {
    const [a] = await deps.db.query<{ transcript_pk: string | null; personhood_kind: 'world' | 'simulated' | null; personhood_verified_at: Date | string | null; calibrated_ms: string | number | null }>(
      `select transcript_pk, personhood_kind, personhood_verified_at, extract(epoch from calibrated_until) * 1000 as calibrated_ms from agents where id = $1`, [req.agent!.id]);
    // transcriptPublicKey: seal a copy of each answer to it (encrypt to self) so the owner can read it on any device.
    res.json({ agentId: req.agent!.id, address: req.agent!.address, kind: req.agent!.kind, transcriptPublicKey: a?.transcript_pk ?? null, personhood: a ? personhoodOf(a) : null,
      calibratedUntil: a?.calibrated_ms == null ? null : Math.round(Number(a.calibrated_ms)) });
  });
  r.get('/agents/campaigns', requireAgent(deps), async (req: AuthedRequest, res) => {
    res.json({ campaigns: req.agent!.paused ? [] : await activeCampaignViews(deps) });
  });
  r.post('/agents/campaigns/:id/decision', requireAgent(deps), async (req: AuthedRequest, res) => {
    const { kind, reason } = z.object({ kind: z.enum(['answer', 'abstain']), reason: z.string().max(120).optional() }).parse(req.body);
    await recordDecision(deps, req.agent!, String(req.params.id), kind, reason);
    res.status(204).end();
  });
  r.post('/agents/campaigns/:id/envelope', requireAgent(deps), async (req: AuthedRequest, res) => {
    await acceptEnvelope(deps, req.agent!, req.body);
    res.status(204).end();
  });
  /** The owner's copy of an answer this agent already submitted, sealed to the owner's transcript key. Ciphertext only. */
  r.post('/agents/campaigns/:id/answer-copy', requireAgent(deps), async (req: AuthedRequest, res) => {
    await acceptAnswerCopy(deps, req.agent!, String(req.params.id), req.body);
    res.status(204).end();
  });
  return r;
}
