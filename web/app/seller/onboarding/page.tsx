'use client';
import { VerifyHuman } from '@/components/VerifyHuman';
import { useEffect, useState, type ReactNode } from 'react';
import { Fin, type Pose } from '@/components/Fin';
import { GuardrailEditor } from '@/components/GuardrailEditor';
import { GUIDE_DASHBOARD_STEP, startGuide } from '@/components/Guide';
import { PairAgent } from '@/components/PairAgent';
import { WalletConnect } from '@/components/WalletConnect';
import { Button, Card, Progress, cx } from '@/components/ui';
import { ProfileMatch } from '@/components/ProfileMatch';
import { useStore, type Profile } from '@/lib/store';
import { short } from '@/lib/campaign';
import { DEMO_NOTE } from '@/lib/config';
import { Lock } from 'pixelarticons/react/Lock';

const STEPS = ['Wallet', 'About you', 'Rules', 'Pair agent'] as const;
// Fin talks you through each step, like a lesson coach.
const FIN: { pose: Pose; caption: string }[] = [
  { pose: 'sleeping', caption: "Yawn. Connect a wallet and I'll wake up. It's where your earnings land." },
  { pose: 'idle', caption: "I'm packing your satchel. What you share here travels with me, never to the buyers." },
  { pose: 'policy', caption: 'Teach me your rules. Anything outside them, I politely skip.' },
  { pose: 'swim', caption: "Last step! Pair your agent and I'll swim over to it." },
];

export default function Onboarding() {
  const { ready, session, signOut, profile, setProfile, policy, savePolicy, agent, liveToken, matchProfile, setMatchProfile } = useStore();
  const [match, setMatch] = useState(matchProfile);
  const paired = !!agent?.connected || (!!liveToken && agent?.kind === 'live');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState(policy);
  const [p, setP] = useState<Profile>(profile);
  useEffect(() => { if (ready && agent !== undefined) { setDraft(policy); setP(profile); setMatch(matchProfile); } }, [ready, agent === undefined]); // eslint-disable-line react-hooks/exhaustive-deps

  const go = (n: number) => { setStep(n); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  const done = step === 4;
  // Finished: hand over to the guide at "Go to my dashboard", which leads on to the first-campaign choice.
  useEffect(() => { if (done) startGuide(GUIDE_DASHBOARD_STEP); }, [done]);
  const fin = step === 3 && paired ? { pose: 'found' as Pose, caption: "We're connected! Hit Finish and I'll start looking for work." }
    : step === 0 && session ? { pose: 'paid' as Pose, caption: "Wallet found! This is where your SOL lands. Let's keep going." }
      : FIN[Math.min(step, 3)]!;

  if (done) {
    return (
      <Card className="chunky rise mx-auto flex max-w-2xl flex-col items-center gap-5 rounded-[20px] px-6 py-14 text-center">
        <div className="grid h-44 w-56 place-items-center rounded-3xl bg-tank"><Fin pose={paired ? 'found' : 'policy'} label={paired ? 'Fin found a job: your agent is on duty' : 'Fin waiting for your agent'} /></div>
        <h1 className="font-pixel text-4xl font-bold">{paired ? 'Your agent is on duty.' : 'Your rules are saved.'}</h1>
        <p className="max-w-md text-muted">{paired
          ? <>It checks new campaigns against your rules and answers the ones that pass. Earnings arrive in {session ? short(session.address, 12, 4) : 'your wallet'}.</>
          : 'Pair your agent whenever you are ready: it starts answering campaigns under these rules as soon as it connects.'}</p>
        <div className="flex flex-wrap justify-center gap-2">
          {!paired && <Button href="/seller/agent" size="lg">Pair my agent</Button>}
          <Button href="/seller" size="lg" variant={paired ? undefined : 'secondary'} data-guide="ob-dashboard">Go to my dashboard</Button>
        </div>
        <span className="text-xs text-muted">{DEMO_NOTE}</span>
      </Card>
    );
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      <Progress steps={STEPS} current={step} />
      <div className="flex items-end gap-3">
        <div className="grid size-24 shrink-0 place-items-center rounded-2xl bg-tank"><Fin pose={fin.pose} label="" /></div>
        <p key={step} aria-live="polite" className="rise relative mb-3 rounded-2xl border-2 border-line bg-surface px-4 py-3 text-[15px] font-semibold leading-snug">
          {fin.caption}
          <span aria-hidden className="absolute -left-[9px] bottom-4 size-4 rotate-45 border-b-2 border-l-2 border-line bg-surface" />
        </p>
      </div>
      <div>
        <Card key={step} className="rise p-5 sm:p-7">
          {step === 0 && (session ? (
            <div className="flex flex-col gap-4">
              <h2 className="font-pixel text-[28px] font-bold">Wallet connected</h2>
              <p className="text-muted">This wallet is where your earnings arrive.</p>
              <div className="rounded-xl bg-subtle px-4 py-3 font-mono text-sm">{short(session.address, 18, 6)}</div>
              <Actions><Button variant="ghost" onClick={signOut}>Use another wallet</Button><Button onClick={() => go(1)} data-guide="ob-continue-0">Continue</Button></Actions>
            </div>
          ) : (
            <WalletConnect intro="This wallet is where your earnings arrive." onConnected={() => setTimeout(() => go(1), 700)} />
          ))}

          {step === 1 && (
            <div className="flex flex-col gap-5">
              <div className="flex flex-col gap-1.5">
                <h2 className="font-pixel text-[28px] font-bold">About you</h2>
                <p className="text-muted">Optional. Turn matching on and your agent only answers campaigns aimed at people like you.</p>
              </div>
              <div className="flex gap-3 rounded-2xl bg-blue-soft p-4 text-sm leading-relaxed">
                <Lock aria-hidden width={18} height={18} className="mt-0.5 shrink-0 text-blue" />
                <span><b>Stays on your device / in your agent.</b> Campaigns only ever learn &quot;answered&quot; or &quot;abstained: no matching profile&quot;, never these values.</span>
              </div>
              <ProfileMatch on={match} onToggle={setMatch} profile={p} onChange={setP} />
              <Actions note={match ? 'Saved on this device' : undefined}>
                <Button variant="secondary" onClick={() => go(0)}>Back</Button>
                <Button data-guide="ob-continue-1" onClick={() => { setProfile(p); setMatchProfile(match); go(2); }}>{match ? 'Continue' : 'Skip for now'}</Button>
              </Actions>
            </div>
          )}

          {step === 2 && (
            <div className="flex flex-col gap-5">
              <div className="flex flex-col gap-1.5">
                <h2 className="font-pixel text-[28px] font-bold">Set your rules</h2>
                <p className="text-muted">We&apos;ve started you on safe defaults. Sensitive categories are blocked.</p>
              </div>
              <GuardrailEditor value={draft} onChange={setDraft} preview={false} />
              <Actions>
                <Button variant="secondary" onClick={() => go(1)}>Back</Button>
                {saveError && <span role="alert" className="text-sm font-bold text-danger-ink">{saveError}</span>}
                <Button data-guide="ob-rules" onClick={async () => {
                  // Existing agents save now; a new agent gets these rules when it registers in the next step.
                  try { if (agent) await savePolicy(draft); setSaveError(null); go(3); } catch (e) { setSaveError((e as Error).message); }
                }}>Use these rules</Button>
              </Actions>
            </div>
          )}

          {step === 3 && (
            <div className="flex flex-col gap-5">
              <div className="flex flex-col gap-1.5">
                <h2 className="font-pixel text-[28px] font-bold">Pair your agent</h2>
                <p className="text-muted">Your agent answers through our plugin. The website is only for setup and watching.</p>
              </div>
              <PairAgent policy={draft} demoAgent={false} />
              {paired && <VerifyHuman />}
              {paired && agent?.kind === 'plugin' && (
                <p className="rounded-2xl bg-blue-soft p-4 text-sm leading-relaxed"><b>Next: calibration.</b> Your agent gets 15 quick questions about you. When it has answered, you answer the same ones on the <a href="/seller/calibration" className="font-bold text-blue underline">Calibration</a> page, so campaigns can trust it knows you.</p>
              )}
              <Actions>
                <Button variant="secondary" onClick={() => go(2)}>Back</Button>
                {!paired && <Button variant="secondary" onClick={() => go(4)} data-guide="ob-pair-done">Skip for now</Button>}
                <Button onClick={() => go(4)} disabled={!paired} data-guide={paired ? 'ob-pair-done' : undefined}>Finish</Button>
              </Actions>
            </div>
          )}
        </Card>

      </div>
    </div>
  );
}



function Actions({ children, note }: { children: ReactNode; note?: string }) {
  return (
    <div className={cx('sticky bottom-0 -mx-5 mt-2 flex items-center gap-3 border-t border-line bg-surface px-5 py-3 sm:static sm:mx-0 sm:px-0 sm:pb-0')}>
      {note && <span className="mr-auto text-[13px] text-muted">{note}</span>}
      <div className="ml-auto flex gap-2">{children}</div>
    </div>
  );
}
