// server/test/x402.test.ts — the research report behind the x402 platform fee (3 USDC, Solana devnet, `exact`).
import { describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import request from 'supertest';
import { generateKeyPairSigner } from '@solana/kit';
import { x402Facilitator } from '@x402/core/facilitator';
import { toFacilitatorSvmSigner } from '@x402/svm';
import { ExactSvmScheme } from '@x402/svm/exact/facilitator';
import { addressFromSeed } from '@as/shared';
import { createApp } from '../src/app.js';
import { NETWORK, USDC_MINT, mountReportRoute, usdcBaseUnits } from '../src/x402.js';
import { hashToken } from '../src/tokens.js';
import { makeDeps } from './helpers.js';

/** Our facilitator (src/facilitator.ts) in-process, with a throwaway fee payer. Only /supported is hit: no RPC. */
async function localFacilitator() {
  const feePayer = await generateKeyPairSigner();
  const facilitator = new x402Facilitator();
  facilitator.register(NETWORK, new ExactSvmScheme(toFacilitatorSvmSigner(feePayer, { defaultRpcUrl: 'http://127.0.0.1:9' })));
  const app = express();
  app.use(express.json());
  app.get('/supported', (_req, res) => res.json(facilitator.getSupported()));
  const srv = createServer(app).listen(0);
  await new Promise((r) => srv.once('listening', r));
  return { url: `http://127.0.0.1:${(srv.address() as AddressInfo).port}`, feePayer: feePayer.address as string, close: () => srv.close() };
}

const PAY_TO = addressFromSeed('platform-fee-wallet');

async function setup(state: string, research: object | null, fee = true) {
  const { deps } = await makeDeps();
  if (fee) deps.config.platformFeePayTo = PAY_TO;
  const fac = await localFacilitator();
  const app = createApp(deps, (a) => mountReportRoute(a, deps, { facilitatorUrl: fac.url }));
  const id = 'cc'.repeat(32);
  await deps.db.query(
    `insert into campaigns (id, spec, state, buyer_address, buyer_pkh, access_token_hash, deadline_ms, refund_after_ms, settlement_tx_hash)
     values ($1, $2::jsonb, $3, $4, $4, $5, 0, 0, $6)`,
    [id, JSON.stringify({ questions: [] }), state, addressFromSeed('buyer'), hashToken('t'.repeat(64)), 'd'.repeat(64)]);
  await deps.db.query(`insert into reports (campaign_id, settlement, research, report_hash) values ($1, '{}'::jsonb, $2::jsonb, 'h')`,
    [id, research ? JSON.stringify(research) : null]);
  return { app, id, fac, close: fac.close };
}

describe('x402 report endpoint', () => {
  it('3 USDC is 3_000_000 base units', () => {
    expect(usdcBaseUnits(3)).toBe('3000000');
    expect(usdcBaseUnits(0.5)).toBe('500000');
  });
  it('403 without the campaign access token (no 402 offered)', async () => {
    const s = await setup('SETTLED', { results: {} });
    const res = await request(s.app).get(`/api/campaigns/${s.id}/report`).expect(403);
    expect(res.headers['payment-required']).toBeUndefined();
    s.close();
  });
  it('409 before settlement and for refunded campaigns', async () => {
    const a = await setup('SETTLEMENT_SUBMITTED', { results: {} });
    await request(a.app).get(`/api/campaigns/${a.id}/report`).set('Authorization', `Bearer ${'t'.repeat(64)}`).expect(409);
    a.close();
    const b = await setup('REFUNDED', null);
    const res = await request(b.app).get(`/api/campaigns/${b.id}/report`).set('Authorization', `Bearer ${'t'.repeat(64)}`).expect(409);
    expect(res.body.code).toBe('NO_REPORT');
    b.close();
  });
  it('402 with an exact 3 USDC (devnet) requirement once settled; our facilitator pays the fee', async () => {
    const s = await setup('SETTLED', { results: { q1: { A: 0.4, B: 0.6 } } });
    const res = await request(s.app).get(`/api/campaigns/${s.id}/report`).set('Authorization', `Bearer ${'t'.repeat(64)}`).expect(402);
    const required = JSON.parse(Buffer.from(String(res.headers['payment-required']), 'base64').toString());
    expect(NETWORK).toBe('solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1');
    expect(required.accepts[0]).toMatchObject({
      scheme: 'exact', network: NETWORK, amount: '3000000', asset: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU', payTo: PAY_TO,
      extra: { feePayer: s.fac.feePayer },
    });
    expect(USDC_MINT).toBe('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU');
    s.close();
  });
  it('no fee configured: the access token alone returns the report (still 403 without it)', async () => {
    const s = await setup('SETTLED', { results: { q1: { A: 1 } } }, false);
    await request(s.app).get(`/api/campaigns/${s.id}/report`).expect(403);
    const res = await request(s.app).get(`/api/campaigns/${s.id}/report`).set('Authorization', `Bearer ${'t'.repeat(64)}`).expect(200);
    expect(res.body).toMatchObject({ results: { q1: { A: 1 } }, settlementTx: 'd'.repeat(64) });
    s.close();
  });
});
