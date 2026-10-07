// shared/src/pipeline.ts
import { settleAddressOk } from './settlePayload';
import { openSealed } from './envelope';
import { decodeCampaignAccount, type EscrowAccount } from './escrowAccount';
import { aggregate, answersValid, clientCounts, dispersion, hashResearch, signSettlement, sourceCounts } from './report';
import type { PersonhoodKind } from './personhood';
import type { Answers, Envelope, EnvelopeMeta, Question, ResearchReport, SettlementReport } from './types';

/** GET /api/cre/campaigns/:id/context (C5). */
export interface CreContext {
  campaignId: string;
  escrowTxRef: string;
  questions: Question[];
  deadlineMs: number;
  registered: string[];
  /** Registered agents' personhood (World ID or simulated), keyed by address. The nullifier identifies one human. */
  personhood?: Record<string, { kind: PersonhoodKind; nullifier: string }>;
  verifiedHumansOnly?: boolean;
  /** Registered agents' calibration validity (ms), keyed by address. */
  calibratedUntil?: Record<string, number>;
  calibratedAgentsOnly?: boolean;
}
export type ReceivedEnvelope = Envelope & { receivedAtMs: number };

export interface PipelineInput {
  context: CreContext;
  /** The escrow account from RPC; null when it doesn't exist (never funded, or already settled/refunded). */
  escrow: EscrowAccount | null;
  programId: string;
  envelopes: ReceivedEnvelope[];
  envelopeSecretKey: string;
  reportSecretKey: string;
  nowIso: string;
}
export interface PipelineOutput { settlement: SettlementReport; research: ResearchReport | null }

/**
 * The whole CRE aggregation, as a pure deterministic function (same input -> same bytes on every DON node).
 * Throws (no report) if the escrow is missing, spent, not at the script, or does not belong to this campaign.
 */
export function runPipeline(input: PipelineInput): PipelineOutput {
  const { context, escrow } = input;
  if (!escrow) throw new Error('escrow account not found (unfunded or already closed)');
  if (escrow.owner !== input.programId) throw new Error('escrow not owned by the escrow program');
  if (escrow.address !== context.escrowTxRef) throw new Error('escrow address differs from the campaign record');
  const datum = decodeCampaignAccount(escrow.data);
  if (datum.campaignId !== context.campaignId) throw new Error('escrow belongs to another campaign');
  const escrowed = datum.budgetLamports;

  const registered = new Set(context.registered);
  const seen = new Set<string>();
  const seenHumans = new Set<string>();
  const counts = { malformed: 0, duplicate: 0, ineligible: 0, late: 0 };
  const accepted: { address: string; answers: Answers; meta: EnvelopeMeta | null; kind: PersonhoodKind | null }[] = [];
  const ordered = [...input.envelopes].sort(
    (a, b) => a.receivedAtMs - b.receivedAtMs || (a.respondentAddress < b.respondentAddress ? -1 : 1),
  );
  for (const env of ordered) {
    if (env.receivedAtMs > datum.deadlineMs) { counts.late++; continue; }
    if (env.campaignId !== context.campaignId || !registered.has(env.respondentAddress) || !settleAddressOk(env.respondentAddress)) {
      counts.ineligible++; continue;
    }
    if (seen.has(env.respondentAddress)) { counts.duplicate++; continue; }
    seen.add(env.respondentAddress);
    const ph = context.personhood?.[env.respondentAddress];
    if (context.verifiedHumansOnly && !ph) { counts.ineligible++; continue; }
    if (ph) {
      if (seenHumans.has(ph.nullifier)) { counts.duplicate++; continue; } // same human through a second agent
      seenHumans.add(ph.nullifier);
    }
    if (context.calibratedAgentsOnly && !((context.calibratedUntil?.[env.respondentAddress] ?? 0) > datum.deadlineMs)) { counts.ineligible++; continue; }
    let answers: Answers;
    let meta: EnvelopeMeta | null;
    try {
      ({ answers, meta } = openSealed(input.envelopeSecretKey, env));
    } catch {
      counts.malformed++; continue;
    }
    if (!answersValid(context.questions, answers)) { counts.malformed++; continue; }
    if (accepted.length >= datum.maxResponses) { counts.ineligible++; continue; }
    accepted.push({ address: env.respondentAddress, answers, meta, kind: ph?.kind ?? null });
  }

  const cohortMet = accepted.length >= datum.minCohort;
  const winners = cohortMet ? accepted : [];
  const results = cohortMet ? aggregate(context.questions, winners.map((w) => w.answers)) : null;
  const research: ResearchReport | null = results
    ? {
        schemaVersion: 1, campaignId: context.campaignId, validRespondents: winners.length, minCohort: datum.minCohort,
        results,
        dispersion: dispersion(results),
        sources: sourceCounts(context.questions, winners.map((w) => w.meta)),
        clients: clientCounts(winners.map((w) => w.meta)),
        ...(context.personhood ? {
          verifiedHumans: winners.filter((w) => w.kind === 'world').length,
          simulatedHumans: winners.filter((w) => w.kind === 'simulated').length,
        } : {}),
        ...(context.calibratedUntil ? {
          calibratedAgents: winners.filter((w) => (context.calibratedUntil![w.address] ?? 0) > datum.deadlineMs).length,
        } : {}),
      }
    : null;
  const reward = datum.rewardLamports;
  const payoutTotal = reward * BigInt(winners.length);
  const settlement = signSettlement({
    schemaVersion: 1,
    campaignId: context.campaignId,
    escrowTxRef: context.escrowTxRef,
    escrowedLamports: escrowed.toString(),
    rewardPerResponseLamports: reward.toString(),
    acceptedCount: winners.length,
    payouts: winners.map((w) => ({ address: w.address, lamports: reward.toString() })),
    payoutTotalLamports: payoutTotal.toString(),
    refundAddress: datum.company,
    refundLamports: (escrowed - payoutTotal).toString(),
    rejectionCounts: counts,
    resultHash: hashResearch(research),
    timestamp: input.nowIso,
  }, input.reportSecretKey);
  return { settlement, research };
}
