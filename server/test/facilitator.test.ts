// server/test/facilitator.test.ts — the self-hosted facilitator only serves callers holding FACILITATOR_TOKEN (review issue 4).
import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createFacilitatorApp } from '../src/facilitatorApp.js';
import { facilitatorClient } from '../src/x402.js';

const stub = {
  getSupported: () => ({ kinds: [{ x402Version: 2, scheme: 'exact', network: 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1' }], extensions: [], signers: {} }),
  verify: async () => ({ isValid: true }),
  settle: async () => ({ success: true, transaction: 'tx', network: 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1' }),
};
const body = { paymentPayload: {}, paymentRequirements: {} };

describe('self-hosted facilitator auth', () => {
  it('refuses /supported, /verify and /settle without the token', async () => {
    const app = createFacilitatorApp(stub as never, 'secret-token');
    await request(app).get('/supported').expect(401);
    await request(app).post('/verify').send(body).expect(401);
    await request(app).post('/settle').set('Authorization', 'Bearer wrong').send(body).expect(401);
  });
  it('serves callers with the token, and the server client sends it', async () => {
    const app = createFacilitatorApp(stub as never, 'secret-token');
    await request(app).post('/settle').set('Authorization', 'Bearer secret-token').send(body).expect(200);
    const server = app.listen(0);
    try {
      const port = (server.address() as { port: number }).port;
      const supported = await facilitatorClient(`http://127.0.0.1:${port}`, 'secret-token').getSupported();
      expect(supported.kinds[0]!.network).toBe('solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1');
    } finally { server.close(); }
  });
  it('stays open when no token is configured (local development)', async () => {
    await request(createFacilitatorApp(stub as never)).get('/supported').expect(200);
  });
});
