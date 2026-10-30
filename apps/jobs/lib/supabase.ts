'use client';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// The same Supabase project as the main Friday site, so people sign in with their Friday account. The
// session lives in this site's own localStorage (a different origin from the main site).

let client: SupabaseClient | undefined;

export function supabase() {
  return (client ??= createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    auth: { flowType: 'pkce', detectSessionInUrl: false },
  }));
}

/** Where people create a Friday account. */
export const WEB_URL = process.env.NEXT_PUBLIC_WEB_URL || 'http://localhost:3100';
