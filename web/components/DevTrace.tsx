'use client';
// Dev view (FRONTEND_PRD §5.10): the technical trace under the user view. Public on-chain facts and non-sensitive
// platform data only (GET /api/campaigns/:id/trace, GET /api/config/public); never answers, tokens or private keys.
import { useEffect, useState, type ReactNode } from 'react';
import { decodeCampaignAccount, verifySettlementReport } from '@as/shared';
import { AddressLink, CopyButton, TxLink, cx } from './ui';
import { getConfig, getTrace, type CampaignTrace, type PublicConfig, type TxTrace } from '@/lib/api';
import { useStore } from '@/lib/store';

import { solOf } from '@/lib/campaign';

const amount = (lamports: string | number | bigint | null | undefined) => (lamports == null ? '—' : `${solOf(lamports)} (${lamports.toString()} lamports)`);
const when = (ms: number | null | undefined) => (ms ? `${new Date(ms).toLocaleString()} · ${ms}` : '—');

function usePublicConfig() {
  const [cfg, setCfg] = useState<PublicConfig | null>(null);
  useEffect(() => { getConfig().then(setCfg).catch(() => {}); }, []);
  return cfg;
}

function DevBadge() {
  return <span className="rounded bg-[#f2c14e] px-1.5 py-0.5 font-pixel text-[11px] font-bold text-[#13203d]">DEV</span>;
}

function Row({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 py-1.5 sm:grid-cols-[180px_minmax(0,1fr)] sm:gap-3">
      <dt className="text-[12px] font-bold text-[#9ba8c2]">{k}</dt>
      <dd className="min-w-0 break-all font-mono text-[12px] text-[#e7ecf7]">{children}</dd>
    </div>
  );
}
function Hex({ v }: { v: string | null | undefined }) {
  if (!v) return <>—</>;
  return <span className="inline-flex items-center gap-1">{v}<CopyButton text={v} className="!text-[#7f9ff2]" /></span>;
}
function Json({ value }: { value: unknown }) {
  const text = JSON.stringify(value, null, 2);
  return (
    <div className="relative">
      <div className="absolute right-2 top-2"><CopyButton text={text} label="Copy JSON" className="!text-[#7f9ff2]" /></div>
      <pre className="max-h-80 overflow-auto rounded-xl bg-[#0b111d] p-3 pr-24 font-mono text-[11.5px] leading-relaxed text-[#cdd6ea]">{text}</pre>
    </div>
  );
}
function Block({ step, title, children, tone }: { step: number; title: string; children: ReactNode; tone?: 'ok' | 'warn' | 'idle' }) {
  return (
    <details open className="group rounded-2xl border border-[#2a3654] bg-[#172036]">
      <summary className="flex cursor-pointer items-center gap-3 px-4 py-3">
        <span className={cx('grid size-6 place-items-center rounded-full text-[11px] font-bold',
          tone === 'ok' ? 'bg-[#4fc68a] text-[#0f1625]' : tone === 'warn' ? 'bg-[#f2c14e] text-[#0f1625]' : 'bg-[#2a3654] text-[#9ba8c2]')}>{step}</span>
        <span className="text-sm font-bold text-[#e7ecf7]">{title}</span>
      </summary>
      <div className="flex flex-col gap-2 border-t border-[#2a3654] px-4 py-3">{children}</div>
    </details>
  );
}

function TxTable({ tx }: { tx: TxTrace }) {
  return (
    <>
      <dl>
        <Row k="signature"><TxLink hash={tx.signature} full className="!text-[#7f9ff2]" /></Row>
        <Row k="slot / block time">{tx.slot ?? '—'} / {tx.blockTime ? when(tx.blockTime * 1000) : '—'}</Row>
        <Row k="fee">{amount(tx.fee)}</Row>
        <Row k="status">{tx.err == null ? <span className="text-[#4fc68a]">ok</span> : <span className="text-[#f39a8f]">{JSON.stringify(tx.err)}</span>}</Row>
        {tx.instructions.length > 0 && <Row k="instructions">{tx.instructions.map((ix, i) => <span key={i} className="mr-3 inline-block"><span className="text-[#9ba8c2]">{ix.program}</span>::<b className={ix.name === 'unknown' ? '' : 'text-[#f2c14e]'}>{ix.name}</b></span>)}</Row>}
      </dl>
      {tx.logMessages.length > 0 && (
        <pre className="max-h-64 overflow-auto rounded-xl bg-[#0b111d] p-3 font-mono text-[11px] leading-relaxed text-[#cdd6ea]">{tx.logMessages.join('\n')}</pre>
      )}
    </>
  );
}

/** Global strip under the header: the on-chain identifiers every page relies on. */
export function DevStrip() {
  const { view } = useStore();
  const cfg = usePublicConfig();
  if (view !== 'dev' || !cfg) return null;
  return (
    <div className="border-b border-[#2a3654] bg-[#0f1625] text-[#e7ecf7]">
      <div className="mx-auto flex max-w-[clamp(1280px,90vw,2200px)] flex-wrap items-center gap-x-5 gap-y-1.5 px-4 py-2 font-mono text-[11.5px] sm:px-8">
        <DevBadge />
        <span>network <b>solana:{cfg.cluster ?? 'devnet'}</b></span>
        {cfg.programId && <span className="flex items-center gap-1">escrow program <AddressLink address={cfg.programId} className="!text-[11.5px] !text-[#7f9ff2]" /></span>}
        {cfg.relayerAddress && <span className="flex items-center gap-1">relayer <AddressLink address={cfg.relayerAddress} className="!text-[11.5px] !text-[#7f9ff2]" /></span>}
        {cfg.platformFeePayTo && <span className="flex items-center gap-1">x402 payTo <AddressLink address={cfg.platformFeePayTo} className="!text-[11.5px] !text-[#7f9ff2]" /> · {cfg.platformFeeUsdc} USDC</span>}
        <span className="flex items-center gap-1">ReportRegistry {cfg.reportRegistryAddress ? <AddressLink address={cfg.reportRegistryAddress} evm className="!text-[11.5px] !text-[#7f9ff2]" /> : <span className="text-[#f2c14e]">not deployed (simulated)</span>}</span>
        <span className="flex items-center gap-1">CRE envelope pk <span className="text-[#9ba8c2]">{cfg.envelopePublicKey.slice(0, 10)}…</span><CopyButton text={cfg.envelopePublicKey} className="!text-[#7f9ff2]" /></span>
        <span className="flex items-center gap-1">CRE report pk <span className="text-[#9ba8c2]">{cfg.reportPublicKey.slice(0, 10)}…</span><CopyButton text={cfg.reportPublicKey} className="!text-[#7f9ff2]" /></span>
      </div>
    </div>
  );
}

/** Per-campaign transaction timeline (§5.10), polled every 5 s. */
export function DevTrace({ campaignId }: { campaignId: string }) {
  const { session } = useStore();
  const cfg = usePublicConfig();
  const [t, setT] = useState<CampaignTrace | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    const load = () => getTrace(campaignId, session?.sessionToken).then((v) => { if (live) { setT(v); setError(null); } }).catch((e: Error) => live && setError(e.message));
    void load();
    const timer = setInterval(load, 5_000);
    return () => { live = false; clearInterval(timer); };
  }, [campaignId, session]);

  let account: ReturnType<typeof decodeCampaignAccount> | null = null;
  try { account = t?.escrow?.data ? decodeCampaignAccount(t.escrow.data) : null; } catch { account = null; }
  const sig = t?.settlementReport && cfg ? verifySettlementReport(t.settlementReport, cfg.reportPublicKey, { minCohort: t.spec.minCohort, maxResponses: t.spec.maxResponses }) : null;

  return (
    <section className="flex flex-col gap-3 rounded-3xl bg-[#0f1625] p-4 text-[#e7ecf7] sm:p-5" aria-label="Developer trace">
      <div className="flex flex-wrap items-center gap-3">
        <DevBadge />
        <h2 className="font-pixel text-xl font-bold">Under the hood</h2>
        <span className="text-xs text-[#9ba8c2]">Public on-chain data and platform metadata. Never answers, tokens or keys.</span>
      </div>
      {error && <p className="text-sm text-[#f39a8f]">{error}</p>}
      {!t ? <div className="h-40 animate-pulse rounded-2xl bg-[#172036]" /> : (
        <>
          <Block step={0} title={`Lifecycle · ${t.state}`} tone="ok">
            <dl>
              <Row k="campaign id"><Hex v={t.campaignId} /></Row>
              <Row k="state">{t.state}</Row>
              <Row k="created / updated">{when(t.createdAt)} → {when(t.updatedAt)}</Row>
              <Row k="deadline">{when(t.deadlineMs)}</Row>
              <Row k="refund_after">{when(t.refundAfterMs)}</Row>
              <Row k="buyer (company)"><AddressLink address={t.buyerAddress} full className="!text-[12px] !text-[#7f9ff2]" /></Row>
            </dl>
          </Block>

          <Block step={1} title={`Screening · ${t.rejectReasons.length ? 'rejected' : 'passed'}`} tone={t.rejectReasons.length ? 'warn' : 'ok'}>
            {t.rejectReasons.length > 0 && <p className="text-sm text-[#f39a8f]">{t.rejectReasons.join('; ')}</p>}
            <Json value={t.spec} />
          </Block>

          <Block step={2} title="Funding tx · escrow account" tone={t.fundTx ? 'ok' : 'idle'}>
            <dl>
              <Row k='escrow PDA ["campaign", id]'>{t.escrowTxRef ? <AddressLink address={t.escrowTxRef} full className="!text-[12px] !text-[#7f9ff2]" /> : '—'}</Row>
              {t.escrow && <Row k="escrow lamports / owner">{amount(t.escrow.lamports)} · <AddressLink address={t.escrow.owner} className="!text-[12px] !text-[#7f9ff2]" /></Row>}
            </dl>
            {account ? (
              <dl>
                <Row k="campaign_id"><Hex v={account.campaignId} /></Row>
                <Row k="company"><AddressLink address={account.company} full className="!text-[12px] !text-[#7f9ff2]" /></Row>
                <Row k="report_pk (CRE key: only signed payouts settle)"><Hex v={account.reportPk} /></Row>
                <Row k="reward_lamports">{amount(account.rewardLamports)}</Row>
                <Row k="budget_lamports">{amount(account.budgetLamports)}</Row>
                <Row k="max_responses / min_cohort">{account.maxResponses} / {account.minCohort}</Row>
                <Row k="deadline">{when(account.deadlineMs)}</Row>
                <Row k="refund_after">{when(account.refundAfterMs)}</Row>
              </dl>
            ) : <p className="text-sm text-[#9ba8c2]">{t.escrow === null && t.settlementTx ? 'Escrow account closed (settled or refunded).' : 'No escrow account on chain.'}</p>}
            {t.fundTx ? <TxTable tx={t.fundTx} /> : <p className="text-sm text-[#9ba8c2]">Funding tx not on chain yet.</p>}
          </Block>

          <Block step={3} title={`Encrypted answers · ${t.envelopes.count}`} tone={t.envelopes.count ? 'ok' : 'idle'}>
            <dl>
              <Row k="envelopes">{t.envelopes.count}</Row>
              <Row k="first / last received">{when(t.envelopes.firstAtMs)} → {when(t.envelopes.lastAtMs)}</Row>
              {t.envelopes.sample && <Row k="sample (public fields)">epk {t.envelopes.sample.epk.slice(0, 16)}… · nonce {t.envelopes.sample.n.slice(0, 12)}… · ciphertext {t.envelopes.sample.ciphertextBytes} bytes</Row>}
            </dl>
            <p className="text-[12px] text-[#9ba8c2]">X25519 + XChaCha20-Poly1305 to the CRE envelope key. Only the CRE workflow can open them.</p>
          </Block>

          <Block step={4} title={`CRE run · ${t.creJob?.status ?? 'not started'}`} tone={t.settlementReport ? 'ok' : t.creJob ? 'warn' : 'idle'}>
            {t.creJob && <Row k="job">{t.creJob.id} · {t.creJob.status}</Row>}
            {t.creJob?.log && <pre className="max-h-64 overflow-auto rounded-xl bg-[#0b111d] p-3 font-mono text-[11px] leading-relaxed text-[#9fe0b9]">{t.creJob.log}</pre>}
            {t.settlementReport && (
              <>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-bold">Settlement report</span>
                  {sig && (sig.length === 0
                    ? <span className="rounded-full bg-[#163a2a] px-2 py-0.5 text-xs font-bold text-[#4fc68a]">signature verified ✓</span>
                    : <span className="rounded-full bg-[#3a1d22] px-2 py-0.5 text-xs font-bold text-[#f39a8f]">check failed: {sig.join(', ')}</span>)}
                </div>
                <Json value={t.settlementReport} />
              </>
            )}
            {t.researchReport && <><span className="text-sm font-bold">Research report (owner only)</span><Json value={t.researchReport} /></>}
          </Block>

          <Block step={5} title={`EVM commitment · ${t.evm.txHash ? 'broadcast' : 'simulated'}`} tone={t.settlementReport ? (t.evm.txHash ? 'ok' : 'warn') : 'idle'}>
            <dl>
              <Row k="ReportRegistry">{t.evm.registryAddress ? <AddressLink address={t.evm.registryAddress} evm full className="!text-[12px] !text-[#7f9ff2]" /> : 'not configured'}</Row>
              <Row k="campaignId → reportHash">{t.settlementReport ? `${t.campaignId.slice(0, 12)}… → ${t.settlementReport.reportHash}` : '—'}</Row>
              <Row k="tx">{t.evm.txHash ? <TxLink hash={t.evm.txHash} evm full className="!text-[12px] !text-[#7f9ff2]" /> : 'simulated (dry run)'}</Row>
            </dl>
          </Block>

          <Block step={6} title={t.state === 'REFUNDED' ? 'Refund tx' : 'Settlement tx'} tone={t.settlementTx ? 'ok' : 'idle'}>
            {t.settlementTx ? <TxTable tx={t.settlementTx} /> : <p className="text-sm text-[#9ba8c2]">Not settled yet.</p>}
          </Block>
        </>
      )}
    </section>
  );
}

/** Seller dev panel: the agent record and each decision's settlement link (no answers exist here to show). */
export function DevSeller({ items }: { items: { campaignId: string; kind: string; reason: string | null; outcome: string; payoutLamports?: string; settlementTx: string | null }[] }) {
  const { agent, session } = useStore();
  return (
    <section className="flex flex-col gap-3 rounded-3xl bg-[#0f1625] p-4 text-[#e7ecf7] sm:p-5" aria-label="Developer trace">
      <div className="flex items-center gap-3"><DevBadge /><h2 className="font-pixel text-xl font-bold">Under the hood</h2></div>
      <Block step={0} title="Agent record" tone={agent ? 'ok' : 'idle'}>
        {agent ? (
          <dl>
            <Row k="agent id">{agent.agentId}</Row>
            <Row k="kind">{agent.kind}{agent.paused ? ' · paused' : ''}</Row>
            <Row k="payout address">{session && <AddressLink address={session.address} full className="!text-[12px] !text-[#7f9ff2]" />}</Row>
            <Row k="last seen">{when(agent.lastSeenAt)} · {agent.status}</Row>
          </dl>
        ) : <p className="text-sm text-[#9ba8c2]">No agent registered.</p>}
        {agent?.policy && <Json value={agent.policy} />}
      </Block>
      <Block step={1} title={`Decisions · ${items.length}`} tone={items.length ? 'ok' : 'idle'}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] font-mono text-[11.5px]">
            <thead><tr className="text-left text-[#9ba8c2]"><th className="py-1 pr-3">campaign</th><th className="pr-3">decision</th><th className="pr-3">outcome</th><th className="pr-3">payout</th><th>settlement tx</th></tr></thead>
            <tbody>
              {items.map((a) => (
                <tr key={a.campaignId} className="border-t border-[#2a3654]">
                  <td className="py-1 pr-3">{a.campaignId.slice(0, 12)}…</td>
                  <td className="pr-3">{a.kind}{a.reason ? ` (${a.reason})` : ''}</td>
                  <td className="pr-3">{a.outcome}</td>
                  <td className="pr-3">{a.payoutLamports ? solOf(a.payoutLamports) : '—'}</td>
                  <td>{a.settlementTx ? <TxLink hash={a.settlementTx} className="!text-[11.5px] !text-[#7f9ff2]" /> : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Block>
    </section>
  );
}

/** Builder dev panel: the exact CampaignSpec that POST /api/campaigns will receive. */
export function DevSpec({ spec }: { spec: unknown }) {
  return (
    <section className="flex flex-col gap-3 rounded-3xl bg-[#0f1625] p-4 text-[#e7ecf7]" aria-label="Developer trace">
      <div className="flex items-center gap-3"><DevBadge /><span className="text-sm font-bold">CampaignSpec → POST /api/campaigns</span></div>
      <Json value={spec} />
    </section>
  );
}
