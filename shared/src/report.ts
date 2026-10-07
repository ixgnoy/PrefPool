import { ed25519 } from '@noble/curves/ed25519.js';
import { bytesToHex, hexToBytes, jcs, sha256Hex } from './crypto';
import { signSettlePayload, verifySettlePayload } from './settlePayload';
import { ANSWER_SOURCES, type AnswerSource, type Answers, type EnvelopeMeta, type Question, type ResearchReport, type SettlementReport } from './types';

export type UnsignedSettlement = Omit<SettlementReport, 'reportHash' | 'signature' | 'settleSignature'>;

export function hashResearch(research: ResearchReport | null): string {
  return sha256Hex(research ? jcs(research) : '');
}

export function hashSettlement(report: UnsignedSettlement | SettlementReport): string {
  const { reportHash: _h, signature: _s, settleSignature: _o, ...rest } = report as SettlementReport;
  return sha256Hex(jcs(rest));
}

export function signSettlement(report: UnsignedSettlement, skHex: string): SettlementReport {
  const reportHash = hashSettlement(report);
  const signature = bytesToHex(ed25519.sign(hexToBytes(reportHash), hexToBytes(skHex)));
  // Second signature, over exactly what the escrow validator rebuilds on-chain (payees, escrow input, report hash).
  const settleSignature = signSettlePayload({ ...report, reportHash }, skHex);
  return { ...report, reportHash, signature, settleSignature };
}

/** Returns a list of violations; empty means the report is internally consistent and correctly signed. */
export function verifySettlementReport(
  r: SettlementReport,
  pkHex: string,
  expect: { minCohort: number; maxResponses: number },
): string[] {
  const errs: string[] = [];
  if (r.schemaVersion !== 1) errs.push('schemaVersion');
  if (hashSettlement(r) !== r.reportHash) errs.push('reportHash mismatch');
  else if (!ed25519.verify(hexToBytes(r.signature), hexToBytes(r.reportHash), hexToBytes(pkHex))) errs.push('bad signature');
  if (!verifySettlePayload(r, r.settleSignature ?? '', pkHex)) errs.push('bad settle signature');
  const n = r.acceptedCount;
  if (r.payouts.length !== n) errs.push('payouts.length != acceptedCount');
  if (!(n === 0 || (n >= expect.minCohort && n <= expect.maxResponses))) errs.push('acceptedCount out of range');
  const reward = BigInt(r.rewardPerResponseLamports);
  if (r.payouts.some((p) => BigInt(p.lamports) !== reward)) errs.push('payout amount != reward');
  if (new Set(r.payouts.map((p) => p.address)).size !== r.payouts.length) errs.push('duplicate payout address');
  const sum = r.payouts.reduce((a, p) => a + BigInt(p.lamports), 0n);
  if (sum !== BigInt(r.payoutTotalLamports) || sum !== BigInt(n) * reward) errs.push('payout total mismatch');
  if (sum + BigInt(r.refundLamports) !== BigInt(r.escrowedLamports)) errs.push('payouts + refund != escrow');
  if (BigInt(r.refundLamports) < 0n) errs.push('negative refund');
  return errs;
}

/** Share per option, rounded to 4 decimals. Only called when validRespondents >= minCohort. */
export function aggregate(questions: Question[], answers: Answers[]): ResearchReport['results'] {
  const results: ResearchReport['results'] = {};
  for (const q of questions) {
    const labels = q.type === 'likert_5' ? ['1', '2', '3', '4', '5'] : (q.options ?? []);
    const counts = new Map(labels.map((l) => [l, 0]));
    for (const a of answers) {
      const v = a[q.id];
      const label = q.type === 'likert_5' ? String(v) : labels[v as number];
      if (label !== undefined && counts.has(label)) counts.set(label, counts.get(label)! + 1);
    }
    results[q.id] = Object.fromEntries(
      labels.map((l) => [l, answers.length ? Math.round((counts.get(l)! / answers.length) * 10_000) / 10_000 : 0]),
    );
  }
  return results;
}

/** True when the answers object matches the questionnaire exactly (all questions, valid values, no extras). */
export function answersValid(questions: Question[], a: Answers): boolean {
  if (typeof a !== 'object' || a === null) return false;
  if (Object.keys(a).length !== questions.length) return false;
  return questions.every((q) => {
    const v = a[q.id];
    if (!Number.isInteger(v)) return false;
    return q.type === 'likert_5' ? v! >= 1 && v! <= 5 : v! >= 0 && v! < (q.options?.length ?? 0);
  });
}

/** Per question, how many accepted answers carried each source tag. v1 envelopes (no meta) count as unknown. */
export function sourceCounts(questions: Question[], metas: (EnvelopeMeta | null)[]): Record<string, Record<AnswerSource | 'unknown', number>> {
  const out: Record<string, Record<AnswerSource | 'unknown', number>> = {};
  for (const q of questions) {
    const row: Record<AnswerSource | 'unknown', number> = { checked: 0, owner_told: 0, inferred: 0, unknown: 0 };
    for (const m of metas) {
      const s = m && Object.prototype.hasOwnProperty.call(m.sources, q.id) ? m.sources[q.id] : undefined;
      row[s && (ANSWER_SOURCES as readonly string[]).includes(s) ? s : 'unknown']++;
    }
    out[q.id] = row;
  }
  return out;
}

export const MIN_CLIENT_BUCKET = 3;
/**
 * Accepted answers per client ("name" or "name (modelId)"; v1 envelopes are "unknown"). Buckets under MIN_CLIENT_BUCKET
 * fold into "other" so a rare model cannot single out one agent. Keys come out sorted, so the report bytes do not depend
 * on envelope order.
 */
export function clientCounts(metas: (EnvelopeMeta | null)[]): Record<string, number> {
  const raw = new Map<string, number>();
  for (const m of metas) {
    const k = m ? `${m.client.name}${m.client.modelId ? ` (${m.client.modelId})` : ''}` : 'unknown';
    raw.set(k, (raw.get(k) ?? 0) + 1);
  }
  const kept: [string, number][] = [];
  let other = 0;
  for (const [k, n] of [...raw].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    if (n >= MIN_CLIENT_BUCKET && k !== 'other') kept.push([k, n]); else other += n;
  }
  if (other > 0) kept.push(['other', other]);
  kept.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  // fromEntries defines own properties, so a client named "__proto__" stays a plain key.
  return Object.fromEntries(kept);
}
