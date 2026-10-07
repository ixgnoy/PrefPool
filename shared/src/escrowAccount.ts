// shared/src/escrowAccount.ts: the on-chain Campaign account of solana/programs/campaign_escrow (Anchor layout).
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { base64 } from '@scure/base';
import { addressBytes, addressFromBytes } from './address';
import type { CampaignDatumFields } from './types';

/** Anchor discriminator: first 8 bytes of sha256("<namespace>:<Name>"). */
export const anchorDiscriminator = (namespace: 'account' | 'global' | 'event', name: string) =>
  sha256(new TextEncoder().encode(`${namespace}:${name}`)).slice(0, 8);

const CAMPAIGN_DISC = anchorDiscriminator('account', 'Campaign');
export const CAMPAIGN_ACCOUNT_SIZE = 8 + 32 + 32 + 32 + 8 + 8 + 2 + 2 + 8 + 8 + 1;

/** Decode the escrow account data (raw bytes or base64 as RPC getAccountInfo returns it). */
export function decodeCampaignAccount(data: Uint8Array | string): CampaignDatumFields {
  const b = typeof data === 'string' ? base64.decode(data) : data;
  if (b.length < CAMPAIGN_ACCOUNT_SIZE) throw new Error('not a Campaign account (too short)');
  if (!CAMPAIGN_DISC.every((x, i) => b[i] === x)) throw new Error('not a Campaign account (discriminator)');
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let o = 8;
  const bytes = (n: number) => { const s = b.slice(o, o + n); o += n; return s; };
  const u64 = () => { const x = v.getBigUint64(o, true); o += 8; return x; };
  const i64 = () => { const x = v.getBigInt64(o, true); o += 8; return Number(x); };
  const u16 = () => { const x = v.getUint16(o, true); o += 2; return x; };
  return {
    campaignId: bytesToHex(bytes(32)),
    company: addressFromBytes(bytes(32)),
    reportPk: bytesToHex(bytes(32)),
    rewardLamports: u64(),
    budgetLamports: u64(),
    maxResponses: u16(),
    minCohort: u16(),
    deadlineMs: i64(),
    refundAfterMs: i64(),
  };
}

/** The escrow account as the platform and CRE read it from RPC (getAccountInfo, base64 encoding). */
export interface EscrowAccount {
  address: string;
  owner: string;
  lamports: string;
  data: string; // base64
}

/** Inverse of decodeCampaignAccount (fixtures and tests; on-chain the program writes this). */
export function encodeCampaignAccount(d: CampaignDatumFields, bump = 255): Uint8Array {
  const b = new Uint8Array(CAMPAIGN_ACCOUNT_SIZE);
  const v = new DataView(b.buffer);
  b.set(CAMPAIGN_DISC, 0);
  let o = 8;
  const put = (x: Uint8Array) => { b.set(x, o); o += x.length; };
  put(hexToBytes(d.campaignId));
  put(addressBytes(d.company));
  put(hexToBytes(d.reportPk));
  v.setBigUint64(o, d.rewardLamports, true); o += 8;
  v.setBigUint64(o, d.budgetLamports, true); o += 8;
  v.setUint16(o, d.maxResponses, true); o += 2;
  v.setUint16(o, d.minCohort, true); o += 2;
  v.setBigInt64(o, BigInt(d.deadlineMs), true); o += 8;
  v.setBigInt64(o, BigInt(d.refundAfterMs), true); o += 8;
  b[o] = bump;
  return b;
}
