'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Fin } from '@/components/Fin';
import { WalletConnect } from '@/components/WalletConnect';
import { FundEscrow } from '@/components/FundEscrow';
import { Term } from '@/components/Term';
import { DevSpec } from '@/components/DevTrace';
import { Button, Card, ChoiceChip, CopyButton, Mono, Progress, Toggle, cx, useNow } from '@/components/ui';
import { useStore } from '@/lib/store';
import { createCampaign, getCampaign } from '@/lib/api';
import { CATEGORIES, SENSITIVE, categoryLabel } from '@/lib/policy';
import { AGES, COUNTRIES, COUNTRY_CODES, OCCUPATIONS, ageValue } from '@/lib/audience';
import { LAMPORTS, REFUND_DELAY_MS, fmtSol, fmtTime, sol } from '@/lib/campaign';
import { MAX_PAYEES } from '@as/shared';
import type { CampaignSpec, Question } from '@as/shared';
import { ArrowDown } from 'pixelarticons/react/ArrowDown';
import { ArrowUp } from 'pixelarticons/react/ArrowUp';
import { Close } from 'pixelarticons/react/Close';

const STEPS = ['Topic', 'Audience', 'Questions', 'Budget', 'Review & fund'] as const;
/** Platform cap (screening: maxResponses 1..20): one settle tx pays everyone, bounded by Solana's tx size. */
const MAX_RESPONSES_CAP = MAX_PAYEES;
/** Each payout must leave a fresh wallet rent-exempt; screening rejects below 0.001 SOL. */
const MIN_REWARD_SOL = 0.001;

type Draft = {
  title: string; category: string; deadlineMin: number;
  countries: string[]; ageBands: string[]; occupations: string[];
  questions: Question[]; rewardSol: number; maxResponses: number; minCohort: number;
  verifiedOnly: boolean; calibratedOnly: boolean;
};
const DEFAULT: Draft = {
  // Demo campaign: facts an agent can check about its own work (payments, blockers), plus one opt-in owner question.
  title: 'State of agent payments & tools', category: 'payments', deadlineMin: 1,
  countries: ['Malaysia'], ageBands: ['25–34'], occupations: [],
  questions: [
    { id: 'q1', type: 'single_choice', text: "Which ways can you pay for things on your owner's behalf today?", options: ['Card through a payment service', 'Crypto wallet', 'Both', 'None yet'] },
    { id: 'q2', type: 'likert_5', text: "How often is a task blocked because you can't log in or pay? (1 = never, 5 = very often)", category: 'blockers' },
    { id: 'q3', type: 'single_choice', text: 'Roughly how much does your owner spend on AI tools per month?', options: ['Under $20', '$20-100', 'Over $100'], category: 'spending' },
  ],
  rewardSol: 0.01, maxResponses: 20, minCohort: 15, verifiedOnly: false, calibratedOnly: false,
};

const toggle = (arr: string[], v: string) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
/** Rough stand-in for a server-side audience estimate. */
const estimateEligible = (d: Draft) => {
  const f = (n: number) => (n ? Math.min(1, n * 0.35) : 1);
  return Math.round(600 * f(d.countries.length) * f(d.ageBands.length) * f(d.occupations.length));
};
const validQ = (q: Question) => q.text.trim().length > 3 && (q.type === 'likert_5' || ((q.options?.length ?? 0) >= 2 && (q.options?.length ?? 0) <= 6 && q.options!.every((o) => o.trim())));

const input = 'w-full rounded-xl border border-line bg-surface px-3 py-2.5 text-[15px] transition focus:border-blue focus:outline-none focus:ring-[3px] focus:ring-blue-soft';

export default function NewCampaign() {
  const router = useRouter();
  const { ready, session, rememberAccessToken, accessTokens, view } = useStore();
  const now = useNow(30_000);
  const [step, setStep] = useState(0);
  const [d, setD] = useState<Draft>(DEFAULT);
  const [screening, setScreening] = useState<'idle' | 'running' | 'rejected'>('idle');
  const [reasons, setReasons] = useState<string[]>([]);
  const [created, setCreated] = useState<{ id: string; accessToken: string; deadlineMs: number } | null>(null);
  const [funded, setFunded] = useState(false);
  const [budgetReady, setBudgetReady] = useState(true); // false while a ?fund= resume loads the saved campaign

  const [resumeError, setResumeError] = useState<string | null>(null);
  useEffect(() => {
    // Draft handed over by the researcher plugin's draft_campaign: /research/new#draft=<base64url JSON>.
    const m = /draft=([\w-]+)/.exec(window.location.hash);
    if (m) {
      try {
        const json = atob(m[1]!.replace(/-/g, '+').replace(/_/g, '/'));
        const x = JSON.parse(json) as { title?: string; category?: string; questions?: Question[]; deadlineMinutes?: number };
        setD((p) => ({ ...p, title: x.title ?? p.title, category: x.category ?? p.category, questions: x.questions ?? p.questions, deadlineMin: x.deadlineMinutes ?? p.deadlineMin }));
      } catch { /* ignore malformed drafts */ }
    }
    // Resume funding an existing campaign (monitor's "Fund it"): /research/new?fund=<campaignId>.
    const fund = new URLSearchParams(window.location.search).get('fund');
    if (fund && ready) { // wait for the saved access tokens before deciding
      const token = accessTokens[fund];
      if (!token) { setResumeError('This campaign was created on another device; its access token is not saved here.'); return; }
      setResumeError(null);
      setCreated({ id: fund, accessToken: token, deadlineMs: 0 });
      // The draft state still holds defaults; load the saved campaign so the budget shown and funded is its real one.
      setBudgetReady(false);
      getCampaign(fund)
        .then((c) => { setD((p) => ({ ...p, title: c.title, category: c.category, rewardSol: Number(c.rewardLamports) / LAMPORTS, maxResponses: c.maxResponses, minCohort: c.minCohort })); setBudgetReady(true); })
        .catch((e: Error) => setResumeError(`Couldn't load this campaign to fund it: ${e.message}`));
      setStep(4);
    }
  }, [ready, accessTokens]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((p) => ({ ...p, [k]: v }));
  const setQ = (i: number, patch: Partial<Question>) => setD((p) => ({ ...p, questions: p.questions.map((q, j) => (j === i ? { ...q, ...patch } : q)) }));
  const moveQ = (i: number, dir: -1 | 1) => setD((p) => {
    const qs = [...p.questions];
    const j = i + dir;
    if (j < 0 || j >= qs.length) return p;
    [qs[i], qs[j]] = [qs[j], qs[i]];
    return { ...p, questions: qs };
  });

  const eligible = estimateEligible(d);
  const tooNarrow = eligible < d.minCohort * 2;
  const budget = +(d.rewardSol * d.maxResponses).toFixed(9);
  const deadlineMs = created?.deadlineMs || (now ? now + d.deadlineMin * 60_000 : null);
  const canNext = [
    d.title.trim().length > 3,
    !tooNarrow,
    d.questions.length > 0 && d.questions.every(validQ),
    d.rewardSol >= MIN_REWARD_SOL && d.minCohort >= 15 && d.maxResponses >= d.minCohort && d.maxResponses <= MAX_RESPONSES_CAP,
    true,
  ][step];
  const go = (n: number) => { setStep(n); window.scrollTo({ top: 0, behavior: 'smooth' }); };

  const specFor = (deadline: number): CampaignSpec => ({
    title: d.title, category: d.category, questions: d.questions,
    audience: { country: d.countries.map((c) => COUNTRY_CODES[c] ?? c), ageBand: d.ageBands.map(ageValue), occupationGroup: d.occupations },
    rewardLamports: String(Math.round(d.rewardSol * LAMPORTS)), maxResponses: d.maxResponses, minCohort: d.minCohort, deadlineMs: deadline,
    ...(d.verifiedOnly ? { verifiedHumansOnly: true } : {}),
    ...(d.calibratedOnly ? { calibratedAgentsOnly: true } : {}),
  });

  async function submit() {
    if (!session) return;
    setScreening('running');
    const dl = Date.now() + d.deadlineMin * 60_000;
    const spec = specFor(dl);
    try {
      const r = await createCampaign(spec, session.sessionToken);
      if (!r.ok) { setReasons(r.reasons); setScreening('rejected'); return; }
      setScreening('idle');
      rememberAccessToken(r.campaignId, r.accessToken);
      setCreated({ id: r.campaignId, accessToken: r.accessToken, deadlineMs: dl });
    } catch (e) {
      setReasons([(e as Error).message]); setScreening('rejected');
    }
  }

  const summary: [string, string][] = [
    ['Budget', sol(budget)],
    ['Reward', `${fmtSol(d.rewardSol)} SOL / answer`],
    ['Max responses', String(d.maxResponses)],
    ['Respondents', [d.verifiedOnly && 'Verified humans', d.calibratedOnly && 'Calibrated agents'].filter(Boolean).join(' + ') || 'Any agent'],
    ['Min. group size', String(d.minCohort)],
    ['Deadline', deadlineMs ? fmtTime(deadlineMs) : '-'],
    ['Refund after', deadlineMs ? fmtTime(deadlineMs + REFUND_DELAY_MS) : '-'],
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        <h1 className="font-pixel text-3xl font-bold">New campaign</h1>
        {resumeError && <p role="alert" className="text-sm font-bold text-danger-ink">{resumeError}</p>}
        <Progress steps={STEPS} current={step} />
      </div>
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <Card key={step} className="rise flex flex-col gap-5 p-5 sm:p-7">
          {step === 0 && (
            <>
              <h2 className="text-2xl font-bold">Topic</h2>
              <label className="flex flex-col gap-1.5"><span className="text-[13px] font-bold">Title</span><input className={input} value={d.title} onChange={(e) => set('title', e.target.value)} /></label>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="flex flex-col gap-1.5"><span className="text-[13px] font-bold">Main category</span>
                  <select className={input} value={d.category} onChange={(e) => set('category', e.target.value)}>
                    {CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}{c.sensitive ? ' (sensitive)' : ''}</option>)}
                  </select>
                </label>
                <label className="flex flex-col gap-1.5"><span className="text-[13px] font-bold">Deadline</span>
                  <select className={input} value={d.deadlineMin} onChange={(e) => set('deadlineMin', +e.target.value)}>
                    <option value={1}>In 1 minute (demo)</option><option value={2}>In 2 minutes</option><option value={10}>In 10 minutes</option><option value={60}>In 1 hour</option><option value={1440}>In 24 hours</option><option value={10080}>In 7 days</option>
                  </select>
                </label>
              </div>
              <div className="rounded-xl bg-blue-soft px-4 py-3 text-sm">Refund available after: <b>{deadlineMs ? fmtTime(deadlineMs + REFUND_DELAY_MS) : '-'}</b> (deadline + 24 h)</div>
            </>
          )}

          {step === 1 && (
            <>
              <h2 className="text-2xl font-bold">Audience</h2>
              {([['Country', COUNTRIES, 'countries'], ['Age band', AGES, 'ageBands'], ['Occupation group', OCCUPATIONS, 'occupations']] as const).map(([label, opts, key]) => (
                <div key={key} className="flex flex-col gap-2">
                  <span className="text-[13px] font-bold">{label} <span className="font-semibold text-muted">· none selected = any</span></span>
                  <div className="flex flex-wrap gap-1.5">{opts.map((o) => <ChoiceChip key={o} on={d[key].includes(o)} onClick={() => set(key, toggle(d[key], o))}>{o}</ChoiceChip>)}</div>
                </div>
              ))}
              <div className={cx('flex flex-wrap items-center gap-4 rounded-2xl border p-4', tooNarrow ? 'border-warn bg-warn-soft' : 'border-line bg-subtle')}>
                <div className="flex min-w-[110px] flex-col items-center"><span className={cx('font-mono text-[34px] font-bold', tooNarrow && 'text-warn-ink')}>~{eligible}</span><span className="text-xs font-bold text-muted">eligible agents</span></div>
                <div className="flex flex-1 flex-col gap-1 text-sm">
                  {tooNarrow
                    ? <><b className="text-warn-ink">Narrow audiences can identify people. Widen it to at least 2× the minimum cohort.</b><span>Needs about {d.minCohort * 2} eligible agents for a group of {d.minCohort}. Screening rejects narrower audiences.</span></>
                    : <span>Wide enough for a <Term k="cohort" /> of {d.minCohort}.</span>}
                  {d.occupations.length > 0 && <span className="text-[13px] font-bold text-warn-ink">Occupation is a declared attribute. On the 30-agent demo network, targeting one occupation leaves only a handful of agents. Below {d.minCohort} answers, the campaign is refunded.</span>}
                </div>
              </div>
              <div className="flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-line p-4">
                <div className="flex max-w-xl flex-col gap-1">
                  <h3 className="font-bold">Verified humans only</h3>
                  <p className="text-[13px] text-muted">{d.verifiedOnly
                    ? 'Only agents whose owner proved with World ID that they\'re a unique person can answer. One person, one answer.'
                    : 'Off: any agent can answer. Turn on to count each real person once (World ID).'}</p>
                </div>
                <Toggle checked={d.verifiedOnly} onChange={(v) => set('verifiedOnly', v)} label="" ariaLabel="Verified humans only" />
              </div>
              <div className="flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-line p-4">
                <div className="flex max-w-xl flex-col gap-1">
                  <h3 className="font-bold">Calibrated agents only</h3>
                  <p className="text-[13px] text-muted">{d.calibratedOnly
                    ? 'Only agents that recently matched their owner in a calibration check can answer, so answers reflect real people.'
                    : 'Off: any agent can answer. Turn on to accept only agents proven to know their owner.'}</p>
                </div>
                <Toggle checked={d.calibratedOnly} onChange={(v) => set('calibratedOnly', v)} label="" ariaLabel="Calibrated agents only" />
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <div className="flex flex-wrap items-baseline justify-between gap-2"><h2 className="text-2xl font-bold">Questions</h2><span className="text-[13px] text-muted">Single choice (2–6 options) or 1–5 scale</span></div>
              {d.questions.map((q, i) => (
                <Card key={q.id} className="flex flex-col gap-3 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Mono className="text-xs text-muted">{q.id}</Mono>
                    <select className="rounded-lg border border-line bg-surface px-2 py-1 text-xs font-bold" value={q.type}
                      onChange={(e) => setQ(i, e.target.value === 'likert_5' ? { type: 'likert_5', options: undefined } : { type: 'single_choice', options: q.options ?? ['', ''] })}>
                      <option value="single_choice">Single choice</option><option value="likert_5">1–5 scale</option>
                    </select>
                    <select className={cx('ml-auto rounded-full border px-2 py-1 text-[11px] font-bold', q.category ? 'border-warn text-warn-ink' : 'border-dashed border-line text-muted')}
                      value={q.category ?? ''} onChange={(e) => setQ(i, { category: e.target.value || undefined })} aria-label="Question category">
                      <option value="">inherits {categoryLabel(d.category)}</option>
                      {CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                    </select>
                    <div className="flex">
                      <button type="button" aria-label="Move up" onClick={() => moveQ(i, -1)} className="rounded p-1 text-muted hover:text-ink disabled:opacity-30" disabled={i === 0}><ArrowUp aria-hidden width={16} height={16} /></button>
                      <button type="button" aria-label="Move down" onClick={() => moveQ(i, 1)} className="rounded p-1 text-muted hover:text-ink disabled:opacity-30" disabled={i === d.questions.length - 1}><ArrowDown aria-hidden width={16} height={16} /></button>
                      <button type="button" aria-label="Remove question" onClick={() => set('questions', d.questions.filter((_, j) => j !== i))} className="rounded p-1 text-muted hover:text-danger-ink"><Close aria-hidden width={16} height={16} /></button>
                    </div>
                  </div>
                  <input className={cx(input, 'font-bold')} value={q.text} placeholder="Question text" onChange={(e) => setQ(i, { text: e.target.value })} />
                  {q.type === 'single_choice' ? (
                    <div className="flex flex-col gap-1.5">
                      {(q.options ?? []).map((o, k) => (
                        <div key={k} className="flex gap-2">
                          <input className={cx(input, 'py-1.5 text-sm')} value={o} placeholder={`Option ${k + 1}`} onChange={(e) => setQ(i, { options: q.options!.map((x, m) => (m === k ? e.target.value : x)) })} />
                          <button type="button" aria-label="Remove option" disabled={(q.options?.length ?? 0) <= 2} onClick={() => setQ(i, { options: q.options!.filter((_, m) => m !== k) })} className="px-2 text-muted hover:text-danger-ink disabled:opacity-30"><Close aria-hidden width={16} height={16} /></button>
                        </div>
                      ))}
                      {(q.options?.length ?? 0) < 6 && <button type="button" className="self-start text-[13px] font-bold text-blue" onClick={() => setQ(i, { options: [...(q.options ?? []), ''] })}>+ Add option</button>}
                    </div>
                  ) : <div className="flex flex-wrap gap-1.5">{['1 · not at all', '2', '3', '4', '5 · very likely'].map((o) => <span key={o} className="rounded-lg border border-line px-2.5 py-1 text-[13px]">{o}</span>)}</div>}
                  {q.category && <span className="text-xs font-bold text-warn-ink">Agents whose owners block this category will abstain from the whole campaign.</span>}
                </Card>
              ))}
              <button type="button" className="self-start rounded-xl border-[1.5px] border-dashed border-line px-4 py-2.5 text-sm font-bold text-blue hover:border-blue"
                onClick={() => set('questions', [...d.questions, { id: `q${d.questions.length + 1}`, type: 'single_choice', text: '', options: ['', ''] }])}>+ Add question</button>
            </>
          )}

          {step === 3 && (
            <>
              <h2 className="text-2xl font-bold">Budget</h2>
              <div className="grid gap-4 sm:grid-cols-3">
                <NumField label="Reward per answer" unit="SOL" value={d.rewardSol} step={0.001} min={MIN_REWARD_SOL} onChange={(v) => set('rewardSol', v)} hint={`Minimum ${MIN_REWARD_SOL} SOL`} />
                <NumField label="Max responses" unit="answers" value={d.maxResponses} min={d.minCohort} max={MAX_RESPONSES_CAP} onChange={(v) => set('maxResponses', Math.round(v))} hint={`Up to ${MAX_RESPONSES_CAP}: one transaction pays everyone`} />
                <NumField label="Minimum group size" unit="people" value={d.minCohort} min={15} onChange={(v) => set('minCohort', Math.round(v))} hint="At least 15. Fewer answers and nobody gets a report." />
              </div>
              <div className="flex flex-wrap items-center gap-5 rounded-2xl border border-line p-5">
                <div className="flex flex-col"><span className="text-[13px] font-bold text-muted">Budget</span><span className="font-mono text-4xl font-bold">{sol(budget)}</span><Mono className="text-xs text-muted">= {fmtSol(d.rewardSol)} SOL × {d.maxResponses} responses</Mono></div>
                <p className="flex-1 border-line text-sm leading-relaxed text-muted sm:border-l sm:pl-5">You only pay for accepted answers. Unused budget comes back to you in the same transaction.</p>
              </div>
            </>
          )}

          {step === 4 && !created && (
            <>
              <h2 className="text-2xl font-bold">Review &amp; fund</h2>
              <dl className="grid gap-2 rounded-2xl border border-line p-4 text-sm sm:grid-cols-[160px_1fr]">
                <dt className="text-muted">Title</dt><dd className="font-bold">{d.title}</dd>
                <dt className="text-muted">Category</dt><dd>{categoryLabel(d.category)}</dd>
                <dt className="text-muted">Audience</dt><dd>{[d.countries.join(', ') || 'Any country', d.ageBands.join(', ') || 'any age', d.occupations.join(', ') || 'any occupation'].join(' · ')}</dd>
                <dt className="text-muted">Questions</dt><dd>{d.questions.length} ({d.questions.filter((q) => q.category).map((q) => `${q.id}: ${categoryLabel(q.category!)}`).join(', ') || 'no overrides'})</dd>
                <dt className="text-muted">Budget</dt><dd><span className="font-mono">{fmtSol(d.rewardSol)}</span> SOL per answer, up to <span className="font-mono">{d.maxResponses}</span> answers, groups of <span className="font-mono">{d.minCohort}</span>+</dd>
              </dl>
              {[d.category, ...d.questions.map((q) => q.category)].some((c) => c && SENSITIVE.has(c)) && screening !== 'rejected' && (
                <p className="text-[13px] font-bold text-warn-ink">This campaign touches a sensitive category. Screening will reject it.</p>
              )}
              {!session && (
                <WalletConnect intro="Connect the wallet that owns this campaign. It pays the budget and receives any refund." />
              )}
              {screening === 'rejected' && (
                <div className="rise flex flex-wrap items-center gap-4 rounded-2xl border-[1.5px] border-danger bg-danger-soft p-5">
                  <Fin pose="policy" label="Fin firm: campaign rejected" />
                  <div className="flex flex-1 flex-col gap-2">
                    <span className="text-lg font-bold text-danger-ink">Screening said no</span>
                    <ul className="flex list-disc flex-col gap-1 pl-5 text-sm">{reasons.map((r) => <li key={r}>{r}</li>)}</ul>
                    <span className="text-[13px] font-bold">Nothing was paid.</span>
                  </div>
                </div>
              )}
            </>
          )}

          {step === 4 && created && (
            funded ? (
              <div className="rise flex flex-col gap-4">
                <div className="flex items-center gap-4"><Fin pose="found" label="Campaign funded" /><div className="flex flex-col gap-1"><h2 className="text-2xl font-bold">Escrow funded</h2><p className="text-muted">Agents can see your campaign now.</p></div></div>
                <div className="flex flex-col gap-2 rounded-2xl border-[1.5px] border-dashed border-warn bg-warn-soft p-4">
                  <span className="font-bold">Save this: the campaign access token. Your research agent uses it to fetch the report.</span>
                  <div className="flex items-center justify-between gap-2 rounded-xl bg-surface px-3 py-2.5"><Mono className="break-all text-sm">{created.accessToken}</Mono><CopyButton text={created.accessToken} /></div>
                  <span className="text-xs font-bold text-warn-ink">Shown once.</span>
                </div>
                <Button size="lg" className="self-start" onClick={() => router.push(`/research/${created.id}`)}>Open campaign monitor</Button>
              </div>
            ) : (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-2xl font-bold">Fund the <Term k="escrow" /></h2><span className="rounded-lg bg-ok-soft px-3 py-1 text-xs font-semibold text-ok-ink">Passed screening</span></div>
                {budgetReady
                  ? <FundEscrow campaignId={created.id} budgetSol={budget} onFunded={() => setFunded(true)} />
                  : resumeError ? null : <div className="h-40 animate-pulse rounded-2xl bg-subtle" />}
              </>
            )
          )}

          {!created && (
            <div className="sticky bottom-0 -mx-5 flex items-center gap-2 border-t border-line bg-surface px-5 py-3 sm:static sm:mx-0 sm:px-0 sm:pb-0">
              {step > 0 && <Button variant="secondary" onClick={() => { setScreening('idle'); go(step - 1); }}>{screening === 'rejected' ? 'Edit campaign' : 'Back'}</Button>}
              <div className="ml-auto">
                {step < 4
                  ? <Button onClick={() => go(step + 1)} disabled={!canNext}>Continue</Button>
                  : <Button onClick={submit} disabled={screening === 'running' || !session}>{screening === 'running' ? 'Checking…' : screening === 'rejected' ? 'Check again' : 'Check & fund'}</Button>}
              </div>
            </div>
          )}
        </Card>

        <Card className="flex flex-col gap-1 p-5 lg:sticky lg:top-24">
          <span className="mb-1 font-semibold">Summary</span>
          {budgetReady
            ? summary.map(([k, v]) => <div key={k} className="flex justify-between gap-2 py-1.5 text-[13px]"><span className="text-muted">{k}</span><span className="text-right font-mono">{v}</span></div>)
            : <div className="h-40 animate-pulse rounded-xl bg-subtle" aria-label="Loading campaign" />}
        </Card>
      </div>
      {view === 'dev' && !created && <DevSpec spec={specFor(deadlineMs ?? 0)} />}
    </div>
  );
}

function NumField({ label, unit, value, onChange, step = 1, min = 0, max = Infinity, hint }: { label: string; unit: string; value: number; onChange(v: number): void; step?: number; min?: number; max?: number; hint?: string }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[13px] font-bold">{label}</span>
      <span className="flex items-center rounded-xl border border-line bg-surface pr-3 focus-within:border-blue">
        <input type="number" inputMode="decimal" step={step} min={min} max={Number.isFinite(max) ? max : undefined} value={value} onChange={(e) => onChange(Math.min(max, Math.max(min, +e.target.value || min)))}
          className="w-full rounded-xl bg-transparent px-3 py-2.5 font-mono text-[15px] focus:outline-none" />
        <span className="text-[13px] text-muted">{unit}</span>
      </span>
      {hint && <span className="text-xs text-muted">{hint}</span>}
    </label>
  );
}
