'use client';

import Link from 'next/link';
import { useConsent } from '@/components/MetaPixel';
import { PIXEL_ID, saveConsent } from '@/lib/meta';

/** Asks once for marketing cookies (the Meta Pixel). Nothing is loaded until the visitor accepts. */
export function ConsentBanner() {
  const consent = useConsent();
  if (!PIXEL_ID || consent !== null) return null;
  return (
    <div
      role="dialog"
      aria-label="Cookie preferences"
      className="fixed inset-x-4 bottom-4 z-50 mx-auto max-w-xl rounded-2xl border border-line bg-surface/95 p-4 text-sm shadow-2xl backdrop-blur sm:p-5"
    >
      <p className="text-muted">
        We&rsquo;d like to use Meta&rsquo;s advertising cookies to measure which ads bring people to Friday AI. They never
        see your interviews, answers or resume.{' '}
        <Link href="/privacy#cookies" className="text-fg underline underline-offset-2">
          Privacy policy
        </Link>
      </p>
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <button type="button" className="btn btn-ghost" onClick={() => saveConsent('denied')}>
          Decline
        </button>
        <button type="button" className="btn btn-primary" onClick={() => saveConsent('granted')}>
          Accept
        </button>
      </div>
    </div>
  );
}

/** Lets a visitor change their answer later (privacy policy). */
export function CookieSettingsButton() {
  const consent = useConsent();
  if (!PIXEL_ID) return null;
  return (
    <button type="button" className="font-medium text-brand hover:underline" onClick={() => saveConsent(null)}>
      {consent === 'granted' ? 'Withdraw consent or change cookie settings' : 'Change cookie settings'}
    </button>
  );
}
