// server/test/health.test.ts — Railway healthcheck path shared by both services (Task 8.14).
import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createFacilitatorApp } from '../src/facilitatorApp.js';
import { makeDeps } from './helpers.js';

const stub = { getSupported: () => ({ kinds: [] }), verify: async () => ({}), settle: async () => ({}) };

describe('GET /healthz', () => {
  it('answers on the API server without auth', async () => {
    const { app } = await makeDeps();
    const res = await request(app).get('/healthz').expect(200);
    expect(res.body).toEqual({ ok: true, service: 'server' });
  });
  it('answers on the facilitator even when a token is required', async () => {
    const app = createFacilitatorApp(stub as never, 'secret-token');
    const res = await request(app).get('/healthz').expect(200);
    expect(res.body).toEqual({ ok: true, service: 'facilitator' });
    await request(app).get('/supported').expect(401);
  });
});
