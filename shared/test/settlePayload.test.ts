// shared/test/settlePayload.test.ts
import { describe, expect, it } from 'vitest';
import { ed25519 } from '@noble/curves/ed25519.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { addressFromSeed, campaignEscrowAddress } from '../src/address.js';
import { settleAddressOk, settleDigestHex, signSettlePayload, verifySettlePayload } from '../src/settlePayload.js';

const escrow = campaignEscrowAddress('Cm1NmUPngoFke9pc8zXsK2qebBEfPb76bS3gHfjMS2hN', 'cc'.repeat(32));
const report = {
  campaignId: 'cc'.repeat(32), escrowTxRef: escrow, reportHash: '11'.repeat(32),
  payouts: [{ address: addressFromSeed('a') }, { address: addressFromSeed('b') }],
};

describe('settle digest', () => {
  it('matches settle_digest in the Rust program (same vector in tests/escrow.rs)', () => {
    expect(settleDigestHex(report)).toBe('8d7dc0edf50925cc9c26a37f7ad6cfc4a5863b7a2a39529d57b3e723a3e7fbc8');
  });
  it('binds order and membership of the payee list', () => {
    const swapped = { ...report, payouts: [...report.payouts].reverse() };
    expect(settleDigestHex(swapped)).not.toBe(settleDigestHex(report));
    expect(settleDigestHex({ ...report, payouts: report.payouts.slice(1) })).not.toBe(settleDigestHex(report));
  });
  it('signs and verifies with the report key', () => {
    const sk = ed25519.utils.randomSecretKey();
    const pk = bytesToHex(ed25519.getPublicKey(sk));
    const sig = signSettlePayload(report, bytesToHex(sk));
    expect(verifySettlePayload(report, sig, pk)).toBe(true);
    expect(verifySettlePayload({ ...report, reportHash: '22'.repeat(32) }, sig, pk)).toBe(false);
  });
  it('only pays wallet addresses, never PDAs', () => {
    expect(settleAddressOk(addressFromSeed('a'))).toBe(true);
    expect(settleAddressOk(escrow)).toBe(false);
    expect(settleAddressOk('not-an-address')).toBe(false);
  });
});
