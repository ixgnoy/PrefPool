// web/lib/fund.ts — fund (and refund) a campaign escrow: server builds the unsigned tx → wallet signs → server checks + broadcasts.
import { base64 } from '@scure/base';
import { api } from './api';
import type { ConnectedWallet } from './wallet';

export type FundStep = 'build' | 'sign' | 'pay' | 'settled';
export interface FundBuild { unsignedTx: string; budgetLamports: string; escrowAddress: string; lastValidBlockHeight: number }

/** Base64 wire tx → wallet signTransaction → base64 signed tx. */
export async function signTxBase64(wallet: ConnectedWallet, unsignedTx: string): Promise<string> {
  return base64.encode(await wallet.signTransaction(base64.decode(unsignedTx)));
}

/** fund/build → signTransaction → fund/submit. The campaign turns FUNDED once the server sees the escrow account. */
export async function fundDirect(opts: {
  campaignId: string; sessionToken: string; wallet: ConnectedWallet; onStep: (s: FundStep, build?: FundBuild) => void;
}): Promise<{ txHash: string; escrowAddress: string; pending: boolean }> {
  const { campaignId, sessionToken, wallet, onStep } = opts;
  onStep('build');
  const build = await api<FundBuild>(`/campaigns/${campaignId}/fund/build`, { method: 'POST', token: sessionToken, body: '{}' });
  onStep('sign', build);
  const signedTx = await signTxBase64(wallet, build.unsignedTx);
  onStep('pay', build);
  const { txHash } = await api<{ txHash: string }>(`/campaigns/${campaignId}/fund/submit`,
    { method: 'POST', token: sessionToken, body: JSON.stringify({ signedTx }) });
  onStep('settled', build);
  return { txHash, escrowAddress: build.escrowAddress, pending: true };
}

/** Company escape hatch after refund_after: refund/build → signTransaction → refund/submit. */
export async function refundDirect(opts: { campaignId: string; sessionToken: string; wallet: ConnectedWallet }): Promise<{ txHash: string }> {
  const { campaignId, sessionToken, wallet } = opts;
  const { unsignedTx } = await api<{ unsignedTx: string }>(`/campaigns/${campaignId}/refund/build`, { method: 'POST', token: sessionToken, body: '{}' });
  const signedTx = await signTxBase64(wallet, unsignedTx);
  return api<{ txHash: string }>(`/campaigns/${campaignId}/refund/submit`, { method: 'POST', token: sessionToken, body: JSON.stringify({ signedTx }) });
}
