// server/src/auth.ts
import { Router, type NextFunction, type Request, type Response } from 'express';
import { ed25519 } from '@noble/curves/ed25519.js';
import { addressBytes, hexToBytes, isSolanaAddress, randomHex32, utf8ToBytes } from '@as/shared';
import { z } from 'zod';
import { HttpError, type Deps } from './deps.js';
import { hashToken, newToken } from './tokens.js';

export interface AuthedRequest extends Request { address?: string; agent?: { id: string; address: string; kind: string; paused?: boolean } }

const bearer = (req: Request) => /^Bearer (\S+)$/.exec(req.header('authorization') ?? '')?.[1];

/** What the wallet signs (Wallet Standard `solana:signMessage`), UTF-8. The web app and plugin show the same text. */
export const signInMessage = (address: string, nonce: string) => `Sign in to PrefPool\n\nWallet: ${address}\nNonce: ${nonce}`;

/** Ed25519 over the message, with the address itself as the public key. */
export function signInSignatureOk(address: string, nonce: string, signatureHex: string): boolean {
  try {
    return ed25519.verify(hexToBytes(signatureHex), utf8ToBytes(signInMessage(address, nonce)), addressBytes(address));
  } catch {
    return false;
  }
}

const solanaAddress = z.string().refine(isSolanaAddress, 'not a Solana address');

export function authRoutes(deps: Deps): Router {
  const r = Router();
  r.post('/auth/nonce', async (req, res) => {
    const { address } = z.object({ address: solanaAddress }).parse(req.body);
    const nonce = randomHex32(); // hex (F7)
    await deps.db.query(
      `insert into auth_nonces (address, nonce, expires_at) values ($1, $2, to_timestamp($3 / 1000.0))
       on conflict (address) do update set nonce = excluded.nonce, expires_at = excluded.expires_at`,
      [address, nonce, deps.now() + 5 * 60_000],
    );
    res.json({ nonce, message: signInMessage(address, nonce) });
  });
  r.post('/auth/verify', async (req, res) => {
    const body = z.object({ address: solanaAddress, signature: z.string().regex(/^[0-9a-fA-F]{128}$/) }).parse(req.body);
    const [row] = await deps.db.query<{ nonce: string }>(
      `delete from auth_nonces where address = $1 and expires_at > to_timestamp($2 / 1000.0) returning nonce`,
      [body.address, deps.now()],
    );
    if (!row) throw new HttpError(401, 'NONCE', 'nonce missing or expired');
    if (!signInSignatureOk(body.address, row.nonce, body.signature.toLowerCase())) throw new HttpError(401, 'SIGNATURE', 'bad signature');
    const sessionToken = newToken();
    await deps.db.query(`insert into sessions (token_hash, address, expires_at) values ($1, $2, to_timestamp($3 / 1000.0))`,
      [hashToken(sessionToken), body.address, deps.now() + 24 * 3_600_000]);
    res.json({ sessionToken });
  });
  return r;
}

export const requireSession = (deps: Deps) => async (req: AuthedRequest, _res: Response, next: NextFunction) => {
  const t = bearer(req);
  if (!t) return next(new HttpError(401, 'AUTH', 'missing session token'));
  const [s] = await deps.db.query<{ address: string }>(
    `select address from sessions where token_hash = $1 and expires_at > to_timestamp($2 / 1000.0)`, [hashToken(t), deps.now()]);
  if (!s) return next(new HttpError(401, 'AUTH', 'invalid session'));
  req.address = s.address;
  next();
};

export const requireAgent = (deps: Deps) => async (req: AuthedRequest, _res: Response, next: NextFunction) => {
  const t = bearer(req);
  const agent = t ? await agentByToken(deps, t) : undefined;
  if (!agent) return next(new HttpError(401, 'AUTH', 'invalid agent token'));
  req.agent = agent;
  next();
};

/** Looks the agent up by token and records that it was seen (connection status on the seller's pages). */
export async function agentByToken(deps: Deps, token: string) {
  const [a] = await deps.db.query<{ id: string; address: string; kind: string; paused: boolean }>(
    `update agents set last_seen_at = now() where token_hash = $1 returning id, address, kind, paused`, [hashToken(token)]);
  return a;
}

export const requireStaticToken = (token: string) => (req: Request, _res: Response, next: NextFunction) =>
  bearer(req) === token && token.length >= 32 ? next() : next(new HttpError(401, 'AUTH', 'invalid token'));
