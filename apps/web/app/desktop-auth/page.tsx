'use client';
import { Suspense, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { CheckCircle2, XCircle } from 'lucide-react';
import { HANDOFF_STORAGE_KEY, handoffSupabase, isAllowedDesktopRedirect } from '@/lib/supabase';
import { LogoMark } from '@/components/Logo';

// Final step of desktop sign-in (spec A1): send the freshly minted session to the desktop app via
// one-shot 127.0.0.1 loopback listener, then drop it from this browser. The app answers with a
// redirect to /desktop-auth/done, so the tab ends on this site, not on the loopback URL.
function Handoff() {
  const router = useRouter();
  const params = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const redirect = params.get('redirect');
    const state = params.get('state') ?? '';
    if (!isAllowedDesktopRedirect(redirect)) {
      setError('Invalid desktop redirect.');
      return;
    }
    handoffSupabase()
      .auth.getSession()
      .then(({ data }) => {
        const session = data.session;
        if (!session) {
          router.replace(`/login?${new URLSearchParams({ redirect, state })}`);
          return;
        }
        const url = new URL(redirect);
        url.searchParams.set('access_token', session.access_token);
        url.searchParams.set('refresh_token', session.refresh_token);
        url.searchParams.set('expires_at', String(session.expires_at ?? ''));
        url.searchParams.set('state', state);
        // Forget the session locally without revoking it: it now belongs to the desktop app.
        sessionStorage.removeItem(HANDOFF_STORAGE_KEY);
        // replace(): the token-bearing URL must not become a history entry.
        window.location.replace(url.toString());
      });
  }, [params, router]);

  return (
    <div className="glass w-full max-w-md animate-fade-up rounded-3xl p-10 text-center">
      {error ? (
        <>
          <XCircle className="mx-auto text-danger" size={44} />
          <h1 className="mt-5 text-xl font-semibold">Something went wrong</h1>
          <p className="mt-2 text-sm text-danger">{error}</p>
        </>
      ) : (
        <>
          <div className="relative mx-auto w-fit">
            <div className="absolute -inset-6 glow" />
            <LogoMark size={56} />
          </div>
          <h1 className="mt-6 text-xl font-semibold">Returning to Friday AI…</h1>
          <p className="mt-2 text-sm text-muted">
            <CheckCircle2 size={14} className="mr-1 inline text-brand" />
            You're signed in. Handing your session to the app…
          </p>
        </>
      )}
    </div>
  );
}

export default function DesktopAuthPage() {
  return (
    <main className="relative grid min-h-screen place-items-center px-4">
      <div className="pointer-events-none absolute inset-0 -z-10 bg-grid" />
      <Suspense>
        <Handoff />
      </Suspense>
    </main>
  );
}
