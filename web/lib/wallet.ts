// web/lib/wallet.ts — Solana wallets through the Wallet Standard (Phantom, Solflare, Backpack all register here).
// Kept tiny on purpose: no adapter UI packages, just getWallets() and the three features we use.
import { getWallets } from '@wallet-standard/app';
import type { Wallet, WalletAccount } from '@wallet-standard/base';

export const SOLANA_DEVNET = 'solana:devnet';
const CONNECT = 'standard:connect', SIGN_MESSAGE = 'solana:signMessage', SIGN_TX = 'solana:signTransaction';

type ConnectFeature = { connect(input?: { silent?: boolean }): Promise<{ accounts: readonly WalletAccount[] }> };
type SignMessageFeature = { signMessage(...inputs: { account: WalletAccount; message: Uint8Array }[]): Promise<{ signature: Uint8Array }[]> };
type SignTxFeature = { signTransaction(...inputs: { account: WalletAccount; transaction: Uint8Array; chain?: string }[]): Promise<{ signedTransaction: Uint8Array }[]> };

/** What getWallets() returns, narrowed to what we read (tests pass a fake). */
export type WalletSource = { get(): readonly Wallet[]; on?(event: 'register' | 'unregister', listener: () => void): () => void };
const source = (): WalletSource => getWallets();

export interface WalletInfo { id: string; name: string; icon: string }

/** A wallet we can use: Solana chains plus connect, signMessage and signTransaction. */
export const isSolanaWallet = (w: Wallet) =>
  w.chains.some((c) => c.startsWith('solana:')) && CONNECT in w.features && SIGN_MESSAGE in w.features && SIGN_TX in w.features;

/** Installed Solana wallets; `id` is the wallet name (unique per Wallet Standard registry in practice). */
export function installedWallets(src: WalletSource = source()): WalletInfo[] {
  return src.get().filter(isSolanaWallet).map((w) => ({ id: w.name, name: w.name, icon: w.icon }));
}

/**
 * Devnet check. The Wallet Standard doesn't expose which cluster the wallet UI is set to, only the chains it supports,
 * so this catches wallets without Devnet; the server's fund builder catches the rest (no Devnet SOL at this address).
 */
export function networkProblem(chains: readonly string[]): string | null {
  return chains.includes(SOLANA_DEVNET) ? null : 'Your wallet does not offer Solana Devnet; switch it to Devnet.';
}

export interface ConnectedWallet {
  name: string;
  /** base58 Solana address */
  address: string;
  signMessage(message: Uint8Array): Promise<Uint8Array>;
  /** Wire bytes in (legacy tx), signed wire bytes out. */
  signTransaction(tx: Uint8Array): Promise<Uint8Array>;
}

/** Connects (silently first when asked, e.g. after a reload) and wraps the account's signing features. */
export async function connectWallet(id: string, opts: { silent?: boolean } = {}, src: WalletSource = source()): Promise<ConnectedWallet> {
  const wallet = src.get().find((w) => w.name === id && isSolanaWallet(w));
  if (!wallet) throw new Error(`${id} not found. Install Phantom (or Solflare / Backpack), then reload.`);
  // Checked before any address read or signature.
  const problem = networkProblem(wallet.chains);
  if (problem) throw new Error(problem);
  const connect = wallet.features[CONNECT] as ConnectFeature;
  let { accounts } = await (opts.silent ? connect.connect({ silent: true }) : connect.connect());
  if (!accounts.length && opts.silent) ({ accounts } = await connect.connect());
  const account = accounts.find((a) => a.chains.some((c) => c.startsWith('solana:'))) ?? accounts[0];
  if (!account) throw new Error('The wallet shared no Solana account.');
  return {
    name: wallet.name,
    address: account.address,
    signMessage: async (message) => {
      const [out] = await (wallet.features[SIGN_MESSAGE] as SignMessageFeature).signMessage({ account, message });
      if (!out) throw new Error('The wallet returned no signature.');
      return out.signature;
    },
    signTransaction: async (transaction) => {
      const [out] = await (wallet.features[SIGN_TX] as SignTxFeature).signTransaction({ account, transaction, chain: SOLANA_DEVNET });
      if (!out) throw new Error('The wallet returned no signed transaction.');
      return out.signedTransaction;
    },
  };
}

/** Re-renders when wallets register late (extensions inject after load). Returns the unsubscribe function. */
export function onWalletsChanged(listener: () => void, src: WalletSource = source()): () => void {
  const offs = [src.on?.('register', listener), src.on?.('unregister', listener)];
  return () => offs.forEach((off) => off?.());
}
