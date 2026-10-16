import type { FastifyReply, FastifyRequest } from 'fastify';
import { createRemoteJWKSet, decodeProtectedHeader, jwtVerify, type JWTPayload } from 'jose';
import { env } from '../env.js';

export interface AuthUser {
  id: string;
  email: string;
  provider: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    user: AuthUser;
  }
}

const issuer = `${env.SUPABASE_URL}/auth/v1`;
const jwks = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
const hsSecret = env.SUPABASE_JWT_SECRET ? new TextEncoder().encode(env.SUPABASE_JWT_SECRET) : null;

/** Verifies a Supabase access token locally (no network hop per request beyond cached JWKS). */
export async function verifyAccessToken(token: string): Promise<AuthUser> {
  const { alg } = decodeProtectedHeader(token);
  const opts = { issuer, audience: 'authenticated' };
  let payload: JWTPayload & { email?: string; app_metadata?: { provider?: string } };
  if (alg === 'HS256') {
    if (!hsSecret) throw new Error('HS256 token but SUPABASE_JWT_SECRET is not set');
    ({ payload } = await jwtVerify(token, hsSecret, opts));
  } else {
    ({ payload } = await jwtVerify(token, jwks, opts));
  }
  if (!payload.sub) throw new Error('Token has no subject');
  return {
    id: payload.sub,
    email: payload.email ?? '',
    provider: payload.app_metadata?.provider ?? 'email',
  };
}

/** preHandler / preValidation hook: requires `Authorization: Bearer <supabase access token>`. */
export async function requireAuth(req: FastifyRequest, reply: FastifyReply) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return reply.code(401).send({ error: 'unauthorized', message: 'Missing bearer token' });
  }
  try {
    req.user = await verifyAccessToken(header.slice(7));
  } catch (err) {
    req.log.debug({ err }, 'token verification failed');
    return reply.code(401).send({ error: 'unauthorized', message: 'Invalid or expired token' });
  }
}
