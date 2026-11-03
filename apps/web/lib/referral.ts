'use client';
import { REFERRAL_COOKIE, REFERRAL_COOKIE_DAYS, type Me, type ReferralClaimResult } from '@parakeet/shared';
import { ApiError, api } from './api';
import { readCookie } from './meta';

// Partner invite links (/r/<code>). The code waits in a first-party cookie until the visitor has an
// account, then the signed-in app claims it once (the API decides whether the account qualifies).

function writeCookie(value: string | null) {
  const secure = location.protocol === 'https:' ? '; Secure' : '';
  document.cookie =
    value === null
      ? `${REFERRAL_COOKIE}=; Max-Age=0; Path=/; SameSite=Lax${secure}`
      : `${REFERRAL_COOKIE}=${encodeURIComponent(value)}; Max-Age=${REFERRAL_COOKIE_DAYS * 86400}; Path=/; SameSite=Lax${secure}`;
}

/** First link wins: following a second partner's link doesn't replace the first. */
export function rememberReferral(code: string) {
  if (!readCookie(REFERRAL_COOKIE)) writeCookie(code);
}

let claiming: Promise<void> | null = null;

/**
 * Claims a remembered code for the signed-in account. Any answer settles it (attributed or not); on a
 * network or server error the code stays for the next page load.
 */
export function claimPendingReferral(): Promise<void> {
  const code = readCookie(REFERRAL_COOKIE);
  if (!code) return Promise.resolve();
  claiming ??= api<ReferralClaimResult>('/v1/referrals/claim', { method: 'POST', body: JSON.stringify({ code }) })
    .then(() => writeCookie(null))
    .catch((e) => {
      if (e instanceof ApiError && e.status === 400) writeCookie(null); // not a valid code
    })
    .finally(() => {
      claiming = null;
    });
  return claiming;
}

let partnerStatus: Promise<boolean> | null = null;

/** Whether the signed-in account is a partner (asked once per page load). */
export function isPartner(): Promise<boolean> {
  partnerStatus ??= api<Me>('/v1/me').then(
    (me) => me.partner,
    () => {
      partnerStatus = null;
      return false;
    },
  );
  return partnerStatus;
}
