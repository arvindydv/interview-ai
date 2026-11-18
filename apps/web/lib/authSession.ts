'use client';
import { supabase } from './supabase';

// Why the website's session ended decides where a signed-in page goes next: a sign-out the user
// asked for goes home, anything else (expired or revoked token, failed refresh, sign-out in another
// tab) goes to sign-in with a notice and returns to the same page afterwards.

let intentional = false;
let ending: Promise<void> | null = null;
let watching = false;

function watch() {
  if (watching) return;
  watching = true;
  supabase().auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_IN') intentional = false;
  });
}

/** Signs out because the user asked to. */
export async function signOut() {
  watch();
  intentional = true;
  await supabase().auth.signOut();
}

/**
 * The session can no longer be used (the API refused its token even after a refresh). Drops it on
 * this device only, since the server would refuse a sign-out call with the same token; that fires
 * SIGNED_OUT, and the page's listener sends the user to sign in.
 */
export function endExpiredSession(): Promise<void> {
  watch();
  return (ending ??= supabase()
    .auth.signOut({ scope: 'local' })
    .then(
      () => undefined,
      () => undefined,
    )
    .finally(() => {
      ending = null;
    }));
}

/** Where a signed-in page should go once SIGNED_OUT fires. */
export function afterSignOutPath(): string {
  watch();
  if (intentional) {
    intentional = false;
    return '/';
  }
  return `/login?${new URLSearchParams({ next: location.pathname + location.search, expired: '1' })}`;
}
