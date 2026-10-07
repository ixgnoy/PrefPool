// server/src/approvals.ts: the owner's approval queue (policy approve_all). The plugin keeps the sealed answer on the owner's
// machine and posts only the owner's copy (sealed to the transcript key); the owner opens it in the browser and decides.
// The agent learns only {campaignId, state}; nothing here is plaintext.
import { Router } from 'express';
import { z } from 'zod';
import { activeCampaign, envelopeSchema, onDuty, refuseIfAbstained } from './agentService.js';
import { requireAgent, requireSession, type AuthedRequest } from './auth.js';
import { HttpError, type Deps } from './deps.js';

export function approvalRoutes(deps: Deps): Router {
  const r = Router();
  const myAgent = async (address: string) => {
    const [a] = await deps.db.query<{ id: string; transcript_pk: string | null }>(`select id, transcript_pk from agents where address = $1`, [address]);
    if (!a) throw new HttpError(404, 'NO_AGENT', 'register your agent first');
    return a;
  };

  // ---- agent ----
  /** Ask the owner to approve an answer. Same checks as submitting it; the first request wins. */
  r.post('/agents/campaigns/:id/approval', requireAgent(deps), async (req: AuthedRequest, res) => {
    const agent = req.agent!;
    const copy = envelopeSchema.parse(req.body);
    const id = String(req.params.id);
    if (copy.campaignId !== id || copy.respondentAddress !== agent.address) throw new HttpError(403, 'NOT_YOUR_ANSWER', 'the copy must be your own answer to this campaign');
    await onDuty(deps, agent);
    await activeCampaign(deps, id);
    await refuseIfAbstained(deps, agent, id);
    const [answered] = await deps.db.query(`select 1 from envelopes where campaign_id = $1 and respondent_address = $2`, [id, agent.address]);
    if (answered) throw new HttpError(409, 'ANSWERED', 'already answered this campaign');
    await deps.db.query(
      `insert into answer_approvals (campaign_id, agent_id, envelope, state, requested_at_ms) values ($1, $2, $3::jsonb, 'pending', $4) on conflict do nothing`,
      [id, agent.id, JSON.stringify(copy), deps.now()]);
    res.status(204).end();
  });
  r.get('/agents/approvals', requireAgent(deps), async (req: AuthedRequest, res) => {
    const rows = await deps.db.query<{ campaign_id: string; state: string }>(
      `select campaign_id, state from answer_approvals where agent_id = $1 order by requested_at_ms`, [req.agent!.id]);
    res.json({ approvals: rows.map((x) => ({ campaignId: x.campaign_id, state: x.state })) });
  });

  // ---- owner (web) ----
  r.get('/agents/mine/approvals', requireSession(deps), async (req: AuthedRequest, res) => {
    const a = await myAgent(req.address!);
    const rows = await deps.db.query<{ campaign_id: string; envelope: unknown; requested_at_ms: string | number; spec: { title: string; category: string; questions: unknown[] }; deadline_ms: string | number }>(
      `select p.campaign_id, p.envelope, p.requested_at_ms, c.spec, c.deadline_ms from answer_approvals p join campaigns c on c.id = p.campaign_id
        where p.agent_id = $1 and p.state = 'pending' and c.state = 'ACTIVE' and c.deadline_ms > $2 order by p.requested_at_ms`, [a.id, deps.now()]);
    res.json({ transcriptPublicKey: a.transcript_pk, pending: rows.map((x) => ({ campaignId: x.campaign_id, title: x.spec.title, category: x.spec.category,
      questions: x.spec.questions, envelope: x.envelope, requestedAtMs: Number(x.requested_at_ms), deadlineMs: Number(x.deadline_ms) })) });
  });
  /** Decide once, only while pending, the campaign is ACTIVE and before the deadline. */
  r.post('/agents/mine/approvals/:campaignId', requireSession(deps), async (req: AuthedRequest, res) => {
    const a = await myAgent(req.address!);
    const { decision } = z.object({ decision: z.enum(['approve', 'reject']) }).parse(req.body);
    const done = await deps.db.query(
      `update answer_approvals p set state = $3, decided_at_ms = $4 from campaigns c
        where c.id = p.campaign_id and p.campaign_id = $1 and p.agent_id = $2 and p.state = 'pending' and c.state = 'ACTIVE' and c.deadline_ms > $4 returning p.campaign_id`,
      [String(req.params.campaignId), a.id, decision === 'approve' ? 'approved' : 'rejected', deps.now()]);
    if (!done.length) throw new HttpError(404, 'NO_PENDING', 'nothing pending for this campaign');
    res.status(204).end();
  });
  return r;
}
