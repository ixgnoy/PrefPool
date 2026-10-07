// server/src/app.ts
import express, { type NextFunction, type Request, type Response } from 'express';
import { FundingError } from '@as/chain';
import { PERSONHOOD_ACTION } from '@as/shared';
import { ZodError } from 'zod';
import { agentRoutes } from './agentApi.js';
import { authRoutes } from './auth.js';
import { campaignRoutes } from './campaigns.js';
import { creRoutes } from './creApi.js';
import { HttpError, type Deps } from './deps.js';
import { ownerRoutes } from './ownerApi.js';
import { personhoodRoutes } from './personhood.js';
import { calibrationRoutes } from './calibration.js';
import { approvalRoutes } from './approvals.js';

/** Express 5 forwards rejected async handlers to the error middleware (Express 4 does not). */
export function createApp(deps: Deps, extra: (app: express.Express) => void = () => {}) {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  // Railway healthcheck (root railway.json), shared with the facilitator service.
  app.get('/healthz', (_req, res) => res.json({ ok: true, service: 'server' }));
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', process.env.WEB_ORIGIN ?? '*');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, PAYMENT-SIGNATURE, X-PAYMENT');
    res.setHeader('Access-Control-Expose-Headers', 'PAYMENT-REQUIRED, PAYMENT-RESPONSE, X-PAYMENT-RESPONSE');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
    if (req.method === 'OPTIONS') return res.status(204).end();
    next();
  });
  const api = express.Router();
  api.get('/config/public', (_req, res) => res.json({
    cluster: deps.config.cluster ?? 'devnet', rpcUrl: deps.config.rpcUrl ?? 'https://api.devnet.solana.com', programId: deps.chain.programId,
    envelopePublicKey: deps.config.envelopePublicKey, rewardLamports: '1500000', platformFeeUsdc: deps.config.platformFeePayTo ? deps.config.platformFeeUsdc : 0, // 0 = reports free with the access token
    // dev view strip (FRONTEND_PRD §5.10): public identifiers only
    relayerAddress: deps.chain.relayerAddress, reportPublicKey: deps.config.reportPublicKey,
    platformFeePayTo: deps.config.platformFeePayTo ?? null,
    personhood: deps.config.personhood
      ? { appId: deps.config.personhood.appId, environment: deps.config.personhood.environment, action: PERSONHOOD_ACTION } : null,
  }));
  api.use(authRoutes(deps));
  api.use(ownerRoutes(deps));
  api.use(campaignRoutes(deps));
  api.use(agentRoutes(deps));
  api.use(personhoodRoutes(deps));
  api.use(calibrationRoutes(deps));
  api.use(approvalRoutes(deps));
  api.use(creRoutes(deps));
  extra(app);
  app.use('/api', api);
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, code: err.code });
    // Wallet-side funding problems (wrong cluster, too little SOL) are the user's to fix: show the builder's message (Task 4.5).
    if (err instanceof FundingError) return res.status(422).json({ error: err.message, code: err.code });
    if (err instanceof ZodError) return res.status(400).json({ error: err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '), code: 'VALIDATION' });
    console.error(err);
    res.status(500).json({ error: 'internal error', code: 'INTERNAL' });
  });
  return app;
}
