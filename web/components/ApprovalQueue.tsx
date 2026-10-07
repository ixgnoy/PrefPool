'use client';
// Approval queue (policy approve_all): answers the plugin holds on the owner's machine until the owner says yes. The server
// has only the owner's copy (ciphertext to the transcript key); it is opened here, in the browser. Campaign text is
// buyer-written: it is rendered as plain text only.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { openSealed, type AnswerSource, type Answers } from '@as/shared';
import { Lock } from 'pixelarticons/react/Lock';
import { Button, Card, Pill } from '@/components/ui';
import { answerLabel } from '@/components/MyAnswers';
import { ApiError, decideApproval, getApprovals, type PendingApproval } from '@/lib/api';
import { categoryLabel } from '@/lib/policy';
import { useStore } from '@/lib/store';
import { useTranscriptKey } from '@/lib/useTranscriptKey';

const POLL_MS = 10_000;

export function ApprovalQueue() {
  const { session } = useStore();
  const [pending, setPending] = useState<PendingApproval[]>([]);
  const [serverKey, setServerKey] = useState<string | null | undefined>(undefined);
  const [deciding, setDeciding] = useState<string | null>(null);
  const [decideError, setDecideError] = useState<string | null>(null);
  const { transcriptKey, unlock, busy, error } = useTranscriptKey(serverKey);

  const load = useCallback(async () => {
    if (!session) return;
    const r = await getApprovals(session.sessionToken).catch(() => null);
    if (r) { setPending(r.pending); setServerKey(r.transcriptPublicKey); }
  }, [session]);
  useEffect(() => {
    void load();
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  const opened = useMemo(() => pending.map((p) => {
    const none = { p, answers: null as Answers | null, sources: null as Record<string, AnswerSource> | null };
    if (!transcriptKey) return none;
    try {
      const o = openSealed(transcriptKey, p.envelope);
      return { p, answers: o.answers, sources: o.meta?.sources ?? null };
    } catch { return none; }
  }), [pending, transcriptKey]);

  if (!session || pending.length === 0) return null;

  const decide = async (campaignId: string, decision: 'approve' | 'reject') => {
    setDeciding(campaignId); setDecideError(null);
    try {
      await decideApproval(session.sessionToken, campaignId, decision);
    } catch (e) {
      // NO_PENDING: already decided elsewhere or expired; the reload below drops it from the list.
      if (!(e instanceof ApiError && e.code === 'NO_PENDING')) setDecideError(e instanceof Error ? e.message : 'Could not save your decision.');
    } finally {
      setDeciding(null);
      await load();
    }
  };

  return (
    <Card id="approvals" className="flex scroll-mt-24 flex-col gap-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="flex items-center gap-2 font-bold">Waiting for your OK <Pill tone="blue">{pending.length}</Pill></h2>
          <span className="text-[13px] text-muted">Your agent holds these sealed answers on your machine. Nothing is sent until you approve.</span>
        </div>
        {transcriptKey ? <Pill tone="ok">Unlocked in this tab</Pill> : (
          <Button onClick={unlock} disabled={busy}>{busy ? 'Check your wallet…' : 'Unlock to review'}</Button>
        )}
      </div>
      {!transcriptKey && <p className="text-sm text-muted">Unlock with a wallet signature to read each answer before approving it. You can reject without unlocking.</p>}
      {error && <p role="alert" className="text-sm font-bold text-danger-ink">{error}</p>}
      {decideError && <p role="alert" className="text-sm font-bold text-danger-ink">{decideError}</p>}
      <ul className="flex flex-col gap-3">
        {opened.map(({ p, answers, sources }) => (
          <li key={p.campaignId} className="flex flex-col gap-3 rounded-2xl border border-line p-4">
            <div className="flex flex-col">
              <span className="font-bold">{p.title}</span>
              <span className="text-xs text-muted">{categoryLabel(p.category)} · closes {new Date(p.deadlineMs).toLocaleString()}</span>
            </div>
            {answers ? (
              <dl className="grid gap-2">
                {p.questions.map((q) => (
                  <div key={q.id} className="grid gap-1 rounded-xl bg-subtle px-3 py-2 sm:grid-cols-[minmax(0,1fr)_220px] sm:items-center">
                    <dt className="text-sm">{q.text}</dt>
                    <dd className="flex items-center gap-2 text-sm font-bold sm:justify-end">
                      {answerLabel(q, answers[q.id])}
                      {sources?.[q.id] && <Pill>{sources[q.id]!.replace('_', ' ')}</Pill>}
                    </dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="flex items-center gap-1.5 text-sm text-muted">
                <Lock aria-hidden width={15} height={15} />
                {transcriptKey ? "Can't open this answer with this wallet's key." : `${p.questions.length} answers sealed.`}
              </p>
            )}
            <div className="flex gap-2">
              <Button onClick={() => decide(p.campaignId, 'approve')} disabled={!answers || deciding !== null}>Approve</Button>
              <Button variant="secondary" onClick={() => decide(p.campaignId, 'reject')} disabled={deciding !== null}>Reject</Button>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
