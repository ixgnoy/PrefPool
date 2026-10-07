// shared/test/address.test.ts
import { describe, expect, it } from 'vitest';
import { addressBytes, addressFromSeed, campaignEscrowAddress, isOnCurve, isSolanaAddress } from '../src/address.js';

const PROGRAM = 'Cm1NmUPngoFke9pc8zXsK2qebBEfPb76bS3gHfjMS2hN';

describe('Solana addresses', () => {
  it('derives the campaign escrow PDA exactly like `solana find-program-derived-address`', () => {
    expect(campaignEscrowAddress(PROGRAM, 'cc'.repeat(32))).toBe('CU78T3P4D3dPqahyzCztjkawahDzwHDJuBu8PwvK9Hu9');
  });
  it('tells wallets (on-curve) from PDAs (off-curve)', () => {
    expect(isOnCurve(addressBytes(addressFromSeed('x')))).toBe(true);
    expect(isOnCurve(addressBytes(campaignEscrowAddress(PROGRAM, 'cc'.repeat(32))))).toBe(false);
  });
  it('validates base58 32-byte addresses', () => {
    expect(isSolanaAddress(PROGRAM)).toBe(true);
    expect(isSolanaAddress('addr_test1vqpsxqcrqvpsxqcrqvpsxqcrqvpsxqcrqvpsxqcrqvpsxqc7thun8')).toBe(false);
    expect(isSolanaAddress('1111')).toBe(false);
  });
});
