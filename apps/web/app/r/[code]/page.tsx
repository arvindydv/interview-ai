'use client';
import { useEffect, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { normalizePartnerCode } from '@parakeet/shared';
import { API_URL } from '@/lib/api';
import { rememberReferral } from '@/lib/referral';

// A partner's invite link: counts the visit, remembers the code for sign-up, and opens the home page.
export default function ReferralLink() {
  const router = useRouter();
  const { code: raw } = useParams<{ code: string }>();
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const code = normalizePartnerCode(decodeURIComponent(raw ?? ''));
    const go = () => router.replace('/');
    if (!code) return go();
    fetch(`${API_URL}/v1/referrals/click`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code }),
    })
      .then((res) => res.ok && rememberReferral(code))
      .catch(() => rememberReferral(code)) // API unreachable: still credit the partner at sign-up
      .finally(go);
  }, [raw, router]);

  return (
    <main className="flex min-h-screen items-center justify-center">
      <span className="size-5 animate-spin rounded-full border-2 border-brand border-r-transparent" />
    </main>
  );
}
