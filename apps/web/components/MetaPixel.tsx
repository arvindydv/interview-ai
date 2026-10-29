'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { PIXEL_ID, effectiveConsent, flushPendingRegistration, loadPixel, onConsentChange, track } from '@/lib/meta';

export function useConsent() {
  return useSyncExternalStore(onConsentChange, effectiveConsent, () => null);
}

/**
 * Loads the Meta Pixel once marketing cookies are accepted (ConsentBanner) and reports a PageView
 * on load and on every client-side navigation, except on private pages (lib/meta.ts).
 */
export default function MetaPixel() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const consent = useConsent();

  useEffect(() => {
    if (!PIXEL_ID || consent !== 'granted') return;
    loadPixel(PIXEL_ID);
    track('PageView');
    flushPendingRegistration();
  }, [pathname, searchParams, consent]);

  return null;
}
