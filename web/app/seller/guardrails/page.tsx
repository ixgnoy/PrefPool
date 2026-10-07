'use client';
import { useEffect, useState } from 'react';
import { GuardrailEditor } from '@/components/GuardrailEditor';
import { ProfileMatch } from '@/components/ProfileMatch';
import { Button, EmptyState, PageTitle, Toast, cx } from '@/components/ui';
import { useStore } from '@/lib/store';
import { DEMO_NOTE } from '@/lib/config';

export default function GuardrailsPage() {
  const { agent, policy, savePolicy, matchProfile, setMatchProfile, profile, setProfile } = useStore();
  const [draft, setDraft] = useState(policy);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (agent) setDraft(policy); }, [agent?.agentId]); // eslint-disable-line react-hooks/exhaustive-deps

  const dirty = JSON.stringify(draft) !== JSON.stringify(policy);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  async function save() {
    setSaving(true); setError(null);
    try { await savePolicy(draft); } catch (e) { setError((e as Error).message); setSaving(false); return; }
    setSaving(false);
    setToast(true);
    setTimeout(() => setToast(false), 3200);
  }

  if (agent === undefined) return <div className="h-72 animate-pulse rounded-2xl bg-surface" />;
  if (agent === null) return <EmptyState pose="policy" text="Set up your agent first; its rules are saved with it." action={<Button href="/seller/onboarding">Set up my agent</Button>} />;

  return (
    <div className="pb-28">
      <PageTitle title="Your agent's rules" sub="Your agent only answers campaigns that pass every rule below. Everything else, it skips." />
      <GuardrailEditor value={draft} onChange={setDraft} />
      <div className="mt-6"><ProfileMatch compact on={matchProfile} onToggle={setMatchProfile} profile={profile} onChange={setProfile} /></div>
      <p className="mt-6 text-xs text-muted">{DEMO_NOTE}</p>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 backdrop-blur">
        <div className="mx-auto flex max-w-[clamp(1280px,90vw,2200px)] items-center gap-3 px-4 py-3 sm:px-8">
          <span className={cx('size-2.5 rounded-full', dirty ? 'bg-warn' : 'bg-ok')} />
          <span className="mr-auto text-sm font-bold">{error ? <span className="text-danger-ink">{error}</span> : dirty ? 'Unsaved changes' : 'All rules saved'}</span>
          <Button variant="secondary" onClick={() => setDraft(policy)} disabled={!dirty || saving}>Discard</Button>
          <Button onClick={save} disabled={!dirty || saving}>{saving ? 'Saving…' : 'Save guardrails'}</Button>
        </div>
      </div>
      <Toast show={toast}>Rules updated. Your agent follows them from the next campaign.</Toast>
    </div>
  );
}
