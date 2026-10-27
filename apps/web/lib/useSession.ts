'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

/** Who is signed in to the website: `undefined` while checking, `null` when signed out. */
export type SessionUser = { email: string } | null | undefined;

export function useSessionUser(): SessionUser {
  const [user, setUser] = useState<SessionUser>(undefined);
  useEffect(() => {
    const client = supabase();
    client.auth.getSession().then(({ data }) => setUser(data.session ? { email: data.session.user.email ?? '' } : null));
    const { data } = client.auth.onAuthStateChange((_event, session) =>
      setUser(session ? { email: session.user.email ?? '' } : null),
    );
    return () => data.subscription.unsubscribe();
  }, []);
  return user;
}

/**
 * For signed-in pages: the user's email once the session is known (null until then). Signed-out
 * visitors go to sign-in and come back here afterwards; signing out elsewhere leaves the page.
 */
export function useRequireSession(): string | null {
  const router = useRouter();
  const [email, setEmail] = useState<string | null>(null);
  useEffect(() => {
    const client = supabase();
    client.auth.getSession().then(({ data }) => {
      if (!data.session) {
        return router.replace(`/login?${new URLSearchParams({ next: location.pathname + location.search })}`);
      }
      setEmail(data.session.user.email ?? '');
    });
    const { data } = client.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') router.replace('/');
    });
    return () => data.subscription.unsubscribe();
  }, [router]);
  return email;
}
