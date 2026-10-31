import { createHash } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { createRemoteJWKSet, decodeProtectedHeader, jwtVerify, type JWTPayload } from 'jose';
import { env } from '../env.js';
import { sql } from './db.js';

export interface AuthUser {
  id: string;
  email: string;
  provider: string;
  /** Full name given at sign-up (Supabase user_metadata.full_name), if any. */
  name: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    user: AuthUser;
    /** Set when the request came from the Friday extension with its device token. */
    deviceId?: string;
  }
}

const issuer = `${env.SUPABASE_URL}/auth/v1`;
const jwks = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
const hsSecret = env.SUPABASE_JWT_SECRET ? new TextEncoder().encode(env.SUPABASE_JWT_SECRET) : null;

/** Verifies a Supabase access token locally (no network hop per request beyond cached JWKS). */
export async function verifyAccessToken(token: string): Promise<AuthUser> {
  const { alg } = decodeProtectedHeader(token);
  const opts = { issuer, audience: 'authenticated' };
  let payload: JWTPayload & { email?: string; app_metadata?: { provider?: string }; user_metadata?: { full_name?: unknown } };
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
    name: typeof payload.user_metadata?.full_name === 'string' ? payload.user_metadata.full_name.trim().slice(0, 80) : '',
  };
}

/** Why a token was refused, as an HTTP status and the API's error body. */
export class AuthError extends Error {
  constructor(
    readonly status: 401 | 403,
    readonly code: 'unauthorized' | 'suspended' | 'email_unverified',
    message: string,
  ) {
    super(message);
  }
}

/** The user behind an access token, if they may use the API; throws AuthError otherwise. */
export async function authenticate(token: string, log?: FastifyRequest['log']): Promise<AuthUser> {
  let user: AuthUser;
  try {
    user = await verifyAccessToken(token);
  } catch (err) {
    log?.debug({ err }, 'token verification failed');
    throw new AuthError(401, 'unauthorized', 'Invalid or expired token');
  }
  const status = await accountStatus(user.id);
  if (status.suspended) throw new AuthError(403, 'suspended', 'This account has been suspended. Contact support.');
  // Supabase withholds a session until the address is confirmed, but only if "Confirm email" is on
  // for the project. Enforce it here too so a misconfigured project can't let unverified emails in.
  if (!status.confirmed) throw new AuthError(403, 'email_unverified', 'Confirm your email address to continue.');
  return user;
}

/** preHandler / preValidation hook: requires `Authorization: Bearer <supabase access token>`. */
export async function requireAuth(req: FastifyRequest, reply: FastifyReply) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return reply.code(401).send({ error: 'unauthorized', message: 'Missing bearer token' });
  }
  try {
    req.user = await authenticate(header.slice(7), req.log);
  } catch (err) {
    if (err instanceof AuthError) return reply.code(err.status).send({ error: err.code, message: err.message });
    throw err;
  }
}

// Account status (suspension from the admin console, email confirmation). Cached briefly so
// authenticated requests don't each hit Postgres; suspending a user also clears their entry (see
// forgetUserStatus).
const STATUS_CACHE_MS = 15_000;
const statusCache = new Map<string, { suspended: boolean; confirmed: boolean; at: number }>();

async function accountStatus(userId: string) {
  const hit = statusCache.get(userId);
  if (hit && Date.now() - hit.at < STATUS_CACHE_MS) return hit;
  const [row] = await sql<{ status: string | null; confirmed: boolean }[]>`
    select u.status, a.email_confirmed_at is not null as confirmed
    from auth.users a left join public.users u on u.id = a.id
    where a.id = ${userId}`;
  const entry = { suspended: row?.status === 'suspended', confirmed: row?.confirmed ?? false, at: Date.now() };
  if (statusCache.size > 10_000) statusCache.clear();
  // Don't cache "unconfirmed": the user is about to enter their code and shouldn't wait 15 s.
  if (entry.confirmed) statusCache.set(userId, entry);
  return entry;
}

// ---- Friday extension devices (public.auto_apply_devices) ----------------------------------------

/** Device tokens start with this, so they're never mistaken for a Supabase JWT. */
export const DEVICE_TOKEN_PREFIX = 'fdx_';

export const hashDeviceToken = (token: string) => createHash('sha256').update(token).digest('hex');

/** The user and device behind an extension device token; throws AuthError when it's unknown or revoked. */
export async function authenticateDevice(token: string): Promise<AuthUser & { deviceId: string }> {
  const [row] = await sql<{ id: string; user_id: string; email: string | null; provider: string | null; last_seen_at: Date | null }[]>`
    select d.id, d.user_id, a.email, a.raw_app_meta_data->>'provider' as provider, d.last_seen_at
    from public.auto_apply_devices d join auth.users a on a.id = d.user_id
    where d.token_hash = ${hashDeviceToken(token)} and d.revoked_at is null`;
  if (!row) throw new AuthError(401, 'unauthorized', 'This browser was disconnected. Open Friday Jobs to connect it again.');
  const status = await accountStatus(row.user_id);
  if (status.suspended) throw new AuthError(403, 'suspended', 'This account has been suspended. Contact support.');
  // "Last seen" for the Auto Apply page, written at most once a minute.
  if (!row.last_seen_at || Date.now() - row.last_seen_at.getTime() > 60_000) {
    await sql`update public.auto_apply_devices set last_seen_at = now() where id = ${row.id}`;
  }
  return { id: row.user_id, email: row.email ?? '', provider: row.provider ?? 'email', name: '', deviceId: row.id };
}

export function forgetUserStatus(userId: string) {
  statusCache.delete(userId);
}
