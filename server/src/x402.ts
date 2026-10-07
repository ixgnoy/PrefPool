// server/src/x402.ts
import type { Express, NextFunction, Request, Response } from 'express';
import { paymentMiddleware, x402ResourceServer } from '@x402/express';
import { HTTPFacilitatorClient } from '@x402/core/server';
import { SOLANA_DEVNET_CAIP2, USDC_DEVNET_ADDRESS } from '@x402/svm';
import { ExactSvmScheme } from '@x402/svm/exact/server';
import { getCampaign } from './campaigns.js';
import { HttpError, type Deps } from './deps.js';
import { hashToken } from './tokens.js';

export const NETWORK = SOLANA_DEVNET_CAIP2;
export const USDC_MINT = USDC_DEVNET_ADDRESS;
/** USDC has 6 decimals: 3 USDC = 3_000_000 base units. */
export const usdcBaseUnits = (usdc: number) => String(Math.round(usdc * 1_000_000));

/** Client for our self-hosted facilitator; sends FACILITATOR_TOKEN on every call when one is configured. */
export const facilitatorClient = (url: string, token?: string, timeoutMs?: number) => new HTTPFacilitatorClient({
  url, timeoutMs,
  createAuthHeaders: token ? async () => {
    const h = { Authorization: `Bearer ${token}` };
    return { verify: h, settle: h, supported: h };
  } : undefined,
});
const ROUTE = '/api/campaigns/:id/report';

/** Access-token and SETTLED checks, run BEFORE payment so nobody is asked to pay for a report they cannot have. */
function reportGate(deps: Deps) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      if (req.method !== 'GET') return next();
      const c = await getCampaign(deps, String(req.params.id));
      const token = /^Bearer (\S+)$/.exec(req.header('authorization') ?? '')?.[1];
      if (!token || hashToken(token) !== c.access_token_hash) throw new HttpError(403, 'ACCESS_TOKEN', 'campaign access token required');
      if (c.state === 'REFUNDED') throw new HttpError(409, 'NO_REPORT', 'cohort too small: no research report, budget refunded');
      if (c.state !== 'SETTLED') throw new HttpError(409, 'NOT_SETTLED', `report available after settlement (now ${c.state})`);
      next();
    } catch (e) {
      next(e);
    }
  };
}

/**
 * GET /api/campaigns/:id/report — the research report for PLATFORM_FEE_USDC paid over x402 (Solana devnet, `exact`
 * scheme, USDC to PLATFORM_FEE_PAY_TO; our facilitator pays the tx fee). If the handler fails (status >= 400) x402
 * cancels settlement. Without a pay-to wallet or facilitator the route answers 503.
 */
export function mountReportRoute(app: Express, deps: Deps, opts: { facilitatorUrl?: string; facilitatorToken?: string; rpcUrl?: string }) {
  const payTo = deps.config.platformFeePayTo;
  if (!payTo || !opts.facilitatorUrl) {
    app.get(ROUTE, (_req, res) => {
      res.status(503).json({ code: 'X402_UNCONFIGURED', error: 'the x402 report fee is not configured on this server (PLATFORM_FEE_PAY_TO, FACILITATOR_URL)' });
    });
    return;
  }
  app.use(ROUTE, reportGate(deps));

  const resourceServer = new x402ResourceServer(facilitatorClient(opts.facilitatorUrl, opts.facilitatorToken));
  // rpcUrl: embed a recent blockhash in the 402 so the payer skips a round-trip (best effort, ignored on RPC errors).
  resourceServer.register(NETWORK, new ExactSvmScheme({ rpcUrl: opts.rpcUrl }));
  app.use(paymentMiddleware({
    [`GET ${ROUTE}`]: {
      accepts: [{ scheme: 'exact', network: NETWORK, price: { amount: usdcBaseUnits(deps.config.platformFeeUsdc), asset: USDC_MINT }, payTo }],
      description: 'Aggregated research report for one settled campaign',
      mimeType: 'application/json',
    },
  }, resourceServer));

  app.get(ROUTE, async (req, res) => {
    const c = await getCampaign(deps, String(req.params.id));
    const [r] = await deps.db.query<{ research: unknown }>(`select research from reports where campaign_id = $1`, [c.id]);
    if (!r?.research) throw new HttpError(409, 'NO_REPORT', 'no research report');
    res.json({ ...(r.research as object), settlementTx: c.settlement_tx_hash });
  });
}
