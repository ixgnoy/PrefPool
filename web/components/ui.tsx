'use client';
import Link from 'next/link';
import { useEffect, useState, type ButtonHTMLAttributes, type HTMLAttributes, type ReactNode } from 'react';
import { Fin, type Pose } from './Fin';
import { STATE_UI, short, type CampaignState, type Tone } from '@/lib/campaign';
import { explorerAddress, explorerTx } from '@/lib/config';
import { Check } from 'pixelarticons/react/Check';
import { Close } from 'pixelarticons/react/Close';
import { ExternalLink } from 'pixelarticons/react/ExternalLink';
import { Minus } from 'pixelarticons/react/Minus';

export const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(' ');

export function Card({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cx('rounded-2xl border border-line bg-surface', className)} {...rest} />;
}

const BTN = {
  // Duolingo-style press: a darker bottom edge that the button sinks into on click.
  primary: 'bg-blue text-on-accent shadow-[0_4px_0_var(--blue-strong)] hover:brightness-105 active:translate-y-[4px] active:shadow-none',
  secondary: 'border-2 border-line bg-surface text-ink hover:bg-subtle active:translate-y-px',
  danger: 'bg-danger text-white hover:brightness-95',
  ghost: 'text-blue hover:bg-blue-soft',
} as const;
const SIZE = { sm: 'rounded-lg px-3 py-1.5 text-[13px]', md: 'rounded-xl px-4 py-2.5 text-sm', lg: 'rounded-xl px-5 py-3 text-[15px]' } as const;
type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof BTN; size?: keyof typeof SIZE; href?: string };

export function Button({ variant = 'primary', size = 'md', href, className, children, type = 'button', ...rest }: BtnProps) {
  const cls = cx('inline-flex items-center justify-center gap-2 whitespace-nowrap font-bold transition disabled:pointer-events-none disabled:opacity-45', SIZE[size], BTN[variant], className);
  if (href) return <Link href={href} className={cls}>{children}</Link>;
  return <button type={type} className={cls} {...rest}>{children}</button>;
}

const TONE: Record<Tone, string> = {
  neutral: 'bg-subtle text-muted',
  blue: 'bg-blue-soft text-blue',
  ok: 'bg-ok-soft text-ok-ink',
  danger: 'bg-danger-soft text-danger-ink',
  warn: 'bg-warn-soft text-warn-ink',
};
export function Pill({ tone = 'neutral', className, children }: { tone?: Tone; className?: string; children: ReactNode }) {
  return <span className={cx('inline-flex items-center gap-1 whitespace-nowrap rounded-lg px-2 py-0.5 text-xs font-semibold', TONE[tone], className)}>{children}</span>;
}
export function StatePill({ state }: { state: CampaignState | string }) {
  const s = STATE_UI[state as CampaignState] ?? { label: state, tone: 'neutral' as const };
  return <Pill tone={s.tone}>{s.label}</Pill>;
}

export function StatTile({ label, value, unit, note }: { label: string; value: string; unit?: string; note?: string }) {
  return (
    <Card className="flex flex-col justify-between gap-1.5 p-4">
      <span className="text-[13px] font-bold text-muted">{label}</span>
      <span className="flex items-baseline gap-1.5"><span className="font-mono text-[32px] font-semibold leading-none tracking-tight">{value}</span>{unit && <span className="text-[13px] font-bold">{unit}</span>}</span>
      {note && <span className="text-xs text-muted">{note}</span>}
    </Card>
  );
}

export function CategoryChip({ status, children }: { status: 'allowed' | 'blocked' | 'none'; children: ReactNode }) {
  const [Mark, cls] = ({ allowed: [Check, 'bg-ok-soft text-ok-ink'], blocked: [Close, 'bg-danger-soft text-danger-ink'], none: [Minus, 'bg-subtle text-muted'] } as const)[status];
  return <span className={cx('inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-xs font-bold', cls)}><Mark aria-hidden width={14} height={14} />{children}</span>;
}

export function ChoiceChip({ on, onClick, children }: { on: boolean; onClick(): void; children: ReactNode }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick}
      className={cx('rounded-full border-[1.5px] px-3.5 py-1.5 text-sm font-bold transition', on ? 'border-blue bg-blue-soft text-blue' : 'border-line bg-surface hover:border-muted')}>
      {children}
    </button>
  );
}

export const Mono = ({ className, children }: { className?: string; children: ReactNode }) => <span className={cx('font-mono font-medium', className)}>{children}</span>;

/** Solana Explorer (Devnet). */
export function TxLink({ hash, className, full = false }: { hash: string; className?: string; full?: boolean }) {
  const href = explorerTx(hash);
  return <a href={href} target="_blank" rel="noreferrer" className={cx('font-mono text-[13px] font-medium text-blue hover:underline', full && 'break-all', className)}>{full ? hash : short(hash, 6, 4)}<ExternalLink aria-hidden width={14} height={14} className="ml-0.5 inline align-[-2px]" /></a>;
}
export function AddressLink({ address, className, full = false }: { address: string; className?: string; full?: boolean }) {
  const href = explorerAddress(address);
  return <a href={href} target="_blank" rel="noreferrer" className={cx('font-mono text-[13px] font-medium text-blue hover:underline', full && 'break-all', className)}>{full ? address : short(address, 12, 4)}<ExternalLink aria-hidden width={14} height={14} className="ml-0.5 inline align-[-2px]" /></a>;
}

export function CopyButton({ text, label = 'Copy', className }: { text: string; label?: string; className?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" className={cx('rounded-lg px-2 py-1 text-xs font-bold text-blue hover:bg-blue-soft', className)}
      onClick={async () => { try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500); } catch { /* clipboard blocked */ } }}>
      {done ? 'Copied' : label}
    </button>
  );
}

export function FinTank({ pose, label, className, tone = 'tank' }: { pose: Pose; label: string; className?: string; tone?: 'tank' | 'subtle' }) {
  return <div className={cx('grid shrink-0 place-items-center rounded-2xl', tone === 'tank' ? 'bg-tank' : 'bg-subtle', className)}><Fin pose={pose} label={label} /></div>;
}

export function EmptyState({ pose, text, action }: { pose: Pose; text: string; action?: ReactNode }) {
  return (
    <Card className="flex flex-col items-center gap-4 px-6 py-12 text-center">
      <Fin pose={pose} label={text} />
      <p className="max-w-md text-[15px] text-muted">{text}</p>
      {action}
    </Card>
  );
}

export function Toast({ show, pose = 'policy', children }: { show: boolean; pose?: Pose; children: ReactNode }) {
  return (
    <div aria-live="polite" className={cx('fixed bottom-24 right-4 z-50 flex max-w-[calc(100vw-2rem)] items-center gap-3 rounded-2xl bg-ink py-2.5 pl-2.5 pr-5 text-sm font-bold text-bg shadow-[0_4px_0_rgb(0_0_0_/.25)] transition-all duration-300 sm:right-8', show ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-3 opacity-0')}>
      <span className="grid size-16 shrink-0 place-items-center rounded-xl bg-bg/10"><Fin pose={pose} size={32} label="" /></span>
      {show && children}
    </div>
  );
}

export function Toggle({ checked, onChange, label, ariaLabel }: { checked: boolean; onChange(v: boolean): void; label: string; ariaLabel?: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label ? undefined : ariaLabel} onClick={() => onChange(!checked)} className="inline-flex items-center gap-2.5 text-sm font-bold">
      <span className={cx('relative h-5 w-9 shrink-0 rounded-full transition', checked ? 'bg-blue' : 'bg-line')}>
        <span className={cx('absolute top-0.5 size-4 rounded-full bg-white shadow transition-all', checked ? 'left-[18px]' : 'left-0.5')} />
      </span>
      {label}
    </button>
  );
}

export function Stepper({ value, onChange, step = 1, min = 0, max = 100, format = String, unit, label }: {
  value: number; onChange(v: number): void; step?: number; min?: number; max?: number; format?: (v: number) => string; unit?: string; label: string;
}) {
  const btn = 'grid size-10 place-items-center rounded-xl border border-line bg-surface text-xl font-bold hover:bg-subtle disabled:opacity-40';
  return (
    <div className="flex items-center gap-3">
      <button type="button" aria-label={`Lower ${label}`} className={btn} disabled={value <= min} onClick={() => onChange(Math.max(min, +(value - step).toFixed(6)))}>−</button>
      <span className="min-w-16 text-center font-mono text-3xl font-semibold" aria-live="polite">{format(value)}</span>
      {unit && <span className="whitespace-nowrap font-semibold">{unit}</span>}
      <button type="button" aria-label={`Raise ${label}`} className={btn} disabled={value >= max} onClick={() => onChange(Math.min(max, +(value + step).toFixed(6)))}>+</button>
    </div>
  );
}

export function Segmented<T extends string>({ value, onChange, options, className }: {
  value: T; onChange(v: T): void; options: { value: T; label: string; hint?: string }[]; className?: string;
}) {
  return (
    <div role="radiogroup" className={cx('grid gap-1 rounded-xl bg-subtle p-1', className)} style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map((o) => {
        const on = value === o.value;
        return (
          <button key={o.value} type="button" role="radio" aria-checked={on} onClick={() => onChange(o.value)}
            className={cx('flex flex-col gap-0.5 rounded-lg px-3 py-2 text-left transition', on ? 'bg-surface shadow-[0_2px_0_var(--line)]' : 'hover:bg-surface/60')}>
            <span className={cx('text-sm font-bold', on ? 'text-blue' : 'text-ink')}>{o.label}</span>
            {o.hint && <span className="text-xs text-muted">{o.hint}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** Wizard progress: equal segments, done = green, current = blue. With onSelect, reached steps are buttons (selected = underlined). */
export function Progress({ steps, current, selected, onSelect }: {
  steps: readonly string[]; current: number; selected?: number | null; onSelect?: (i: number) => void;
}) {
  return (
    <ol className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}>
      {steps.map((s, i) => {
        const body = <>
          <span className={cx('h-2 transition-colors', i < current ? 'bg-ok' : i === current ? 'bg-blue' : 'bg-line')} />
          <span className={cx('truncate text-xs font-bold', i <= current ? 'text-ink' : 'text-muted', i === selected && 'underline decoration-2 underline-offset-4')}>{s}</span>
        </>;
        return (
          <li key={s} className="flex flex-col gap-1.5" aria-current={i === current ? 'step' : undefined}>
            {onSelect && i <= current
              ? <button type="button" onClick={() => onSelect(i)} aria-pressed={i === selected} className="flex flex-col gap-1.5 text-left hover:opacity-80">{body}</button>
              : body}
          </li>
        );
      })}
    </ol>
  );
}

export function useNow(interval = 1000) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), interval);
    return () => clearInterval(t);
  }, [interval]);
  return now;
}

export function Countdown({ to, className }: { to: number; className?: string }) {
  const now = useNow();
  if (now === null) return <span className={className}>-</span>;
  const ms = to - now;
  if (ms <= 0) return <span className={className}>Deadline passed</span>;
  const m = Math.floor(ms / 60_000), s = Math.floor(ms / 1000) % 60, h = Math.floor(m / 60);
  return <span className={className}>{h ? `${h}h ${m % 60}m` : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`} left</span>;
}

export function PageTitle({ title, sub, actions }: { title: string; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="flex flex-col gap-1.5">
        <h1 className="font-pixel text-3xl font-bold leading-tight sm:text-[34px]">{title}</h1>
        {sub && <p className="text-[15px] text-muted">{sub}</p>}
      </div>
      {actions}
    </div>
  );
}
