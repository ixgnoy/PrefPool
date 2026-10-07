// plugins/mcp/src/x402.ts: x402 buyer for the report fee (USDC on Solana devnet, `exact` svm scheme), capped per payment.
import { createKeyPairSignerFromBytes } from '@solana/kit';
import { wrapFetchWithPayment, x402Client } from '@x402/fetch';
import { SOLANA_DEVNET_CAIP2 } from '@x402/svm';
import { ExactSvmScheme } from '@x402/svm/exact/client';

/**
 * Only devnet is registered, and spend controls keep the default-asset allowlist (devnet USDC) with a per-payment USD cap
 * of `maxUsdc` (the x402 default cap is $1, below the $3 platform fee, so the cap must be set explicitly).
 */
export async function reportPayingFetch(secretKey: Uint8Array, opts: { maxUsdc: number; rpcUrl?: string; fetchFn?: typeof fetch }): Promise<typeof fetch | undefined> {
  if (!(opts.maxUsdc > 0)) return undefined;
  const signer = await createKeyPairSignerFromBytes(secretKey);
  const client = new x402Client().setSpendControls({ maxAmountPerPayment: `$${opts.maxUsdc}` });
  client.register(SOLANA_DEVNET_CAIP2, new ExactSvmScheme(signer, opts.rpcUrl ? { rpcUrl: opts.rpcUrl } : undefined));
  return wrapFetchWithPayment(opts.fetchFn ?? fetch, client);
}
