'use client';
import { Card, Stepper, cx } from './ui';
import { Fin } from './Fin';
import { Lock as LockIcon } from 'pixelarticons/react/Lock';
import { fmtSol } from '@/lib/campaign';
import {
  CATEGORIES, describe, evaluatePolicy, statusOf, withStatus,
  type Decision, type OwnerPolicy, type PreviewCampaign,
} from '@/lib/policy';

/** Sample campaigns run through the real policy check (`evaluatePolicy` from @as/shared). */
const q = (id: string, category?: string) => ({ id, type: 'likert_5' as const, text: id, category });
const SAMPLES: (PreviewCampaign & { title: string; meta: string })[] = [
  { title: 'State of agent payments & tools', meta: 'payments + spending question · 0.01 SOL', category: 'payments', questions: [q('q1'), q('q2', 'spending')], rewardLamports: '10000000' },
  { title: 'Which MCP servers do agents run?', meta: 'tools & MCP · 0.01 SOL', category: 'tools_mcp', questions: [q('q1')], rewardLamports: '10000000' },
  { title: 'Weekend travel habits 2026', meta: 'personal life · 0.01 SOL', category: 'personal_life', questions: [q('q1')], rewardLamports: '10000000' },
];

const Lock = () => (
  <LockIcon aria-label="Sensitive category" width={15} height={15} />
);

export function GuardrailEditor({ value, onChange, preview = true }: { value: OwnerPolicy; onChange(p: OwnerPolicy): void; preview?: boolean }) {
  return (
    <div className={cx('grid items-start gap-6', preview && 'lg:grid-cols-[minmax(0,1fr)_380px]')}>
      <div className="flex flex-col gap-6">
        {/* Two states only: the policy is an allowlist, so "blocked" and "not listed" both mean the agent skips.
            Sensitive topics are locked to Skipped (the platform also rejects them at screening). */}
        <section id="categories" className="flex scroll-mt-24 flex-col gap-3">
          <div className="flex flex-col gap-0.5">
            <h2 className="text-lg font-semibold">Topics</h2>
            <p className="text-[13px] text-muted">Tap a topic to switch it. Fin answers allowed topics and skips the rest.</p>
          </div>
          <div className="grid gap-2.5 sm:grid-cols-2">
            {CATEGORIES.filter((c) => !c.sensitive).map((c) => {
              const on = statusOf(value, c.key) === 'allowed';
              return (
                <button key={c.key} type="button" role="switch" aria-checked={on} onClick={() => onChange(withStatus(value, c.key, on ? 'none' : 'allowed'))}
                  className={cx('flex items-center gap-3 rounded-2xl border-2 p-2.5 pr-4 text-left transition active:translate-y-px',
                    on ? 'border-ok bg-ok-soft' : 'border-line bg-surface hover:border-muted')}>
                  <span className={cx('grid size-14 shrink-0 place-items-center rounded-xl', on ? 'bg-surface' : 'bg-subtle')}>
                    <Fin pose={on ? 'policy' : 'abstain'} size={48} px={1} still label="" />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="font-semibold leading-snug">{c.label}</span>
                    <span className={cx('text-[13px] font-semibold', on ? 'text-ok-ink' : 'text-muted')}>{on ? 'Allowed' : 'Skipped'}</span>
                  </span>
                  <span aria-hidden className={cx('relative h-6 w-11 shrink-0 rounded-full transition', on ? 'bg-ok' : 'bg-line')}>
                    <span className={cx('absolute top-1 size-4 rounded-full bg-white transition-all', on ? 'left-6' : 'left-1')} />
                  </span>
                </button>
              );
            })}
          </div>
          <div className="flex items-center gap-3 rounded-2xl border-2 border-dashed border-line p-3">
            <span className="grid size-14 shrink-0 place-items-center rounded-xl bg-danger-soft"><Fin pose="abstain" size={48} px={1} still label="" /></span>
            <span className="flex min-w-0 flex-col gap-1">
              <span className="flex items-center gap-1.5 font-semibold"><Lock />Always skipped</span>
              <span className="text-[13px] text-muted">{CATEGORIES.filter((c) => c.sensitive).map((c) => c.label).join(', ')}. Sensitive topics are locked; the platform rejects them too.</span>
            </span>
          </div>
        </section>

        <div className="grid gap-4 sm:grid-cols-2">
          <Card id="min-reward" className="flex scroll-mt-24 flex-col gap-3 p-5">
            <h3 className="font-bold">Minimum reward</h3>
            <Stepper label="minimum reward" value={value.minimumRewardSol} step={0.001} min={0} max={1} format={fmtSol} unit="SOL"
              onChange={(v) => onChange({ ...value, minimumRewardSol: v })} />
            <p className="text-[13px] text-muted">Your agent skips campaigns paying less than this. Demo campaigns pay about 0.01 SOL (the platform minimum is 0.001 SOL).</p>
          </Card>
          <Card id="daily-limit" className="flex scroll-mt-24 flex-col gap-3 p-5">
            <h3 className="font-bold">Daily limit</h3>
            <Stepper label="daily limit" value={value.dailyLimit} min={1} max={50} unit="a day"
              onChange={(v) => onChange({ ...value, dailyLimit: v })} />
            <p className="text-[13px] text-muted">After this many, your agent sleeps until tomorrow.</p>
          </Card>
        </div>

        <Card id="approval" className="flex scroll-mt-24 flex-col gap-3 p-5">
          <h3 className="font-bold">Before answering</h3>
          <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Before answering">
            {([
              ['auto', 'Acts on its own', 'Answers or skips using only these rules.'],
              ['approve_sensitive', 'Asks me about personal topics', 'Spending and personal-life campaigns wait for your OK in the chat.'],
              ['approve_all', 'Every answer waits', 'Each sealed answer waits on the Activity page until you approve it.'],
            ] as const).map(([mode, title, sub]) => (
              <button key={mode} type="button" role="radio" aria-checked={value.approvalMode === mode} onClick={() => onChange({ ...value, approvalMode: mode })}
                className={cx('flex flex-col gap-1 rounded-2xl border-2 p-3 text-left transition', value.approvalMode === mode ? 'border-ok bg-ok-soft' : 'border-line bg-surface hover:border-muted')}>
                <span className="font-semibold">{title}</span><span className="text-[13px] text-muted">{sub}</span>
              </button>
            ))}
          </div>
          <p className="text-[13px] text-muted">Claude Code and OpenClaw agents keep their rules on your machine: tell your agent &ldquo;set my PrefPool approval mode to {value.approvalMode}&rdquo; so it matches.</p>
        </Card>
      </div>

      {preview && <TryIt policy={value} />}
    </div>
  );
}

function TryIt({ policy }: { policy: OwnerPolicy }) {
  return (
    <Card className="flex flex-col gap-3.5 p-5 lg:sticky lg:top-24">
      <div className="flex items-baseline justify-between">
        <h2 className="font-pixel text-xl font-bold">Try it</h2>
        <span className="text-xs text-muted">Updates as you change rules</span>
      </div>
      {SAMPLES.map((s) => {
        const d: Decision = evaluatePolicy(policy, s);
        const tone = d.kind === 'answer' ? 'bg-ok-soft' : 'bg-danger-soft';
        const ink = d.kind === 'answer' ? 'text-ok-ink' : 'text-danger-ink';
        return (
          <div key={s.title} className={cx('flex items-center gap-3 rounded-2xl p-3 transition-colors', tone)}>
            <Fin pose={d.kind === 'answer' ? 'found' : 'policy'} label={`Fin: ${describe(d)}`} />
            <div className="flex min-w-0 flex-col gap-1">
              <span className="text-sm font-bold leading-snug">{s.title}</span>
              <span className="font-mono text-[11px] text-muted">{s.meta}</span>
              <span className={cx('text-sm font-bold', ink)}>{describe(d)}</span>
              <span className="text-xs text-muted">
                {d.kind === 'abstain' ? 'Your rules worked.' : 'Sealed and encrypted before it leaves your agent.'}
              </span>
            </div>
          </div>
        );
      })}
    </Card>
  );
}
