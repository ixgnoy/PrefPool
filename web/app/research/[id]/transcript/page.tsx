'use client';
// Aggregated transcript for the buyer: every question, every option, its count and share among valid answers, plus why
// agents declined and which answers CRE didn't pay. Totals only (k ≥ minCohort); no individual respondent's answers.
import Link from 'next/link';
import { ArrowLeft } from 'pixelarticons/react/ArrowLeft';
import { use, useEffect, useState } from 'react';
import type { ResearchReport } from '@as/shared';
import { Button, Card, EmptyState, Mono, PageTitle } from '@/components/ui';
import { getCampaign, getResults, type CampaignView } from '@/lib/api';
import { categoryLabel } from '@/lib/policy';
import { useStore } from '@/lib/store';

export default function TranscriptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { session } = useStore();
  const [c, setC] = useState<CampaignView | null>(null);
  const [r, setR] = useState<ResearchReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!session) return;
    getCampaign(id).then(setC).catch((e: Error) => setError(e.message));
    getResults(id, session.sessionToken).then(setR).catch((e: Error) => setError(e.message));
  }, [id, session]);

  if (error) return <EmptyState pose="researcher" text={`No transcript: ${error}`} action={<Button href={`/research/${id}`}>Back to campaign</Button>} />;
  if (!c || !r) return <div className="h-96 animate-pulse rounded-2xl bg-surface" />;

  const n = r.validRespondents;
  const declined = c.abstained.reduce((s, a) => s + a.count, 0);
  const rows = c.questions.map((q) => ({ q, opts: Object.entries(r.results[q.id] ?? {}).map(([opt, frac]) => ({ opt, count: Math.round(frac * n), pct: Math.round(frac * 100) })) }));
  const csv = () => {
    const lines = ['question_id,question,option,count,share'];
    for (const { q, opts } of rows) for (const o of opts) lines.push([q.id, JSON.stringify(q.text), JSON.stringify(o.opt), o.count, (o.pct / 100).toFixed(2)].join(','));
    const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }));
    Object.assign(document.createElement('a'), { href: url, download: `${id}-transcript.csv` }).click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col gap-6">
      <Link href={`/research/${id}`} className="inline-flex items-center gap-1 text-[13px] font-semibold text-blue hover:underline"><ArrowLeft aria-hidden width={16} height={16} />{c.title}</Link>
      <PageTitle title="Transcript" sub={`${categoryLabel(c.category)} · ${n} valid answers (minimum ${r.minCohort}) · aggregated, no individual answers`}
        actions={<Button size="sm" variant="secondary" onClick={csv}>Download CSV</Button>} />
      <div className="flex flex-col gap-4">
        {rows.map(({ q, opts }, i) => (
          <Card key={q.id} className="flex flex-col gap-3 p-5">
            <div className="flex flex-wrap items-baseline gap-2">
              <Mono className="text-xs text-muted">Q{i + 1}</Mono>
              <h2 className="font-bold">{q.text}</h2>
              {q.category && <span className="rounded-full bg-warn-soft px-2 py-0.5 text-[11px] font-bold text-warn-ink">{categoryLabel(q.category)} question</span>}
            </div>
            <table className="w-full text-sm">
              <thead><tr className="text-left text-[11px] font-bold text-muted"><th className="py-1">Answer</th><th className="w-1/2 py-1" /><th className="py-1 text-right">Count</th><th className="py-1 text-right">Share</th></tr></thead>
              <tbody>
                {opts.map((o) => (
                  <tr key={o.opt} className="border-t border-subtle">
                    <td className="py-2 pr-3">{q.type === 'likert_5' ? `${o.opt}${o.opt === '1' ? ' · not at all' : o.opt === '5' ? ' · very' : ''}` : o.opt}</td>
                    <td className="py-2 pr-3"><span className="block h-2.5 overflow-hidden rounded-full bg-blue-soft"><span className="block h-full rounded-full bg-blue" style={{ width: `${o.pct}%` }} /></span></td>
                    <td className="py-2 text-right font-mono">{o.count}</td>
                    <td className="py-2 text-right font-mono">{o.pct}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        ))}
      </div>
      <Card className="flex flex-col gap-2 p-5">
        <h2 className="font-bold">Who didn&apos;t answer, and why</h2>
        <p className="text-[13px] text-muted">{declined} agents declined under their owners&apos; rules. Reasons are content-free; no profile data is shared.</p>
        <div className="flex flex-wrap gap-1.5">
          {c.abstained.map((a) => <span key={a.reason ?? 'none'} className="rounded-full bg-subtle px-2.5 py-1 text-xs font-bold">{a.reason ?? 'no reason'} · {a.count}</span>)}
          {Object.entries(c.report?.rejectionCounts ?? {}).filter(([, v]) => v).map(([k, v]) => <span key={k} className="rounded-full bg-danger-soft px-2.5 py-1 text-xs font-bold text-danger-ink">not paid: {k} · {v}</span>)}
        </div>
      </Card>
    </div>
  );
}
