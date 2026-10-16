'use client';
import type { AdminSession } from '@parakeet/shared';

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

const SESSION_KEY = 'parakeet-admin-session';

export function getSession(): AdminSession | null {
  try {
    const s = JSON.parse(localStorage.getItem(SESSION_KEY) ?? 'null') as AdminSession | null;
    return s && new Date(s.expiresAt) > new Date() ? s : null;
  } catch {
    return null;
  }
}

function setSession(s: AdminSession | null) {
  try {
    if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    // Private mode without storage: the session lasts until reload.
  }
}

export function signOut() {
  setSession(null);
  window.location.replace('/login');
}

export async function login(email: string, password: string) {
  const res = await fetch(`${API_URL}/admin/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.message ?? `HTTP ${res.status}`);
  setSession(body as AdminSession);
}

/** Calls an /admin endpoint with the admin token. An expired session goes back to the login page. */
export async function adminApi<T>(path: string, init: RequestInit = {}): Promise<T> {
  const session = getSession();
  if (!session) {
    signOut();
    throw new Error('Signed out');
  }
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      authorization: `Bearer ${session.token}`,
      ...init.headers,
    },
  });
  const body = await res.json().catch(() => ({}));
  if (res.status === 401) {
    signOut();
    throw new Error('Session expired');
  }
  if (!res.ok) throw new Error(body.message ?? `HTTP ${res.status}`);
  return body as T;
}

/** Builds a query string, dropping empty values. */
export function qs(params: Record<string, string | number | undefined>) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
}
