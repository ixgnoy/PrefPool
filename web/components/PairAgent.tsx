'use client';
import { useEffect, useState } from 'react';
import { Button, Card, CopyButton, Mono, Toggle, cx } from './ui';
import { useStore } from '@/lib/store';
import { SERVER, registerAgent } from '@/lib/api';
import type { OwnerPolicy } from '@/lib/policy';
import { TABS, snippet, type Tab } from '@/lib/pairSnippets';


/** Shared by onboarding step 4 and /seller/agent. */
export function PairAgent({ onConnected, allTabs = false, policy: draft }: { onConnected?(): void; allTabs?: boolean; policy?: OwnerPolicy }) {
  const { session, agent, refreshAgent, policy: saved, liveToken, setLiveToken } = useStore();
  const policy = draft ?? saved;
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('Claude Code');
  const [web, setWeb] = useState('http://localhost:3000');
  useEffect(() => setWeb(window.location.origin), []); // the site the user is on
  const live = !!liveToken && agent?.kind === 'live';
  const paired = live || !!agent?.connected;
  const waiting = !!token && !paired;

  async function register(kind: 'live' | 'plugin') {
    if (!session) throw new Error('Connect your Solana wallet first.');
    // Keep the saved guardrails: the plugin also keeps its own copy, but the server is what the web pages show.
    return registerAgent(session.sessionToken, kind, policy);
  }

  async function createToken() {
    setBusy(true); setError(null);
    try {
      const r = await register('plugin');
      setToken(r.agentToken);
      setLiveToken(null);
      await refreshAgent();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  async function setLive(on: boolean) {
    setError(null);
    if (!on) { setLiveToken(null); return; }
    try {
      const r = await register('live');
      setLiveToken(r.agentToken);
      await refreshAgent();
      onConnected?.();
    } catch (e) { setError((e as Error).message); }
  }

  // GET /api/agents/mine reports `connected` once the plugin has called the API with its token.
  useEffect(() => {
    if (!waiting) return;
    const t = setInterval(() => { void refreshAgent(); }, 2_000);
    return () => clearInterval(t);
  }, [waiting, refreshAgent]);
  useEffect(() => { if (token && agent?.connected) onConnected?.(); }, [token, agent?.connected]); // eslint-disable-line react-hooks/exhaustive-deps

  const tabs = allTabs ? TABS : (['Claude Code'] as const);
  return (
    <div className="flex flex-col gap-4">
      <Card className={cx('flex flex-col gap-4 p-5', !live && 'border-[1.5px] border-blue')}>
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-base font-bold">Use Claude Code or another MCP client</h3>
          <span className="rounded-full bg-blue-soft px-2 py-0.5 text-[11px] font-bold text-blue">Recommended</span>
        </div>
        {allTabs && (
          <div className="flex flex-wrap gap-1" role="tablist">
            {tabs.map((t) => (
              <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
                className={cx('rounded-lg px-3 py-1.5 text-[13px] font-bold', tab === t ? 'bg-blue-soft text-blue' : 'text-muted hover:text-ink')}>{t}</button>
            ))}
          </div>
        )}
        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] font-bold">1. Install</span>
          <div className="relative">
            <pre className="overflow-x-auto rounded-xl bg-ink p-3 pr-20 font-mono text-[13px] leading-relaxed text-bg">{snippet(tab, token ?? '<agent_token>', { server: SERVER, web })}</pre>
            <CopyButton text={snippet(tab, token ?? '<agent_token>', { server: SERVER, web })} className="absolute right-2 top-2 bg-bg/10 !text-bg hover:bg-bg/20" />
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] font-bold">2. Paste this token into the plugin&apos;s <Mono>agent_token</Mono> setting</span>
          {token ? (
            <>
              <div className="flex items-center justify-between gap-2 rounded-xl border-[1.5px] border-dashed border-warn bg-warn-soft px-3 py-2.5">
                <Mono className="break-all text-sm">{token}</Mono>
                <CopyButton text={token} />
              </div>
              <span className="text-xs font-bold text-warn-ink">Shown once. Copy it now; we can&apos;t show it again.</span>
            </>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={createToken} disabled={busy}>{busy ? 'Creating…' : agent ? 'Create new token' : 'Create token'}</Button>
              {agent && <span className="text-xs text-muted">A new token revokes the old one.</span>}
            </div>
          )}
        </div>
      </Card>

      <Card className="flex items-center gap-3 p-4">
        <div className="flex flex-1 flex-col gap-0.5">
          <span className="text-[15px] font-bold">Demo agent in this tab</span>
          <span className="text-[13px] text-muted"><b className="text-ink">Demo only: its answers are random, not your opinions.</b> It follows your rules and encrypts answers like a real agent, but only while this tab is open. For real answers, pair Claude Code or OpenClaw above.</span>
          {agent?.kind === 'plugin' && !live && <span className="text-[13px] font-bold text-warn-ink">Turning this on issues a new token, so your paired plugin stops working.</span>}
        </div>
        <Toggle checked={live} onChange={setLive} label="" ariaLabel="Run the demo agent in this tab" />
      </Card>

      {error && <p role="alert" className="text-sm font-bold text-danger-ink">{error}</p>}
      <div aria-live="polite" className={cx('flex items-center gap-3 rounded-2xl px-4 py-3.5', paired ? 'bg-ok-soft' : 'bg-subtle')}>
        <span className={cx('size-2.5 rounded-full', paired ? 'bg-ok' : waiting ? 'animate-pulse bg-warn' : 'bg-line')} />
        <span className={cx('text-[15px] font-bold', paired ? 'text-ok-ink' : 'text-ink')}>
          {paired ? `Connected · ${live ? 'web agent in this tab' : 'plugin'}` : waiting ? 'Waiting for your agent to connect…' : 'Not connected'}
        </span>
      </div>
    </div>
  );
}
