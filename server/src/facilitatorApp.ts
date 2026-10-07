// server/src/facilitatorApp.ts — HTTP surface of the self-hosted x402 facilitator (WS7 Task 7.4).
// With a token, every route needs `Authorization: Bearer <token>`: the facilitator's fee payer holds a little SOL, and an open one lets
// anyone verify and settle payments with our fee payer's SOL (review issue 4). No token: open, for local development.
import { createHash, timingSafeEqual } from 'node:crypto';
import express from 'express';
import type { x402Facilitator } from '@x402/core/facilitator';
import { z } from 'zod';

const digest = (s: string) => createHash('sha256').update(s).digest();

export function createFacilitatorApp(facilitator: Pick<x402Facilitator, 'getSupported' | 'verify' | 'settle'>, token?: string) {
  const body = z.object({ paymentPayload: z.any(), paymentRequirements: z.any() });
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  // Railway healthcheck: before the token check, and it reveals nothing.
  app.get('/healthz', (_req, res) => res.json({ ok: true, service: 'facilitator' }));
  if (token) {
    const want = digest(`Bearer ${token}`);
    app.use((req, res, next) => {
      if (timingSafeEqual(digest(req.header('authorization') ?? ''), want)) return next();
      res.status(401).json({ error: 'facilitator token required' });
    });
  }
  app.get('/supported', (_req, res) => res.json(facilitator.getSupported()));
  app.post('/verify', async (req, res) => {
    const { paymentPayload, paymentRequirements } = body.parse(req.body);
    res.json(await facilitator.verify(paymentPayload, paymentRequirements));
  });
  app.post('/settle', async (req, res) => {
    const { paymentPayload, paymentRequirements } = body.parse(req.body);
    const result = await facilitator.settle(paymentPayload, paymentRequirements);
    if (!result.success) console.error('settle failed', result.errorReason, result.errorMessage ?? '');
    res.json(result);
  });
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error('facilitator', err);
    res.status(err instanceof z.ZodError ? 400 : 500).json({ error: String(err) });
  });
  return app;
}
