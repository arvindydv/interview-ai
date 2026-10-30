'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { supabase } from '@/lib/supabase';

/** Sign in / get started for visitors; a way back in for people already signed in. */
export function AuthButtons() {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  useEffect(() => {
    supabase()
      .auth.getSession()
      .then(({ data }) => setSignedIn(Boolean(data.session)));
  }, []);

  if (signedIn) {
    return (
      <Link href="/recommended" className="btn btn-primary">
        Open my jobs <ArrowRight size={16} />
      </Link>
    );
  }
  return (
    <div className="flex items-center gap-1 sm:gap-2">
      <Link href="/login" className="btn btn-ghost">
        Sign in
      </Link>
      <Link href="/login" className="btn btn-primary">
        Get started
      </Link>
    </div>
  );
}
