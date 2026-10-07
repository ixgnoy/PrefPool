// Escrow funding and refund by direct wallet signing: */build → wallet signTransaction(base64 wire bytes) → */submit { signedTx }.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fundDirect, refundDirect } from '../lib/fund';
import type { ConnectedWallet } from '../lib/wallet';

const UNSIGNED = Buffer.from([1, 2, 3, 4]).toString('base64');
const SIGNED_BYTES = Uint8Array.from([9, 9, 9]);
const SIG = '5'.repeat(88);

const wallet = () => ({
  name: 'Phantom', address: 'So11111111111111111111111111111111111111112',
  signMessage: vi.fn(async () => new Uint8Array(64)),
  signTransaction: vi.fn(async () => SIGNED_BYTES),
}) satisfies ConnectedWallet;

function stubServer(build: Record<string, unknown>) {
  const calls: { url: string; body: unknown; auth: string | null }[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url: url.replace(/^.*\/api/, ''), body: JSON.parse(String(init.body)), auth: new Headers(init.headers).get('Authorization') });
    return new Response(JSON.stringify(url.endsWith('/build') ? build : { txHash: SIG }), { status: 200 });
  }));
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe('fundDirect', () => {
  it('builds, has the wallet sign the decoded tx bytes and submits the signed tx as base64', async () => {
    const build = { unsignedTx: UNSIGNED, budgetLamports: '200000000', escrowAddress: 'Esc1', lastValidBlockHeight: 99 };
    const calls = stubServer(build);
    const w = wallet();
    const steps: string[] = [];
    const r = await fundDirect({ campaignId: 'c1', sessionToken: 'sess', wallet: w, onStep: (s) => steps.push(s) });
    expect(r).toEqual({ txHash: SIG, escrowAddress: 'Esc1', pending: true });
    expect(calls.map((c) => c.url)).toEqual(['/campaigns/c1/fund/build', '/campaigns/c1/fund/submit']);
    expect(calls[0]!.body).toEqual({});
    expect(calls[1]!.body).toEqual({ signedTx: Buffer.from(SIGNED_BYTES).toString('base64') });
    expect(calls.every((c) => c.auth === 'Bearer sess')).toBe(true);
    expect(Array.from((w.signTransaction.mock.calls as unknown as Uint8Array[][])[0]![0]!)).toEqual([1, 2, 3, 4]);
    expect(steps).toEqual(['build', 'sign', 'pay', 'settled']);
  });

  it('stops before signing when the server cannot build (e.g. no Devnet SOL)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'not enough SOL', code: 'INSUFFICIENT_FUNDS' }), { status: 422 })));
    const w = wallet();
    await expect(fundDirect({ campaignId: 'c1', sessionToken: 's', wallet: w, onStep: () => {} })).rejects.toMatchObject({ status: 422, code: 'INSUFFICIENT_FUNDS' });
    expect(w.signTransaction).not.toHaveBeenCalled();
  });

  it('sends nothing when the wallet declines', async () => {
    const calls = stubServer({ unsignedTx: UNSIGNED, budgetLamports: '1', escrowAddress: 'Esc1', lastValidBlockHeight: 1 });
    const w = { ...wallet(), signTransaction: vi.fn(async () => { throw new Error('User rejected the request.'); }) };
    await expect(fundDirect({ campaignId: 'c1', sessionToken: 's', wallet: w, onStep: () => {} })).rejects.toThrow(/rejected/);
    expect(calls.map((c) => c.url)).toEqual(['/campaigns/c1/fund/build']);
  });
});

describe('refundDirect', () => {
  it('refund/build → sign → refund/submit { signedTx }', async () => {
    const calls = stubServer({ unsignedTx: UNSIGNED });
    const r = await refundDirect({ campaignId: 'c2', sessionToken: 'sess', wallet: wallet() });
    expect(r).toEqual({ txHash: SIG });
    expect(calls.map((c) => c.url)).toEqual(['/campaigns/c2/refund/build', '/campaigns/c2/refund/submit']);
    expect(calls[1]!.body).toEqual({ signedTx: Buffer.from(SIGNED_BYTES).toString('base64') });
  });
});
