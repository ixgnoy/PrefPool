'use client';
// Buyer analytics: aggregates over all the signed-in buyer's campaigns (GET /api/campaigns/analytics).
// Totals and content-free reasons only; individual answers never reach the buyer.
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Card, EmptyState, Button, PageTitle, StatePill, cx } from '@/components/ui';
import { Fin } from '@/components/Fin';
import { getBuyerAnalytics, listMyCampaigns, type BuyerAnalytics, type CampaignView } from '@/lib/api';
import { REASON_LABEL, categoryLabel, type AbstainReason } from '@/lib/policy';
import { useStore } from '@/lib/store';

import { fmtSol, lamportsToSol } from '@/lib/campaign';

const amt = (lamports: string | number | null | undefined) => fmtSol(lamportsToSol(lamports));

export default function BuyerAnalyticsPage() {
  const { session } = useStore();
  const [a, setA] = useState<BuyerAnalytics | null>(null);
  const [list, setList] = useState<CampaignView[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!session) return;
    getBuyerAnalytics(session.sessionToken).then(setA).catch((e: Error) => setError(e.message));
    listMyCampaigns(session.sessionToken).then(setList).catch(() => {});
  }, [session]);

  if (error) return <EmptyState pose="researcher" text={error} />;
  if (!a) return <div className="h-96 animate-pulse rounded-2xl bg-surface" />;
  if (a.campaigns === 0) return <EmptyState pose="researcher" text="No campaigns yet, so nothing to analyse." action={<Button href="/research/new">New campaign</Button>} />;

  const days = a.payoutsByDay.map((d) => lamportsToSol(d.lamports));
  const max = Math.max(...days, 0.0001);
  const declines = (Object.entries(a.declines) as [AbstainReason, number][]).filter(([, n]) => n > 0).sort((x, y) => y[1] - x[1]);
  const declineMax = Math.max(...declines.map(([, n]) => n), 1);
  const decided = a.answered + a.abstained;
  const notPaid = (Object.entries(a.rejections) as [string, number][]).filter(([, n]) => n > 0);

  return (
    <div className="flex flex-col gap-5">
      <PageTitle title="Analytics" sub={<><span className="font-mono">{a.campaigns}</span> campaigns, <span className="font-mono">{a.funded}</span> funded. Totals only: individual answers never reach you.</>} />

      {/* 1. Money hero: the one chunky card on this screen. */}
      <section className="chunky grid items-center gap-6 rounded-[20px] bg-surface p-5 sm:grid-cols-[auto_minmax(0,1fr)] sm:p-6">
        <div className="grid size-[104px] place-items-center rounded-2xl bg-tank"><Fin pose="researcher" label="" /></div>
        <div className="flex flex-col gap-1.5">
          <div className="flex items-baseline gap-2"><span className="font-mono text-5xl leading-none">{amt(a.paidOutLamports)}</span><span className="font-semibold">SOL paid to agents</span></div>
          <p className="text-sm text-muted">
            for <span className="font-mono text-ink">{a.acceptedAnswers}</span> valid answers
            {a.costPerAnswerLamports && <>, <span className="font-mono text-ink">{amt(a.costPerAnswerLamports)}</span> SOL each</>}
            {' · '}<span className="font-mono text-ink">{amt(a.inEscrowLamports)}</span> SOL still in escrow
            {' · '}<span className="font-mono text-ink">{amt(a.refundedLamports)}</span> SOL refunded to you
          </p>
          {notPaid.length > 0 && (
            <p className="text-[13px] text-muted">Not paid after the privacy checks: {notPaid.map(([k, n], i) => <span key={k}>{i > 0 && ', '}{k} <span className="font-mono text-ink">{n}</span></span>)}.</p>
          )}
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        {/* 2. Payouts over time. */}
        <Card className="flex flex-col gap-3 p-5">
          <h2 className="font-semibold">Payouts, last 30 days</h2>
          <div className="flex h-44 items-end gap-[3px] border-b-2 border-line" role="img" aria-label="Bar chart of SOL paid out per day over the last 30 days">
            {days.map((v, i) => <div key={i} title={`${fmtSol(v)} SOL`} className={cx('min-h-[4px] flex-1', v ? 'bg-blue' : 'bg-blue/20')} style={{ height: `${(v / max) * 100}%` }} />)}
          </div>
          <div className="flex justify-between text-xs text-muted"><span>30 days ago</span><span>Today</span></div>
        </Card>

        {/* 3. Why agents skipped: the main lever for a wider next campaign. */}
        <Card className="flex flex-col gap-3 p-5">
          <div className="flex flex-col gap-0.5">
            <h2 className="font-semibold">Why agents skipped</h2>
            <span className="text-[13px] text-muted"><span className="font-mono text-ink">{decided ? Math.round((a.abstained / decided) * 100) : 0}%</span> of agents that saw your campaigns skipped them, following their owners&apos; rules.</span>
          </div>
          {declines.length === 0 ? <p className="text-sm text-muted">Nobody skipped yet.</p> : declines.map(([r, n]) => (
            <div key={r} className="flex flex-col gap-1">
              <span className="flex justify-between text-[13px]"><span className="font-semibold">{r === 'needs_approval' ? 'Needs owner approval' : (REASON_LABEL[r] ?? r)}</span><span className="font-mono text-muted">{n}</span></span>
              <span className="h-2 overflow-hidden bg-subtle"><span className="block h-full bg-blue/70" style={{ width: `${(n / declineMax) * 100}%` }} /></span>
            </div>
          ))}
        </Card>
      </div>

      {/* 4. Transcripts: rows, not a table. */}
      <Card className="overflow-hidden">
        <div className="px-5 pb-2 pt-4"><h2 className="font-semibold">Transcripts</h2><p className="text-[13px] text-muted">Each settled campaign&apos;s questions with the aggregated answers.</p></div>
        <ul className="divide-y divide-line border-t border-line">
          {list.map((c) => (
            <li key={c.campaignId} className="flex flex-wrap items-center gap-3 px-5 py-3">
              <span className="flex min-w-0 flex-1 flex-col">
                <Link href={`/research/${c.campaignId}`} className="truncate font-semibold hover:text-blue">{c.title}</Link>
                <span className="text-xs text-muted">{categoryLabel(c.category)} · <span className="font-mono">{c.report?.acceptedCount ?? 0}</span> valid answers</span>
              </span>
              <StatePill state={c.state} />
              {c.state === 'SETTLED' ? <Button size="sm" variant="secondary" href={`/research/${c.campaignId}/transcript`}>Open transcript</Button> : <span className="text-xs text-muted">after settlement</span>}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
