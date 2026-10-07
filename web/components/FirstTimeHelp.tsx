import Link from 'next/link';
import { ExternalLink } from 'pixelarticons/react/ExternalLink';
import { BACKPACK_URL, FAUCET_URL, PHANTOM_URL, SOLFLARE_URL } from '@/lib/config';
import { cx } from './ui';

const ext = 'inline-flex items-center gap-0.5 font-bold text-blue hover:underline';

/**
 * Guide for people new to Solana: wallet → Devnet → free Devnet SOL → connect.
 * Open by default when no wallet extension is found; otherwise a collapsed "New to Solana?" row.
 */
export function FirstTimeHelp({ open = false, className }: { open?: boolean; className?: string }) {
  return (
    <details open={open} className={cx('group rounded-xl border border-line bg-subtle/50 p-4', className)}>
      <summary className="cursor-pointer list-none text-[15px] font-bold marker:hidden [&::-webkit-details-marker]:hidden">
        <span aria-hidden className="mr-1.5 inline-block transition group-open:rotate-90">›</span>
        New to Solana? Four steps, about five minutes, no real money.
      </summary>
      <ol className="mt-3 flex list-decimal flex-col gap-2.5 pl-6 text-sm leading-relaxed">
        <li>
          <b>Install a wallet.</b> <a href={PHANTOM_URL} target="_blank" rel="noreferrer" className={ext}>Phantom<ExternalLink aria-hidden width={12} height={12} /></a>,{' '}
          <a href={SOLFLARE_URL} target="_blank" rel="noreferrer" className={ext}>Solflare<ExternalLink aria-hidden width={12} height={12} /></a> or{' '}
          <a href={BACKPACK_URL} target="_blank" rel="noreferrer" className={ext}>Backpack<ExternalLink aria-hidden width={12} height={12} /></a> as a browser extension, then create a new wallet and keep its recovery phrase safe.
        </li>
        <li>
          <b>Switch it to Devnet.</b> This app runs on Solana&apos;s developer network. In Phantom: <i>Settings → Developer Settings → Testnet Mode</i>, then <i>Solana Devnet</i>. In Solflare or Backpack: the network setting → <i>Devnet</i>.
        </li>
        <li>
          <b>Get free Devnet SOL.</b> Copy your wallet&apos;s address, paste it into the{' '}
          <a href={FAUCET_URL} target="_blank" rel="noreferrer" className={ext}>Solana faucet<ExternalLink aria-hidden width={12} height={12} /></a> and pick <i>Devnet</i>. Devnet SOL has no value. You only need it to fund a campaign; answering surveys needs none.
        </li>
        <li><b>Come back and connect.</b> Reload this page and pick your wallet. You&apos;ll sign a message, which isn&apos;t a transaction and costs nothing.</li>
      </ol>
      <p className="mt-3 text-[13px] text-muted">
        Just looking? <Link href="/#watch" className="font-bold text-blue hover:underline">Watch a campaign without a wallet</Link>.
      </p>
    </details>
  );
}
