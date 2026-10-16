'use client';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;

let webClient: SupabaseClient | undefined;
let handoffClient: SupabaseClient | undefined;

/** The website's own session (persisted in localStorage, auto-refreshed). */
export function supabase() {
  return (webClient ??= createClient(url, key, { auth: { flowType: 'pkce', detectSessionInUrl: false } }));
}

export const HANDOFF_STORAGE_KEY = 'parakeet-desktop-handoff';

/**
 * A separate, throwaway session used only to sign in the desktop app (spec A1).
 * Handing the website's own refresh token to the desktop would make the two clients fight over
 * refresh-token rotation, so desktop sign-in mints its own session in sessionStorage, passes it to
 * the app and then forgets it.
 */
export function handoffSupabase() {
  return (handoffClient ??= createClient(url, key, {
    auth: {
      flowType: 'pkce',
      storageKey: HANDOFF_STORAGE_KEY,
      storage: typeof window === 'undefined' ? undefined : window.sessionStorage,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  }));
}

/** Desktop redirect targets we are willing to send tokens to. */
export function isAllowedDesktopRedirect(raw: string | null): raw is string {
  if (!raw) return false;
  try {
    const u = new URL(raw);
    if (u.protocol === 'parakeet:') return true;
    // Dev builds of the desktop app listen on a loopback port instead of a registered protocol.
    return u.protocol === 'http:' && u.hostname === '127.0.0.1' && u.pathname === '/callback';
  } catch {
    return false;
  }
}
