'use client';
// Campaign monitor (FRONTEND_PRD §5.9): polls GET /api/campaigns/:id. Owner view adds results, the access token and
// the refund escape hatch. Dev view adds the technical trace (§5.10).
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Aquarium } from './Aquarium';
import { DevTrace } from './DevTrace';
import { Fin } from './Fin';
import { Term } from './Term';
import { AddressLink, Button, Card, CopyButton, Countdown, EmptyState, Mono, Pill, Progress, StatePill, TxLink, cx } from './ui';
import { ArrowLeft } from 'pixelarticons/react/ArrowLeft';
import { Check } from 'pixelarticons/react/Check';
import { Close } from 'pixelarticons/react/Close';
import { Minus } from 'pixelarticons/react/Minus';
import { useStore } from '@/lib/store';
import { ApiError, getCampaign, getConfig, getResults, type CampaignView } from '@/lib/api';
import { refundDirect } from '@/lib/fund';
import { layoutFish, type Phase } from '@/lib/aquarium';
import { LAMPORTS, STATE_UI, TIMELINE, fmtSol, fmtTime, short, sol, type CampaignState } from '@/lib/campaign';
import { DEFAULT_PLATFORM_FEE_USDC, DEMO_NOTE } from '@/lib/config';
import { campaignEscrowAddress, type ResearchReport } from '@as/shared';

const CRE_STEPS = ['Read escrow from Solana', 'Decrypt (inside CRE)', 'Validate', 'Remove duplicates', 'Cohort check (≥ k)', 'Aggregate', 'Sign payee list'];
type StepState = 'done' | 'run' | 'idle' | 'fail' | 'skip';
const STEP_STYLE: Record<StepState, string> = {
  done: 'bg-ok-soft text-ok-ink', run: 'bg-blue-soft text-blue animate-pulse', idle: 'bg-subtle text-muted',
  fail: 'bg-danger-soft text-danger-ink', skip: 'bg-subtle text-muted opacity-60',
};
const STEP_ICON: Record<StepState, typeof Check | null> = { done: Check, run: null, idle: null, fail: Close, skip: Minus };
const TERMINAL = new Set(['SETTLED', 'REFUNDED', 'REJECTED']);

function phaseOf(c: CampaignView): Phase {
  if (c.state === 'SETTLED') return 'settled';
  if (c.state === 'REFUNDED' || c.state === 'INSUFFICIENT_COHORT' || c.report?.acceptedCount === 0) return 'insufficient';
  if (c.report) return 'formed'; // CRE validated the cohort; payout pending
  if (c.state === 'AGGREGATING') return 'aggregating';
  return 'collecting';
}

/** Polls the public campaign view: every 2 s while live, every 15 s once finished. */
function useCampaign(id: string) {
  const [c, setC] = useState<CampaignView | null | undefined>(undefined);
  useEffect(() => {
    let live = true, t: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        const v = await getCampaign(id);
        if (!live) return;
        setC(v);
        t = setTimeout(load, TERMINAL.has(v.state) ? 15_000 : 2_000);
      } catch (e) {
        if (!live) return;
        if (e instanceof ApiError && e.status === 404) setC(null); else t = setTimeout(load, 5_000);
      }
    };
    void load();
    return () => { live = false; clearTimeout(t); };
  }, [id]);
  return c;
}

export function CampaignMonitor({ id, owner }: { id: string; owner: boolean }) {
  const c = useCampaign(id);
  const { view } = useStore();
  const [programId, setProgramId] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [viewStep, setViewStep] = useState<number | null>(null); // null = live; else replay that timeline step
  const [feeUsdc, setFeeUsdc] = useState(DEFAULT_PLATFORM_FEE_USDC);
  useEffect(() => { getConfig().then((cfg) => { setProgramId(cfg.programId); setFeeUsdc(cfg.platformFeeUsdc ?? DEFAULT_PLATFORM_FEE_USDC); }).catch(() => {}); }, []);

  if (c === undefined) return <div className="h-96 animate-pulse rounded-2xl bg-surface" />;
  if (c === null) return <EmptyState pose="researcher" text="We couldn't find this campaign." action={<Button href={owner ? '/research' : '/'}>Go back</Button>} />;
  if (c.state === 'REJECTED') return <EmptyState pose="policy" text={`This campaign was rejected at screening: ${c.rejectReasons.join('; ')}. Nothing was paid.`} action={<Button href="/research/new">Create a new campaign</Button>} />;
  if (c.state === 'AWAITING_FUNDING' || c.state === 'DRAFT' || c.state === 'FUNDING_FAILED') {
    return (
      <div className="flex flex-col gap-6">
        <EmptyState pose="researcher" text={`"${c.title}" isn't funded yet. Agents can't see it until the budget is in escrow.${c.lastError ? ` Last attempt: ${c.lastError}.` : ''}`}
          action={owner ? <Button href={`/research/new?fund=${c.campaignId}`}>Fund it</Button> : undefined} />
        {view === 'dev' && <DevTrace campaignId={c.campaignId} />}
      </div>
    );
  }

  const live = phaseOf(c);
  // Replay: the aquarium, counter and panels show the phase of the picked step; actions (reclaim) always follow live.
  const phase: Phase = viewStep === null ? live : ([ 'collecting', 'collecting', 'aggregating', 'formed', live ] as const)[viewStep]!;
  const collecting = phase === 'collecting', aggregating = phase === 'aggregating', formed = phase === 'formed', settled = phase === 'settled', ins = phase === 'insufficient';
  const placeholders = collecting || aggregating ? Math.max(0, Math.min(c.networkSize, c.maxResponses + 10) - c.agents.length) : 0;
  const fish = layoutFish(c.agents, placeholders, phase);
  const reward = Number(c.rewardLamports) / LAMPORTS;
  // escrowTxRef is the escrow PDA once funding confirms; before that (or if the server omits it) derive it from the program id.
  let escrowAddress = c.escrowTxRef;
  try { if (!escrowAddress && programId) escrowAddress = campaignEscrowAddress(programId, c.campaignId); } catch { /* bad id: show none */ }
  const budget = reward * c.maxResponses;
  const accepted = c.report?.acceptedCount ?? 0;
  const refund = budget - accepted * reward;
  // Buyer used the escape hatch: refunded without a zero-count CRE report (no report, or answers had been accepted).
  const reclaimed = c.state === 'REFUNDED' && (c.report?.acceptedCount ?? 1) > 0;
  const step = STATE_UI[c.state as CampaignState]?.step ?? 0;
  const refunding = live === 'insufficient' && c.state !== 'REFUNDED'; // too few answers; the refund is not confirmed until REFUNDED
  const liveStep = live === 'settled' || (live === 'insufficient' && !refunding) ? TIMELINE.length : step;
  const counter = collecting ? <><b className="font-mono">{c.answered}</b> answers in, needs <b className="font-mono">{c.minCohort}</b></>
    : aggregating ? <><b className="font-mono">{c.answered}</b> answers in. Opening them privately…</>
      : formed ? <>School formed: <b className="font-mono">{accepted}</b> valid answers</>
        : settled ? <><b className="font-mono">{accepted}</b> agents paid <b className="font-mono">{fmtSol(reward)}</b> SOL each</>
          : reclaimed ? <>Budget reclaimed after the refund window</> : <>Only <b className="font-mono">{accepted}</b> valid answers, needed <b className="font-mono">{c.minCohort}</b></>;
  // Plain-language privacy line for User view; the CRE step-by-step lives in Dev view.
  const privacy = collecting ? `Answers stay sealed until the deadline. Then they're opened privately and only totals for groups of ${c.minCohort}+ come out.`
    : aggregating ? (c.cre?.status === 'failed' ? 'The private count hit a snag and is retrying on its own.' : `Counting privately. Only totals for groups of ${c.minCohort}+ come out.`)
      : formed ? 'Totals are signed. Paying everyone in one transaction…'
        : settled ? `Paid by the escrow in one transaction. ${sol(refund)} of unused budget went back to the buyer.`
          : reclaimed ? 'No report: the buyer took the budget back after the refund window.' : `Too few answers to protect anyone's privacy, so nothing was counted and the budget ${refunding ? 'is being refunded' : 'was refunded'}.`;
  const creState = (i: number): StepState => collecting ? 'idle'
    : aggregating ? (c.cre?.status === 'failed' ? (i === 0 ? 'fail' : 'idle') : i === 0 ? 'run' : 'idle')
      : formed || settled ? 'done'
        : reclaimed ? 'idle' : i < 4 ? 'done' : i === 4 ? 'fail' : 'skip';
  const pickedFish = fish.find((f) => f.id === picked);
  const abstainedTotal = c.abstained.reduce((n, a) => n + a.count, 0);
  const evidence = [
    <>{sol(budget)} locked in escrow {escrowAddress && <AddressLink address={escrowAddress} />}{c.fundTxHash && <> · funding tx <TxLink hash={c.fundTxHash} /></>}</>,
    <><b className="font-mono">{c.answered}</b> answered, <b className="font-mono">{abstainedTotal}</b> skipped. Answers stayed sealed until the deadline.</>,
    c.report ? <><b className="font-mono">{accepted}</b> answers accepted · CRE signed report hash <Mono className="text-[13px]">{short(c.report.reportHash, 6, 4)}</Mono> and the payee list</> : <>Not aggregated yet.</>,
    c.settlementTxHash ? <>Payout transaction <TxLink hash={c.settlementTxHash} /></> : <>Payout not sent yet.</>,
    c.settlementTxHash ? <>{live === 'settled' ? `${accepted} agents paid, ${sol(refund)} back to the buyer` : 'Refund'} · <TxLink hash={c.settlementTxHash} /></> : <>Not finished yet.</>,
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        {owner && <Link href="/research" className="inline-flex items-center gap-1 self-start text-[13px] font-semibold text-blue hover:underline"><ArrowLeft aria-hidden width={16} height={16} />Your research</Link>}
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-pixel text-3xl font-bold leading-tight sm:text-[34px]">{c.title}</h1>
          <StatePill state={c.state} />
          {!owner && <Pill>Public view</Pill>}
        </div>
        <p className="text-sm text-muted">
          {collecting ? <><Countdown to={c.deadlineMs} className="font-mono text-ink" /></> : 'Deadline passed'} · <span className="font-mono text-ink">{sol(budget)}</span> in escrow
        </p>
      </div>

      <Progress steps={TIMELINE.map((l, i) => (i === 4 && live === 'insufficient' ? (refunding ? 'Refunding' : 'Refunded') : l))} current={liveStep}
        selected={viewStep} onSelect={(i) => setViewStep(i === Math.min(liveStep, TIMELINE.length - 1) ? null : i)} />
      {viewStep !== null && (
        <div className="rise -mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-blue-soft px-3 py-2 text-[13px]">
          <span className="min-w-0">Replaying <b>{TIMELINE[viewStep]}</b>: {evidence[viewStep]}</span>
          <button type="button" onClick={() => setViewStep(null)} className="font-bold text-blue hover:underline">Back to live</button>
        </div>
      )}

      {/* Hero: the aquarium. Each fish is one agent; the school forms when enough valid answers arrive. */}
      <section className="chunky flex flex-col gap-4 rounded-[20px] bg-surface p-3 sm:p-4">
        <Aquarium fish={fish} phase={phase} selected={picked} onSelect={setPicked} className="h-[340px] sm:h-[440px]" />
        <div className="flex flex-col gap-1.5 px-2 pb-1">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-xl sm:text-2xl" aria-live="polite">{counter}</span>
            {c.verifiedHumansOnly && <Pill tone="ok">Verified humans only</Pill>}
            {c.humans && <span className="text-xs font-semibold text-muted">{c.humans.world} World ID verified · {c.humans.simulated} simulated humans</span>}
            <span className="text-xs text-muted">Tap a fish to see what it decided</span>
          </div>
          <p className="text-[15px] text-muted">{privacy}</p>
          {settled && c.settlementTxHash && <span className="text-[13px]">Payout transaction <TxLink hash={c.settlementTxHash} /></span>}
          {pickedFish && <div className="rise mt-1 rounded-xl bg-blue-soft px-3 py-2 text-sm"><Mono>{pickedFish.id}</Mono>: {pickedFish.kind === 'answered' ? 'answered (sealed, nobody can read it)' : pickedFish.kind === 'abstained' ? `skipped, ${pickedFish.reason ?? 'no reason given'}` : 'still deciding'}</div>}
        </div>
      </section>

      {ins && (
        <Card className="rise flex flex-wrap items-center gap-5 p-5">
          <Fin pose="sleeping" label="Fin sleeping" />
          <div className="flex flex-1 flex-col gap-1">
            <span className="text-lg font-semibold">{reclaimed ? 'Budget reclaimed after the refund window.' : refunding ? `Your full budget of ${sol(budget)} is on its way back to you.` : `Your full budget of ${sol(budget)} was refunded.`}</span>
            {c.settlementTxHash && <span className="text-[13px] text-muted">Refund transaction <TxLink hash={c.settlementTxHash} /></span>}
          </div>
          {owner && <Button variant="secondary" href="/research/new">Create a wider campaign</Button>}
        </Card>
      )}

      {(formed || settled) && (owner && settled ? <Results c={c} abstained={abstainedTotal} feeUsdc={feeUsdc} /> : (
        <p className="text-sm text-muted">{settled ? 'Aggregated results go to the campaign owner only.' : 'Results unlock once payouts settle.'} Individual answers are never shown to anyone.</p>
      ))}

      {owner && live !== 'settled' && live !== 'insufficient' && <Reclaim c={c} />}

      <p className="text-xs text-muted">{DEMO_NOTE}</p>

      {view === 'dev' && (
        <div className="flex flex-col gap-4">
          <Card className="flex flex-col gap-3 p-5">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">Private aggregation (Chainlink <Term k="CRE" />)</h2>
              <Pill tone="warn">CRE Simulation</Pill>
            </div>
            <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {CRE_STEPS.map((label, i) => {
                const st = creState(i), Icon = STEP_ICON[st];
                return (
                  <li key={label} className={cx('flex items-start gap-1.5 rounded-xl px-2.5 py-2 text-xs font-semibold leading-snug transition-colors duration-500', STEP_STYLE[st])}>
                    {Icon && <Icon aria-hidden width={14} height={14} className="mt-px shrink-0" />}
                    <span>{label.replace('≥ k', `≥ ${c.minCohort}`)}</span>
                  </li>
                );
              })}
            </ol>
            <dl className="grid gap-2 border-t border-line pt-3 text-[13px] sm:grid-cols-2">
              {escrowAddress && <div className="flex justify-between gap-3"><dt className="text-muted">Escrow account</dt><dd><AddressLink address={escrowAddress} /></dd></div>}
              {c.fundTxHash && <div className="flex justify-between gap-3"><dt className="text-muted">Funding tx</dt><dd><TxLink hash={c.fundTxHash} /></dd></div>}
              {c.report && <div className="flex items-center justify-between gap-3"><dt className="text-muted">Report hash</dt><dd className="flex items-center gap-1"><Mono className="text-[13px]">{short(c.report.reportHash, 6, 4)}</Mono><CopyButton text={c.report.reportHash} /></dd></div>}
              {c.report && c.settlementTxHash && <div className="flex justify-between gap-3"><dt className="text-muted">Report hash on Solana</dt><dd><TxLink hash={c.settlementTxHash} /></dd></div>}
            </dl>
          </Card>
          <Card className="flex flex-col gap-3 p-5">
            <h2 className="font-semibold">Agents, <span className="font-mono">{c.agents.length}</span> decided</h2>
            {c.agents.length === 0 ? <p className="text-sm text-muted">No agent has decided yet.</p> : (
              <ul className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 xl:grid-cols-5">
                {c.agents.map((t, i) => (
                  <li key={`${t.tag}-${i}`}>
                    <button type="button" onClick={() => setPicked(picked === t.tag ? null : t.tag)} title={t.reason ?? undefined}
                      className={cx('flex w-full min-w-0 flex-col gap-0.5 rounded-xl border px-2.5 py-2 text-left transition', picked === t.tag ? 'border-blue bg-blue-soft' : 'border-line hover:border-muted')}>
                      <span className="flex items-center justify-between gap-1">
                        <Mono className="text-[11px] text-muted">{t.tag}</Mono>
                      </span>
                      <span className={cx('text-xs font-semibold', t.kind === 'answer' ? 'text-ok-ink' : 'text-ink')}>{t.kind === 'answer' ? 'Answered' : 'Abstained'}</span>
                      <span className="truncate text-[11px] text-muted">{t.kind === 'answer' ? 'sealed' : t.reason}{t.live ? ', live wallet' : ''}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <DevTrace campaignId={c.campaignId} />
        </div>
      )}
    </div>
  );
}

function Results({ c, abstained, feeUsdc }: { c: CampaignView; abstained: number; feeUsdc: number }) {
  const { session, accessTokens } = useStore();
  const [report, setReport] = useState<ResearchReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!session) return;
    getResults(c.campaignId, session.sessionToken).then(setReport).catch((e: Error) => setError(e.message));
  }, [c.campaignId, session]);
  const accessToken = accessTokens[c.campaignId];
  const download = () => {
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement('a'), { href: url, download: `${c.campaignId}-report.json` });
    a.click();
    URL.revokeObjectURL(url);
  };
  const rc = c.report?.rejectionCounts ?? {};
  const chips: [string, number][] = [
    ['Accepted', c.report?.acceptedCount ?? 0], ['Skipped', abstained],
    ['Duplicate', rc.duplicate ?? 0], ['Late', rc.late ?? 0], ['Malformed', rc.malformed ?? 0], ['Ineligible', rc.ineligible ?? 0],
  ];
  return (
    <Card className="flex flex-col gap-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-semibold">Results from <span className="font-mono">{report?.validRespondents ?? c.report?.acceptedCount ?? 0}</span> valid answers</h2>
        <div className="flex flex-wrap gap-2">
          {accessToken && <CopyButton text={accessToken} label="Copy agent access token" className="border-2 border-line px-3 py-2" />}
          <Button size="sm" variant="secondary" href={`/research/${c.campaignId}/transcript`}>Open transcript</Button>
          <Button size="sm" onClick={download} disabled={!report}>Download JSON</Button>
        </div>
      </div>
      {error && <p className="text-sm text-danger-ink">{error}</p>}
      {!report && !error && <div className="h-32 animate-pulse rounded-xl bg-subtle" />}
      {report && (
        <div className="grid gap-6 md:grid-cols-2">
          {c.questions.map((q) => {
            // Keys come back in questionnaire order (options, or 1→5 for scales); values are fractions.
            const entries = Object.entries(report.results[q.id] ?? {});
            return (
              <div key={q.id} className="flex flex-col gap-2">
                <span className="text-sm font-bold">{q.text}</span>
                {entries.map(([opt, frac]) => {
                  const pct = Math.round(frac * 100);
                  return (
                    <div key={opt} className="grid grid-cols-[140px_1fr_40px] items-center gap-2 text-[13px]">
                      <span className="truncate">{q.type === 'likert_5' ? `${opt}${opt === '1' ? ' · not at all' : opt === '5' ? ' · very' : ''}` : opt}</span>
                      <span className="h-3 overflow-hidden bg-blue-soft"><span className="block h-full bg-blue transition-[width] duration-700" style={{ width: `${pct}%` }} /></span>
                      <Mono className="text-right text-xs">{pct}%</Mono>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}
      <p className="border-t border-line pt-3 text-[13px] text-muted">
        {chips.filter(([, n]) => n > 0).map(([l, n], i) => <span key={l}>{i > 0 && ', '}{l.toLowerCase()} <span className="font-mono text-ink">{n}</span></span>)}.
      </p>
      <p className="text-[13px] text-muted">Your results are free here. {feeUsdc ? <>A research agent fetching this report with the access token pays a <b className="font-mono text-ink">{feeUsdc} USDC</b> platform fee over <Term k="x402" /> (Devnet USDC).</> : 'A research agent can fetch the same report with the access token, free.'}</p>
    </Card>
  );
}

/** Company escape hatch: after refund_after the buyer signs a Refund tx that returns the whole escrow. */
function Reclaim({ c }: { c: CampaignView }) {
  const { session, ensureWallet } = useStore();
  const [now, setNow] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => { setNow(Date.now()); const t = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(t); }, []);
  const open = now !== null && now > c.refundAfterMs + 60_000 && !!c.escrowTxRef;
  async function reclaim() {
    if (!session) return;
    setBusy(true); setMsg(null);
    try {
      const wallet = await ensureWallet();
      const { txHash } = await refundDirect({ campaignId: c.campaignId, sessionToken: session.sessionToken, wallet });
      setMsg(`Refund submitted: ${short(txHash, 8, 6)}`);
    } catch (e) {
      setMsg((e as Error).message ?? 'Refund failed');
    } finally { setBusy(false); }
  }
  return (
    <div className="flex flex-wrap items-center gap-4 rounded-2xl border border-dashed border-line px-5 py-4">
      <div className="flex flex-1 flex-col gap-1">
        <span className="text-sm font-bold">Reclaim budget</span>
        <span className="text-[13px] text-muted">If a campaign gets stuck, you can pull the full budget back from <Term k="escrow" /> after the refund time (deadline + 24 h). You sign the refund in your wallet.</span>
        {msg && <span className="text-[13px] font-bold">{msg}</span>}
      </div>
      <Button variant="secondary" size="sm" disabled={!open || busy} onClick={reclaim}>{busy ? 'Signing…' : open ? 'Reclaim budget' : `Available after ${fmtTime(c.refundAfterMs)}`}</Button>
    </div>
  );
}
