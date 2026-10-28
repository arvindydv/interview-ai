'use client';
import { supabase } from './supabase';

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

/** A non-2xx reply from the API. `status` 0 means the request never got a reply (network error). */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** Calls the Edge API with the current user's access token. */
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { data } = await supabase().auth.getSession();
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...(data.session ? { authorization: `Bearer ${data.session.access_token}` } : {}),
      ...init.headers,
    },
  }).catch((e: Error) => {
    throw new ApiError(e.message, 0);
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(body.message ?? `HTTP ${res.status}`, res.status);
  return body as T;
}

/** Like `api`, for binary replies (e.g. audio). */
export async function apiBlob(path: string, init: RequestInit = {}): Promise<Blob> {
  const { data } = await supabase().auth.getSession();
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { ...(data.session ? { authorization: `Bearer ${data.session.access_token}` } : {}), ...init.headers },
  }).catch((e: Error) => {
    throw new ApiError(e.message, 0);
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(body.message ?? `HTTP ${res.status}`, res.status);
  }
  return res.blob();
}
