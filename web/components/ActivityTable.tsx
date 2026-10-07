'use client';
import { Fin, type Pose } from './Fin';
import { TxLink, cx } from './ui';
import type { ActivityItem } from '@/lib/api';
import { categoryLabel } from '@/lib/policy';
import { solOf } from '@/lib/campaign';

/** One row per campaign; Fin's pose is the outcome at a glance (paid, rules worked, waiting, not paid). */
function outcome(a: ActivityItem): { pose: Pose; text: string; tone: string } {
  if (a.kind === 'abstain') return { pose: 'abstain', text: `Skipped: ${a.reason ?? 'outside your rules'}`, tone: 'text-muted' };
  if (a.outcome === 'paid') return { pose: 'paid', text: `+${solOf(a.payoutLamports)}`, tone: 'text-ok-ink' };
  if (a.outcome === 'not_paid') return { pose: 'sleeping', text: `Not paid: ${a.notPaidReason}`, tone: 'text-danger-ink' };
  return { pose: 'sealed', text: 'Waiting for results', tone: 'text-blue' };
}

export function ActivityTable({ items }: { items: ActivityItem[] }) {
  return (
    <ul className="divide-y divide-line">
      {items.map((a) => {
        const o = outcome(a);
        return (
          <li key={a.campaignId} className="flex items-center gap-3 px-4 py-3 sm:px-5">
            <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-tank"><Fin pose={o.pose} size={32} px={1} still label="" /></span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate font-semibold">{a.title}</span>
              <span className="text-xs text-muted">{categoryLabel(a.category)}</span>
            </span>
            <span className="flex min-w-0 max-w-[45%] flex-col items-end gap-0.5 break-words text-right">
              <span className={cx('text-[13px] font-semibold', o.tone, o.pose === 'paid' && 'font-mono text-[15px]')}>{o.text}</span>
              {a.settlementTx && <TxLink hash={a.settlementTx} className="text-xs" />}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
