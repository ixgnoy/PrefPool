'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Button, Card, FinTank } from './ui';
import { FirstTimeHelp } from './FirstTimeHelp';
import { ExternalLink } from 'pixelarticons/react/ExternalLink';
import type { Pose } from './Fin';
import { useStore } from '@/lib/store';
import { installedWallets, onWalletsChanged } from '@/lib/wallet';
import { PHANTOM_URL } from '@/lib/config';
import { short } from '@/lib/campaign';

type Phase = 'list' | 'connecting' | 'signing' | 'signed' | 'wrong_network' | 'rejected';
type WalletInfo = { id: string; name: string; icon?: string };

const VIEW: Record<Exclude<Phase, 'list'>, { pose: Pose; title: string; body: string }> = {
  connecting: { pose: 'swim', title: 'Connecting…', body: 'Approve the connection in your wallet pop-up.' },
  signing: { pose: 'sealed', title: 'Check your wallet', body: 'Sign a message to prove this wallet is yours. This is not a transaction and costs nothing.' },
  signed: { pose: 'found', title: "You're in", body: 'Your wallet is connected on Devnet.' },
  wrong_network: { pose: 'policy', title: 'Wrong network', body: 'Your wallet is not on Solana Devnet. Switch it to Devnet.' },
  rejected: { pose: 'abstain', title: 'Signature declined', body: 'Nothing happened and nothing was sent. Sign the message to continue.' },
};

type Props = {
  /** Where to go after sign-in. */
  next?: string;
  onConnected?(): void;
  intro?: string;
};

/** Wallet Standard Solana wallets (Phantom, Solflare, Backpack). Funds are checked where they matter: the server's funding builder explains a shortfall. */
export function WalletConnect({ next, onConnected, intro }: Props) {
  const router = useRouter();
  const { connect } = useStore();
  const [wallets, setWallets] = useState<WalletInfo[] | null>(null);
  const [phase, setPhase] = useState<Phase>('list');
  const [active, setActive] = useState<WalletInfo | null>(null);
  const [address, setAddress] = useState('');
  const [error, setError] = useState('');

  // Wallet extensions register with the Wallet Standard shortly after load; late ones arrive as 'register' events.
  useEffect(() => {
    const update = () => setWallets(installedWallets());
    const off = onWalletsChanged(update);
    const t = setTimeout(update, 300);
    return () => { clearTimeout(t); off(); };
  }, []);

  async function start(w: WalletInfo) {
    setActive(w);
    setPhase('connecting');
    try {
      // connect() connects the wallet, checks it offers Devnet, then asks for the sign-in message signature.
      const signing = setTimeout(() => setPhase('signing'), 400);
      const { session } = await connect(w.id, w.name).finally(() => clearTimeout(signing));
      setAddress(session.address);
      setPhase('signed');
      onConnected?.();
      if (next) setTimeout(() => router.push(next), 700);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e);
      setError(msg);
      setPhase(/devnet/i.test(msg) ? 'wrong_network' : 'rejected');
    }
  }

  if (phase === 'list') {
    const list = wallets ?? [];
    return (
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <h2 className="font-pixel text-[28px] font-bold">Connect Solana wallet</h2>
          {intro && <p className="text-[15px] text-muted">{intro}</p>}
        </div>
        {wallets && wallets.length === 0 && (
          <Card className="flex flex-wrap items-center justify-between gap-3 p-4" data-guide="wallet-list">
            <span className="text-sm"><b>No Solana wallet found.</b> Install Phantom (or Solflare / Backpack), set it to Devnet, then reload this page.</span>
            <Button href={PHANTOM_URL} variant="secondary" size="sm">Install Phantom<ExternalLink aria-hidden width={14} height={14} /></Button>
          </Card>
        )}
        <div className="flex max-w-md flex-col gap-2" data-guide="wallet-list">
          {wallets === null && <div className="h-14 animate-pulse rounded-xl bg-subtle" />}
          {list.map((w) => (
            <button key={w.id} type="button" onClick={() => start(w)}
              className="flex items-center gap-3 rounded-xl border border-line bg-surface p-3 text-left transition hover:border-blue hover:bg-blue-soft/40">
              {w.icon
                ? <img src={w.icon} alt="" className="size-8 rounded-lg" />
                : <span className="grid size-8 place-items-center rounded-lg bg-subtle font-pixel text-sm font-bold">{w.name[0]}</span>}
              <span className="flex-1 text-[15px] font-bold">{w.name}</span>
              <span className="text-xs text-muted">Installed</span>
            </button>
          ))}
        </div>
        <p className="text-[13px] text-muted">Next you&apos;ll sign a message. It&apos;s not a transaction and costs nothing.</p>
        {wallets && <FirstTimeHelp open={wallets.length === 0} />}
      </div>
    );
  }

  const v = VIEW[phase];
  const retry = () => (active ? start(active) : setPhase('list'));
  return (
    <div className="rise flex max-w-lg flex-col gap-4" aria-live="polite">
      <FinTank pose={v.pose} label={v.title} className="h-36 w-full" tone={phase === 'wrong_network' || phase === 'rejected' ? 'subtle' : 'tank'} />
      <h2 className="text-xl font-bold">{phase === 'connecting' && active ? `Connecting to ${active.name}…` : v.title}</h2>
      <p className="text-[15px] text-muted">{phase === 'signed' && address ? `${short(address, 8, 6)} is connected on Devnet.` : phase === 'wrong_network' && error ? error : v.body}</p>
      {phase === 'wrong_network' && (
        <div role="alert" className="rounded-xl border border-warn-ink/30 bg-warn-soft p-4 text-sm text-warn-ink">
          <b>Nothing was signed or sent.</b> In Phantom: <i>Settings → Developer Settings → Testnet Mode</i>, then <i>Solana Devnet</i>. In Solflare or Backpack: the network setting → <i>Devnet</i>. Then press Try again.
        </div>
      )}
      {phase === 'rejected' && error && <p className="text-xs text-muted">{error}</p>}
      <div className="flex flex-wrap gap-2">
        {phase === 'wrong_network' && <Button onClick={retry}>Try again</Button>}
        {phase === 'rejected' && <><Button onClick={retry}>Sign again</Button><Button variant="secondary" onClick={() => setPhase('list')}>Use another wallet</Button></>}
        {(phase === 'connecting' || phase === 'signing') && <Button variant="secondary" onClick={() => setPhase('list')}>Cancel</Button>}
        {phase === 'signed' && !next && !onConnected && <Button href="/">Continue</Button>}
      </div>
    </div>
  );
}
