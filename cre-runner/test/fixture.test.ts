// cre-runner/test/fixture.test.ts
import { describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { ed25519, x25519 } from '@noble/curves/ed25519.js';
import { bytesToHex, campaignEscrowAddress, openEnvelope, runPipeline, type EscrowAccount } from '@as/shared';
import { FIXTURE_PROGRAM_ID, fixtureHandler, makeFixture } from '../src/fixtureServer.js';

describe('fixture platform', () => {
  it('serves context, pages of 10 envelopes, and accepts reports', async () => {
    const sk = x25519.utils.randomSecretKey();
    const fx = makeFixture({ campaignId: 'cc'.repeat(32), escrowAddress: campaignEscrowAddress(FIXTURE_PROGRAM_ID, 'cc'.repeat(32)),
      deadlineMs: 2_000_000_000_000, envelopePk: bytesToHex(x25519.getPublicKey(sk)), respondents: 23 });
    expect(fx.escrow).toBeNull();
    let posted: unknown;
    const srv = createServer(fixtureHandler(fx, 'tok', (b) => (posted = b))).listen(0);
    const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}/api/cre/campaigns/${fx.campaignId}`;
    const h = { Authorization: 'Bearer tok' };
    expect((await fetch(`${base}/context`)).status).toBe(401);
    const ctx = await (await fetch(`${base}/context`, { headers: h })).json();
    expect(ctx.registered).toHaveLength(23);
    const p3 = await (await fetch(`${base}/envelopes?page=3`, { headers: h })).json();
    expect(p3).toMatchObject({ page: 3, pageSize: 10, total: 23 });
    expect(p3.items).toHaveLength(3);
    expect(JSON.stringify(p3).length).toBeLessThan(25_000);
    expect(openEnvelope(bytesToHex(sk), p3.items[0])).toHaveProperty('q1');
    const ack = await (await fetch(`${base}/reports`, { method: 'POST', headers: h, body: JSON.stringify({ x: 1 }) })).json();
    expect(ack).toEqual({ ack: 'stored' });
    expect(posted).toEqual({ x: 1 });
    srv.close();
  });
});

describe('fixture Solana RPC mock', () => {
  it('serves getAccountInfo for a synthetic escrow that runPipeline accepts', async () => {
    const envSk = x25519.utils.randomSecretKey();
    const repSk = ed25519.utils.randomSecretKey();
    const campaignId = 'dd'.repeat(32);
    const fx = makeFixture({ campaignId, deadlineMs: 2_000_000_000_000, envelopePk: bytesToHex(x25519.getPublicKey(envSk)),
      respondents: 23, reportPk: bytesToHex(ed25519.getPublicKey(repSk)) });
    expect(fx.escrowTxRef).toBe(campaignEscrowAddress(FIXTURE_PROGRAM_ID, campaignId));
    const srv = createServer(fixtureHandler(fx, 'tok', () => {})).listen(0);
    const rpc = `http://127.0.0.1:${(srv.address() as AddressInfo).port}/rpc`;
    const call = async (address: string) => (await (await fetch(rpc, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getAccountInfo', params: [address, { encoding: 'base64', commitment: 'confirmed' }] }) })).json());
    const r = await call(fx.escrowTxRef);
    expect(r.result.value.data[1]).toBe('base64');
    expect((await call(campaignEscrowAddress(FIXTURE_PROGRAM_ID, 'ee'.repeat(32)))).result.value).toBeNull();
    // Same normalization as cre/aggregate parseAccountInfo.
    const v = r.result.value;
    const escrow: EscrowAccount = { address: fx.escrowTxRef, owner: v.owner, lamports: String(v.lamports), data: v.data[0] };
    const ctx = { campaignId, escrowTxRef: fx.escrowTxRef, questions: fx.questions, deadlineMs: fx.deadlineMs, registered: fx.registered };
    const { settlement, research } = runPipeline({ context: ctx, escrow, programId: FIXTURE_PROGRAM_ID, envelopes: fx.envelopes,
      envelopeSecretKey: bytesToHex(envSk), reportSecretKey: bytesToHex(repSk), nowIso: '2033-05-18T03:33:20.000Z' });
    expect(settlement.acceptedCount).toBe(20); // capped at maxResponses
    expect(settlement.rejectionCounts.ineligible).toBe(3);
    expect(settlement.escrowTxRef).toBe(fx.escrowTxRef);
    expect(research?.validRespondents).toBe(20);
    expect(() => runPipeline({ context: ctx, escrow, programId: 'other', envelopes: fx.envelopes,
      envelopeSecretKey: bytesToHex(envSk), reportSecretKey: bytesToHex(repSk), nowIso: '2033-05-18T03:33:20.000Z' })).toThrow(/owned/);
    srv.close();
  });
});
