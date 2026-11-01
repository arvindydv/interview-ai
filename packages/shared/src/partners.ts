// Referral partners (influencers): a partner shares /r/<code>; people who sign up through it are
// theirs, and the partner earns a share of what those people pay. See apps/api lib/partners.ts.

import type { DayPoint } from './admin.js';

/** How long a followed link is remembered in the browser before sign-up. */
export const REFERRAL_COOKIE_DAYS = 30;
/** The website cookie holding the referral code until the visitor signs in. */
export const REFERRAL_COOKIE = 'fa_ref';
/** Only accounts this new can be attributed to a partner (and only before their first payment). */
export const REFERRAL_ACCOUNT_MAX_AGE_DAYS = 7;

/** Partner codes: lowercase letters, digits, - and _, 3–32 characters, starting with a letter or digit. */
export const PARTNER_CODE_RE = /^[a-z0-9][a-z0-9_-]{2,31}$/;

/** " Riya_Fit " → "riya_fit". Null if it can't be a code (e.g. "riya.fit"). */
export function normalizePartnerCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const code = raw.trim().toLowerCase();
  return PARTNER_CODE_RE.test(code) ? code : null;
}

/** Commission on a payment, in paise, rounded down. `bps` is basis points (2000 = 20%). */
export const commissionFor = (amount: number, bps: number) => Math.floor((amount * bps) / 10_000);

/** 2000 → 20, 1250 → 12.5 */
export const bpsToPercent = (bps: number) => bps / 100;
/** 12.5 → 1250 */
export const percentToBps = (percent: number) => Math.round(percent * 100);

/** The path a partner shares; prefix the website's origin. */
export const partnerPath = (code: string) => `/r/${code}`;

/** POST /v1/referrals/click: the link was valid and is active. */
export interface ReferralClickResult {
  name: string;
}

/** POST /v1/referrals/claim */
export interface ReferralClaimResult {
  /** True if this account now belongs to the partner (or already did). */
  attributed: boolean;
  /** Why not, when it wasn't. */
  reason?: 'unknown_code' | 'own_code' | 'already_referred' | 'not_new';
}

export interface PartnerTotals {
  clicks: number;
  signups: number;
  /** Referred users with at least one payment that counts (paid, not refunded). */
  payingUsers: number;
  /** Paise: what referred users paid (refunds excluded). */
  revenue: number;
  /** Paise */
  earned: number;
  /** Paise */
  paidOut: number;
  /** Paise: earned minus paid out. Negative if a refund came after a payout. */
  balance: number;
}

export interface PartnerReferral {
  /** Shown to the partner as an anonymous label ("User 12"); admins also get the email. */
  label: string;
  email?: string;
  userId?: string;
  joinedAt: string;
  /** Paise */
  paid: number;
  /** Paise */
  commission: number;
}

export interface PartnerEarning {
  /** Paise */
  amount: number;
  /** Paise */
  commission: number;
  status: 'paid' | 'refunded';
  paidAt: string;
  /** Same label as in `referrals`. */
  label: string;
}

export interface PartnerPayout {
  id: string;
  /** Paise */
  amount: number;
  reference: string;
  note: string;
  paidAt: string;
}

export interface PartnerProfile {
  id: string;
  code: string;
  name: string;
  instagram: string;
  /** Percent of each payment. */
  commissionPercent: number;
  active: boolean;
  createdAt: string;
}

/** GET /v1/partner (the partner's own dashboard) and GET /admin/partners/:id. */
export interface PartnerDashboard {
  partner: PartnerProfile;
  totals: PartnerTotals;
  /** Last 30 UTC days. */
  series: { clicks: DayPoint[]; signups: DayPoint[]; earned: DayPoint[] };
  referrals: PartnerReferral[];
  earnings: PartnerEarning[];
  payouts: PartnerPayout[];
}

/** GET /admin/partners */
export interface AdminPartnerRow extends PartnerProfile {
  email: string;
  totals: PartnerTotals;
}

/** POST /admin/partners */
export interface CreatePartnerInput {
  /** Email of the partner's existing account. */
  email: string;
  code: string;
  name: string;
  instagram?: string;
  commissionPercent: number;
}

/** PATCH /admin/partners/:id */
export type UpdatePartnerInput = Partial<Pick<PartnerProfile, 'name' | 'instagram' | 'commissionPercent' | 'active'>>;

/** POST /admin/partners/:id/payouts */
export interface CreatePayoutInput {
  /** Paise */
  amount: number;
  reference?: string;
  note?: string;
}
