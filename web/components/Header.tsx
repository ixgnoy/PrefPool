'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { SlidersHorizontal } from 'pixelarticons/react/SlidersHorizontal';
import { Wallet } from 'pixelarticons/react/Wallet';
import { Check } from 'pixelarticons/react/Check';
import { Copy } from 'pixelarticons/react/Copy';
import { ExternalLink } from 'pixelarticons/react/ExternalLink';
import { Logout } from 'pixelarticons/react/Logout';
import { Fin, type Pose } from './Fin';
import { cx } from './ui';
import { explorerAddress } from '@/lib/config';
import { useStore } from '@/lib/store';
import { short } from '@/lib/campaign';

type NavLink = { href: string; label: string; exact?: boolean };
const NAV: Record<'seller' | 'research', NavLink[]> = {
  seller: [
    { href: '/seller', label: 'Dashboard', exact: true },
    { href: '/seller/activity', label: 'Activity' },
    { href: '/seller/guardrails', label: 'Rules' },
    { href: '/seller/agent', label: 'Agent' },
    { href: '/seller/calibration', label: 'Calibration' },
  ],
  research: [
    { href: '/research', label: 'Campaigns', exact: true },
    { href: '/research/analytics', label: 'Analytics' },
    { href: '/research/new', label: 'New campaign' },
  ],
};

export function Header() {
  const path = usePathname();
  const { ready, session } = useStore();
  const area = path.startsWith('/seller') ? 'seller' : path.startsWith('/research') ? 'research' : null;
  const links = area && !path.startsWith('/seller/onboarding') ? NAV[area] : [];
  const active = (l: NavLink) => (l.exact ? path === l.href : path.startsWith(l.href));
  const landing = path === '/'; // landing keeps logo, settings and wallet chip: Fin's card is the one CTA

  return (
    <header className={cx('sticky top-0 z-40 border-b', landing ? 'border-transparent' : 'border-line bg-surface/90 backdrop-blur')}>
      <div className="mx-auto flex h-16 max-w-[clamp(1280px,90vw,2200px)] items-center gap-3 px-4 sm:px-8">
        <Link href="/" className="flex shrink-0 items-center gap-2" aria-label="PrefPool home">
          <Fin size={32} px={1} still label="" />
          <span className="font-pixel text-xl font-bold">PrefPool</span>
        </Link>
        <nav className="ml-4 hidden items-center gap-1 md:flex" aria-label="Section">
          {links.map((l) => <Tab key={l.href} link={l} on={active(l)} />)}
        </nav>
        <div className="ml-auto flex items-center gap-2 sm:gap-3">
          {!landing && <RoleSwitch area={area} />}
          <SettingsMenu />
          {/* No header Connect button: every page that needs a wallet shows its own connect step (one CTA per page). */}
          {ready && session && <WalletChip />}
        </div>
      </div>
      {!landing && (
        <div className="mx-auto flex max-w-[clamp(1280px,90vw,2200px)] items-center gap-1 overflow-x-auto px-4 pb-2 sm:hidden">
          <RoleSwitch area={area} mobile />
          {links.map((l) => <Tab key={l.href} link={l} on={active(l)} />)}
        </div>
      )}
      {links.length > 0 && (
        <nav className="mx-auto hidden max-w-[clamp(1280px,90vw,2200px)] gap-1 overflow-x-auto px-4 pb-2 sm:flex md:hidden" aria-label="Section">
          {links.map((l) => <Tab key={l.href} link={l} on={active(l)} />)}
        </nav>
      )}
    </header>
  );
}

function Tab({ link, on }: { link: NavLink; on: boolean }) {
  return (
    <Link href={link.href} aria-current={on ? 'page' : undefined}
      className={cx('whitespace-nowrap rounded-lg px-3 py-2 text-sm font-semibold transition-colors', on ? 'bg-blue-soft text-blue' : 'text-muted hover:text-ink')}>
      {link.label}
    </Link>
  );
}

function RoleSwitch({ area, mobile = false }: { area: 'seller' | 'research' | null; mobile?: boolean }) {
  const item = (href: string, label: string, on: boolean) => (
    <Link href={href} aria-current={on ? 'page' : undefined}
      className={cx('rounded-lg px-3 py-1.5 text-[13px] font-semibold transition', on ? 'bg-surface text-ink shadow-[0_2px_0_var(--line)]' : 'text-muted hover:text-ink')}>{label}</Link>
  );
  return (
    <div className={cx('shrink-0 rounded-xl bg-subtle p-1', mobile ? 'mr-2 flex' : 'hidden sm:flex')} aria-label="Role">
      {item('/seller', 'Seller', area === 'seller')}
      {item('/research', 'Research', area === 'research')}
    </div>
  );
}

/** Click-outside dropdown shared by the settings menu and the wallet chip. */
function Dropdown({ trigger, label, panelClass = 'w-72 p-3', children }: { trigger: ReactNode; label: string; panelClass?: string; children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label={label}
        className="flex items-center gap-2 whitespace-nowrap rounded-xl px-2.5 py-1.5 text-muted transition hover:bg-subtle hover:text-ink">
        {trigger}
      </button>
      {open && (
        <div className={cx('rise absolute right-0 top-full mt-2 overflow-hidden rounded-2xl border-2 border-line bg-surface text-ink shadow-[0_4px_0_var(--line)]', panelClass)}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

/** Environment, User/Dev view (FRONTEND_PRD §5.10) and theme, out of the header row. */
function SettingsMenu() {
  const { view, setView, theme, toggleTheme } = useStore();
  const seg = (on: boolean) => cx('flex-1 rounded-lg px-3 py-1.5 text-[13px] font-semibold transition', on ? 'bg-surface text-ink shadow-[0_2px_0_var(--line)]' : 'text-muted hover:text-ink');
  return (
    <Dropdown label="Settings" trigger={<SlidersHorizontal width={20} height={20} aria-hidden />}>
      {() => (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-0.5 rounded-xl bg-warn-soft px-3 py-2 text-warn-ink">
            <span className="text-[13px] font-bold">Test network</span>
            <span className="text-xs">Solana Devnet. Private aggregation runs as a CRE simulation.</span>
          </div>
          <Row label="View">
            <button type="button" aria-pressed={view === 'user'} className={seg(view === 'user')} onClick={() => setView('user')}>User</button>
            <button type="button" aria-pressed={view === 'dev'} className={seg(view === 'dev')} onClick={() => setView('dev')}>Dev</button>
          </Row>
          <Row label="Theme">
            <button type="button" aria-pressed={theme !== 'dark'} className={seg(theme !== 'dark')} onClick={() => theme === 'dark' && toggleTheme()}>Lagoon</button>
            <button type="button" aria-pressed={theme === 'dark'} className={seg(theme === 'dark')} onClick={() => theme !== 'dark' && toggleTheme()}>Deep sea</button>
          </Row>
        </div>
      )}
    </Dropdown>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-14 text-[13px] font-semibold text-muted">{label}</span>
      <div className="flex flex-1 gap-1 rounded-xl bg-subtle p-1">{children}</div>
    </div>
  );
}

function WalletChip() {
  const { session, agent } = useStore();
  if (!session) return null;
  return (
    <Dropdown label="Wallet" panelClass="w-80"
      trigger={<><Wallet width={18} height={18} aria-hidden className="text-ok-ink" /><span className="font-mono text-[13px] text-ink">{short(session.address, 8, 4)}</span>
        {agent?.personhood && <span title="Verified human (World ID)" className="inline-flex items-center gap-0.5 rounded-lg bg-ok-soft px-1.5 py-0.5 text-[11px] font-semibold text-ok-ink"><Check aria-hidden width={12} height={12} />human</span>}</>}>
      {(close) => <WalletPanel close={close} />}
    </Dropdown>
  );
}

/** Fin reacts to what you do in the menu: coin flip by default, "Copied!" after copying, sleepy over Sign out. */
function WalletPanel({ close }: { close(): void }) {
  const { session, signOut } = useStore();
  const router = useRouter();
  const [mood, setMood] = useState<'idle' | 'copied' | 'leaving'>('idle');
  if (!session) return null;
  const fin: Record<typeof mood, { pose: Pose; line: string }> = {
    idle: { pose: 'paid', line: 'Your SOL lands here!' },
    copied: { pose: 'found', line: 'Copied! Paste it anywhere.' },
    leaving: { pose: 'sleeping', line: 'Leaving already?' },
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(session.address); setMood('copied'); setTimeout(() => setMood('idle'), 1600); } catch { /* clipboard blocked */ }
  };
  const item = 'flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm font-semibold transition hover:bg-subtle active:translate-y-px';
  return (
    <>
      <div className="flex items-center gap-3 bg-tank px-3 py-3">
        <Fin pose={fin[mood].pose} label="" />
        <div className="flex min-w-0 flex-col gap-1">
          <span key={mood} aria-live="polite" className="rise rounded-xl border-2 border-line bg-surface px-2.5 py-1.5 text-[13px] font-semibold leading-snug">{fin[mood].line}</span>
          <span className="text-xs font-semibold capitalize text-muted">{session.walletName} wallet · Devnet</span>
        </div>
      </div>
      <div className="flex flex-col gap-1 p-2">
        <p className="select-all break-all px-3 py-2 font-mono text-[11px] leading-relaxed text-muted">{session.address}</p>
        <button type="button" className={item} onClick={copy}><Copy aria-hidden width={18} height={18} className="text-blue" />Copy address</button>
        <a href={explorerAddress(session.address)} target="_blank" rel="noreferrer" className={item}>
          <ExternalLink aria-hidden width={18} height={18} className="text-blue" />View on Solana Explorer
        </a>
        <button type="button" className={cx(item, 'text-danger-ink hover:bg-danger-soft')}
          onMouseEnter={() => setMood('leaving')} onMouseLeave={() => setMood('idle')} onFocus={() => setMood('leaving')} onBlur={() => setMood('idle')}
          onClick={() => { signOut(); close(); router.push('/'); }}>
          <Logout aria-hidden width={18} height={18} />Sign out
        </button>
      </div>
    </>
  );
}
