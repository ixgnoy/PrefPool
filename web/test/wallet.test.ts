// Wallet Standard (Phantom / Solflare / Backpack) connect + sign, and the signMessage sign-in.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Wallet } from '@wallet-standard/base';
import { connectWallet, installedWallets, networkProblem, type WalletSource } from '../lib/wallet';
import { signIn } from '../lib/api';

const ADDR = 'GsbwXfJraMomNxBcjYLcG3mxkBUiyWXAB32fGbSMQRdW';
const account = { address: ADDR, publicKey: new Uint8Array(32), chains: ['solana:devnet', 'solana:mainnet'] as const, features: [] as const };

function fakeWallet(name: string, chains: string[], opts: { silentAccounts?: boolean } = {}) {
  const connect = vi.fn(async (input?: { silent?: boolean }) => ({ accounts: input?.silent && opts.silentAccounts === false ? [] : [account] }));
  const signMessage = vi.fn(async (...inputs: { message: Uint8Array }[]) => inputs.map(() => ({ signedMessage: inputs[0]!.message, signature: Uint8Array.from([0xab, 0xcd]) })));
  const signTransaction = vi.fn(async (...inputs: { transaction: Uint8Array; chain?: string }[]) => inputs.map((i) => ({ signedTransaction: Uint8Array.from([...i.transaction, 7]) })));
  const wallet = {
    version: '1.0.0', name, icon: 'data:image/svg+xml;base64,AA==', chains, accounts: [],
    features: { 'standard:connect': { version: '1.0.0', connect }, 'solana:signMessage': { version: '1.0.0', signMessage }, 'solana:signTransaction': { version: '1.0.0', signTransaction } },
  } as unknown as Wallet;
  return { wallet, connect, signMessage, signTransaction };
}
const src = (...ws: Wallet[]): WalletSource => ({ get: () => ws });

afterEach(() => vi.unstubAllGlobals());

describe('wallet standard', () => {
  it('lists only Solana wallets with connect, signMessage and signTransaction', () => {
    const phantom = fakeWallet('Phantom', ['solana:mainnet', 'solana:devnet']).wallet;
    const evmOnly = fakeWallet('MetaMask', ['eip155:1']).wallet;
    const noTx = { ...fakeWallet('Partial', ['solana:devnet']).wallet, features: { 'standard:connect': {} } } as unknown as Wallet;
    expect(installedWallets(src(phantom, evmOnly, noTx))).toEqual([{ id: 'Phantom', name: 'Phantom', icon: 'data:image/svg+xml;base64,AA==' }]);
  });

  it('networkProblem: Devnet is required', () => {
    expect(networkProblem(['solana:mainnet', 'solana:devnet'])).toBeNull();
    expect(networkProblem(['solana:mainnet'])).toMatch(/Devnet/);
  });

  it('refuses a wallet without Devnet before connecting', async () => {
    const f = fakeWallet('MainnetOnly', ['solana:mainnet']);
    await expect(connectWallet('MainnetOnly', {}, src(f.wallet))).rejects.toThrow(/Devnet/);
    expect(f.connect).not.toHaveBeenCalled();
  });

  it('points to Phantom when the wallet is missing', async () => {
    await expect(connectWallet('Solflare', {}, src())).rejects.toThrow(/Phantom/);
  });

  it('connects and wraps signMessage / signTransaction for the account (devnet chain)', async () => {
    const f = fakeWallet('Phantom', ['solana:devnet']);
    const w = await connectWallet('Phantom', {}, src(f.wallet));
    expect(w.address).toBe(ADDR);
    expect(Array.from(await w.signMessage(Uint8Array.from([1])))).toEqual([0xab, 0xcd]);
    expect(Array.from(await w.signTransaction(Uint8Array.from([1, 2])))).toEqual([1, 2, 7]);
    expect(f.signTransaction).toHaveBeenCalledWith(expect.objectContaining({ account, chain: 'solana:devnet' }));
  });

  it('silent reconnect falls back to a prompt when the wallet has no authorized account', async () => {
    const f = fakeWallet('Phantom', ['solana:devnet'], { silentAccounts: false });
    const w = await connectWallet('Phantom', { silent: true }, src(f.wallet));
    expect(w.address).toBe(ADDR);
    expect(f.connect.mock.calls).toEqual([[{ silent: true }], []]);
  });
});

describe('signIn', () => {
  it('signs the server message as UTF-8 and sends the hex signature', async () => {
    const message = `Sign in to PrefPool\n\nWallet: ${ADDR}\nNonce: n1`;
    const bodies: unknown[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify(url.endsWith('/auth/nonce') ? { nonce: 'n1', message } : { sessionToken: 'sess' }), { status: 200 });
    }));
    const signMessage = vi.fn(async () => Uint8Array.from([0, 1, 254, 255]));
    expect(await signIn({ address: ADDR, signMessage })).toBe('sess');
    expect(new TextDecoder().decode((signMessage.mock.calls as unknown as Uint8Array[][])[0]![0]!)).toBe(message);
    expect(bodies).toEqual([{ address: ADDR }, { address: ADDR, signature: '0001feff' }]);
  });
});
