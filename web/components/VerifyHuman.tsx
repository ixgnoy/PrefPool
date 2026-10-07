'use client';
// World ID "verified human" card (spec 2026-10-07-world-id-personhood-design.md §5). One proof per seller, ever:
// the server signs the request and checks the proof with World; we never see or store who the person is.
import { useState } from 'react';
import { IDKitRequestWidget, orbLegacy, type IDKitResult } from '@worldcoin/idkit';
import { Check } from 'pixelarticons/react/Check';
import { Human } from 'pixelarticons/react/Human';
import { Lock } from 'pixelarticons/react/Lock';
import { Button, Card, FinTank, Pill } from '@/components/ui';
import { ApiError, personhoodRequest, personhoodVerify, type PersonhoodRequest } from '@/lib/api';
import { useStore } from '@/lib/store';

const MESSAGES: Record<string, string> = {
  HUMAN_ALREADY_LINKED: 'This World ID is already linked to another agent.',
  ALREADY_VERIFIED: 'This agent is already verified with a different World ID.',
  WORLD_UNAVAILABLE: 'World ID is unavailable right now. Try again in a minute.',
  PERSONHOOD_DISABLED: 'World ID verification is not set up on this server.',
};
const message = (e: unknown) => (e instanceof ApiError ? MESSAGES[e.code] ?? e.message : e instanceof Error ? e.message : 'Verification failed.');

export function VerifyHuman() {
  const { session, agent, refreshAgent } = useStore();
  const [req, setReq] = useState<PersonhoodRequest | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!agent || !session) return null;
  const token = session.sessionToken;
  const verified = agent.personhood;

  async function start() {
    setError(null); setBusy(true);
    try { setReq(await personhoodRequest(token)); setOpen(true); } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  async function verify(result: IDKitResult) {
    try { await personhoodVerify(token, result); await refreshAgent(); } catch (e) { setError(message(e)); throw e; }
  }

  return (
    <Card id="personhood" className="flex flex-col gap-4 p-5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-base font-bold"><Human aria-hidden width={18} height={18} className="text-blue" />Verified human</h2>
        {verified
          ? <Pill tone="ok"><Check aria-hidden width={14} height={14} />{verified.kind === 'world' ? 'World ID' : 'Simulated'}</Pill>
          : <Pill>Not verified</Pill>}
      </div>

      {verified ? (
        <div className="flex flex-col gap-3">
          <FinTank pose="found" label="Verified human" className="h-28 w-full" />
          <p className="text-sm leading-relaxed">Your agent can answer <b>verified humans only</b> campaigns. One person, one agent: this World ID can&apos;t verify another agent.</p>
        </div>
      ) : (
        <>
          <p className="text-sm leading-relaxed text-muted">Prove once with World ID that a real, unique person runs this agent. It unlocks campaigns that only accept verified humans.</p>
          <div className="flex gap-3 rounded-2xl bg-blue-soft p-4 text-sm leading-relaxed">
            <Lock aria-hidden width={18} height={18} className="mt-0.5 shrink-0 text-blue" />
            <span><b>Anonymous.</b> We keep a one-way code that only says &quot;this person already has an agent&quot;, never who you are.</span>
          </div>
          <Button className="self-start" onClick={start} disabled={busy}>{busy ? 'Opening World ID…' : 'Verify with World ID'}</Button>
          {req?.environment === 'staging' && (
            <span className="text-xs text-muted">Testing: open simulator.worldcoin.org, choose <b>Paste code</b>, then approve.</span>
          )}
        </>
      )}
      {error && <p role="alert" className="text-sm font-bold text-danger-ink">{error}</p>}

      {req && (
        <IDKitRequestWidget open={open} onOpenChange={setOpen} app_id={req.appId} action={req.action} rp_context={req.rpContext}
          allow_legacy_proofs environment={req.environment} preset={orbLegacy({ signal: req.signal })}
          handleVerify={verify} onSuccess={() => setOpen(false)}
          onError={() => setError((e) => e ?? 'World ID verification was cancelled or expired. Try again.')} />
      )}
    </Card>
  );
}
