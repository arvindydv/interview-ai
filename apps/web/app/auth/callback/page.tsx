'use client';
import { Suspense, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { handoffSupabase, supabase } from '@/lib/supabase';

// OAuth / magic-link landing page: exchanges the PKCE code for a session, then continues.
function Callback() {
  const router = useRouter();
  const params = useSearchParams();
  const [error, setError] = useState<string | null>(params.get('error_description'));
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const code = params.get('code');
    const next = params.get('next') || '/dashboard';
    if (!code) return;
    const client = params.get('handoff') === '1' ? handoffSupabase() : supabase();
    client.auth.exchangeCodeForSession(code).then(({ error }) => {
      if (error) setError(error.message);
      else router.replace(next.startsWith('/') ? next : '/dashboard');
    });
  }, [params, router]);

  return (
    <div className="flex items-center gap-3 text-sm">
      {!error && <span className="size-4 animate-spin rounded-full border-2 border-brand border-r-transparent" />}
      <p className={error ? 'text-danger' : 'text-muted'}>{error ?? 'Signing you in…'}</p>
    </div>
  );
}

export default function CallbackPage() {
  return (
    <main className="flex min-h-screen items-center justify-center">
      <Suspense>
        <Callback />
      </Suspense>
    </main>
  );
}
