'use client';
// "My answers" (Activity tab): earnings by category, plus the agent's own answers (encrypt to self). The owner unlocks them
// with a wallet signature over a fixed message; the browser derives the transcript key from it and opens the sealed
// copies locally. The server, the buyer and CRE's report never see these per-person answers.
import { useEffect, useMemo, useState } from 'react';
import { openSealed, transcriptKeyMessage, type AnswerSource, type Answers, type Question } from '@as/shared';
import { solOf } from '@/lib/campaign';
import { Fin } from '@/components/Fin';
import { Button, Card, EmptyState, Pill, TxLink, cx } from '@/components/ui';
import { getAnswerCopies, type AnswerCopy } from '@/lib/api';
import { useActivity } from '@/lib/useActivity';
import { categoryLabel } from '@/lib/policy';
import { useStore } from '@/lib/store';
import { useTranscriptKey } from '@/lib/useTranscriptKey';

/** One answer as the owner reads it. single_choice values are canonical option indexes. */
export const answerLabel = (q: Question, v: number | undefined) =>
  v === undefined ? '-' : q.type === 'likert_5' ? `${v} / 5` : (q.options?.[v] ?? `option ${v}`);

export function MyAnswers() {
  const { session, agent } = useStore();
  const { items, totals, loading } = useActivity();
  const [copies, setCopies] = useState<AnswerCopy[] | null>(null);
  const [serverKey, setServerKey] = useState<string | null | undefined>(undefined);
  const { transcriptKey, unlock, busy, error, setError } = useTranscriptKey(serverKey);

  useEffect(() => {
    if (!session) return;
    getAnswerCopies(session.sessionToken).then((r) => { setCopies(r.copies); setServerKey(r.transcriptPublicKey); }).catch((e: Error) => setError(e.message));
  }, [session, transcriptKey]);

  const opened = useMemo(() => (copies ?? []).map((c) => {
    const none = { c, answers: null as Answers | null, sources: null as Record<string, AnswerSource> | null };
    if (!transcriptKey) return none;
    try {
      const o = openSealed(transcriptKey, c.envelope);
      return { c, answers: o.answers, sources: o.meta?.sources ?? null };
    } catch { return none; }
  }), [copies, transcriptKey]);
  const outcome = (id: string) => items.find((i) => i.campaignId === id);

  if (agent === null) return <EmptyState pose="sleeping" text="Set up your agent first; then this page shows what it sold." action={<Button href="/seller/onboarding">Set up my agent</Button>} />;

  return (
    <div className="flex flex-col gap-6">
      <Card className="overflow-x-auto">
        <div className="px-5 pt-4"><h2 className="font-semibold">Earnings by category</h2></div>
        <table className="mt-2 w-full min-w-[520px] text-sm">
          <thead><tr className="border-y border-line text-left text-xs font-semibold text-muted">
            <th className="px-5 py-2">Category</th><th className="px-2 py-2">Seen</th><th className="px-2 py-2">Answered</th><th className="px-2 py-2">Answer rate</th><th className="px-5 py-2 text-right">Earned</th>
          </tr></thead>
          <tbody>
            {(totals?.byCategory ?? []).map((c) => (
              <tr key={c.category} className="border-b border-subtle last:border-0">
                <td className="px-5 py-2.5 font-bold">{categoryLabel(c.category)}</td>
                <td className="px-2 py-2.5 font-mono">{c.seen}</td>
                <td className="px-2 py-2.5 font-mono">{c.answered}</td>
                <td className="px-2 py-2.5 font-mono">{c.seen ? Math.round((c.answered / c.seen) * 100) : 0}%</td>
                <td className="px-5 py-2.5 text-right font-mono">{solOf(c.earnedLamports)}</td>
              </tr>
            ))}
            {!loading && !(totals?.byCategory ?? []).length && <tr><td colSpan={5} className="px-5 py-6 text-center text-muted">No campaigns yet.</td></tr>}
          </tbody>
        </table>
      </Card>

      <Card className="flex flex-col gap-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h2 className="font-bold">My agent&apos;s answers</h2>
            <span className="text-[13px] text-muted">Sealed copies stored by PrefPool as ciphertext. Your wallet signature unlocks them in this browser only.</span>
          </div>
          {transcriptKey ? <Pill tone="ok">Unlocked in this tab</Pill> : (
            <Button onClick={unlock} disabled={busy || !session}>{busy ? 'Check your wallet…' : 'Unlock my answers'}</Button>
          )}
        </div>
        {error && <p role="alert" className="text-sm font-bold text-danger-ink">{error}</p>}
        {!transcriptKey && (
          <div className="flex items-center gap-4 rounded-2xl bg-blue-soft p-4">
            <Fin pose="sealed" label="Sealed answers" />
            <p className="text-sm">Your wallet will ask you to <b>sign a message</b>: &ldquo;{transcriptKeyMessage('').replace(/ · $/, '')}&rdquo;. It&apos;s not a transaction and costs nothing.
              {serverKey === null && ' The first unlock also gives your agent the key to seal future answers to; answers given before that can\'t be shown.'}</p>
          </div>
        )}
        {copies === null ? <div className="h-32 animate-pulse rounded-xl bg-subtle" /> : copies.length === 0 ? (
          <p className="text-sm text-muted">No sealed copies yet. Your agent adds one each time it answers, once you&apos;ve unlocked here at least once. The web agent and the PrefPool plugin both do this.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {opened.map(({ c, answers, sources }) => {
              const o = outcome(c.campaignId);
              return (
                <li key={c.campaignId} className="rounded-2xl border border-line p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-col">
                      <span className="font-bold">{c.title}</span>
                      <span className="text-xs text-muted">{categoryLabel(c.category)} · answered {new Date(c.receivedAtMs).toLocaleString()}</span>
                    </div>
                    <span className={cx('text-sm font-bold', o?.outcome === 'paid' ? 'text-ok-ink' : o?.outcome === 'not_paid' ? 'text-danger-ink' : 'text-blue')}>
                      {o?.outcome === 'paid' ? `Accepted · paid ${solOf(o.payoutLamports)}` : o?.outcome === 'not_paid' ? `Not paid: ${o.notPaidReason}` : 'Waiting for results'}
                      {o?.settlementTx && <> · <TxLink hash={o.settlementTx} /></>}
                    </span>
                  </div>
                  {answers ? (
                    <dl className="mt-3 grid gap-2">
                      {c.questions.map((q) => (
                        <div key={q.id} className="grid gap-1 rounded-xl bg-subtle px-3 py-2 sm:grid-cols-[minmax(0,1fr)_220px] sm:items-center">
                          <dt className="text-sm">{q.text}</dt>
                          <dd className="flex items-center gap-2 text-sm font-bold sm:justify-end">
                            {answerLabel(q, answers[q.id])}
                            {sources?.[q.id] && <Pill>{sources[q.id]!.replace('_', ' ')}</Pill>}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  ) : <p className="mt-2 text-sm text-muted">{transcriptKey ? "Can't open this copy with this wallet's key." : `${c.questions.length} answers sealed.`}</p>}
                </li>
              );
            })}
          </ul>
        )}
        <p className="text-xs text-muted">Buyers only ever get totals for groups of 15+. These per-question answers are yours alone.</p>
      </Card>
    </div>
  );
}
