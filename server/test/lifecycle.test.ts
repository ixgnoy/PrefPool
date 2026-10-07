// server/test/lifecycle.test.ts — funding reconcile by the escrow account and the fund tx's status, and settle retries.
import { describe, expect, it } from 'vitest';
import { addressFromSeed, campaignEscrowAddress } from '@as/shared';
import { getCampaign, datumFor } from '../src/campaigns.js';
import { tick } from '../src/lifecycle.js';
import { demoSpec, escrowFor, makeDeps } from './helpers.js';

const SIG = '5'.repeat(88);
const BUYER = addressFromSeed('lifecycle-buyer');

async function pending() {
  const env = await makeDeps();
  const { deps, clock } = env;
  const id = 'cd'.repeat(32);
  const deadline = clock.now + 3_600_000;
  await deps.db.query(
    `insert into campaigns (id, spec, state, buyer_address, buyer_pkh, access_token_hash, deadline_ms, refund_after_ms, fund_tx_hash, pending_fund_tx)
     values ($1, $2::jsonb, 'FUNDING_SUBMITTED', $3, $3, 'h', $4, $5, $6, 'blockhash')`,
    [id, JSON.stringify(demoSpec(deadline)), BUYER, deadline, deadline + 86_400_000, SIG]);
  return { ...env, id };
}

describe('lifecycle: funding reconcile', () => {
  it('pending funding becomes FUNDED when the escrow account appears, with the PDA as escrow ref', async () => {
    const s = await pending();
    s.chainState.escrow = escrowFor(datumFor(await getCampaign(s.deps, s.id), s.deps.config.reportPublicKey));
    await tick(s.deps);
    expect(await getCampaign(s.deps, s.id)).toMatchObject({ state: 'FUNDED', escrow_tx_ref: campaignEscrowAddress(s.deps.chain.programId, s.id), pending_fund_tx: null });
  });
  it('stays pending while the tx may still land', async () => {
    const s = await pending();
    await tick(s.deps);
    expect((await getCampaign(s.deps, s.id)).state).toBe('FUNDING_SUBMITTED');
  });
  it('an expired blockhash without the escrow means FUNDING_FAILED (the buyer may fund again)', async () => {
    const s = await pending();
    s.chainState.txStatus = 'expired';
    await tick(s.deps);
    expect(await getCampaign(s.deps, s.id)).toMatchObject({ state: 'FUNDING_FAILED', last_error: 'funding tx expired without landing' });
  });
  it('a landed tx whose escrow is not visible yet keeps waiting', async () => {
    const s = await pending();
    s.chainState.txStatus = 'landed';
    await tick(s.deps);
    expect((await getCampaign(s.deps, s.id)).state).toBe('FUNDING_SUBMITTED');
  });
  it('an escrow with other terms (budget) goes to FUNDING_FAILED', async () => {
    const s = await pending();
    const d = datumFor(await getCampaign(s.deps, s.id), s.deps.config.reportPublicKey);
    s.chainState.escrow = escrowFor({ ...d, budgetLamports: d.budgetLamports + 1n });
    await tick(s.deps);
    expect((await getCampaign(s.deps, s.id)).state).toBe('FUNDING_FAILED');
  });
  it('an escrow account with garbage data goes to FUNDING_FAILED', async () => {
    const s = await pending();
    s.chainState.escrow = { ...escrowFor(datumFor(await getCampaign(s.deps, s.id), s.deps.config.reportPublicKey)), data: 'AAAA' };
    await tick(s.deps);
    expect((await getCampaign(s.deps, s.id)).state).toBe('FUNDING_FAILED');
  });
});

describe('lifecycle: settle retry', () => {
  it('a settle tx that never closed the escrow is retried after 3 minutes', async () => {
    const s = await pending();
    const escrow = campaignEscrowAddress(s.deps.chain.programId, s.id);
    await s.deps.db.query(`update campaigns set state = 'SETTLEMENT_SUBMITTED', escrow_tx_ref = $2, settlement_tx_hash = 'x' where id = $1`, [s.id, escrow]);
    s.clock.now = Date.now();
    await tick(s.deps);
    expect((await getCampaign(s.deps, s.id)).state).toBe('SETTLEMENT_SUBMITTED');
    await s.deps.db.query(`update campaigns set updated_at = now() - interval '4 minutes' where id = $1`, [s.id]);
    await tick(s.deps);
    expect(await getCampaign(s.deps, s.id)).toMatchObject({ state: 'SETTLEMENT_FAILED', last_error: 'settle tx did not land; retrying' });
  });
});
