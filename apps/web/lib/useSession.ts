'use client';
import { useEffect, useState } from 'react';
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
