import { redactSensitive, type FormQuestion, type PreparedAnswer } from '@parakeet/shared';
import type { SubmitOptions, SubmitResult } from './types.js';

// HTTP for ATS connectors: one request, a timeout, and a classification of what went wrong that keeps
// "never sent" (safe to retry) apart from "may have been sent" (never resent automatically).

export interface HttpResponse {
  status: number;
  headers: Headers;
  text: string;
  json: unknown;
}

/** Connection errors that mean the request never reached the server. */
const NOT_SENT = /ENOTFOUND|EAI_AGAIN|ECONNREFUSED|EHOSTUNREACH|ENETUNREACH|UND_ERR_CONNECT_TIMEOUT|CERT|SSL|TLS|ERR_INVALID_URL/i;

export class NotSentError extends Error {}
export class MaybeSentError extends Error {}

function errorCode(err: unknown): string {
  const e = err as { code?: string; name?: string; message?: string; cause?: { code?: string; message?: string } };
  return [e?.cause?.code, e?.code, e?.name, e?.cause?.message, e?.message].filter(Boolean).join(' ');
}

/**
 * Sends one request. Throws NotSentError when it provably never left (cancelled first, DNS, refused,
 * TLS), MaybeSentError when it may have reached the ATS (our timeout fired, connection reset mid-way).
 */
export async function request(url: string, init: RequestInit, opts: SubmitOptions & { timeoutMs: number }): Promise<HttpResponse> {
  if (opts.signal?.aborted) throw new NotSentError('Cancelled before sending');
  const doFetch = opts.fetch ?? fetch;
  const timeout = AbortSignal.timeout(opts.timeoutMs);
  let res: Response;
  try {
    res = await doFetch(url, { ...init, signal: timeout, redirect: 'manual' });
  } catch (err) {
    const code = errorCode(err);
    if (NOT_SENT.test(code)) throw new NotSentError(`Connection failed: ${code.slice(0, 200)}`);
    throw new MaybeSentError(timeout.aborted ? `No response within ${Math.round(opts.timeoutMs / 1000)}s` : `Connection lost: ${code.slice(0, 200)}`);
  }
  let text = '';
  try {
    text = await res.text();
  } catch {
    // Status arrived; the body didn't. The status still tells us what happened.
  }
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, headers: res.headers, text, json };
}

/** Retry-After in ms (seconds or an HTTP date); default when absent. */
export function retryAfterMs(headers: Headers, fallback = 60_000): number {
  const v = headers.get('retry-after');
  if (!v) return fallback;
  const n = Number(v);
  if (Number.isFinite(n)) return Math.max(1000, n * 1000);
  const t = Date.parse(v);
  return Number.isFinite(t) ? Math.max(1000, t - Date.now()) : fallback;
}

const short = (s: string) => redactSensitive(s.replace(/\s+/g, ' ').slice(0, 300));

/** Form keys whose label or key the error message names. */
export function namedFields(message: string, form: FormQuestion[]): string[] {
  const m = message.toLowerCase();
  return form.filter((q) => (q.key.length > 3 && m.includes(q.key.toLowerCase())) || (q.label.length > 3 && m.includes(q.label.toLowerCase()))).map((q) => q.key);
}

/** The outcome for a non-2xx status, the same for every ATS. */
export function classifyStatus(res: HttpResponse, message: string, form: FormQuestion[]): SubmitResult {
  const s = res.status;
  const msg = short(message || res.text || `HTTP ${s}`);
  if (/already (applied|submitted|exists)|duplicate (application|candidate)/i.test(msg) || s === 409) {
    return { outcome: 'failed', code: 'duplicate', httpStatus: s, retryable: false, message: msg };
  }
  if (s === 429) return { outcome: 'failed', code: 'rate_limited', httpStatus: s, retryable: true, message: msg, retryAfterMs: retryAfterMs(res.headers) };
  if (s === 401 || s === 403) return { outcome: 'failed', code: 'auth', httpStatus: s, retryable: false, message: msg };
  if (s === 404 || s === 410) return { outcome: 'failed', code: 'closed', httpStatus: s, retryable: false, message: msg };
  // A gateway gave up waiting: the ATS behind it may have processed the application.
  if (s === 502 || s === 504) return { outcome: 'uncertain', httpStatus: s, message: msg };
  if (s >= 500) return { outcome: 'failed', code: 'server', httpStatus: s, retryable: true, message: msg, retryAfterMs: retryAfterMs(res.headers, 5 * 60_000) };
  if (s >= 300 && s < 400) return { outcome: 'failed', code: 'server', httpStatus: s, retryable: false, message: `Unexpected redirect (HTTP ${s})` };
  return { outcome: 'failed', code: 'validation', httpStatus: s, retryable: false, message: msg, fields: namedFields(msg, form) };
}

/** Runs a connector's request, turning thrown network errors into outcomes. */
export async function guarded(run: () => Promise<SubmitResult>): Promise<SubmitResult> {
  try {
    return await run();
  } catch (err) {
    if (err instanceof NotSentError) return { outcome: 'failed', code: 'network', httpStatus: null, retryable: true, message: err.message };
    if (err instanceof MaybeSentError) return { outcome: 'uncertain', httpStatus: null, message: err.message };
    throw err;
  }
}

/** A secret is a bare API key, or JSON with apiKey and connector options (e.g. Lever's region). */
export function parseSecret(secret: string): { apiKey: string; [k: string]: unknown } {
  const t = secret.trim();
  if (t.startsWith('{')) {
    const o = JSON.parse(t) as { apiKey?: string };
    if (!o.apiKey) throw new Error('Credential JSON has no apiKey');
    return o as { apiKey: string };
  }
  return { apiKey: t };
}

export const basicAuth = (user: string) => `Basic ${Buffer.from(`${user}:`).toString('base64')}`;

/** The prepared answer for a key, when it has a value. */
export function answerOf(answers: PreparedAnswer[], key: string): string | string[] | null {
  const a = answers.find((x) => x.key === key);
  return a?.value ?? null;
}

export const first = (v: string | string[] | null): string => (Array.isArray(v) ? (v[0] ?? '') : (v ?? ''));
export const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
