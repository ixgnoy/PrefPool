'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Fin } from '@/components/Fin';
import { Button, Card, Countdown, Mono, PageTitle, StatePill } from '@/components/ui';
import { useStore } from '@/lib/store';
import { solOf } from '@/lib/campaign';
import { getConfig, listMyCampaigns, type CampaignView } from '@/lib/api';
import { DEFAULT_PLATFORM_FEE_USDC } from '@/lib/config';
import { categoryLabel } from '@/lib/policy';

export default function ResearchDashboard() {
  const { session } = useStore();
  const [list, setList] = useState<CampaignView[] | null>(null);
  const [feeUsdc, setFeeUsdc] = useState(DEFAULT_PLATFORM_FEE_USDC);
  useEffect(() => { getConfig().then((c) => setFeeUsdc(c.platformFeeUsdc ?? DEFAULT_PLATFORM_FEE_USDC)).catch(() => {}); }, []);
  useEffect(() => {
    if (!session) return;
    const load = () => listMyCampaigns(session.sessionToken).then(setList).catch(() => setList([]));
    void load();
    const t = setInterval(load, 10_000);
    return () => clearInterval(t);
  }, [session]);

  return (
    <>
      <PageTitle title="Your research" actions={<Button href="/research/new">New campaign</Button>} />
      <Card className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-4" data-testid="platform-fee">
        <span className="rounded bg-blue-soft px-1.5 py-0.5 text-[11px] font-bold text-blue">x402</span>
        <p className="min-w-0 flex-1 basis-72 text-[14px] text-muted">
          Your own results are free on each campaign page. A research agent fetching a report with the campaign&apos;s access token
          pays a fixed <b className="font-mono text-ink">{feeUsdc} USDC</b> platform fee (Devnet) over x402, straight from its wallet.
        </p>
      </Card>
      {list === null ? <div className="h-72 animate-pulse rounded-2xl bg-surface" /> : list.length === 0 ? (
        <Card className="flex flex-col items-center gap-4 px-6 py-12 text-center">
          <div className="grid size-28 place-items-center rounded-2xl bg-tank"><Fin pose="researcher" label="" /></div>
          <h2 className="font-pixel text-2xl font-bold">No campaigns yet</h2>
          <p className="max-w-md text-[15px] text-muted">Create one here, or let your research agent draft it: it calls <Mono>draft_campaign</Mono> in the PrefPool plugin and the draft shows up on this page for you to fund.</p>
          <Button href="/research/new">New campaign</Button>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <ul className="divide-y divide-line">
            {list.map((c) => {
              const awaiting = c.state === 'AWAITING_FUNDING' || c.state === 'DRAFT' || c.state === 'FUNDING_FAILED';
              const live = c.state === 'ACTIVE' || c.state === 'FUNDED';
              return (
                <li key={c.campaignId} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-4">
                  <span className="flex min-w-0 flex-1 basis-64 flex-col">
                    <Link href={`/research/${c.campaignId}`} className="truncate font-semibold hover:text-blue">{c.title}</Link>
                    <span className="text-xs text-muted">{categoryLabel(c.category)} · <Mono>{solOf(BigInt(c.rewardLamports) * BigInt(c.maxResponses))}</Mono></span>
                  </span>
                  <StatePill state={c.state} />
                  <span className="w-44 text-[13px] text-muted">
                    {awaiting ? 'Not funded yet' : <><Mono className="text-ink">{c.answered}</Mono> answers in{live && <>, <Countdown to={c.deadlineMs} className="font-mono text-ink" /></>}</>}
                  </span>
                  {awaiting ? <Button size="sm" href={`/research/new?fund=${c.campaignId}`}>Fund</Button> : <Button size="sm" variant="secondary" href={`/research/${c.campaignId}`}>Open</Button>}
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </>
  );
}
