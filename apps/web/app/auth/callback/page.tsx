'use client';
import { Suspense, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { safeNext } from '@/lib/safeNext';
import { noteSignIn } from '@/lib/meta';
import { handoffSupabase, supabase } from '@/lib/supabase';

// Shown instead of the provider's `error_description`, which anyone can put in a link.
const SIGN_IN_FAILED = 'That sign-in link is invalid or has expired. Please go back and try again.';

// OAuth / magic-link landing page: exchanges the PKCE code for a session, then continues.
function Callback() {
  const router = useRouter();
  const params = useSearchParams();
  const [error, setError] = useState<string | null>(params.get('error') ? SIGN_IN_FAILED : null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const code = params.get('code');
    const next = safeNext(params.get('next'));
    if (!code) return;
    const client = params.get('handoff') === '1' ? handoffSupabase() : supabase();
    client.auth.exchangeCodeForSession(code).then(({ data, error }) => {
      if (error) return setError(SIGN_IN_FAILED);
      // Reported from the next page: this one's URL carries the one-time code.
      if (data.user) noteSignIn(data.user);
      router.replace(next);
    });
  }, [params, router]);

  return (
    <div className="flex flex-col items-center gap-4 text-sm">
      <div className="flex items-center gap-3">
        {!error && <span className="size-4 animate-spin rounded-full border-2 border-brand border-r-transparent" />}
        <p className={error ? 'text-danger' : 'text-muted'}>{error ?? 'Signing you in…'}</p>
      </div>
      {error && (
        <a href="/login" className="font-medium text-brand hover:underline">
          Back to sign in
        </a>
      )}
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
