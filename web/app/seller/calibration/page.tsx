'use client';
// Calibration (spec 2026-10-07-agent-calibration-design.md §7): your agent answers 15 questions about you first,
// then you answer the same ones here within 10 minutes. We compare, keep only the score, and forget the answers.
import { useCallback, useEffect, useState } from 'react';
import { Check } from 'pixelarticons/react/Check';
import { Lock } from 'pixelarticons/react/Lock';
import { Button, Card, ChoiceChip, CopyButton, Countdown, EmptyState, FinTank, PageTitle, Pill, useNow } from '@/components/ui';
import {
  ApiError, getCalibration, openCalibration, startCalibration, submitCalibration,
  type CalibrationQ, type CalibrationResult, type CalibrationStatus,
} from '@/lib/api';
import { useStore } from '@/lib/store';
import { CALIBRATION_MAX_PROBES } from '@as/shared';

const DAY = 86_400_000;
/** What to paste into an agent that only acts when asked (Claude Code, Cursor, …). OpenClaw picks rounds up on its heartbeat. */
const NUDGE = 'Check my PrefPool calibration and answer the waiting round for me.';
const LIKERT = ['1 · Not at all', '2', '3', '4', '5 · Very much'];
// A refresh mid-quiz keeps the picks (the 10-minute timer keeps running on the server anyway).
const draftKey = (roundId: string) => `cf.calibration.${roundId}`;
const loadDraft = (roundId: string): Record<string, number> => { try { return JSON.parse(sessionStorage.getItem(draftKey(roundId)) ?? '{}'); } catch { return {}; } };
const saveDraft = (roundId: string, a: Record<string, number>) => { try { sessionStorage.setItem(draftKey(roundId), JSON.stringify(a)); } catch { /* storage blocked */ } };
// Probes ("my agent couldn't know this") survive a refresh the same way.
const probesKey = (roundId: string) => `cf.calibration.${roundId}.probes`;
const loadProbes = (roundId: string): Set<string> => { try { return new Set(JSON.parse(sessionStorage.getItem(probesKey(roundId)) ?? '[]')); } catch { return new Set(); } };
const saveProbes = (roundId: string, p: Set<string>) => { try { sessionStorage.setItem(probesKey(roundId), JSON.stringify([...p])); } catch { /* storage blocked */ } };
const pct = (x: number) => `${Math.round(x * 100)}%`;
const days = (ms: number) => Math.max(0, Math.ceil(ms / DAY));

export default function CalibrationPage() {
  const { session, agent } = useStore();
  const [status, setStatus] = useState<CalibrationStatus | null>(null);
  const [quiz, setQuiz] = useState<{ roundId: string; questions: CalibrationQ[]; deadline: number } | null>(null);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [unknowable, setUnknowable] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<{ r: CalibrationResult; probes: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const token = session?.sessionToken;
  const now = useNow();
  const timeUp = !!quiz && now !== null && now > quiz.deadline;

  const refresh = useCallback(async () => {
    if (!token) return;
    try { setStatus(await getCalibration(token)); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, [token]);
  useEffect(() => { void refresh(); const t = setInterval(refresh, 15_000); return () => clearInterval(t); }, [refresh]);

  const act = async (fn: () => Promise<void>) => {
    setBusy(true); setError(null);
    try { await fn(); } catch (e) { setError(e instanceof ApiError || e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  const start = () => act(async () => { await startCalibration(token!); await refresh(); });
  const open = () => act(async () => {
    const r = status!.round!;
    const q = await openCalibration(token!, r.roundId);
    setQuiz({ roundId: r.roundId, ...q }); setAnswers(loadDraft(r.roundId)); setUnknowable(loadProbes(r.roundId)); setResult(null);
  });
  const submit = () => act(async () => {
    try {
      const probes = [...unknowable];
      const { result: res } = await submitCalibration(token!, quiz!.roundId, answers, probes);
      setResult({ r: res, probes: probes.length });
    } catch (e) {
      // Time ran out, or the round closed elsewhere: drop the stale quiz so "Calibrate now" comes back.
      if (!(e instanceof ApiError && (e.code === 'EXPIRED' || e.code === 'CLOSED'))) throw e;
      setError(e.code === 'EXPIRED' ? 'Time ran out for this round. Start a new one with Calibrate now.' : 'This round has already closed.');
    }
    try { sessionStorage.removeItem(draftKey(quiz!.roundId)); sessionStorage.removeItem(probesKey(quiz!.roundId)); } catch { /* storage blocked */ }
    setQuiz(null); setUnknowable(new Set()); await refresh();
  });
  const toggleProbe = (id: string) => setUnknowable((p) => {
    const next = new Set(p);
    if (next.has(id)) next.delete(id); else if (next.size < CALIBRATION_MAX_PROBES) next.add(id);
    if (quiz) saveProbes(quiz.roundId, next);
    return next;
  });
  const pick = (id: string, v: number) => setAnswers((a) => { const next = { ...a, [id]: v }; if (quiz) saveDraft(quiz.roundId, next); return next; });

  if (agent === null) return <EmptyState pose="sleeping" text="Set up your agent first; then calibrate it here." action={<Button href="/seller/onboarding">Set up my agent</Button>} />;
  if (!status) return <div className="h-96 animate-pulse rounded-2xl bg-surface" />;

  const valid = status.calibratedUntil && status.calibratedUntil > Date.now();
  const header = (
    <PageTitle title="Calibration" sub="Check that your agent really knows you. Some campaigns only accept calibrated agents." />
  );

  if (!status.calibratable) return (
    <>
      {header}
      <EmptyState pose="policy" text="The web demo agent answers from your wallet address, so it can't be calibrated. Pair Claude Code, OpenClaw or another MCP agent that knows you." action={<Button href="/seller/agent">Pair an agent</Button>} />
    </>
  );

  return (
    <>
      {header}
      <div className="grid items-start gap-6 lg:grid-cols-[340px_minmax(0,1fr)]">
        <div className="flex flex-col gap-5">
          <Card className="flex flex-col gap-3 p-5">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-base font-bold">Status</h2>
              {valid ? <Pill tone="ok"><Check aria-hidden width={14} height={14} />Calibrated</Pill> : <Pill>Not calibrated</Pill>}
            </div>
            <FinTank pose={valid ? 'found' : 'policy'} label={valid ? 'Calibrated agent' : 'Agent not calibrated yet'} className="h-28 w-full" />
            {valid
              ? <p className="text-sm">Valid for <b className="font-mono">{days(status.calibratedUntil! - Date.now())}</b> more days. A new round starts automatically when it runs out.</p>
              : <p className="text-sm text-muted">Pass a round to unlock campaigns that only accept calibrated agents.</p>}
            {status.last && (
              <p className="text-[13px] text-muted">Last round: matched you on <b className="font-mono text-ink">{pct(status.last.agreement)}</b>, a typical person&apos;s answers would match <b className="font-mono text-ink">{pct(status.last.baseline)}</b> · {status.last.abstainRate !== null && <> · said &quot;unknown&quot; on <b className="font-mono text-ink">{pct(status.last.abstainRate)}</b> of what it couldn&apos;t know</>} · {status.last.passed ? 'passed' : 'not passed'}</p>
            )}
            {!status.round && !quiz && <Button className="self-start" variant={valid ? 'secondary' : 'primary'} onClick={start} disabled={busy}>Calibrate now</Button>}
          </Card>
          <div className="flex gap-3 rounded-2xl bg-blue-soft p-4 text-sm leading-relaxed">
            <Lock aria-hidden width={18} height={18} className="mt-0.5 shrink-0 text-blue" />
            <span><b>Private.</b> We compare your answers with your agent&apos;s, keep only the score, and delete both sets of answers. Buyers never see them.</span>
          </div>
        </div>

        <div className="flex flex-col gap-5">
          {result && <ResultCard r={result.r} probes={result.probes} />}

          {quiz ? (
            <Card className="flex flex-col gap-5 p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-base font-bold">Answer for yourself</h2>
                <Pill tone="warn"><Countdown to={quiz.deadline} /></Pill>
              </div>
              <p className="text-[13px] text-muted">Don&apos;t ask your agent: this checks that it knows you. {Object.keys(answers).length} of {quiz.questions.length} answered. Tick &quot;My agent couldn&apos;t know this&quot; on up to {CALIBRATION_MAX_PROBES} questions you never told it about ({unknowable.size} marked).</p>
              <ol className="flex flex-col gap-4">
                {quiz.questions.map((q, i) => (
                  <li key={q.id} className="flex flex-col gap-2 border-t border-line pt-4 first:border-0 first:pt-0">
                    <span className="text-sm font-bold"><span className="font-mono text-muted">{i + 1}.</span> {q.text}</span>
                    <div className="flex flex-wrap gap-2">
                      {(q.type === 'likert_5' ? LIKERT : q.options!).map((label, k) => {
                        const v = q.type === 'likert_5' ? k + 1 : k;
                        return <ChoiceChip key={label} on={answers[q.id] === v} onClick={() => pick(q.id, v)}>{label}</ChoiceChip>;
                      })}
                    </div>
                    <label className={`flex items-center gap-2 text-[13px] ${!unknowable.has(q.id) && unknowable.size >= CALIBRATION_MAX_PROBES ? 'text-muted opacity-60' : 'text-muted'}`}>
                      <input type="checkbox" className="size-4" checked={unknowable.has(q.id)} onChange={() => toggleProbe(q.id)}
                        disabled={!unknowable.has(q.id) && unknowable.size >= CALIBRATION_MAX_PROBES} />
                      My agent couldn&apos;t know this
                    </label>
                  </li>
                ))}
              </ol>
              {timeUp
                ? <div className="flex flex-wrap items-center gap-3"><p className="text-sm font-bold text-danger-ink">Time&apos;s up for this round.</p><Button variant="secondary" onClick={submit} disabled={busy}>Close it</Button></div>
                : <Button className="self-start" onClick={submit} disabled={busy || Object.keys(answers).length < quiz.questions.length}>{busy ? 'Scoring…' : 'Submit my answers'}</Button>}
            </Card>
          ) : status.round?.state === 'CREATED' ? (
            <Card className="flex flex-col gap-2 p-5">
              <h2 className="text-base font-bold">Waiting for your agent</h2>
              <p className="text-sm text-muted">Your agent has 15 questions about you. OpenClaw answers on its next heartbeat. Claude Code and other agents answer when you ask them: paste this in.</p>
              <div className="flex items-center justify-between gap-2 rounded-xl bg-subtle px-3 py-2.5">
                <span className="font-mono text-[13px]">{NUDGE}</span>
                <CopyButton text={NUDGE} label="Copy prompt" />
              </div>
              <p className="text-[13px] text-muted">This page updates by itself when your agent has answered. It has 24 hours.</p>
            </Card>
          ) : status.round ? (
            <Card className="flex flex-col gap-3 p-5">
              <h2 className="text-base font-bold">Your turn: 15 quick questions</h2>
              <p className="text-sm text-muted">Your agent has answered. Answer the same questions about yourself; you have 10 minutes once you start. You won&apos;t see your agent&apos;s answers.</p>
              <Button className="self-start" onClick={open} disabled={busy}>{status.round.state === 'OWNER_ANSWERING' ? 'Continue' : 'Start'}</Button>
            </Card>
          ) : !result && (
            <Card className="flex flex-col gap-2 p-5">
              <h2 className="text-base font-bold">How it works</h2>
              <ol className="list-decimal pl-5 text-sm leading-relaxed text-muted">
                <li>Your agent answers 15 questions about you (food, habits, tech, travel…).</li>
                <li>You answer the same questions here, within 10 minutes.</li>
                <li>Your agent passes if it matches you on at least 70%, and by 20 points more than a typical person&apos;s answers would.</li>
                <li>Mark up to {CALIBRATION_MAX_PROBES} questions your agent could not know; it passes only if it said &quot;unknown&quot; on at least half of them.</li>
              </ol>
            </Card>
          )}
          {error && <p role="alert" className="text-sm font-bold text-danger-ink">{error}</p>}
        </div>
      </div>
    </>
  );
}

function ResultCard({ r, probes }: { r: CalibrationResult; probes: number }) {
  return (
    <Card className="flex items-center gap-4 p-5">
      <FinTank pose={r.passed ? 'paid' : 'abstain'} label={r.passed ? 'Calibration passed' : 'Calibration not passed'} className="size-24" />
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-bold">{r.passed ? 'Passed: your agent knows you' : 'Not passed this time'}</h2>
        <p className="text-sm">Your agent matched you on <b className="font-mono">{pct(r.agreement)}</b>. A typical person&apos;s answers would match <b className="font-mono">{pct(r.baseline)}</b>.</p>
        {r.abstainRate !== null && <p className="text-sm">On <b className="font-mono">{probes}</b> question{probes === 1 ? '' : 's'} you said your agent couldn&apos;t know: it admitted it on <b className="font-mono">{pct(r.abstainRate)}</b>.</p>}
        {!r.passed && <p className="text-[13px] text-muted">Chat with your agent about yourself, then calibrate again.</p>}
      </div>
    </Card>
  );
}
