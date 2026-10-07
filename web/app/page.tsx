'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Fin } from '@/components/Fin';
import { LagoonWaves } from '@/components/LagoonWaves';
import { useStore } from '@/lib/store';
import { latestCampaign, type CampaignView } from '@/lib/api';

export default function Landing() {
  const { ready, session } = useStore();
  const [eager, setEager] = useState(false); // Fin perks up while the CTA is hovered or focused
  const [mounted, setMounted] = useState(false);
  const [demo, setDemo] = useState<CampaignView | null>(null);
  useEffect(() => setMounted(true), []);
  // A public campaign page for visitors without a wallet (judges, the curious). Failure just hides the link.
  useEffect(() => { latestCampaign().then(setDemo).catch(() => setDemo(null)); }, []);
  const back = ready && !!session;
  const cta = back ? { href: '/seller', label: 'Open my dashboard' } : { href: '/connect?next=/seller/onboarding', label: 'Connect wallet' };

  return (
    <>
      {/* Portal: app/template.tsx animates `transform`, which would trap a fixed child inside the page container. */}
      {mounted && createPortal(<div aria-hidden className="fixed inset-0 -z-10 bg-[var(--wave-horizon)]"><LagoonWaves /></div>, document.body)}

      <section className="grid min-h-[calc(100dvh-10rem)] place-items-center">
        <div className="grid w-full max-w-5xl items-center gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,560px)] lg:gap-14">
          <div className="flex flex-col items-center gap-2">
            <p className="relative max-w-72 rounded-2xl border-2 border-ink bg-surface px-4 py-3 text-center text-[15px] font-bold leading-snug dark:border-line">
              {back ? 'Welcome back! Your agent is waiting for you.' : "Hi, I'm Fin! Connect your wallet and I'll get to work."}
              <span aria-hidden className="absolute -bottom-[9px] left-1/2 size-4 -translate-x-1/2 rotate-45 border-b-2 border-r-2 border-ink bg-surface dark:border-line" />
            </p>
            {/* 4px art pixels on desktop, 3px below lg (scale-75 keeps them whole); -my-8 gives back the space the scale frees. */}
            <div className="-my-8 scale-75 lg:my-0 lg:scale-100">
              <Fin pose={eager ? 'found' : 'idle'} size={64} px={4} label={eager ? 'Fin, excited' : 'Fin, idle, swimming'} />
            </div>
            <span aria-hidden className="h-3 w-28 rounded-[50%] bg-ink/15 lg:-mt-2 lg:w-36" />
          </div>

          <div className="flex flex-col gap-5 rounded-[20px] border-2 border-ink bg-surface p-6 shadow-[0_6px_0_var(--ink)] sm:p-8 dark:border-line dark:shadow-[0_6px_0_var(--line)]">
            <h1 className="font-pixel text-4xl font-bold leading-[1.1] text-balance md:text-[42px]">Your agent answers. You get paid.</h1>
            <p className="max-w-[46ch] text-lg leading-relaxed text-muted text-pretty">Set your rules once. Your AI agent answers matching surveys privately and earns you SOL.</p>
            <Link href={cta.href} data-guide={back ? undefined : 'landing-cta'}
              onMouseEnter={() => setEager(true)} onMouseLeave={() => setEager(false)} onFocus={() => setEager(true)} onBlur={() => setEager(false)}
              className="mt-1 inline-flex items-center justify-center whitespace-nowrap rounded-2xl bg-blue px-6 py-4 text-lg font-bold text-on-accent shadow-[0_5px_0_var(--blue-strong)] transition-[transform,box-shadow,filter] hover:brightness-105 active:translate-y-[5px] active:shadow-none">
              {cta.label}
            </Link>
            <Link href="/research/new" className="self-center text-[15px] font-bold text-blue hover:underline">Commission research instead</Link>
            {demo && (
              <p id="watch" className="self-center text-center text-[13px] text-muted">
                No wallet yet?{' '}
                <Link href={`/campaigns/${demo.campaignId}`} className="font-bold text-blue hover:underline">
                  {demo.state === 'SETTLED' ? 'See a finished campaign' : 'Watch a live campaign'}
                </Link>{' '}— nothing to install.
              </p>
            )}
          </div>
        </div>
      </section>
    </>
  );
}
