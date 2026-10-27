'use client';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { useSessionUser } from '@/lib/useSession';

/** The footer's Account column: sign-in links for visitors, account links once signed in. */
export function FooterAccountLinks() {
  const user = useSessionUser();
  if (user === undefined) return null;
  const link = 'transition hover:text-fg';
  return user ? (
    <>
      <li><Link href="/dashboard" className={link}>Dashboard</Link></li>
      <li><Link href="/billing" className={link}>Plans &amp; billing</Link></li>
      <li>
        <button type="button" onClick={() => supabase().auth.signOut()} className={link}>
          Sign out
        </button>
      </li>
    </>
  ) : (
    <>
      <li><Link href="/login" className={link}>Sign in</Link></li>
      <li><Link href="/signup" className={link}>Create account</Link></li>
    </>
  );
}
