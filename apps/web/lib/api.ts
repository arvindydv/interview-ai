'use client';
import { endExpiredSession } from './authSession';
import { supabase } from './supabase';

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

const SESSION_EXPIRED = 'Your session expired. Please sign in again.';

/** A non-2xx reply from the API. `status` 0 means the request never got a reply (network error). */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/**
 * Sends a request with the current access token. If the API refuses the token (401), the session
 * is refreshed once and the request retried; if it is still refused, the session is over and the
 * user is signed out here (signed-in pages then redirect to sign-in).
 */
async function send(path: string, init: RequestInit, headers: Record<string, string>): Promise<Response> {
  const attempt = (token: string | undefined) =>
    fetch(`${API_URL}${path}`, {
      ...init,
      headers: { ...headers, ...(token ? { authorization: `Bearer ${token}` } : {}), ...init.headers },
    }).catch((e: Error) => {
      throw new ApiError(e.message, 0);
    });

  const { data } = await supabase().auth.getSession();
  const token = data.session?.access_token;
  const res = await attempt(token);
  // Without a token there is no session to end; the page's own sign-in check handles that.
  if (res.status !== 401 || !token) return res;

  const refreshed = await supabase()
    .auth.refreshSession()
    .catch(() => null);
  const fresh = refreshed?.data.session?.access_token;
  const retry = fresh ? await attempt(fresh) : res;
  if (retry.status === 401) {
    await endExpiredSession();
    throw new ApiError(SESSION_EXPIRED, 401);
  }
  return retry;
}

/** Calls the Edge API with the current user's access token. */
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await send(path, init, init.body ? { 'content-type': 'application/json' } : {});
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(body.message ?? `HTTP ${res.status}`, res.status);
  return body as T;
}

/** Like `api`, for binary replies (e.g. audio). */
export async function apiBlob(path: string, init: RequestInit = {}): Promise<Blob> {
  const res = await send(path, init, {});
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(body.message ?? `HTTP ${res.status}`, res.status);
  }
  return res.blob();
}
