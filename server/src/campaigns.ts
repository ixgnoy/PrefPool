// server/src/campaigns.ts
import { createHash } from 'node:crypto';
import { Router } from 'express';
import { Transaction } from '@solana/web3.js';
import { checkFundingTx, submitErrorMessage } from '@as/chain';
import { campaignEscrowAddress, randomHex32, screenCampaign, screenWarnings, type CampaignDatumFields, type CampaignSpec } from '@as/shared';
import { z } from 'zod';
import { requireSession, type AuthedRequest } from './auth.js';
import { HttpError, type Deps } from './deps.js';
import { hashToken, newToken } from './tokens.js';
import type { CampaignRow } from './views.js';

const GRACE_MS = 86_400_000; // settle window: deadline .. deadline + 24 h, then the company may refund
/** A buyer who keeps probing the screening waits: at most this many rejected drafts per rolling window. */
const REJECT_LIMIT = 10;
const REJECT_WINDOW_MS = 86_400_000;

const questionSchema = z.object({
  id: z.string().regex(/^q[1-9]$/),
  type: z.enum(['single_choice', 'likert_5']),
  text: z.string().min(3).max(300),
  options: z.array(z.string().min(1).max(80)).optional(),
  category: z.string().max(40).optional(),
});
export const specSchema: z.ZodType<CampaignSpec> = z.object({
  title: z.string().min(3).max(120),
  category: z.string().min(2).max(40),
  questions: z.array(questionSchema).min(1).max(5),
  audience: z.object({ country: z.array(z.string()).optional(), ageBand: z.array(z.string()).optional(), occupationGroup: z.array(z.string()).optional() }),
  rewardLamports: z.string().regex(/^\d+$/),
  maxResponses: z.number().int(),
  minCohort: z.number().int(),
  deadlineMs: z.number().int(),
  verifiedHumansOnly: z.boolean().optional(),
  calibratedAgentsOnly: z.boolean().optional(),
});

export async function getCampaign(deps: Deps, id: string): Promise<CampaignRow> {
  const [c] = await deps.db.query<CampaignRow>(`select * from campaigns where id = $1`, [id]);
  if (!c) throw new HttpError(404, 'NOT_FOUND', 'campaign not found');
  return c;
}

export const budgetOf = (c: CampaignRow) => BigInt(c.spec.rewardLamports) * BigInt(c.spec.maxResponses);
/** The escrow account names CRE's report key: only payouts CRE signed can settle it (signed settlement). */
export function datumFor(c: CampaignRow, reportPk: string): CampaignDatumFields {
  return {
    campaignId: c.id, company: c.buyer_address, reportPk,
    rewardLamports: BigInt(c.spec.rewardLamports), budgetLamports: budgetOf(c), maxResponses: c.spec.maxResponses, minCohort: c.spec.minCohort,
    deadlineMs: Number(c.deadline_ms), refundAfterMs: Number(c.refund_after_ms),
  };
}

export async function setState(deps: Deps, id: string, state: string, extra: Record<string, unknown> = {}) {
  const cols = Object.keys(extra);
  const sets = cols.map((k, i) => `${k} = $${i + 3}`).join(', ');
  await deps.db.query(`update campaigns set state = $2, updated_at = now()${sets ? ', ' + sets : ''} where id = $1`,
    [id, state, ...cols.map((k) => extra[k])]);
}

/**
 * Screen and store a campaign for `buyerAddress` (its creator: the escrow's company, refund owner and the only one who
 * can view results). The access token (buying the report over x402) is returned once and only its hash is stored.
 */
export async function createCampaign(deps: Deps, spec: CampaignSpec, buyerAddress: string) {
  const now = deps.now();
  const [{ n } = { n: 0 }] = await deps.db.query<{ n: number | string }>(
    `select count(*) as n from campaigns where buyer_address = $1 and state = 'REJECTED' and created_at > to_timestamp($2 / 1000.0)`,
    [buyerAddress, now - REJECT_WINDOW_MS]);
  if (Number(n) >= REJECT_LIMIT) {
    throw new HttpError(429, 'TOO_MANY_REJECTED', `${REJECT_LIMIT} rejected drafts in 24 hours; fix the questions and try again tomorrow`);
  }
  const id = randomHex32();
  const reasons = screenCampaign(spec, now);
  const warnings = screenWarnings(spec);
  const accessToken = newToken();
  const state = reasons.length ? 'REJECTED' : 'AWAITING_FUNDING';
  await deps.db.query(
    `insert into campaigns (id, spec, state, buyer_address, buyer_pkh, buyer_stake, access_token_hash, reject_reasons, deadline_ms, refund_after_ms, lint_warnings, created_at)
     values ($1, $2::jsonb, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11::jsonb, to_timestamp($12 / 1000.0))`,
    [id, JSON.stringify(spec), state, buyerAddress, buyerAddress, null, hashToken(accessToken), // buyer_pkh/buyer_stake: legacy columns
      JSON.stringify(reasons), spec.deadlineMs, spec.deadlineMs + GRACE_MS, JSON.stringify(warnings), now], // created_at on the server clock: the throttle window uses it
  );
  return { id, state, reasons, warnings, accessToken };
}

export function campaignRoutes(deps: Deps): Router {
  const r = Router();
  r.post('/campaigns', requireSession(deps), async (req: AuthedRequest, res) => {
    const spec = specSchema.parse(req.body);
    const { id, state, reasons, warnings, accessToken } = await createCampaign(deps, spec, req.address!);
    if (reasons.length) return res.status(422).json({ campaignId: id, state, reasons });
    res.status(201).json({ campaignId: id, state, accessToken, warnings });
  });

  const fundable = async (req: AuthedRequest) => {
    const c = await getCampaign(deps, String(req.params.id));
    if (c.buyer_address !== req.address) throw new HttpError(403, 'NOT_BUYER', 'only the campaign creator can fund it');
    if (!['AWAITING_FUNDING', 'FUNDING_FAILED'].includes(c.state)) throw new HttpError(409, 'STATE', `cannot fund in state ${c.state}`);
    return c;
  };
  /** Unsigned `fund` tx for the buyer's wallet (fee payer and company = the session address). */
  r.post('/campaigns/:id/fund/build', requireSession(deps), async (req: AuthedRequest, res) => {
    const c = await fundable(req);
    const { unsignedTx, lastValidBlockHeight } = await deps.chain.buildFundTx(datumFor(c, deps.config.reportPublicKey));
    res.json({ unsignedTx, budgetLamports: budgetOf(c).toString(), escrowAddress: campaignEscrowAddress(deps.chain.programId, c.id), lastValidBlockHeight });
  });

  /** The wallet-signed fund tx: broadcast only if it does exactly what fund/build issued (checkFundingTx). */
  r.post('/campaigns/:id/fund/submit', requireSession(deps), async (req: AuthedRequest, res) => {
    const c = await fundable(req);
    const { signedTx } = z.object({ signedTx: z.string().min(1).max(4000) }).parse(req.body);
    const check = checkFundingTx(signedTx, { programId: deps.chain.programId, datum: datumFor(c, deps.config.reportPublicKey) });
    if (!check.ok) throw new HttpError(422, check.reason, `funding transaction refused: ${check.reason}`);
    const txHash = await deps.chain.submitSignedTx(signedTx).catch((e: unknown) => {
      throw new HttpError(422, 'SUBMIT_FAILED', submitErrorMessage(e));
    });
    // pending_fund_tx keeps the tx's blockhash: once it expires without the tx landing, funding failed (lifecycle).
    await setState(deps, c.id, 'FUNDING_SUBMITTED', { fund_tx_hash: txHash, pending_fund_tx: Transaction.from(Buffer.from(signedTx, 'base64')).recentBlockhash, last_error: null });
    res.json({ txHash });
  });

  /** The signed-in buyer sees their own results in the dashboard; agents buy the same report over x402 (USDC). */
  r.get('/campaigns/:id/results', requireSession(deps), async (req: AuthedRequest, res) => {
    const c = await getCampaign(deps, String(req.params.id));
    if (c.buyer_address !== req.address) throw new HttpError(403, 'NOT_BUYER', 'only the campaign creator can view results here');
    if (c.state !== 'SETTLED') throw new HttpError(409, c.state === 'REFUNDED' ? 'NO_REPORT' : 'NOT_SETTLED', `campaign is ${c.state}`);
    const [r] = await deps.db.query<{ research: unknown }>(`select research from reports where campaign_id = $1`, [c.id]);
    res.json({ ...(r!.research as object), settlementTx: c.settlement_tx_hash });
  });
  r.get('/campaigns/:id', async (req, res) => {
    res.json(await campaignView(deps, String(req.params.id)));
  });
  return r;
}

/** Public campaign view: states, counts, reasons, tx links. Never answers or envelopes. */
export async function campaignView(deps: Deps, id: string) {
  // Independent queries in parallel: Supabase is a ~400 ms round-trip away, so sequential reads made this view take ~5 s.
  const [c, decisions, [{ n: envelopeCount } = { n: 0 }], [report], [job], tiles, [{ n: networkSize } = { n: 0 }]] = await Promise.all([
    getCampaign(deps, id),
    deps.db.query<{ kind: string; reason: string | null; n: number | string }>(
      `select kind, reason, count(*) as n from agent_decisions where campaign_id = $1 group by kind, reason`, [id]),
    deps.db.query<{ n: number | string }>(`select count(*) as n from envelopes where campaign_id = $1`, [id]),
    deps.db.query<{
      settlement: { acceptedCount: number; rejectionCounts: unknown; reportHash: string };
      research: { verifiedHumans?: number; simulatedHumans?: number } | null;
    }>(`select settlement, research from reports where campaign_id = $1`, [id]),
    deps.db.query<{ status: string; log: string | null }>(`select status, log from cre_jobs where campaign_id = $1`, [id]),
    // Aquarium tiles: one per decision, under a per-campaign pseudonym (not linkable across campaigns), never an answer.
    deps.db.query<{ agent_id: string; kind: 'answer' | 'abstain'; reason: string | null; agent_kind: string; personhood_kind: 'world' | 'simulated' | null }>(
      `select d.agent_id, d.kind, d.reason, a.kind as agent_kind, a.personhood_kind from agent_decisions d join agents a on a.id = d.agent_id
        where d.campaign_id = $1 order by d.created_at, d.agent_id`, [id]),
    deps.db.query<{ n: number | string }>(`select count(*) as n from agents`),
  ]);
  return {
    campaignId: c.id, state: c.state, title: c.spec.title, category: c.spec.category, questions: c.spec.questions,
    rewardLamports: c.spec.rewardLamports, maxResponses: c.spec.maxResponses, minCohort: c.spec.minCohort,
    deadlineMs: Number(c.deadline_ms), refundAfterMs: Number(c.refund_after_ms), rejectReasons: c.reject_reasons ?? [],
    answered: decisions.filter((d) => d.kind === 'answer').reduce((s, d) => s + Number(d.n), 0),
    abstained: decisions.filter((d) => d.kind === 'abstain').map((d) => ({ reason: d.reason, count: Number(d.n) })),
    envelopes: Number(envelopeCount),
    fundTxHash: c.fund_tx_hash, escrowTxRef: c.escrow_tx_ref, settlementTxHash: c.settlement_tx_hash, lastError: c.last_error,
    report: report ? { acceptedCount: report.settlement.acceptedCount, rejectionCounts: report.settlement.rejectionCounts,
      reportHash: report.settlement.reportHash } : null,
    cre: job ? { status: job.status, log: (job.log ?? '').slice(-20_000) } : null,
    agents: tiles.map((t) => ({ tag: `agt_${createHash('sha256').update(`${id}:${t.agent_id}`).digest('hex').slice(0, 6)}`, // 24 bits: collisions in a 30-agent cohort ~1 in 30k
      kind: t.kind, reason: t.reason, live: t.agent_kind === 'live' || t.agent_kind === 'plugin', personhood: t.personhood_kind })),
    networkSize: Number(networkSize),
    verifiedHumansOnly: c.spec.verifiedHumansOnly === true,
    calibratedAgentsOnly: c.spec.calibratedAgentsOnly === true,
    humans: report?.research?.verifiedHumans !== undefined
      ? { world: report.research.verifiedHumans, simulated: report.research.simulatedHumans ?? 0 } : null,
  };
}
