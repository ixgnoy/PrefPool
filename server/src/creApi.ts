// server/src/creApi.ts
import { Router } from 'express';
import { randomHex32, verifySettlementReport, type ResearchReport, type SettlementReport } from '@as/shared';
import { z } from 'zod';
import { requireStaticToken } from './auth.js';
import { getCampaign, setState } from './campaigns.js';
import { HttpError, type Deps } from './deps.js';

const PAGE = 10; // F11: one envelope < 1 KB, consensus observation limit 25 KB

export function creRoutes(deps: Deps): Router {
  const r = Router();
  const cre = requireStaticToken(deps.config.creToken);
  const runner = requireStaticToken(deps.config.runnerToken);

  r.get('/cre/campaigns/:id/context', cre, async (req, res) => {
    const c = await getCampaign(deps, String(req.params.id));
    if (!c.escrow_tx_ref) throw new HttpError(409, 'NO_ESCROW', 'campaign not funded');
    const agents = await deps.db.query<{ address: string; personhood_kind: 'world' | 'simulated' | null; personhood_nullifier: string | null; calibrated_ms: string | number | null }>(
      `select address, personhood_kind, personhood_nullifier, extract(epoch from calibrated_until) * 1000 as calibrated_ms from agents where created_at <= to_timestamp($1 / 1000.0) order by address`,
      [Number(c.deadline_ms)]);
    const personhood = Object.fromEntries(agents.filter((a) => a.personhood_kind && a.personhood_nullifier)
      .map((a) => [a.address, { kind: a.personhood_kind!, nullifier: a.personhood_nullifier! }]));
    res.json({ campaignId: c.id, escrowTxRef: c.escrow_tx_ref, questions: c.spec.questions, deadlineMs: Number(c.deadline_ms),
      registered: agents.map((a) => a.address), personhood, verifiedHumansOnly: c.spec.verifiedHumansOnly === true,
      calibratedUntil: Object.fromEntries(agents.filter((a) => a.calibrated_ms !== null).map((a) => [a.address, Math.round(Number(a.calibrated_ms))])),
      calibratedAgentsOnly: c.spec.calibratedAgentsOnly === true });
  });

  r.get('/cre/campaigns/:id/envelopes', cre, async (req, res) => {
    const page = Math.max(1, Number(req.query.page ?? 1) | 0);
    const [{ n } = { n: 0 }] = await deps.db.query<{ n: number | string }>(`select count(*) as n from envelopes where campaign_id = $1`, [String(req.params.id)]);
    const rows = await deps.db.query<{ envelope: object; received_at_ms: string | number }>(
      `select envelope, received_at_ms from envelopes where campaign_id = $1
       order by received_at_ms, respondent_address limit $2 offset $3`, [String(req.params.id), PAGE, (page - 1) * PAGE]);
    res.json({ page, pageSize: PAGE, total: Number(n), items: rows.map((r) => ({ ...r.envelope, receivedAtMs: Number(r.received_at_ms) })) });
  });

  /** Idempotent: every DON node posts; the same reportHash returns the same ack. */
  r.post('/cre/campaigns/:id/reports', cre, async (req, res) => {
    const body = z.object({ settlement: z.any(), research: z.any().nullable(), evmTx: z.string().nullable().optional() }).parse(req.body);
    const settlement = body.settlement as SettlementReport;
    const research = body.research as ResearchReport | null;
    const c = await getCampaign(deps, String(req.params.id));
    const [existing] = await deps.db.query<{ report_hash: string }>(`select report_hash from reports where campaign_id = $1`, [c.id]);
    if (existing) {
      if (existing.report_hash === settlement.reportHash) return res.json({ ack: 'stored' });
      throw new HttpError(409, 'REPORT_EXISTS', 'a different report is already stored');
    }
    if (c.state !== 'AGGREGATING') throw new HttpError(409, 'STATE', `campaign is ${c.state}`);
    const errs = verifySettlementReport(settlement, deps.config.reportPublicKey, { minCohort: c.spec.minCohort, maxResponses: c.spec.maxResponses });
    if (settlement.campaignId !== c.id) errs.push('campaignId mismatch');
    if (settlement.escrowTxRef !== c.escrow_tx_ref) errs.push('escrowTxRef mismatch');
    if (errs.length) throw new HttpError(422, 'BAD_REPORT', errs.join('; '));
    await deps.db.query(`insert into reports (campaign_id, settlement, research, report_hash, evm_tx) values ($1, $2::jsonb, $3::jsonb, $4, $5)`,
      [c.id, JSON.stringify(settlement), research ? JSON.stringify(research) : null, settlement.reportHash, body.evmTx ?? null]);
    await setState(deps, c.id, settlement.acceptedCount === 0 ? 'INSUFFICIENT_COHORT' : 'SETTLEMENT_READY');
    res.json({ ack: 'stored' });
  });

  /** Atomic claim; stale 'running' jobs (> 10 min) are reclaimable. */
  r.get('/cre/jobs/next', runner, async (_req, res) => {
    const [job] = await deps.db.query<{ id: string; campaign_id: string }>(
      `update cre_jobs set status = 'running', claimed_at = now()
       where id = (select id from cre_jobs
                   where status = 'queued' or (status = 'running' and claimed_at < now() - interval '10 minutes')
                   order by id limit 1 for update skip locked)
       returning id, campaign_id`);
    if (!job) return res.status(204).end();
    res.json({ jobId: job.id, campaignId: job.campaign_id });
  });
  r.post('/cre/jobs/:jobId/result', runner, async (req, res) => {
    const { ok, log } = z.object({ ok: z.boolean(), log: z.string().max(400_000) }).parse(req.body);
    await deps.db.query(`update cre_jobs set status = $2, log = $3, finished_at = now() where id = $1`,
      [String(req.params.jobId), ok ? 'done' : 'failed', log]);
    res.status(204).end();
  });
  return r;
}

export async function enqueueCreJob(deps: Deps, campaignId: string) {
  await deps.db.query(`insert into cre_jobs (id, campaign_id, status) values ($1, $2, 'queued') on conflict (campaign_id) do nothing`,
    [`job-${randomHex32().slice(0, 16)}`, campaignId]);
}
