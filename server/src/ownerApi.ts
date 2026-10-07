// server/src/ownerApi.ts — endpoints for the redesigned web app (FRONTEND_PRD Appendix A):
// the seller's agent (status, guardrails, pause, activity), the buyer's campaign list and refund escape hatch,
// and the dev-view trace. Wallet-session auth; nothing here ever returns answers, tokens or private keys.
import { Router, type Request } from 'express';
import { ABSTAIN_REASONS, type SettlementReport } from '@as/shared';
import { z } from 'zod';
import { requireSession, type AuthedRequest } from './auth.js';
import { campaignView, getCampaign } from './campaigns.js';
import { HttpError, type Deps } from './deps.js';
import { hashToken } from './tokens.js';

const policySchema = z.object({
  allowedCategories: z.array(z.string()), blockedCategories: z.array(z.string()),
  minimumRewardSol: z.number().nonnegative(), dailyLimit: z.number().int().positive(),
  approvalMode: z.enum(['auto', 'approve_sensitive', 'approve_all']),
});
/** An agent counts as connected if it called the API or held the relay within this window. */
const CONNECTED_WINDOW_MS = 120_000;
/** Plugin and OpenClaw agents check in when they work (heartbeat, tool calls), not continuously. */
const IDLE_WINDOW_MS = 24 * 3_600_000;
export type Presence = 'online' | 'idle' | 'offline';
export const presenceOf = (lastSeenAt: number | null, now: number): Presence =>
  lastSeenAt === null ? 'offline' : now - lastSeenAt < CONNECTED_WINDOW_MS ? 'online' : now - lastSeenAt < IDLE_WINDOW_MS ? 'idle' : 'offline';
/** Refund window opens at refund_after (cluster clock); keep a minute's margin for clock drift. */
const REFUND_MARGIN_MS = 60_000;
const REFUNDABLE = ['FUNDED', 'ACTIVE', 'AGGREGATING', 'INSUFFICIENT_COHORT', 'SETTLEMENT_READY', 'SETTLEMENT_SUBMITTED', 'SETTLEMENT_FAILED'];
const DAY_MS = 86_400_000;

type AbstainBucket = 'blocked_category' | 'category_not_allowed' | 'reward_below_minimum' | 'daily_limit' | 'no_matching_profile' | 'unverified' | 'uncalibrated'
  | 'task_request' | 'credential_ask' | 'unknown_answer' | 'other';
/** Buckets the content-free reason strings evaluatePolicy produces (shared/src/policy.ts) and abstain_campaign's fixed reasons (plugin). */
const bucket = (reason: string | null): AbstainBucket =>
  reason?.startsWith('blocked category') ? 'blocked_category'
    : reason?.startsWith('category not allowed') ? 'category_not_allowed'
      : reason?.startsWith('reward') ? 'reward_below_minimum'
        : reason?.startsWith('daily limit') ? 'daily_limit' : reason?.startsWith('no matching profile') ? 'no_matching_profile'
          : reason?.startsWith('unverified') ? 'unverified' : reason?.startsWith('uncalibrated') ? 'uncalibrated'
            : reason === ABSTAIN_REASONS.task_request ? 'task_request' : reason === ABSTAIN_REASONS.credential_ask ? 'credential_ask'
              : reason === ABSTAIN_REASONS.unknown_answer ? 'unknown_answer' : 'other';

interface AgentRow {
  id: string; kind: string; address: string; policy: unknown; paused: boolean; last_seen_at: Date | string | null;
  personhood_kind: 'world' | 'simulated' | null; personhood_verified_at: Date | string | null; calibrated_ms: string | number | null;
}

/** What clients may see of an agent's personhood: never the nullifier. */
export const personhoodOf = (a: { personhood_kind: 'world' | 'simulated' | null; personhood_verified_at: Date | string | null }) =>
  a.personhood_kind ? { kind: a.personhood_kind, verifiedAt: a.personhood_verified_at ? new Date(a.personhood_verified_at).getTime() : null } : null;

/** Optional session: the trace shows buyer-only items when the caller is the campaign's buyer. */
async function sessionAddress(deps: Deps, req: Request): Promise<string | undefined> {
  const t = /^Bearer (\S+)$/.exec(req.header('authorization') ?? '')?.[1];
  if (!t) return undefined;
  const [s] = await deps.db.query<{ address: string }>(
    `select address from sessions where token_hash = $1 and expires_at > to_timestamp($2 / 1000.0)`, [hashToken(t), deps.now()]);
  return s?.address;
}

export function ownerRoutes(deps: Deps): Router {
  const r = Router();
  const myAgent = async (address: string) =>
    (await deps.db.query<AgentRow>(`select id, kind, address, policy, paused, last_seen_at, personhood_kind, personhood_verified_at,
      extract(epoch from calibrated_until) * 1000 as calibrated_ms from agents where address = $1`, [address]))[0];

  r.get('/agents/mine', requireSession(deps), async (req: AuthedRequest, res) => {
    const a = await myAgent(req.address!);
    if (!a) return res.json({ agent: null });
    const lastSeenAt = a.last_seen_at ? new Date(a.last_seen_at).getTime() : null;
    res.json({ agent: { agentId: a.id, kind: a.kind, address: a.address, policy: a.policy, paused: a.paused, lastSeenAt,
      connected: presenceOf(lastSeenAt, deps.now()) === 'online', status: presenceOf(lastSeenAt, deps.now()), personhood: personhoodOf(a),
      calibration: { calibratedUntil: a.calibrated_ms === null ? null : Math.round(Number(a.calibrated_ms)) } } });
  });

  r.put('/agents/mine', requireSession(deps), async (req: AuthedRequest, res) => {
    const body = z.object({ policy: policySchema.optional(), paused: z.boolean().optional() }).parse(req.body);
    const a = await myAgent(req.address!);
    if (!a) throw new HttpError(404, 'NO_AGENT', 'register your agent first');
    await deps.db.query(`update agents set policy = coalesce($2::jsonb, policy), paused = coalesce($3, paused) where id = $1`,
      [a.id, body.policy ? JSON.stringify(body.policy) : null, body.paused ?? null]);
    res.json({ ok: true });
  });

  r.get('/agents/mine/activity', requireSession(deps), async (req: AuthedRequest, res) => {
    const a = await myAgent(req.address!);
    if (!a) return res.json({ items: [], totals: null });
    const rows = await deps.db.query<{
      campaign_id: string; kind: 'answer' | 'abstain'; reason: string | null; created_at: Date | string;
      spec: { title: string; category: string; rewardLamports: string }; state: string; settlement_tx_hash: string | null;
      settlement: SettlementReport | null; settled_at: Date | string | null;
    }>(`select d.campaign_id, d.kind, d.reason, d.created_at, c.spec, c.state, c.settlement_tx_hash, r.settlement,
            case when c.state = 'SETTLED' then c.updated_at end as settled_at
          from agent_decisions d join campaigns c on c.id = d.campaign_id left join reports r on r.campaign_id = d.campaign_id
         where d.agent_id = $1 order by d.created_at desc`, [a.id]);

    const now = deps.now();
    const today = Math.floor(now / DAY_MS) * DAY_MS;
    const byDay = new Map<number, bigint>();
    const abstainReasons: Record<AbstainBucket, number> = { blocked_category: 0, category_not_allowed: 0, reward_below_minimum: 0, daily_limit: 0, no_matching_profile: 0, unverified: 0, uncalibrated: 0,
      task_request: 0, credential_ask: 0, unknown_answer: 0, other: 0 };
    let earned = 0n, pending = 0n, todayCount = 0;
    const cats = new Map<string, { category: string; seen: number; answered: number; earned: bigint }>();
    const items = rows.map((d) => {
      const decidedAt = new Date(d.created_at).getTime();
      const cat = cats.get(d.spec.category) ?? { category: d.spec.category, seen: 0, answered: 0, earned: 0n };
      cats.set(d.spec.category, cat);
      cat.seen++;
      if (d.kind === 'answer') cat.answered++;
      if (decidedAt >= today && d.kind === 'answer') todayCount++; // the policy's daily limit counts answers
      const base = { campaignId: d.campaign_id, title: d.spec.title, category: d.spec.category, decidedAt, kind: d.kind, reason: d.reason,
        rewardLamports: d.spec.rewardLamports, settlementTx: d.settlement_tx_hash };
      if (d.kind === 'abstain') { abstainReasons[bucket(d.reason)]++; return { ...base, outcome: 'abstained' as const }; }
      if (d.state === 'REFUNDED' || d.state === 'INSUFFICIENT_COHORT') {
        // REFUNDED with no report, or with accepted answers, means the buyer used the escape hatch before payout.
        const tooSmall = d.state === 'INSUFFICIENT_COHORT' || d.settlement?.acceptedCount === 0;
        return { ...base, outcome: 'not_paid' as const, notPaidReason: tooSmall ? 'cohort too small, budget refunded' : 'budget reclaimed by the buyer before payout' };
      }
      if (d.state !== 'SETTLED') { pending += BigInt(d.spec.rewardLamports); return { ...base, outcome: 'pending' as const }; }
      const payout = d.settlement?.payouts.find((p) => p.address === a.address);
      if (!payout) return { ...base, outcome: 'not_paid' as const, notPaidReason: 'not accepted by CRE' };
      earned += BigInt(payout.lamports);
      cat.earned += BigInt(payout.lamports);
      const day = Math.floor(new Date(d.settled_at ?? d.created_at).getTime() / DAY_MS) * DAY_MS;
      byDay.set(day, (byDay.get(day) ?? 0n) + BigInt(payout.lamports));
      return { ...base, outcome: 'paid' as const, payoutLamports: payout.lamports, paidAt: new Date(d.settled_at ?? d.created_at).getTime() };
    });
    const earningsByDay = Array.from({ length: 30 }, (_, i) => {
      const day = today - (29 - i) * DAY_MS;
      return { day, lamports: (byDay.get(day) ?? 0n).toString() };
    });
    const answered = rows.filter((d) => d.kind === 'answer').length;
    res.json({ items, totals: {
      earnedLamports: earned.toString(), pendingLamports: pending.toString(), seen: rows.length, answered, abstained: rows.length - answered,
      abstainReasons, todayCount, dailyLimit: (a.policy as { dailyLimit?: number } | null)?.dailyLimit ?? null, earningsByDay,
      byCategory: [...cats.values()].map((c) => ({ category: c.category, seen: c.seen, answered: c.answered, earnedLamports: c.earned.toString() })),
    } });
  });

  /** Encrypt to self: the public half of the key the owner's wallet signature derives (shared/transcript.ts). */
  r.put('/agents/mine/transcript-key', requireSession(deps), async (req: AuthedRequest, res) => {
    const { publicKey } = z.object({ publicKey: z.string().regex(/^[0-9a-f]{64}$/) }).parse(req.body);
    const a = await myAgent(req.address!);
    if (!a) throw new HttpError(404, 'NO_AGENT', 'register your agent first');
    // First key wins, atomically: a different key means a different wallet (or signing format), and copies already
    // sealed to the first key would become unreadable.
    const set = await deps.db.query(`update agents set transcript_pk = $2 where id = $1 and (transcript_pk is null or transcript_pk = $2) returning id`, [a.id, publicKey]);
    if (set.length === 0) throw new HttpError(409, 'KEY_MISMATCH', 'this wallet produces a different transcript key');
    res.json({ ok: true });
  });

  /** The owner's sealed copies with each campaign's questions; only the owner's browser can open them. */
  r.get('/agents/mine/answer-copies', requireSession(deps), async (req: AuthedRequest, res) => {
    const a = await myAgent(req.address!);
    if (!a) return res.json({ copies: [], transcriptPublicKey: null });
    const rows = await deps.db.query<{ campaign_id: string; envelope: unknown; received_at_ms: string | number; spec: { title: string; category: string; questions: unknown[] }; state: string }>(
      `select k.campaign_id, k.envelope, k.received_at_ms, c.spec, c.state from answer_copies k join campaigns c on c.id = k.campaign_id
        where k.agent_id = $1 order by k.received_at_ms desc`, [a.id]);
    const [row] = await deps.db.query<{ transcript_pk: string | null }>(`select transcript_pk from agents where id = $1`, [a.id]);
    res.json({ transcriptPublicKey: row?.transcript_pk ?? null, copies: rows.map((k) => ({ campaignId: k.campaign_id, title: k.spec.title, category: k.spec.category,
      questions: k.spec.questions, state: k.state, envelope: k.envelope, receivedAtMs: Number(k.received_at_ms) })) });
  });

  /** Buyer dashboard: aggregates over the signed-in buyer's campaigns. Totals and content-free reasons only. */
  r.get('/campaigns/analytics', requireSession(deps), async (req: AuthedRequest, res) => {
    const rows = await deps.db.query<{ id: string; state: string; spec: { category: string; rewardLamports: string; maxResponses: number }; settlement: SettlementReport | null; settled_at: Date | string | null }>(
      `select c.id, c.state, c.spec, r.settlement, case when c.state = 'SETTLED' then c.updated_at end as settled_at
         from campaigns c left join reports r on r.campaign_id = c.id
        where c.buyer_address = $1`, [req.address]);
    const FUNDED = new Set(['FUNDED', 'ACTIVE', 'AGGREGATING', 'INSUFFICIENT_COHORT', 'SETTLEMENT_READY', 'SETTLEMENT_SUBMITTED', 'SETTLEMENT_FAILED', 'SETTLED', 'REFUNDED']);
    const now = deps.now(), today = Math.floor(now / DAY_MS) * DAY_MS;
    const byState: Record<string, number> = {};
    const cats = new Map<string, { category: string; campaigns: number; acceptedAnswers: number; paid: bigint; locked: bigint }>();
    const byDay = new Map<number, bigint>();
    const rejections = { malformed: 0, duplicate: 0, ineligible: 0, late: 0 };
    let locked = 0n, inEscrow = 0n, paid = 0n, refunded = 0n, accepted = 0, funded = 0;
    for (const c of rows) {
      byState[c.state] = (byState[c.state] ?? 0) + 1;
      const cat = cats.get(c.spec.category) ?? { category: c.spec.category, campaigns: 0, acceptedAnswers: 0, paid: 0n, locked: 0n };
      cats.set(c.spec.category, cat);
      cat.campaigns++;
      if (!FUNDED.has(c.state)) continue;
      funded++;
      const budget = BigInt(c.spec.rewardLamports) * BigInt(c.spec.maxResponses);
      locked += budget; cat.locked += budget;
      if (c.state !== 'SETTLED' && c.state !== 'REFUNDED') inEscrow += budget; // settle/refund closes the escrow
      if (c.state === 'SETTLED' && c.settlement) {
        const p = BigInt(c.settlement.payoutTotalLamports ?? 0);
        paid += p; cat.paid += p; refunded += BigInt(c.settlement.refundLamports ?? 0);
        accepted += c.settlement.acceptedCount; cat.acceptedAnswers += c.settlement.acceptedCount;
        for (const k of Object.keys(rejections) as (keyof typeof rejections)[]) rejections[k] += c.settlement.rejectionCounts?.[k] ?? 0;
        const day = Math.floor(new Date(c.settled_at ?? now).getTime() / DAY_MS) * DAY_MS;
        byDay.set(day, (byDay.get(day) ?? 0n) + p);
      } else if (c.state === 'REFUNDED') refunded += budget;
    }
    const ids = rows.map((c) => c.id);
    const decisions = ids.length ? await deps.db.query<{ kind: string; reason: string | null; n: string | number }>(
      `select kind, reason, count(*) as n from agent_decisions where campaign_id = any($1::text[]) group by kind, reason`, [ids]) : [];
    const declines: Record<string, number> = {};
    for (const d of decisions) if (d.kind === 'abstain') declines[bucket(d.reason)] = (declines[bucket(d.reason)] ?? 0) + Number(d.n);
    res.json({
      campaigns: rows.length, funded, byState,
      budgetLockedLamports: locked.toString(), inEscrowLamports: inEscrow.toString(), paidOutLamports: paid.toString(), refundedLamports: refunded.toString(),
      acceptedAnswers: accepted, costPerAnswerLamports: accepted ? (paid / BigInt(accepted)).toString() : null,
      answered: decisions.filter((d) => d.kind === 'answer').reduce((n, d) => n + Number(d.n), 0),
      abstained: decisions.filter((d) => d.kind === 'abstain').reduce((n, d) => n + Number(d.n), 0),
      rejections, declines,
      topDeclineReasons: decisions.filter((d) => d.kind === 'abstain' && d.reason).map((d) => ({ reason: d.reason!, count: Number(d.n) }))
        .sort((x, y) => y.count - x.count).slice(0, 8),
      byCategory: [...cats.values()].map((c) => ({ category: c.category, campaigns: c.campaigns, acceptedAnswers: c.acceptedAnswers, paidLamports: c.paid.toString(), lockedLamports: c.locked.toString() })),
      payoutsByDay: Array.from({ length: 30 }, (_, i) => { const day = today - (29 - i) * DAY_MS; return { day, lamports: (byDay.get(day) ?? 0n).toString() }; }),
    });
  });

  /** `?mine=1`: the signed-in buyer's campaigns. `?latest=1`: the newest live or settled campaign (landing page). */
  r.get('/campaigns', async (req, res) => {
    let rows: { id: string }[];
    if (req.query.latest) {
      rows = await deps.db.query(`select id from campaigns where state in ('ACTIVE','AGGREGATING','SETTLEMENT_READY','SETTLEMENT_SUBMITTED','SETTLED')
                                    order by created_at desc limit 1`);
    } else if (req.query.mine) {
      const address = await sessionAddress(deps, req);
      if (!address) throw new HttpError(401, 'AUTH', 'invalid session');
      rows = await deps.db.query(`select id from campaigns where buyer_address = $1 order by created_at desc`, [address]);
    } else throw new HttpError(400, 'QUERY', 'use ?mine=1 or ?latest=1');
    res.json({ campaigns: await Promise.all(rows.map((c) => campaignView(deps, c.id))) });
  });

  const refundable = async (req: AuthedRequest) => {
    const c = await getCampaign(deps, String(req.params.id));
    if (c.buyer_address !== req.address) throw new HttpError(403, 'NOT_BUYER', 'only the campaign creator can reclaim its budget');
    if (!REFUNDABLE.includes(c.state) || !c.escrow_tx_ref) throw new HttpError(409, 'STATE', `nothing to reclaim in state ${c.state}`);
    if (deps.now() < Number(c.refund_after_ms) + REFUND_MARGIN_MS) throw new HttpError(409, 'REFUND_NOT_OPEN', 'the refund window opens 24 h after the deadline');
    return c;
  };
  r.post('/campaigns/:id/refund/build', requireSession(deps), async (req: AuthedRequest, res) => {
    const c = await refundable(req);
    const { unsignedTx, lastValidBlockHeight } = await deps.chain.buildRefundTx(c.id, c.buyer_address);
    res.json({ unsignedTx, lastValidBlockHeight });
  });
  r.post('/campaigns/:id/refund/submit', requireSession(deps), async (req: AuthedRequest, res) => {
    const c = await refundable(req);
    const { signedTx } = z.object({ signedTx: z.string().min(1).max(4000) }).parse(req.body);
    // Only the buyer's `refund` of this campaign's escrow counts (the program only lets the company refund, after
    // refund_after). Settle can't run then (its window ends at refund_after), so nothing races the refund.
    if (!deps.chain.isRefundTx(signedTx, c.id, c.buyer_address)) throw new HttpError(422, 'NOT_A_REFUND', 'this transaction is not your refund of the campaign escrow');
    const txHash = await deps.chain.submitSignedTx(signedTx).catch((e: unknown) => {
      throw new HttpError(422, 'SUBMIT_FAILED', `the network refused the transaction: ${String((e as Error)?.message ?? e).slice(0, 300)}`);
    });
    await deps.db.query(`update campaigns set state = 'REFUNDED', settlement_tx_hash = $2, updated_at = now() where id = $1 and state = any($3::text[])`,
      [c.id, txHash, REFUNDABLE]);
    res.json({ txHash });
  });

  /** Dev view (FRONTEND_PRD §5.10): public on-chain facts and non-sensitive platform data, never answers or tokens. */
  r.get('/campaigns/:id/trace', async (req, res) => {
    const c = await getCampaign(deps, String(req.params.id));
    const [isBuyer, [times], envs, [job], [report]] = await Promise.all([
      sessionAddress(deps, req).then((a) => a === c.buyer_address),
      deps.db.query<{ created_at: Date | string; updated_at: Date | string }>(`select created_at, updated_at from campaigns where id = $1`, [c.id]),
      deps.db.query<{ envelope: { epk: string; n: string; ct: string }; received_at_ms: string | number }>(
        `select envelope, received_at_ms from envelopes where campaign_id = $1 order by received_at_ms`, [c.id]),
      deps.db.query<{ id: string; status: string; log: string | null }>(`select id, status, log from cre_jobs where campaign_id = $1`, [c.id]),
      deps.db.query<{ settlement: SettlementReport; research: unknown }>(`select settlement, research from reports where campaign_id = $1`, [c.id]),
    ]);
    const describe = async (sig: string | null) => (sig ? deps.chain.describeTx(sig).catch(() => null) : null);
    const ms = (d: Date | string) => new Date(d).getTime();
    // Three devnet RPC round-trips; in parallel, not one after another.
    const [escrow, fundTx, settlementTx] = await Promise.all([
      c.escrow_tx_ref ? deps.chain.fetchEscrow(c.id).catch(() => null) : null, describe(c.fund_tx_hash), describe(c.settlement_tx_hash)]);

    res.json({
      campaignId: c.id, state: c.state, createdAt: ms(times!.created_at), updatedAt: ms(times!.updated_at),
      spec: c.spec, rejectReasons: c.reject_reasons ?? [], deadlineMs: Number(c.deadline_ms), refundAfterMs: Number(c.refund_after_ms),
      escrowTxRef: c.escrow_tx_ref, buyerAddress: c.buyer_address,
      // The escrow PDA as RPC has it now; null before funding confirms and after settle/refund closes it.
      escrow,
      envelopes: { count: envs.length, firstAtMs: envs[0] ? Number(envs[0].received_at_ms) : null, lastAtMs: envs.at(-1) ? Number(envs.at(-1)!.received_at_ms) : null,
        sample: envs[0] ? { epk: envs[0].envelope.epk, n: envs[0].envelope.n, ciphertextBytes: envs[0].envelope.ct.length / 2 } : null },
      creJob: job ? { id: job.id, status: job.status, log: (job.log ?? '').slice(-20_000) } : null,
      settlementReport: report?.settlement ?? null,
      researchReport: isBuyer ? (report?.research ?? null) : null,
      fundTx, settlementTx,
    });
  });

  return r;
}
