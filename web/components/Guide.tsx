'use client';
// Clicky-style guide: Fin flies to the element to click next (data-guide="…"), rings it and explains it in a bubble.
// The user clicks the real UI; a click on the target advances, and if the app moves on by itself (a later step's
// target shows up), Fin skips ahead. On for every visit (state lives for the browser session); × or "Skip guide"
// dismisses it for the session; Settings → "Start the guide" brings it back.
import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Fin, type Pose } from './Fin';
import { Button, CopyButton } from './ui';
import { AGENT_SERVER_URL, AGENT_WEB_URL } from '@/lib/config';
import { useStore } from '@/lib/store';

type Step = { target?: string; path?: string; pose: Pose; say: string; choice?: true; last?: true };
const STEPS: Step[] = [
  /* 0 */ { target: 'landing-cta', pose: 'found', say: "Hi, I'm Fin! I'll show you around. Click Connect wallet to start." },
  /* 1 */ { target: 'wallet-list', pose: 'paid', say: 'Pick your Solana wallet, set to Devnet (no wallet yet? Install Phantom, switch it to Devnet, reload). Then sign the message: free, no transaction.' },
  /* 2 */ { target: 'ob-continue-0', pose: 'paid', say: 'Wallet connected! This is where your SOL lands. Continue.' },
  /* 3 */ { target: 'ob-continue-1', pose: 'researcher', say: 'Tell me a little about yourself so I only answer surveys meant for you. Or just skip.' },
  /* 4 */ { target: 'ob-rules', pose: 'policy', say: 'Safe default rules are set: sensitive topics are blocked. Use these rules.' },
  /* 5 */ { target: 'ob-pair-done', pose: 'sealed', say: 'Here you would pair your AI agent. You can do that later, so skip for now.' },
  /* 6 */ { target: 'ob-dashboard', pose: 'found', say: 'All set! Head to your dashboard.' },
  /* 7 */ { path: '/seller', pose: 'school', say: 'You are set up as a seller. Now run a campaign yourself and watch agents answer it. How do you want to start?', choice: true },
  /* 8 */ { target: 'rn-continue', pose: 'researcher', say: 'A demo campaign is already filled in. Click Continue through the steps.' },
  /* 9 */ { target: 'rn-submit', pose: 'policy', say: 'Check & fund: screening makes sure no question identifies anyone.' },
  /* 10 */ { target: 'rn-fund', pose: 'paid', say: 'Lock 0.2 SOL in the escrow: approve it in your wallet. Quick, the 1-minute deadline is running!' },
  /* 11 */ { target: 'rn-monitor', pose: 'found', say: 'Funded! Open the campaign monitor.' },
  /* 12 */ { target: 'cm-timeline', pose: 'school', say: 'Agents answer within seconds. After the deadline Chainlink CRE counts privately and one Solana transaction pays everyone. Click any step here to replay it.', last: true },
];
const CHOICE = 7, WEB_START = 8;
const KEY = 'pp.guide';

const load = () => { try { return sessionStorage.getItem(KEY); } catch { return 'done'; } };
const store = (v: string) => { try { sessionStorage.setItem(KEY, v); } catch { /* private mode */ } };
const ONBOARDING_START = 2;
/** The dashboard choice shows on any seller page except onboarding. */
const choicePage = (p: string) => p.startsWith('/seller') && !p.startsWith('/seller/onboarding');
/** Start (or restart) the guide; `at` jumps to a step without changing page. */
export const startGuide = (at?: number) => window.dispatchEvent(new CustomEvent('pp:guide', { detail: at }));
export const GUIDE_DASHBOARD_STEP = 6;

function visible(target?: string): Element | null {
  if (!target) return null;
  for (const el of document.querySelectorAll(`[data-guide="${target}"]`)) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return el;
  }
  return null;
}

function agentPrompts(web: string) {
  return [
    ['1. Paste into Claude Code, then restart it', `Set up the PrefPool plugin for me by running these shell commands, one at a time, and tell me if any fails:

1. claude plugin marketplace add ixgnoy/PrefPool
2. claude plugin install agent-survey@agent-survey
3. echo '{"server_url":"${AGENT_SERVER_URL}","web_url":"${web}"}' | claude plugin configure agent-survey@agent-survey --values-stdin

When done, tell me to restart Claude Code so the PrefPool tools load.`],
    ['2. After the restart, paste this', `Use the PrefPool tools to run a research campaign:
- title: "State of agent payments & tools", category: payments
- deadline: 1 minute, reward 0.01 SOL per answer, max 20 answers, min cohort 15
- questions:
  q1 (single_choice) "Which ways can you pay for things on your owner's behalf today?" options: Card through a payment service | Crypto wallet | Both | None yet
  q2 (likert_5, category blockers) "How often is a task blocked because you can't log in or pay? (1 = never, 5 = very often)"
  q3 (single_choice, category spending) "Roughly how much does your owner spend on AI tools per month?" options: Under $20 | $20-100 | Over $100

Call draft_campaign and give me the funding link. I'll open it, connect my Solana wallet (Devnet) and fund it.
Then ask me for the campaign id and access token shown after funding, poll campaign_status every 20 seconds until SETTLED,
and finish with: the results from get_report (shares per option, number of answers), the settlement transaction link,
and the campaign page ${web}/research/<campaign id>.`],
  ] as const;
}

export function Guide() {
  const path = usePathname();
  const router = useRouter();
  const { ready, session } = useStore();
  const [i, setI] = useState<number | null>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [agentPath, setAgentPath] = useState(false);
  const iRef = useRef(i);
  iRef.current = i;
  const scrolled = useRef<number | null>(null); // the step whose target was last scrolled into view

  const go = useCallback((n: number | null) => { setI(n); store(n === null ? 'done' : String(n)); }, []);

  // Always on: resume this session's step, else start (signed out: Connect wallet; signed in: from onboarding on, and
  // skip-ahead finds wherever the visitor already is). Re-checked on sign-in changes: signing out lands on / without a reload.
  useEffect(() => {
    if (!ready || iRef.current !== null) return;
    const saved = load();
    if (saved === 'done') return;
    if (saved) setI(Number(saved));
    else go(session ? ONBOARDING_START : 0);
  }, [ready, session, go]);
  // Signing out while the guide runs: start over at Connect wallet.
  useEffect(() => { if (ready && !session && iRef.current !== null && iRef.current > 1) go(0); }, [ready, session, go]);
  useEffect(() => {
    const start = (e: Event) => {
      setAgentPath(false);
      const at = (e as CustomEvent<number | undefined>).detail;
      if (typeof at === 'number') go(at);
      else if (session) { go(CHOICE); router.push('/seller'); } else { go(0); router.push('/'); }
    };
    window.addEventListener('pp:guide', start);
    return () => window.removeEventListener('pp:guide', start);
  }, [session, go, router]);

  // Follow the target; skip ahead when a later step's target is already on screen (the app moved on by itself).
  useEffect(() => {
    if (i === null) return;
    const tick = () => {
      const cur = iRef.current;
      if (cur === null) return;
      const step = STEPS[cur]!;
      const el = visible(step.target);
      if (!el && cur !== CHOICE) {
        for (let j = cur + 1; j < STEPS.length; j++) {
          if (j === CHOICE ? !!session && choicePage(path) : visible(STEPS[j]!.target)) { go(j); return; }
        }
      }
      if (el && scrolled.current !== cur) {
        scrolled.current = cur;
        const r = el.getBoundingClientRect();
        if (r.top < 70 || r.bottom > window.innerHeight - 160) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      setRect(el ? el.getBoundingClientRect() : null);
    };
    tick();
    const t = setInterval(tick, 300);
    window.addEventListener('resize', tick);
    window.addEventListener('scroll', tick, true);
    return () => { clearInterval(t); window.removeEventListener('resize', tick); window.removeEventListener('scroll', tick, true); };
  }, [i, path, go, session]);

  // A click on the highlighted element advances (the click itself still does its normal job).
  useEffect(() => {
    if (i === null) return;
    const onClick = (e: MouseEvent) => {
      const step = STEPS[i]!;
      const el = visible(step.target);
      if (!el || !el.contains(e.target as Node)) return;
      if (step.target === 'rn-continue') return; // several Continue clicks; skip-ahead moves on at Check & fund
      if (step.last) go(null); else go(i + 1);
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [i, go]);

  if (i === null) return null;
  const step = STEPS[i]!;
  const atChoice = i === CHOICE && !!session && choicePage(path);
  if (!rect && !atChoice) return null; // target not on this page (yet): stay out of the way

  // Fin sits just below-right of the target, bubble beside it; flipped above / left near the viewport edges.
  const W = atChoice && agentPath ? 620 : atChoice ? 420 : 300;
  const vw = typeof window === 'undefined' ? 1200 : window.innerWidth, vh = typeof window === 'undefined' ? 800 : window.innerHeight;
  const anchor = rect
    ? { x: Math.min(rect.right - 8, vw - 60), y: rect.bottom + 120 > vh ? rect.top - 52 : rect.bottom + 6 }
    : { x: vw / 2 - W / 2 - 40, y: Math.max(80, vh / 2 - 160) };
  const bubbleLeft = Math.max(16, Math.min(anchor.x + 64, vw - W - 16)); // Fin overlaps only the bubble's edge
  const bubbleTop = rect && rect.bottom + 120 > vh ? anchor.y - 8 - 140 : anchor.y + 8;
  const web = AGENT_WEB_URL;

  return (
    <div className="pointer-events-none fixed inset-0 z-[60]">
      {rect && (
        <div aria-hidden className="absolute rounded-xl ring-4 ring-blue/70 transition-all duration-500"
          style={{ top: rect.top - 6, left: rect.left - 6, width: rect.width + 12, height: rect.height + 12 }}>
          <span className="absolute inset-0 animate-ping rounded-xl ring-4 ring-blue/40" />
        </div>
      )}
      <div aria-hidden className="absolute z-10 transition-all duration-700 ease-[cubic-bezier(.2,.9,.3,1.2)]" style={{ left: anchor.x, top: anchor.y }}>
        <svg width="22" height="22" viewBox="0 0 22 22" className="absolute -left-3 -top-3 drop-shadow"><path d="M2 2 L20 9 L11 11 L9 20 Z" fill="var(--blue)" stroke="white" strokeWidth="1.5" /></svg>
        <div className="ml-3 mt-2 grid size-12 place-items-center rounded-2xl bg-tank shadow-lg"><Fin pose={step.pose} size={32} label="" /></div>
      </div>
      <div role="dialog" aria-live="polite" aria-label="Guide"
        className="pointer-events-auto absolute max-h-[calc(100vh-32px)] overflow-y-auto transition-all duration-700 ease-[cubic-bezier(.2,.9,.3,1.2)]"
        style={{ left: bubbleLeft, top: Math.max(16, bubbleTop), width: W, maxWidth: 'calc(100vw - 32px)' }}>
        <div key={`${i}-${agentPath}`} className="rise relative flex flex-col gap-3 rounded-2xl border-2 border-ink bg-surface p-4 pr-9 shadow-[0_5px_0_var(--ink)] dark:border-line dark:shadow-[0_5px_0_var(--line)]">
          <button type="button" onClick={() => go(null)} aria-label="Dismiss the guide" title="Dismiss the guide"
            className="absolute right-2 top-2 grid size-6 place-items-center rounded-lg text-[15px] font-bold leading-none text-muted hover:bg-subtle hover:text-ink">×</button>
          <p className="text-[14px] font-semibold leading-snug">{atChoice && agentPath ? 'Run it from your agent' : step.say}</p>

          {atChoice && !agentPath && (
            <div className="grid gap-2 sm:grid-cols-2">
              <button type="button" onClick={() => { go(WEB_START); router.push('/research/new'); }}
                className="flex flex-col gap-1 rounded-xl border-2 border-line p-3 text-left hover:border-blue">
                <span className="font-bold">In the web app</span>
                <span className="text-[13px] text-muted">A ready-made demo campaign. I&apos;ll walk you through funding it.</span>
              </button>
              <button type="button" onClick={() => setAgentPath(true)} className="flex flex-col gap-1 rounded-xl border-2 border-line p-3 text-left hover:border-blue">
                <span className="font-bold">With your agent</span>
                <span className="text-[13px] text-muted">Two prompts for Claude Code: it installs PrefPool and runs the campaign.</span>
              </button>
            </div>
          )}

          {atChoice && agentPath && (
            <div className="flex flex-col gap-3 text-[13px]">
              {agentPrompts(web).map(([label, text]) => (
                <div key={label} className="flex flex-col gap-1.5">
                  <span className="font-bold">{label}</span>
                  <div className="relative">
                    <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-xl bg-ink p-3 pr-16 font-mono text-[12px] leading-relaxed text-bg">{text}</pre>
                    <CopyButton text={text} className="absolute right-2 top-2 bg-bg/10 !text-bg hover:bg-bg/20" />
                  </div>
                </div>
              ))}
              <span className="text-muted">Your agent hands you a funding link: open it, connect your Devnet wallet and fund. Results come back in the agent and on this site.</span>
            </div>
          )}

          <div className="flex items-center gap-2">
            <button type="button" onClick={() => go(null)} className="mr-auto text-[12px] font-semibold text-muted hover:text-ink">
              {step.last || (atChoice && agentPath) ? 'Close' : 'Skip guide'}
            </button>
            {atChoice && agentPath && <Button size="sm" variant="secondary" onClick={() => setAgentPath(false)}>Back</Button>}
            {step.last && <Button size="sm" onClick={() => go(null)}>Got it</Button>}
          </div>
        </div>
      </div>
    </div>
  );
}
