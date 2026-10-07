// server/src/personhood.ts: World ID seller verification (spec 2026-10-07-world-id-personhood-design.md §2).
// The server signs the request (rp_context) and verifies the proof with World; only the nullifier is stored.
import { Router } from 'express';
import { hashSignal } from '@worldcoin/idkit-core/hashing';
import { signRequest } from '@worldcoin/idkit-core/signing';
import { PERSONHOOD_ACTION } from '@as/shared';
import { z } from 'zod';
import { requireSession, type AuthedRequest } from './auth.js';
import { isUniqueViolation } from './db.js';
import { HttpError, type Deps } from './deps.js';

// Only World ID 3.0 legacy proofs: a human's v3 and v4 nullifiers differ, so accepting both would let one person verify two agents.
const resultSchema = z.object({
  protocol_version: z.string(),
  environment: z.string().optional(),
  action: z.string().optional(),
  responses: z.array(z.object({ signal_hash: z.string().optional() }).passthrough()).min(1),
}).passthrough();

export function personhoodRoutes(deps: Deps): Router {
  const r = Router();
  const cfg = () => {
    const p = deps.config.personhood;
    if (!p) throw new HttpError(404, 'PERSONHOOD_DISABLED', 'World ID verification is not configured');
    return p;
  };
  const agentFor = async (address: string) => {
    const [a] = await deps.db.query<{ id: string }>(`select id from agents where address = $1`, [address]);
    if (!a) throw new HttpError(409, 'NO_AGENT', 'register your agent first');
    return a;
  };

  r.post('/personhood/request', requireSession(deps), async (req: AuthedRequest, res) => {
    const p = cfg();
    await agentFor(req.address!);
    const s = signRequest({ signingKeyHex: p.signingKey.replace(/^0x/, ''), action: PERSONHOOD_ACTION, ttl: 600 });
    res.json({
      appId: p.appId, action: PERSONHOOD_ACTION, environment: p.environment, signal: req.address,
      rpContext: { rp_id: p.rpId, nonce: s.nonce, created_at: s.createdAt, expires_at: s.expiresAt, signature: s.sig },
    });
  });

  r.post('/personhood/verify', requireSession(deps), async (req: AuthedRequest, res) => {
    const p = cfg();
    const a = await agentFor(req.address!);
    const result = resultSchema.parse(req.body);
    const signal = hashSignal(req.address!).toLowerCase();
    if (result.protocol_version !== '3.0' || result.environment !== p.environment
      || (result.action !== undefined && result.action !== PERSONHOOD_ACTION)
      || result.responses.some((x) => x.signal_hash?.toLowerCase() !== signal)) {
      throw new HttpError(422, 'BAD_PROOF', 'this proof is not a World ID 3.0 proof for this wallet, action and environment');
    }
    let w: { success?: boolean; action?: string; nullifier?: string; code?: string; detail?: string };
    try {
      const resp = await (deps.worldFetch ?? fetch)(`https://developer.world.org/api/v4/verify/${p.rpId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(req.body), signal: AbortSignal.timeout(10_000),
      });
      if (resp.status >= 500 || resp.status === 429) throw new Error(`World returned ${resp.status}`);
      w = (await resp.json()) as typeof w;
      if (!resp.ok || !w.success) throw new HttpError(422, 'WORLD_REJECTED', w.code ?? w.detail ?? `World returned ${resp.status}`);
    } catch (e) {
      if (e instanceof HttpError) throw e;
      throw new HttpError(502, 'WORLD_UNAVAILABLE', 'World ID verification is unavailable; try again');
    }
    if (w.action !== PERSONHOOD_ACTION || !w.nullifier) throw new HttpError(422, 'BAD_PROOF', 'this proof is not for this action');
    const nullifier = w.nullifier.toLowerCase();
    let updated: { id: string }[];
    try {
      updated = await deps.db.query<{ id: string }>(
        `update agents set personhood_kind = 'world', personhood_nullifier = $2, personhood_verified_at = coalesce(personhood_verified_at, now())
          where id = $1 and (personhood_nullifier is null or personhood_nullifier = $2) returning id`, [a.id, nullifier]);
    } catch (e) {
      if (isUniqueViolation(e)) throw new HttpError(409, 'HUMAN_ALREADY_LINKED', 'This World ID is already linked to another agent');
      throw e;
    }
    if (!updated.length) throw new HttpError(409, 'ALREADY_VERIFIED', 'this agent is already verified with a different World ID');
    res.json({ personhood: { kind: 'world' } });
  });
  return r;
}
