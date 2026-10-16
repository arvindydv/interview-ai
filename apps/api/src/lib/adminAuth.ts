import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { jwtVerify, SignJWT } from 'jose';
import { env } from '../env.js';
import { sql } from './db.js';
import { redis } from './redis.js';

// Admin console sign-in. A single operator account whose credentials live in the API's env
// (ADMIN_EMAIL / ADMIN_PASSWORD); sessions are short-lived HS256 tokens signed with ADMIN_JWT_SECRET.
// Deliberately separate from Supabase Auth so an end-user token can never reach /admin.

declare module 'fastify' {
  interface FastifyRequest {
    admin: { email: string };
  }
}

const AUDIENCE = 'parakeet-admin';
const LOGIN_WINDOW_S = 15 * 60;
const LOGIN_MAX_ATTEMPTS = 10;

export function adminConfigured() {
  return Boolean(env.ADMIN_EMAIL && env.ADMIN_PASSWORD && env.ADMIN_JWT_SECRET && env.ADMIN_JWT_SECRET.length >= 32);
}

const secret = () => new TextEncoder().encode(env.ADMIN_JWT_SECRET);

/** Compares digests so neither the length nor the content of the secret leaks through timing. */
function safeEqual(a: string, b: string) {
  const h = (s: string) => createHash('sha256').update(s).digest();
  return timingSafeEqual(h(a), h(b));
}

/** Counts a login attempt for this IP. Returns false once the window's budget is spent. */
export async function allowLoginAttempt(ip: string) {
  const key = `admin:login:${ip}`;
  const n = await redis.incr(key);
  if (n === 1) await redis.expire(key, LOGIN_WINDOW_S);
  return n <= LOGIN_MAX_ATTEMPTS;
}

export function checkAdminCredentials(email: string, password: string) {
  // Evaluate both so a wrong email takes as long as a wrong password.
  const emailOk = safeEqual(email.trim().toLowerCase(), env.ADMIN_EMAIL!.trim().toLowerCase());
  const passwordOk = safeEqual(password, env.ADMIN_PASSWORD!);
  return emailOk && passwordOk;
}

export async function issueAdminToken(email: string) {
  const expiresAt = new Date(Date.now() + env.ADMIN_SESSION_HOURS * 3600_000);
  const token = await new SignJWT({ email })
    .setProtectedHeader({ alg: 'HS256' })
    .setAudience(AUDIENCE)
    .setSubject('admin')
    .setIssuedAt()
    .setExpirationTime(expiresAt)
    .sign(secret());
  return { token, email, expiresAt: expiresAt.toISOString() };
}

/** preHandler for /admin/*: requires `Authorization: Bearer <admin token>`. */
export async function requireAdmin(req: FastifyRequest, reply: FastifyReply) {
  if (!adminConfigured()) {
    return reply.code(503).send({ error: 'admin_disabled', message: 'Set ADMIN_EMAIL, ADMIN_PASSWORD and ADMIN_JWT_SECRET on the API.' });
  }
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return reply.code(401).send({ error: 'unauthorized', message: 'Sign in again' });
  try {
    const { payload } = await jwtVerify(header.slice(7), secret(), { audience: AUDIENCE, algorithms: ['HS256'] });
    req.admin = { email: String(payload.email) };
  } catch {
    return reply.code(401).send({ error: 'unauthorized', message: 'Session expired: sign in again' });
  }
}

/** Records an admin action. Never throws: an audit failure must not undo the action itself. */
export async function audit(req: FastifyRequest, action: string, target: string | null, details: Record<string, unknown> = {}) {
  try {
    await sql`
      insert into public.admin_audit (admin_email, action, target, details)
      values (${req.admin.email}, ${action}, ${target}, ${sql.json(details as never)})`;
  } catch (err) {
    req.log.error({ err, action }, 'failed to write admin audit entry');
  }
}
