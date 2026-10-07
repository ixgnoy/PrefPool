'use client';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { ActivityTable } from '@/components/ActivityTable';
import { MyAnswers } from '@/components/MyAnswers';
import { Card, EmptyState, PageTitle, Segmented, cx } from '@/components/ui';
import { useActivity } from '@/lib/useActivity';
import { fmtSol, lamportsToSol } from '@/lib/campaign';
import { REASON_LABEL, REASON_RULE, type AbstainReason } from '@/lib/policy';

type Filter = 'all' | 'answer' | 'abstain' | 'paid';
type Tab = 'history' | 'answers';

export default function ActivityPage() {
  return <Suspense><Activity /></Suspense>; // useSearchParams needs a Suspense boundary
}

function Activity() {
  const router = useRouter();
  const tab: Tab = useSearchParams().get('tab') === 'answers' ? 'answers' : 'history';
  const { totals } = useActivity();
  return (
    <>
      <PageTitle title="Activity" sub={<><span className="font-mono">{totals?.seen ?? 0}</span> campaigns seen · <span className="font-mono">{fmtSol(lamportsToSol(totals?.earnedLamports))}</span> SOL earned</>}
        actions={
          <div className="flex gap-1 rounded-xl bg-subtle p-1" role="tablist">
            {([['history', 'History'], ['answers', 'My answers']] as const).map(([v, label]) => (
              <button key={v} type="button" role="tab" aria-selected={tab === v} onClick={() => router.replace(v === 'history' ? '/seller/activity' : '/seller/activity?tab=answers')}
                className={cx('rounded-lg px-4 py-1.5 text-sm font-semibold transition', tab === v ? 'bg-surface text-ink shadow-[0_2px_0_var(--line)]' : 'text-muted hover:text-ink')}>{label}</button>
            ))}
          </div>
        } />
      {tab === 'history' ? <History /> : <MyAnswers />}
    </>
  );
}

function History() {
  const { items: all, totals, loading } = useActivity();
  const [filter, setFilter] = useState<Filter>('all');
  const items = all.filter((a) => filter === 'all' || (filter === 'paid' ? a.outcome === 'paid' : a.kind === filter));
  const reasons = (Object.entries(totals?.abstainReasons ?? {}) as [AbstainReason, number][]).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
  return (
    <div className="flex flex-col gap-4">
      <Segmented value={filter} onChange={(v) => setFilter(v as Filter)} className="sm:max-w-md" options={[
        { value: 'all', label: 'All' }, { value: 'answer', label: 'Answered' }, { value: 'abstain', label: 'Skipped' }, { value: 'paid', label: 'Paid' },
      ]} />
      {/* Why skipped: one sentence instead of a bar chart; each reason links to the rule that caused it. */}
      {reasons.length > 0 && (
        <p className="text-sm text-muted">
          Your rules skipped <b className="font-mono text-ink">{totals?.abstained ?? 0}</b> campaigns:{' '}
          {reasons.map(([r, n], i) => (
            <span key={r}>{i > 0 && ', '}<Link href={REASON_RULE[r].href} className="font-semibold text-blue hover:underline">{REASON_LABEL[r].toLowerCase()}</Link> <span className="font-mono">{n}</span></span>
          ))}.
        </p>
      )}
      {loading ? <div className="h-72 animate-pulse rounded-2xl bg-surface" /> : items.length ? <Card className="overflow-hidden"><ActivityTable items={items} /></Card>
        : <EmptyState pose="sleeping" text={all.length ? 'Nothing here for this filter.' : 'No campaigns matched yet. Your agent is waiting.'} />}
    </div>
  );
}
