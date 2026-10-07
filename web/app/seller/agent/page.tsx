'use client';
import { VerifyHuman } from '@/components/VerifyHuman';
import { useEffect, useState } from 'react';
import { Fin } from '@/components/Fin';
import { PairAgent } from '@/components/PairAgent';
import { Button, Card, PageTitle, Pill } from '@/components/ui';
import { useStore } from '@/lib/store';
import { registerAgent } from '@/lib/api';

function ago(ms: number | null, now: number | null) {
  if (!ms || !now) return 'never';
  const s = Math.max(0, Math.round((now - ms) / 1000));
  return s < 60 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago`;
}

export default function AgentPage() {
  const { session, agent, refreshAgent, liveToken, setLiveToken } = useStore();
  const presence = (!!liveToken && agent?.kind === 'live') ? 'online' : agent?.status ?? 'offline';
  const PRESENCE = {
    online: { pill: 'Online', tone: 'ok', pose: 'idle', label: 'Agent online' },
    idle: { pill: 'Idle', tone: 'warn', pose: 'swim', label: 'Agent idle, checks in when it works' },
    offline: { pill: 'Not connected', tone: 'danger', pose: 'sleeping', label: 'Agent not connected' },
  } as const;
  const p = PRESENCE[presence];
  // Disconnect = issue a new token and drop it: the old one (plugin or web agent) stops working immediately.
  const disconnect = async () => {
    if (!session || !agent) return;
    await registerAgent(session.sessionToken, agent.kind === 'live' ? 'live' : 'plugin', agent.policy ?? undefined);
    setLiveToken(null);
    await refreshAgent();
  };
  const [now, setNow] = useState<number | null>(null);
  const [confirm, setConfirm] = useState(false);
  useEffect(() => { setNow(Date.now()); const t = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(t); }, []);

  return (
    <>
      <PageTitle title="Agent" sub="Pair your agent and check that it's online." />
      <div className="grid items-start gap-6 lg:grid-cols-[340px_minmax(0,1fr)]">
        <div className="flex flex-col gap-5">
          <Card className="flex flex-col items-center gap-3 p-6 text-center">
            <div className="grid h-36 w-full place-items-center rounded-2xl bg-tank"><Fin pose={p.pose} label={p.label} /></div>
            <Pill tone={p.tone}>{p.pill}</Pill>
            <span className="text-sm text-muted">Last checked in {ago(agent?.lastSeenAt ?? null, now)}{agent ? ` · ${agent.kind === 'live' ? 'web agent' : agent.kind}` : ''}</span>
            {presence === 'idle' && <span className="text-xs text-muted">Idle is normal: Claude Code and OpenClaw agents check in when they run (OpenClaw every heartbeat).</span>}
            {agent && <span className="font-mono text-xs text-muted">{agent.agentId}</span>}
          </Card>
          <VerifyHuman />
          <Card className="flex flex-col gap-3 border-danger/40 p-5">
            <h2 className="font-bold text-danger-ink">Danger zone</h2>
            <p className="text-[13px] text-muted">Disconnecting revokes the token. Your agent stops answering; payouts already earned still arrive.</p>
            {confirm ? (
              <div className="flex gap-2">
                <Button variant="danger" onClick={async () => { await disconnect(); setConfirm(false); }}>Yes, disconnect</Button>
                <Button variant="secondary" onClick={() => setConfirm(false)}>Cancel</Button>
              </div>
            ) : <Button variant="danger" className="self-start" disabled={!agent} onClick={() => setConfirm(true)}>Disconnect agent</Button>}
          </Card>
        </div>
        <PairAgent allTabs />
      </div>
    </>
  );
}
