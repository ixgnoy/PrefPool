'use client';
// Funding the campaign escrow from the buyer's own wallet (lib/fund.ts): the server builds an unsigned Solana tx
// (Anchor `fund` → escrow PDA) → the wallet's signTransaction pop-up → the server checks it and broadcasts.
import { Check } from 'pixelarticons/react/Check';
import { useState } from 'react';
import { AddressLink, Button, Card, TxLink, cx } from './ui';
import { ApiError } from '@/lib/api';
import { fundDirect, type FundStep } from '@/lib/fund';
import { useStore } from '@/lib/store';
import { FAUCET_URL } from '@/lib/config';
import { Term } from './Term';
import { lamportsToSol, sol } from '@/lib/campaign';

type Phase = 'ready' | FundStep | 'confirming' | 'error';
const ROW_OF: Record<Phase, number> = { ready: -1, build: 0, sign: 1, pay: 2, confirming: 3, settled: 3, error: -1 };

type Failure = { title: string; body: string; row: number; code?: string; link?: string; action: string };

/** Turns wallet and API errors into what the user can do about them (PRD §5.8 funding errors). */
export function explainFundingError(e: unknown, budgetSol: number, row: number): Failure {
  const msg = e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e);
  const code = e instanceof ApiError ? e.code : undefined;
  if (/devnet/i.test(msg) && !code) return { title: 'Wrong network', body: msg, row: 0, action: 'Try again' };
  if (code === 'INSUFFICIENT_FUNDS') return { title: 'Not enough SOL', body: `${msg} This needs about ${sol(+(budgetSol + 0.01).toFixed(3))} on Devnet (budget, escrow rent and fees).`, row: 0, link: FAUCET_URL, action: 'Check again' };
  if (code === 'FUNDING_IN_PROGRESS') return { title: 'Already funding', body: 'Another payment for this campaign is being processed. Check the campaign page.', row: 2, code, action: 'Try again' };
  if (e instanceof ApiError && e.status === 422) return { title: 'Payment refused', body: `${msg} Nothing was sent.`, row: 2, code, action: 'Start over' };
  if (!code && /declin|reject|cancel|refused|denied|user/i.test(msg)) return { title: 'You declined in your wallet', body: 'Nothing was sent. Approve to fund the escrow.', row: 1, action: 'Approve again' };
  if (/blockhash|expired/i.test(msg)) return { title: 'The transaction expired', body: 'Solana transactions are only valid for about a minute. Nothing was sent.', row: 2, code, action: 'Start over' };
  return { title: 'Funding failed', body: msg, row, code, action: 'Try again' };
}

/** Funds the escrow PDA from the person's own wallet by direct signing (no x402 here: the program can't be paid over x402). */
export function FundEscrow({ campaignId, budgetSol, onFunded }: { campaignId: string; budgetSol: number; onFunded(txHash: string): void }) {
  const { session, ensureWallet } = useStore();
  const [phase, setPhase] = useState<Phase>('ready');
  const [failure, setFailure] = useState<Failure | null>(null);
  const [txHash, setTxHash] = useState('');
  const [escrow, setEscrow] = useState('');
  const [budget, setBudget] = useState(budgetSol);

  async function start() {
    if (!session) return;
    setFailure(null);
    let last: Phase = 'build';
    try {
      const wallet = await ensureWallet();
      const r = await fundDirect({
        campaignId, sessionToken: session.sessionToken, wallet,
        onStep: (s, b) => { last = s; setPhase(s); if (b) { setEscrow(b.escrowAddress); setBudget(lamportsToSol(b.budgetLamports)); } },
      });
      setTxHash(r.txHash);
      setPhase(r.pending ? 'confirming' : 'settled');
      onFunded(r.txHash);
    } catch (e) {
      setFailure(explainFundingError(e, budget, ROW_OF[last]));
      setPhase('error');
    }
  }

  const rows = [
    { label: 'Build transaction', detail: `Moves ${sol(budget)} into this campaign's escrow account, plus a little rent the escrow returns when it closes` },
    { label: 'Approve in wallet', detail: `${session?.walletName ?? 'Your wallet'} shows the budget plus the network fee leaving. This is the only action.` },
    { label: 'Submitting', detail: 'The server checks the signed transaction matches this campaign, then broadcasts it' },
    { label: phase === 'confirming' ? 'Broadcast; waiting for confirmation' : 'Submitted', detail: 'The campaign opens once the escrow is confirmed on Devnet (a few seconds). You can leave this page.' },
  ];
  const current = ROW_OF[phase];
  const errRow = failure?.row ?? -1;

  return (
    <div className="flex flex-col gap-4">
      <Card className="overflow-hidden">
        <ol>
          {rows.map((r, i) => {
            const isErr = i === errRow;
            const done = phase === 'settled' || (failure ? i < errRow : i < current);
            const now = !failure && i === current && phase !== 'settled';
            return (
              <li key={i} className={cx('grid grid-cols-[32px_minmax(0,1fr)_auto] items-center gap-3.5 border-b border-line px-4 py-3.5 transition-colors last:border-0', now && 'bg-blue-soft/40', isErr && 'bg-danger-soft/50')}>
                <span className={cx('grid size-8 place-items-center rounded-full border-2 text-[13px] font-bold',
                  isErr ? 'border-danger bg-danger text-white' : done ? 'border-ok bg-ok text-on-accent' : now ? 'border-blue bg-blue text-on-accent' : 'border-line text-muted')}>
                  {isErr ? '!' : done ? <Check aria-hidden width={14} height={14} /> : i + 1}
                </span>
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className={cx('text-[15px] font-bold', !done && !now && !isErr && 'text-muted')}>{r.label}</span>
                  <span className="text-xs text-muted">{r.detail}</span>
                </div>
                <span className={cx('text-xs font-bold', isErr ? 'text-danger-ink' : done ? 'text-ok-ink' : 'text-blue')}>
                  {isErr ? 'Stopped' : done ? 'Done' : now ? (i === 1 ? 'Your turn' : 'Working…') : ''}
                </span>
              </li>
            );
          })}
        </ol>
      </Card>

      {phase === 'ready' && (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-blue-soft p-4">
          <span className="flex-1 text-sm">Ready to move {sol(budget)} into the campaign&apos;s escrow. Your wallet should be set to <b>Devnet</b>.</span>
          <Button onClick={start} disabled={!session}>Fund escrow</Button>
        </div>
      )}
      {escrow && <p className="text-sm text-muted">Escrow account: <AddressLink address={escrow} /></p>}
      {txHash && <p className="text-sm text-muted">Escrow funding tx: <TxLink hash={txHash} /></p>}

      {failure && (
        <div className="rise flex flex-wrap items-start gap-4 rounded-2xl border-[1.5px] border-danger bg-danger-soft p-4" role="alert">
          <div className="flex flex-1 flex-col gap-1.5">
            <span className="font-bold text-danger-ink">{failure.title}</span>
            <span className="text-sm">{failure.body}{failure.link && <> <a className="font-bold text-blue underline" href={failure.link} target="_blank" rel="noreferrer">Get Devnet SOL from the Solana faucet</a>.</>}</span>
            {failure.title === 'Wrong network' && <span className="text-xs">In Phantom: <i>Settings → Developer Settings → Testnet Mode</i>, then pick <i>Solana Devnet</i>. Solflare and Backpack: the network picker in settings → <i>Devnet</i>.</span>}
            {failure.code && <span className="self-start rounded-md bg-surface px-2 py-0.5 font-mono text-xs">{failure.code}</span>}
          </div>
          <Button onClick={start}>{failure.action}</Button>
        </div>
      )}

      <p className="text-[13px] text-muted">You sign one transaction: the budget goes straight into a Solana <Term k="escrow">escrow account</Term> owned by our program, not to us.</p>
    </div>
  );
}
