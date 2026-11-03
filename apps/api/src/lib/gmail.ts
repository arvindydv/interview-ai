import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { env } from '../env.js';

// Sending from the candidate's own Gmail (Friday Jobs cold email). OAuth asks only for gmail.send, so
// Friday can send as them but never read their mail. Refresh tokens are stored encrypted with
// GMAIL_TOKEN_KEY; access tokens live in memory for their hour.

export const GMAIL_SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send';
const SCOPES = ['openid', 'email', GMAIL_SEND_SCOPE];
const STATE_TTL_MS = 10 * 60_000;

/** All three set, and a key of the right size: a wrong key would only show up after the candidate had consented. */
export const gmailConfigured = () =>
  Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && Buffer.from(env.GMAIL_TOKEN_KEY ?? '', 'base64').length === 32);
export const gmailRedirectUri = () => `${env.API_PUBLIC_URL}/v1/cold-email/gmail/callback`;

function tokenKey() {
  const key = Buffer.from(env.GMAIL_TOKEN_KEY ?? '', 'base64');
  if (key.length !== 32) throw new Error('GMAIL_TOKEN_KEY must be 32 bytes, base64');
  return key;
}

export function encryptToken(token: string): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', tokenKey(), iv);
  const data = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]);
}

export function decryptToken(blob: Buffer): string {
  const decipher = createDecipheriv('aes-256-gcm', tokenKey(), blob.subarray(0, 12));
  decipher.setAuthTag(blob.subarray(12, 28));
  return Buffer.concat([decipher.update(blob.subarray(28)), decipher.final()]).toString('utf8');
}

// OAuth state: who started the connection and where to send them back, signed so the callback (which
// arrives without the user's session) can trust it.
const stateKey = () => createHash('sha256').update(`gmail-state:${env.GMAIL_TOKEN_KEY}`).digest();
const sign = (payload: string) => createHmac('sha256', stateKey()).update(payload).digest('base64url');

export function signState(userId: string, returnTo: string) {
  const payload = Buffer.from(JSON.stringify({ u: userId, r: returnTo, e: Date.now() + STATE_TTL_MS })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

export function verifyState(state: string): { userId: string; returnTo: string } | null {
  const [payload, mac] = state.split('.');
  if (!payload || !mac) return null;
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  const { u, r, e } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { u: string; r: string; e: number };
  return e > Date.now() ? { userId: u, returnTo: r } : null;
}

export function authUrl(state: string, email: string) {
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID!,
    redirect_uri: gmailRedirectUri(),
    response_type: 'code',
    scope: SCOPES.join(' '),
    // A refresh token, every time (Google only returns one on first consent otherwise).
    access_type: 'offline',
    prompt: 'consent',
    login_hint: email,
    state,
  }).toString();
  return url.toString();
}

/** Google refused the refresh token: the candidate revoked access, or it expired. They must reconnect. */
export class GmailRevokedError extends Error {}

interface TokenReply {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope: string;
  id_token?: string;
}

async function tokenRequest(params: Record<string, string>): Promise<TokenReply> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID!, client_secret: env.GOOGLE_CLIENT_SECRET!, ...params }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await res.json().catch(() => ({}))) as TokenReply & { error?: string };
  if (body.error === 'invalid_grant') throw new GmailRevokedError('Gmail access was revoked');
  if (!res.ok || !body.access_token) throw new Error(`Google token endpoint: ${body.error ?? `HTTP ${res.status}`}`);
  return body;
}

/** Exchanges the OAuth code for tokens, and the Gmail address they belong to. */
export async function exchangeCode(code: string) {
  const reply = await tokenRequest({ code, redirect_uri: gmailRedirectUri(), grant_type: 'authorization_code' });
  // The ID token came straight from Google over TLS, so its claims can be read without verifying it.
  const claims = reply.id_token
    ? (JSON.parse(Buffer.from(reply.id_token.split('.')[1], 'base64url').toString('utf8')) as { email?: string; email_verified?: boolean })
    : {};
  return { ...reply, email: claims.email_verified === false ? null : (claims.email ?? null) };
}

const accessTokens = new Map<string, { token: string; expires: number }>();

export async function accessToken(userId: string, refreshToken: Buffer) {
  const cached = accessTokens.get(userId);
  if (cached && cached.expires > Date.now() + 60_000) return cached.token;
  const reply = await tokenRequest({ refresh_token: decryptToken(refreshToken), grant_type: 'refresh_token' });
  accessTokens.set(userId, { token: reply.access_token, expires: Date.now() + reply.expires_in * 1000 });
  return reply.access_token;
}

export function forgetAccessToken(userId: string) {
  accessTokens.delete(userId);
}

/** Best effort: the stored token is deleted either way. */
export async function revokeToken(refreshToken: Buffer) {
  const token = decryptToken(refreshToken);
  await fetch('https://oauth2.googleapis.com/revoke', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token }),
    signal: AbortSignal.timeout(10_000),
  }).catch(() => undefined);
}

/** RFC 2047 for a header with non-ASCII text, e.g. a name or subject in Hindi. */
const encodeWord = (s: string) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=`);
const base64Lines = (buf: Buffer) => buf.toString('base64').replace(/.{76}/g, '$&\r\n');
/** Header values can't carry line breaks (header injection). */
const oneLine = (s: string) => s.replace(/[\r\n]+/g, ' ').trim();

export interface OutgoingEmail {
  fromName: string;
  fromEmail: string;
  to: string;
  subject: string;
  text: string;
  attachment: { name: string; type: string; data: Buffer } | null;
}

/** The email as a MIME message: plain text, and the resume attached. */
export function buildMime(m: OutgoingEmail) {
  const boundary = `friday-${randomBytes(12).toString('hex')}`;
  const from = m.fromName ? `${encodeWord(oneLine(m.fromName).replace(/["\\]/g, ''))} <${m.fromEmail}>` : m.fromEmail;
  const headers = [
    `From: ${from}`,
    `To: ${oneLine(m.to)}`,
    `Subject: ${encodeWord(oneLine(m.subject))}`,
    'MIME-Version: 1.0',
  ];
  const text = ['Content-Type: text/plain; charset="UTF-8"', 'Content-Transfer-Encoding: base64', '', base64Lines(Buffer.from(m.text.replace(/\r?\n/g, '\r\n'), 'utf8'))];
  if (!m.attachment) return [...headers, ...text].join('\r\n');
  const name = oneLine(m.attachment.name).replace(/["\\]/g, '');
  return [
    ...headers,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    ...text,
    `--${boundary}`,
    `Content-Type: ${m.attachment.type}; name="${encodeWord(name)}"`,
    `Content-Disposition: attachment; filename="${name.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(name)}`,
    'Content-Transfer-Encoding: base64',
    '',
    base64Lines(m.attachment.data),
    `--${boundary}--`,
    '',
  ].join('\r\n');
}

/** Gmail said no (bad address, quota, policy). Nothing was sent. */
export class GmailSendError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** Sends from the candidate's Gmail. Throws GmailSendError when Gmail refused it; other errors may or may not have sent it. */
export async function sendGmail(token: string, mime: string): Promise<{ id: string; threadId: string }> {
  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ raw: Buffer.from(mime, 'utf8').toString('base64url') }),
    signal: AbortSignal.timeout(30_000),
  });
  const body = (await res.json().catch(() => ({}))) as { id?: string; threadId?: string; error?: { message?: string } };
  if (!res.ok || !body.id) throw new GmailSendError(body.error?.message ?? `HTTP ${res.status}`, res.status);
  return { id: body.id, threadId: body.threadId ?? body.id };
}
