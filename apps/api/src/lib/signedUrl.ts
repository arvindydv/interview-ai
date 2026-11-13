import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../env.js';

// Short-lived signed download links (HMAC-SHA256), so a resume can be fetched by a plain <a href> without
// putting the user's access token in a URL. A signature is bound to the user, the resource and the
// expiry; the route still checks the user owns the resource, so a leaked link only works for its owner's
// file and only until it expires.

/** Default lifetime of a link. */
export const DOWNLOAD_URL_TTL_SEC = 10 * 60;

let warned = false;
function secret(): Buffer {
  if (env.DOWNLOAD_URL_SECRET) return Buffer.from(env.DOWNLOAD_URL_SECRET);
  if (env.NODE_ENV === 'production') throw new Error('DOWNLOAD_URL_SECRET must be set in production');
  if (!warned) {
    warned = true;
    console.warn('[signedUrl] DOWNLOAD_URL_SECRET is not set; using a development secret derived from the database URL');
  }
  return createHash('sha256').update(`friday-download:${env.DATABASE_URL}`).digest();
}

const mac = (userId: string, resource: string, exp: number) =>
  createHmac('sha256', secret()).update(`${userId}\n${resource}\n${exp}`).digest('base64url');

/** Signs `resource` (e.g. "applied-resume:auto:<uuid>") for this user; returns the query values. */
export function signDownload(userId: string, resource: string, ttlSec = DOWNLOAD_URL_TTL_SEC, now = Date.now()) {
  const exp = Math.floor(now / 1000) + ttlSec;
  return { exp, sig: mac(userId, resource, exp) };
}

/** Whether a signature is valid for this user and resource and hasn't expired. Constant-time. */
export function verifyDownload(userId: string, resource: string, exp: unknown, sig: unknown, now = Date.now()): boolean {
  const e = Number(exp);
  if (!Number.isInteger(e) || typeof sig !== 'string' || !sig) return false;
  if (e < Math.floor(now / 1000)) return false;
  const expected = Buffer.from(mac(userId, resource, e));
  const given = Buffer.from(sig);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
