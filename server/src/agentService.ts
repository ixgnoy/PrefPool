// server/src/agentService.ts
import { EXPLICIT_ABSTAIN_REASONS, calibrationGate, isSolanaAddress, type Envelope } from '@as/shared';
import { z } from 'zod';
import { getCampaign } from './campaigns.js';
import { isUniqueViolation } from './db.js';
import { HttpError, type Deps } from './deps.js';
import { agentView, type CampaignRow, type CampaignView } from './views.js';

export interface AgentRef { id: string; address: string }

/**
 * Shape check only (the platform never sees plaintext). v2 adds sealed answer sources and client; ct is capped at
 * 2000 hex so a CRE page of 10 envelopes stays under the 25 KB consensus observation limit (creApi PAGE).
 */
export const envelopeSchema = z.object({
  v: z.union([z.literal(1), z.literal(2)]),
  campaignId: z.string().regex(/^[0-9a-f]{64}$/),
  respondentAddress: z.string().refine(isSolanaAddress, 'not a Solana address'),
  epk: z.string().regex(/^[0-9a-f]{64}$/),
  n: z.string().regex(/^[0-9a-f]{48}$/),
  ct: z.string().regex(/^[0-9a-f]{34,2000}$/),
}).strict();

export async function activeCampaign(deps: Deps, id: string): Promise<CampaignRow> {
  const c = await getCampaign(deps, id);
  if (c.state !== 'ACTIVE') throw new HttpError(409, 'NOT_ACTIVE', `campaign is ${c.state}`);
  if (deps.now() > Number(c.deadline_ms)) throw new HttpError(409, 'LATE', 'deadline passed');
  return c;
}

export async function activeCampaignViews(deps: Deps): Promise<CampaignView[]> {
  const rows = await deps.db.query<CampaignRow>(`select * from campaigns where state = 'ACTIVE' and deadline_ms > $1`, [deps.now()]);
  return rows.map((c) => agentView(c, deps.config.envelopePublicKey));
}

/** Records that the agent is active (connection status) and refuses work while its owner has paused it. */
export async function onDuty(deps: Deps, agent: AgentRef) {
  const [a] = await deps.db.query<{ paused: boolean }>(`update agents set last_seen_at = now() where id = $1 returning paused`, [agent.id]);
  if (a?.paused) throw new HttpError(409, 'AGENT_PAUSED', 'this agent is paused by its owner');
}

/** An explicit abstain (abstain_campaign) is final; policy and tier abstains stay recoverable. */
export async function refuseIfAbstained(deps: Deps, agent: AgentRef, campaignId: string) {
  const [abstained] = await deps.db.query(`select 1 from agent_decisions where campaign_id = $1 and agent_id = $2 and kind = 'abstain' and reason = any($3::text[])`,
    [campaignId, agent.id, EXPLICIT_ABSTAIN_REASONS]);
  if (abstained) throw new HttpError(409, 'ABSTAINED', 'this agent abstained from this campaign and cannot answer it');
}

/** First decision wins; a later answer/abstain for the same campaign is ignored. */
export async function recordDecision(deps: Deps, agent: AgentRef, campaignId: string, kind: 'answer' | 'abstain', reason?: string) {
  await onDuty(deps, agent);
  await activeCampaign(deps, campaignId);
  const r = reason ? reason.slice(0, 120) : null; // content-free reason strings from policy evaluation
  await deps.db.query(
    `insert into agent_decisions (campaign_id, agent_id, kind, reason) values ($1, $2, $3, $4) on conflict do nothing`,
    [campaignId, agent.id, kind, kind === 'abstain' ? r : null]);
}

/** Store the owner's copy (encrypt to self). Only for a campaign this agent really answered; first copy wins. */
export async function acceptAnswerCopy(deps: Deps, agent: AgentRef, campaignId: string, raw: unknown): Promise<void> {
  const env = envelopeSchema.parse(raw) as Envelope;
  if (env.respondentAddress !== agent.address || env.campaignId !== campaignId) throw new HttpError(403, 'NOT_YOUR_ANSWER', 'the copy must be of your own answer to this campaign');
  const [answered] = await deps.db.query(`select 1 from envelopes where campaign_id = $1 and respondent_address = $2`, [campaignId, agent.address]);
  if (!answered) throw new HttpError(409, 'NO_ANSWER', 'submit the answer before its copy');
  await deps.db.query(`insert into answer_copies (campaign_id, agent_id, envelope, received_at_ms) values ($1, $2, $3::jsonb, $4) on conflict do nothing`,
    [campaignId, agent.id, JSON.stringify(env), deps.now()]);
}

/** Store an encrypted answer. The platform never sees plaintext; it only checks shape, ownership and timing. */
export async function acceptEnvelope(deps: Deps, agent: AgentRef, raw: unknown): Promise<void> {
  const env = envelopeSchema.parse(raw) as Envelope;
  if (env.respondentAddress !== agent.address) throw new HttpError(403, 'NOT_YOUR_ADDRESS', 'respondentAddress must be your registered address');
  await onDuty(deps, agent);
  const c = await activeCampaign(deps, env.campaignId);
  await refuseIfAbstained(deps, agent, env.campaignId);
  const [me] = await deps.db.query<{ personhood_nullifier: string | null; calibrated_ms: string | number | null }>(
    `select personhood_nullifier, extract(epoch from calibrated_until) * 1000 as calibrated_ms from agents where id = $1`, [agent.id]);
  const nullifier = me?.personhood_nullifier ?? null;
  if (c.spec.verifiedHumansOnly && !nullifier) throw new HttpError(403, 'UNVERIFIED', 'this campaign only accepts World ID verified humans');
  if (!calibrationGate(c.spec, me?.calibrated_ms == null ? null : Number(me.calibrated_ms), Number(c.deadline_ms)).ok)
    throw new HttpError(403, 'UNCALIBRATED', 'this campaign only accepts calibrated agents');
  let inserted: unknown[];
  try {
    // Targeted conflict: the same address again is DUPLICATE; the same human through another agent violates envelopes_campaign_human.
    inserted = await deps.db.query(
      `insert into envelopes (campaign_id, respondent_address, envelope, received_at_ms, personhood_nullifier) values ($1, $2, $3::jsonb, $4, $5)
       on conflict (campaign_id, respondent_address) do nothing returning campaign_id`,
      [env.campaignId, env.respondentAddress, JSON.stringify(env), deps.now(), nullifier]);
  } catch (e) {
    if (isUniqueViolation(e)) throw new HttpError(409, 'DUPLICATE_HUMAN', 'this human already answered this campaign through another agent');
    throw e;
  }
  if (inserted.length === 0) throw new HttpError(409, 'DUPLICATE', 'already answered this campaign');
  await deps.db.query(
    `insert into agent_decisions (campaign_id, agent_id, kind) values ($1, $2, 'answer') on conflict do nothing`,
    [env.campaignId, agent.id]);
}
