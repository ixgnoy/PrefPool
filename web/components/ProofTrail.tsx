'use client';
// Proof trail: the same five phases as the campaign timeline, each with the public evidence for it (devnet tx hashes,
// escrow account, CRE report hash and Ed25519 signature, checked here against the CRE report key).
import { useEffect, useState, type ReactNode } from 'react';
import { verifySettlementReport } from '@as/shared';
import { AddressLink, Card, CopyButton, Mono, Pill, TxLink } from './ui';
import { getConfig, getTrace, type CampaignTrace } from '@/lib/api';
import { TIMELINE, fmtTime, short, solOf } from '@/lib/campaign';

const Row = ({ k, children }: { k: string; children: ReactNode }) => (
  <div className="grid gap-1 py-1.5 text-[13px] sm:grid-cols-[180px_1fr]"><dt className="text-muted">{k}</dt><dd className="min-w-0 break-all">{children}</dd></div>
);
const Hash = ({ v }: { v: string }) => <span className="inline-flex items-center gap-1"><Mono className="text-[12px]">{short(v, 16, 8)}</Mono><CopyButton text={v} /></span>;

export function ProofTrail({ campaignId, token }: { campaignId: string; token?: string }) {
  const [t, setT] = useState<CampaignTrace | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reportPk, setReportPk] = useState<string | null>(null);
  useEffect(() => {
    getTrace(campaignId, token).then(setT).catch((e: Error) => setError(e.message));
    getConfig().then((c) => setReportPk(c.reportPublicKey)).catch(() => {});
  }, [campaignId, token]);
  if (!t) return (
    <Card className="flex flex-col gap-2 p-5">
      <h2 className="font-bold">Proof trail</h2>
      {error ? <p className="text-sm text-danger-ink">Couldn&apos;t load the on-chain evidence: {error}</p>
        : <><p className="text-sm text-muted">Reading the transactions from Solana Devnet…</p><div className="h-40 animate-pulse rounded-xl bg-subtle" /></>}
    </Card>
  );

  const s = t.settlementReport;
  const sigErrors = s && reportPk ? verifySettlementReport(s, reportPk, { minCohort: t.spec.minCohort, maxResponses: t.spec.maxResponses }) : null;
  const when = (tx: { blockTime: number | null; slot: number | null } | null) =>
    tx ? `slot ${tx.slot ?? '?'}${tx.blockTime ? ` · ${fmtTime(tx.blockTime * 1000)}` : ''}` : null;
  const phases: { done: boolean; rows: ReactNode }[] = [
    { done: !!t.fundTx, rows: <>
      <Row k="Escrow account (PDA)">{t.escrowTxRef ? <AddressLink address={t.escrowTxRef} full /> : '—'}</Row>
      <Row k="Funding tx">{t.fundTx ? <><TxLink hash={t.fundTx.signature} full /> <span className="text-muted">({when(t.fundTx)})</span></> : '—'}</Row>
      <Row k="Budget">{solOf(BigInt(t.spec.rewardLamports) * BigInt(t.spec.maxResponses))} ({t.spec.maxResponses} × {solOf(t.spec.rewardLamports)})</Row>
    </> },
    { done: t.envelopes.count > 0, rows: <>
      <Row k="Sealed answers received">{t.envelopes.count}{t.envelopes.firstAtMs && t.envelopes.lastAtMs ? ` · ${fmtTime(t.envelopes.firstAtMs)}–${fmtTime(t.envelopes.lastAtMs)}` : ''}</Row>
      <Row k="Encryption">X25519 + XChaCha20-Poly1305 to the CRE envelope key; the platform never sees plaintext</Row>
      {t.envelopes.sample && <Row k="Sample envelope">epk <Mono className="text-[12px]">{short(t.envelopes.sample.epk, 10, 4)}</Mono> · {t.envelopes.sample.ciphertextBytes} B ciphertext</Row>}
    </> },
    { done: !!s, rows: s ? <>
      <Row k="Accepted / rejected">{s.acceptedCount} accepted · {Object.entries(s.rejectionCounts).map(([k, v]) => `${k} ${v}`).join(', ')}</Row>
      <Row k="Result hash">{<Hash v={s.resultHash} />}</Row>
      <Row k="Report hash">{<Hash v={s.reportHash} />}</Row>
      <Row k="CRE signature (Ed25519)">{<Hash v={s.signature} />}</Row>
      <Row k="CRE report key">{reportPk ? <Hash v={reportPk} /> : '—'}</Row>
      <Row k="Signature check">{sigErrors === null ? '—' : sigErrors.length === 0 ? <Pill tone="ok">verified ✓</Pill> : <Pill tone="danger">failed: {sigErrors.join(', ')}</Pill>}</Row>
      <Row k="Signed payout plan">{s.payouts.length} payees · {solOf(s.payoutTotalLamports)} total · {solOf(s.refundLamports)} refund to <AddressLink address={s.refundAddress} /></Row>
    </> : <Row k="Status">Not aggregated yet</Row> },
    { done: !!t.settlementTx, rows: t.settlementTx ? <>
      <Row k="Instructions">{t.settlementTx.instructions.map((i) => i.name || i.program).join(' → ')}</Row>
      <Row k="On-chain check">the escrow program requires the Ed25519 precompile over sha256(escrow, campaignId, reportHash, payees) by the CRE report key</Row>
      <Row k="Fee (relayer)">{t.settlementTx.fee ? solOf(t.settlementTx.fee) : '—'}</Row>
    </> : <Row k="Status">Not submitted yet</Row> },
    { done: t.state === 'SETTLED' || t.state === 'REFUNDED', rows: t.settlementTx ? <>
      <Row k={t.state === 'REFUNDED' ? 'Refund tx' : 'Settlement tx'}><TxLink hash={t.settlementTx.signature} full /> <span className="text-muted">({when(t.settlementTx)})</span></Row>
      <Row k="Result">{t.settlementTx.err ? <Pill tone="danger">failed</Pill> : <>success · escrow closed{s ? ` · ${s.payouts.length} agents paid, report hash ${short(s.reportHash, 8, 4)} in the Settled event` : ''}</>}</Row>
    </> : <Row k="Status">Not settled yet</Row> },
  ];

  return (
    <Card className="flex flex-col gap-3 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-bold">Proof trail</h2>
        <span className="text-xs text-muted">Solana Devnet · CRE simulation</span>
      </div>
      <ol className="flex flex-col">
        {phases.map((p, i) => (
          <li key={TIMELINE[i]} className="border-t border-line py-2 first:border-t-0">
            <div className="flex items-center gap-2 text-sm font-bold">
              <span className={p.done ? 'text-ok-ink' : 'text-muted'}>{p.done ? '✓' : '○'}</span>{i + 1}. {TIMELINE[i]}
            </div>
            <dl className="pl-6">{p.rows}</dl>
          </li>
        ))}
      </ol>
    </Card>
  );
}
