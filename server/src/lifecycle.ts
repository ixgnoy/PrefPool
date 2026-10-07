// server/src/lifecycle.ts
import { decodeCampaignAccount, type CampaignDatumFields, type SettlementReport } from '@as/shared';
import { datumFor, setState } from './campaigns.js';
import { calibrationTick } from './calibration.js';
import { enqueueCreJob } from './creApi.js';
import type { Deps } from './deps.js';
import { agentView, type CampaignRow } from './views.js';

const SETTLE_DELAY_MS = 60_000; // the program's settle window opens at the deadline (cluster clock); keep a margin
const FUNDING_TIMEOUT_MS = 15 * 60_000;
const RETRY_FAILED_CRE_MS = 2 * 60_000;
const SETTLE_RETRY_MS = 3 * 60_000; // a blockhash is valid ~60-90 s; past this a settle tx that hasn't closed the escrow never will

/** Time since the campaign row last changed (its state was set). */
async function ageMs(deps: Deps, id: string, now: number) {
  const [{ age }] = await deps.db.query<{ age: string | number }>(
    `select extract(epoch from (to_timestamp($2 / 1000.0) - updated_at)) * 1000 as age from campaigns where id = $1`, [id, now]);
  return Number(age);
}

const sameDatum = (a: CampaignDatumFields, b: CampaignDatumFields) =>
  (Object.keys(b) as (keyof CampaignDatumFields)[]).every((k) => String(a[k]) === String(b[k]));

/** One pass of the state machine (README C1 states). Called every few seconds; every step is idempotent. */
export async function tick(deps: Deps): Promise<void> {
  const now = deps.now();
  const rows = await deps.db.query<CampaignRow>(
    `select * from campaigns where state in ('FUNDING_SUBMITTED','FUNDED','ACTIVE','AGGREGATING','SETTLEMENT_READY',
      'INSUFFICIENT_COHORT','SETTLEMENT_FAILED','SETTLEMENT_SUBMITTED')`);
  for (const c of rows) {
    try {
      await step(deps, c, now);
    } catch (e) {
      await deps.db.query(`update campaigns set last_error = $2, updated_at = now() where id = $1`, [c.id, String(e).slice(0, 500)]);
    }
  }
  await calibrationTick(deps).catch((e) => console.error('calibration tick', e));
}

async function step(deps: Deps, c: CampaignRow, now: number) {
  switch (c.state) {
    case 'FUNDING_SUBMITTED': {
      const escrow = await deps.chain.fetchEscrow(c.id);
      if (!escrow) {
        // Not there yet: failed on chain, or its blockhash expired without it landing → the buyer may fund again.
        const status = c.pending_fund_tx ? await deps.chain.txStatus(c.fund_tx_hash!, c.pending_fund_tx) : 'pending';
        if (status === 'failed') return setState(deps, c.id, 'FUNDING_FAILED', { last_error: 'funding tx failed on chain' });
        if (status === 'expired') return setState(deps, c.id, 'FUNDING_FAILED', { last_error: 'funding tx expired without landing' });
        if (await ageMs(deps, c.id, now) > FUNDING_TIMEOUT_MS) await setState(deps, c.id, 'FUNDING_FAILED', { last_error: 'funding tx not seen on chain' });
        return;
      }
      // The PDA is per campaign: whatever sits there must be this campaign's exact terms, owned by our program.
      let datum: CampaignDatumFields | null = null;
      try { datum = decodeCampaignAccount(escrow.data); } catch { /* not a Campaign account */ }
      const expected = datumFor(c, deps.config.reportPublicKey);
      if (escrow.owner !== deps.chain.programId || !datum || !sameDatum(datum, expected) || BigInt(escrow.lamports) < expected.budgetLamports) {
        return setState(deps, c.id, 'FUNDING_FAILED', { last_error: 'escrow account does not match the campaign' });
      }
      return setState(deps, c.id, 'FUNDED', { escrow_tx_ref: escrow.address, pending_fund_tx: null });
    }
    case 'FUNDED':
      if (now >= Number(c.deadline_ms)) return setState(deps, c.id, 'AGGREGATING');
      await setState(deps, c.id, 'ACTIVE');
      deps.relay.broadcast(agentView(c, deps.config.envelopePublicKey));
      return;
    case 'ACTIVE':
      if (now > Number(c.deadline_ms)) {
        await setState(deps, c.id, 'AGGREGATING');
        await enqueueCreJob(deps, c.id);
      }
      return;
    case 'AGGREGATING':
      await enqueueCreJob(deps, c.id);
      await deps.db.query(
        `update cre_jobs set status = 'queued' where campaign_id = $1 and status = 'failed' and finished_at < to_timestamp($2 / 1000.0)`,
        [c.id, now - RETRY_FAILED_CRE_MS]);
      return;
    case 'SETTLEMENT_READY':
    case 'INSUFFICIENT_COHORT':
    case 'SETTLEMENT_FAILED': {
      if (now < Number(c.deadline_ms) + SETTLE_DELAY_MS) return;
      const [r] = await deps.db.query<{ settlement: SettlementReport }>(`select settlement from reports where campaign_id = $1`, [c.id]);
      if (!r) return;
      const out = await deps.chain.settle(r.settlement);
      if (out.status === 'rejected') return setState(deps, c.id, 'SETTLEMENT_FAILED', { last_error: out.errors.join('; ') });
      if (out.status === 'already-spent') {
        return setState(deps, c.id, r.settlement.acceptedCount === 0 ? 'REFUNDED' : 'SETTLED', { settlement_tx_hash: out.txHash });
      }
      return setState(deps, c.id, 'SETTLEMENT_SUBMITTED', { settlement_tx_hash: out.txHash, last_error: null });
    }
    case 'SETTLEMENT_SUBMITTED': {
      const spentBy = await deps.chain.closedBy(c.escrow_tx_ref!);
      if (!spentBy) {
        // A settle tx that never landed (dropped, blockhash expired) leaves the escrow open: settle again. A second
        // settle can't double-pay: the first one to land closes the escrow and the other fails.
        if (await ageMs(deps, c.id, now) > SETTLE_RETRY_MS) await setState(deps, c.id, 'SETTLEMENT_FAILED', { last_error: 'settle tx did not land; retrying' });
        return;
      }
      const [r] = await deps.db.query<{ settlement: SettlementReport }>(`select settlement from reports where campaign_id = $1`, [c.id]);
      return setState(deps, c.id, r?.settlement.acceptedCount === 0 ? 'REFUNDED' : 'SETTLED', { settlement_tx_hash: spentBy });
    }
  }
}
