'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Fin, type Pose } from '@/components/Fin';
import { Button, Card, Toggle, cx } from '@/components/ui';
import { ActivityTable } from '@/components/ActivityTable';
import { CalibrationBanner } from '@/components/CalibrationBanner';
import { DevSeller } from '@/components/DevTrace';
import { useStore } from '@/lib/store';
import { useActivity } from '@/lib/useActivity';
import { fmtSol, lamportsToSol } from '@/lib/campaign';
import { DEMO_NOTE, PRIVACY_NOTE } from '@/lib/config';

type Status = 'active' | 'running' | 'idle' | 'paused' | 'limit' | 'offline' | 'not_connected';
const STATUS: Record<Status, { line: string; tone: string; pose: Pose }> = {
  active: { line: 'Fin is on duty, checking new campaigns against your rules.', tone: 'text-ok-ink', pose: 'idle' },
  paused: { line: 'Paused. Fin is resting until you switch it back on.', tone: 'text-muted', pose: 'sleeping' },
  limit: { line: "Daily limit reached. Fin is back tomorrow.", tone: 'text-warn-ink', pose: 'sleeping' },
  running: { line: 'Your agent app is running. It answers new campaigns when it checks in.', tone: 'text-ok-ink', pose: 'idle' },
  idle: { line: 'Fin checks in when your agent runs and answers new campaigns then.', tone: 'text-ok-ink', pose: 'swim' },
  offline: { line: "Your agent hasn't checked in for a day. Open Claude Code or OpenClaw to wake it.", tone: 'text-warn-ink', pose: 'sleeping' },
  not_connected: { line: 'No agent paired yet. Pair one to start earning.', tone: 'text-danger-ink', pose: 'sleeping' },
};
const WEEK_MS = 7 * 86_400_000;
const solOf = (lamports: string | number) => lamportsToSol(lamports);

export default function SellerDashboard() {
  const { agent, setPaused, policy, liveToken, view } = useStore();
  const { items: all, totals } = useActivity();
  const [paidFlash, setPaidFlash] = useState(false);
  const presence = (!!liveToken && agent?.kind === 'live') ? 'online' : agent?.status ?? 'offline';
  const connected = !!agent && presence !== 'offline';

  const status: Status = !agent ? 'not_connected' : presence === 'offline' ? 'offline' : agent.paused ? 'paused'
    : totals && totals.todayCount >= policy.dailyLimit ? 'limit' : presence === 'idle' ? 'idle' : agent.kind === 'plugin' ? 'running' : 'active';
  const s = STATUS[status];

  // Show the Paid pose for 3 s when a payout landed since the last visit (only while the agent is on duty).
  const latestPaid = all.find((a) => a.outcome === 'paid')?.paidAt ?? 0;
  useEffect(() => {
    if (!['active', 'running', 'idle'].includes(status) || !latestPaid) return;
    const seen = Number(localStorage.getItem('cf.lastPayoutSeen') ?? 0);
    if (latestPaid <= seen) return;
    setPaidFlash(true);
    localStorage.setItem('cf.lastPayoutSeen', String(latestPaid));
    const t = setTimeout(() => setPaidFlash(false), 3000);
    return () => clearTimeout(t);
  }, [latestPaid, status]);

  const weekAgo = Date.now() - WEEK_MS;
  const week = all.filter((a) => a.outcome === 'paid' && (a.paidAt ?? 0) >= weekAgo).reduce((n, a) => n + solOf(a.payoutLamports ?? 0), 0);
  const pending = solOf(totals?.pendingLamports ?? 0);
  const days = totals?.earningsByDay.map((d) => solOf(d.lamports)) ?? Array<number>(30).fill(0);
  const max = Math.max(...days, 0.0001);
  const today = totals?.todayCount ?? 0;

  return (
    <div className="flex flex-col gap-5">
      <CalibrationBanner />
      {/* 1. Status hero: the one chunky card on this screen. */}
      <section className="chunky grid items-center gap-6 rounded-[20px] bg-surface p-5 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:p-6">
        <div className="grid size-[120px] place-items-center rounded-2xl bg-tank">
          <Fin pose={paidFlash ? 'paid' : s.pose} label={paidFlash ? 'Fin delighted: a payout landed' : `Fin: ${s.line}`} />
        </div>
        <div className="flex min-w-0 flex-col gap-1.5">
          <h1 className="font-pixel text-2xl font-bold">My agent</h1>
          <p className={cx('text-[15px] font-semibold', s.tone)}>{s.line}</p>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="font-mono text-5xl leading-none">{fmtSol(solOf(totals?.earnedLamports ?? 0))}</span>
            <span className="font-semibold">SOL earned</span>
          </div>
          <p className="text-sm text-muted">
            <span className="font-mono text-ink">+{fmtSol(week)}</span> this week
            {pending > 0 && <> · <span className="font-mono text-ink">{fmtSol(pending)}</span> waiting for settlement</>}
            {connected && <> · <span className="font-mono text-ink">{today}</span> of <span className="font-mono text-ink">{policy.dailyLimit}</span> surveys today</>}
          </p>
        </div>
        <div className="flex flex-col items-start gap-2 sm:items-end">
          {agent && connected
            ? <Toggle checked={agent.paused} onChange={(v) => void setPaused(v)} label="Pause agent" />
            : <Button href="/seller/agent">Pair agent</Button>}
          <Link href="/seller/guardrails" className="text-[13px] font-semibold text-blue hover:underline">Edit rules</Link>
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        {/* 2. Earnings: square pixel bars, this week in full accent, today in green. */}
        <Card className="flex flex-col gap-3 p-5">
          <h2 className="font-semibold">Earnings, last 30 days</h2>
          <div className="flex h-44 items-end gap-[3px] border-b-2 border-line" role="img" aria-label="Bar chart of SOL earned per day over the last 30 days">
            {days.map((v, i) => (
              <div key={i} title={`${fmtSol(v)} SOL`} className={cx('min-h-[4px] flex-1 transition-[height] duration-500', i === 29 ? 'bg-ok' : i >= 23 ? 'bg-blue' : 'bg-blue/30')} style={{ height: `${(v / max) * 100}%` }} />
            ))}
          </div>
          <div className="flex justify-between text-xs text-muted"><span>30 days ago</span><span>Today</span></div>
        </Card>

        {/* 3. Recent activity: five rows, the rest lives on the Activity tab. */}
        <Card className="overflow-hidden">
          <div className="flex items-baseline justify-between px-5 pb-2 pt-4">
            <h2 className="font-semibold">Recent</h2>
            <Link href="/seller/activity" className="text-[13px] font-semibold text-blue hover:underline">See all</Link>
          </div>
          {all.length ? <ActivityTable items={all.slice(0, 5)} /> : (
            <div className="flex flex-col items-center gap-3 border-t border-line px-6 py-10 text-center">
              <Fin pose="sleeping" label="Fin sleeping: no campaigns yet" />
              <p className="text-[15px] text-muted">No campaigns matched yet. Fin is waiting.</p>
            </div>
          )}
        </Card>
      </div>

      <p className="text-xs leading-relaxed text-muted">{PRIVACY_NOTE} {DEMO_NOTE}</p>
      {view === 'dev' && <DevSeller items={all} />}
    </div>
  );
}
