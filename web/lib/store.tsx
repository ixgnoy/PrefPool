'use client';
// App-wide client state. Persisted: session, campaign access tokens, local profile, theme, view mode.
// In memory only: the live Solana wallet (Wallet Standard; signs funding/refund txs); it reconnects silently after a reload.
// Server-owned: the seller's agent and guardrails (GET/PUT /api/agents/mine).
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { isSolanaAddress, type OwnerPolicy } from '@as/shared';
import { getMyAgent, signIn, updateMyAgent, type MyAgent } from './api';
import { connectWallet, type ConnectedWallet } from './wallet';
import { DEFAULT_POLICY } from './policy';
import { COUNTRY_CODES } from './audience';

export type Session = { address: string; walletId: string; walletName: string; sessionToken: string } | null;
/** Owner's local profile (never uploaded). `country` is an ISO code, `ageBand` like "25-34" (see lib/audience.ts). */
export type Profile = { occupation: string | null; hobbies: string[]; eWallet: boolean | null; ageBand: string | null; country: string | null };
export type Theme = 'light' | 'dark';
export type ViewMode = 'user' | 'dev';

const DEFAULT_PROFILE: Profile = { occupation: null, hobbies: [], eWallet: null, ageBand: null, country: null };

/** Profiles saved by the first onboarding stored country names and en-dash bands; campaigns use ISO codes and "25-34". */
function normalizeProfile(p: Profile): Profile {
  const country = p.country && (COUNTRY_CODES[p.country] ?? (Object.values(COUNTRY_CODES).includes(p.country) ? p.country : null));
  return { ...DEFAULT_PROFILE, ...p, country: country || null, ageBand: p.ageBand ? p.ageBand.replace('–', '-') : null };
}

type Store = {
  ready: boolean;
  session: Session;
  /** Connect a Solana wallet and sign in (signMessage over the server nonce). Throws on wrong network / rejection. */
  connect(walletId: string, walletName: string): Promise<{ wallet: ConnectedWallet; session: NonNullable<Session> }>;
  /** The live wallet for signing; reconnects to the session's wallet if needed. */
  ensureWallet(): Promise<ConnectedWallet>;
  signOut(): void;
  /** The seller's agent from the server; null = not registered yet, undefined = loading. */
  agent: MyAgent | null | undefined;
  refreshAgent(): Promise<void>;
  /** The saved guardrails (server), or the defaults before an agent exists. */
  policy: OwnerPolicy;
  savePolicy(p: OwnerPolicy): Promise<void>;
  setPaused(paused: boolean): Promise<void>;
  profile: Profile; setProfile(p: Profile): void;
  accessTokens: Record<string, string>; rememberAccessToken(campaignId: string, token: string): void;
  theme: Theme; toggleTheme(): void;
  view: ViewMode; setView(v: ViewMode): void;
  /** Agent token of the in-browser web agent; tab-scoped (sessionStorage), so it only runs while this tab is open. */
  liveToken: string | null; setLiveToken(t: string | null): void;
  /** "Match campaigns to my profile": on = the agent abstains when a campaign's audience excludes the owner. */
  matchProfile: boolean; setMatchProfile(v: boolean): void;
  /** Transcript private key, derived from a wallet signature; memory only, gone on reload (encrypt to self). */
  transcriptKey: string | null; setTranscriptKey(k: string | null): void;
};

const Ctx = createContext<Store | null>(null);

function load<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}
const save = (key: string, v: unknown) => { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* private mode */ } };

export function StoreProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [session, setSessionS] = useState<Session>(null);
  const [wallet, setWallet] = useState<ConnectedWallet | null>(null);
  const [agent, setAgent] = useState<MyAgent | null | undefined>(undefined);
  const [profile, setProfileS] = useState<Profile>(DEFAULT_PROFILE);
  const [accessTokens, setTokens] = useState<Record<string, string>>({});
  const [theme, setThemeS] = useState<Theme>('light');
  const [view, setViewS] = useState<ViewMode>('user');
  const [liveToken, setLiveTokenS] = useState<string | null>(null);
  const [matchProfile, setMatchProfileS] = useState(false);
  const [transcriptKey, setTranscriptKey] = useState<string | null>(null);

  useEffect(() => {
    const saved = load<Session>('cf.session', null);
    setSessionS(saved && isSolanaAddress(saved.address) ? saved : null); // drops pre-Solana (Cardano) sessions
    setProfileS(normalizeProfile(load('cf.profile', DEFAULT_PROFILE)));
    setTokens(load('cf.accessTokens', {}));
    setThemeS(load('cf.theme', 'light'));
    setMatchProfileS(load('cf.matchProfile', false)); // opt-in: a blank profile would otherwise skip every targeted campaign
    const urlView = new URLSearchParams(window.location.search).get('view');
    setViewS(urlView === 'dev' || urlView === 'user' ? urlView : load('cf.view', 'user'));
    try { setLiveTokenS(sessionStorage.getItem('cf.liveToken')); } catch { /* private mode */ }
    setReady(true);
  }, []);

  const setSession = (s: Session) => { setSessionS(s); save('cf.session', s); };

  const refreshAgent = useCallback(async () => {
    if (!session) { setAgent(null); return; }
    try { setAgent(await getMyAgent(session.sessionToken)); } catch { setAgent(null); }
  }, [session]);
  useEffect(() => { if (ready) void refreshAgent(); }, [ready, refreshAgent]);

  const connect = async (walletId: string, walletName: string) => {
    const w = await connectWallet(walletId);
    const sessionToken = await signIn(w);
    const s = { address: w.address, walletId, walletName, sessionToken };
    setWallet(w);
    setSession(s);
    return { wallet: w, session: s };
  };

  const value: Store = {
    ready,
    session,
    connect,
    ensureWallet: async () => {
      if (wallet) return wallet;
      if (!session) throw new Error('Connect your Solana wallet first.');
      const w = await connectWallet(session.walletId, { silent: true });
      if (w.address !== session.address) throw new Error('Your wallet switched accounts. Sign in again.');
      setWallet(w);
      return w;
    },
    signOut: () => { setSession(null); setWallet(null); setAgent(null); setTranscriptKey(null); value.setLiveToken(null); },
    agent,
    refreshAgent,
    policy: agent?.policy ?? DEFAULT_POLICY,
    savePolicy: async (p) => {
      if (!session) throw new Error('Connect your Solana wallet first.');
      await updateMyAgent(session.sessionToken, { policy: p });
      await refreshAgent();
    },
    setPaused: async (paused) => {
      if (!session) return;
      await updateMyAgent(session.sessionToken, { paused });
      await refreshAgent();
    },
    profile,
    setProfile: (p) => { setProfileS(p); save('cf.profile', p); },
    accessTokens,
    rememberAccessToken: (id, t) => setTokens((prev) => { const n = { ...prev, [id]: t }; save('cf.accessTokens', n); return n; }),
    theme,
    toggleTheme: () => setThemeS((t) => {
      const n: Theme = t === 'dark' ? 'light' : 'dark';
      document.documentElement.classList.toggle('dark', n === 'dark');
      save('cf.theme', n);
      return n;
    }),
    view,
    setView: (v) => { setViewS(v); save('cf.view', v); },
    matchProfile,
    setMatchProfile: (v) => { setMatchProfileS(v); save('cf.matchProfile', v); },
    transcriptKey,
    setTranscriptKey,
    liveToken,
    setLiveToken: (t) => {
      setLiveTokenS(t);
      try { if (t) sessionStorage.setItem('cf.liveToken', t); else sessionStorage.removeItem('cf.liveToken'); } catch { /* private mode */ }
    },
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore() {
  const s = useContext(Ctx);
  if (!s) throw new Error('useStore must be used inside <StoreProvider>');
  return s;
}
