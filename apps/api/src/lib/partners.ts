import type { TransactionSql } from 'postgres';
import {
  REFERRAL_ACCOUNT_MAX_AGE_DAYS, bpsToPercent, type PartnerDashboard, type PartnerProfile, type PartnerTotals,
  type ReferralClaimResult,
} from '@parakeet/shared';
import { fillDays } from './series.js';
import { sql } from './db.js';
import { redis } from './redis.js';

// Referral partners (migration 20261102000000_partners.sql).
//   * A visit to /r/<code> on the website counts a click (once per visitor IP per hour) and leaves the
//     code in a cookie; after sign-in the website claims it for the account (claimReferral).
//   * Only new accounts that haven't paid yet can be claimed, once, and never by the partner themself.
//   * Each payment such an account makes earns the partner commission_bps of it, fixed when the
//     payment is applied (applyReferralCommission). A refund makes the payment stop counting.

/** A visitor's repeat visits to the same link within this window count as one click. */
const CLICK_DEDUPE_S = 3600;
/** Rows in the dashboard's lists. */
const LIST_LIMIT = 100;

/** Counts a link visit. Returns the partner's display name, or null for an unknown or inactive code. */
export async function recordClick(code: string, ip: string): Promise<string | null> {
  const [partner] = await sql<{ id: string; name: string }[]>`
    select id, name from public.partners where code = ${code} and active`;
  if (!partner) return null;
  const fresh = await redis.set(`partner:click:${partner.id}:${ip}`, '1', 'EX', CLICK_DEDUPE_S, 'NX');
  if (fresh) {
    await sql`
      insert into public.partner_clicks (partner_id, day, clicks)
      values (${partner.id}, (now() at time zone 'utc')::date, 1)
      on conflict (partner_id, day) do update set clicks = partner_clicks.clicks + 1`;
  }
  return partner.name;
}

/** Attributes the account to the partner behind `code`, if it is still eligible (see the top of this file). */
export async function claimReferral(userId: string, code: string): Promise<ReferralClaimResult> {
  const [row] = await sql<{ partner_id: string | null }[]>`
    update public.users u set referred_by = p.id, referred_at = now()
    from public.partners p
    where u.id = ${userId} and p.code = ${code} and p.active and p.user_id <> u.id
      and u.referred_by is null
      and u.created_at > now() - make_interval(days => ${REFERRAL_ACCOUNT_MAX_AGE_DAYS})
      and not exists (select 1 from public.payments pay where pay.user_id = u.id and pay.status in ('paid', 'refunded'))
    returning p.id as partner_id`;
  if (row) return { attributed: true };

  // Not attributed now: say why.
  const [state] = await sql<{ partner_id: string | null; partner_user: string | null; referred_by: string | null }[]>`
    select p.id as partner_id, p.user_id as partner_user, u.referred_by
    from (select 1) one
    left join public.partners p on p.code = ${code} and p.active
    left join public.users u on u.id = ${userId}`;
  if (!state?.partner_id) return { attributed: false, reason: 'unknown_code' };
  if (state.referred_by === state.partner_id) return { attributed: true };
  if (state.partner_user === userId) return { attributed: false, reason: 'own_code' };
  if (state.referred_by) return { attributed: false, reason: 'already_referred' };
  return { attributed: false, reason: 'not_new' };
}

/**
 * Inside the transaction that marks a payment paid: credits the payer's partner, if they have an
 * active one, with their current rate of it.
 */
export async function applyReferralCommission(tx: TransactionSql, paymentId: string) {
  await tx`
    update public.payments pay set
      referral_partner_id = p.id,
      referral_commission = (pay.amount::bigint * p.commission_bps / 10000)::int
    from public.users u join public.partners p on p.id = u.referred_by and p.active
    where pay.id = ${paymentId} and u.id = pay.user_id`;
}

/** The partner record behind an account, if it is one. */
export async function partnerIdForUser(userId: string): Promise<string | null> {
  const [row] = await sql<{ id: string }[]>`select id from public.partners where user_id = ${userId}`;
  return row?.id ?? null;
}

export interface PartnerRow {
  id: string;
  code: string;
  name: string;
  instagram: string;
  commission_bps: number;
  active: boolean;
  created_at: Date;
}

export const toPartnerProfile = (p: PartnerRow): PartnerProfile => ({
  id: p.id,
  code: p.code,
  name: p.name,
  instagram: p.instagram,
  commissionPercent: bpsToPercent(p.commission_bps),
  active: p.active,
  createdAt: p.created_at.toISOString(),
});

export interface TotalsRow {
  clicks: number;
  signups: number;
  paying_users: number;
  revenue: string;
  earned: string;
  paid_out: string;
}

/** Per-partner totals as columns, for a query over public.partners aliased `p`. */
export const TOTALS_COLUMNS = sql`
  (select coalesce(sum(c.clicks), 0)::int from public.partner_clicks c where c.partner_id = p.id) as clicks,
  (select count(*)::int from public.users u where u.referred_by = p.id) as signups,
  (select count(distinct pay.user_id)::int from public.payments pay
    where pay.referral_partner_id = p.id and pay.status = 'paid') as paying_users,
  (select coalesce(sum(pay.amount), 0) from public.payments pay
    where pay.referral_partner_id = p.id and pay.status = 'paid') as revenue,
  (select coalesce(sum(pay.referral_commission), 0) from public.payments pay
    where pay.referral_partner_id = p.id and pay.status = 'paid') as earned,
  (select coalesce(sum(o.amount), 0) from public.partner_payouts o where o.partner_id = p.id) as paid_out`;

// Sums come back from Postgres as strings (bigint); amounts in paise fit a JS number comfortably.
export const toTotals = (r: TotalsRow): PartnerTotals => ({
  clicks: r.clicks,
  signups: r.signups,
  payingUsers: r.paying_users,
  revenue: Number(r.revenue),
  earned: Number(r.earned),
  paidOut: Number(r.paid_out),
  balance: Number(r.earned) - Number(r.paid_out),
});

/**
 * Everything the partner dashboard shows. Referred people appear as "User <n>" (numbered in the
 * order they joined); `withEmails` adds their emails, for the admin console only.
 */
export async function partnerDashboard(partnerId: string, withEmails = false): Promise<PartnerDashboard | null> {
  const [[partner], clicks, signups, earnedByDay, referrals, earnings, payouts] = await Promise.all([
    sql<(PartnerRow & TotalsRow)[]>`
      select p.id, p.code, p.name, p.instagram, p.commission_bps, p.active, p.created_at, ${TOTALS_COLUMNS}
      from public.partners p where p.id = ${partnerId}`,
    sql<{ day: string; n: number }[]>`
      select to_char(day, 'YYYY-MM-DD') as day, clicks as n from public.partner_clicks
      where partner_id = ${partnerId} and day >= (now() at time zone 'utc')::date - 29`,
    sql<{ day: string; n: number }[]>`
      select to_char((referred_at at time zone 'utc')::date, 'YYYY-MM-DD') as day, count(*)::int as n
      from public.users
      where referred_by = ${partnerId}
        and referred_at >= (date_trunc('day', now() at time zone 'utc') - interval '29 days') at time zone 'utc'
      group by 1`,
    sql<{ day: string; n: number }[]>`
      select to_char((paid_at at time zone 'utc')::date, 'YYYY-MM-DD') as day, sum(referral_commission)::int as n
      from public.payments
      where referral_partner_id = ${partnerId} and status = 'paid'
        and paid_at >= (date_trunc('day', now() at time zone 'utc') - interval '29 days') at time zone 'utc'
      group by 1`,
    sql<{ n: number; user_id: string; email: string; referred_at: Date; paid: string; commission: string }[]>`
      with numbered as (
        select id, email, referred_at, row_number() over (order by referred_at, id)::int as n
        from public.users where referred_by = ${partnerId}
      )
      select r.n, r.id as user_id, r.email, r.referred_at,
        coalesce(sum(pay.amount), 0) as paid, coalesce(sum(pay.referral_commission), 0) as commission
      from numbered r
      left join public.payments pay on pay.user_id = r.id and pay.referral_partner_id = ${partnerId} and pay.status = 'paid'
      group by r.n, r.id, r.email, r.referred_at
      order by r.referred_at desc
      limit ${LIST_LIMIT}`,
    sql<{ n: number | null; amount: number; commission: number; status: 'paid' | 'refunded'; paid_at: Date }[]>`
      with numbered as (
        select id, row_number() over (order by referred_at, id)::int as n
        from public.users where referred_by = ${partnerId}
      )
      select r.n, pay.amount, pay.referral_commission as commission, pay.status, pay.paid_at
      from public.payments pay left join numbered r on r.id = pay.user_id
      where pay.referral_partner_id = ${partnerId} and pay.status in ('paid', 'refunded') and pay.paid_at is not null
      order by pay.paid_at desc
      limit ${LIST_LIMIT}`,
    sql<{ id: string; amount: number; reference: string; note: string; paid_at: Date }[]>`
      select id, amount, reference, note, paid_at from public.partner_payouts
      where partner_id = ${partnerId} order by paid_at desc`,
  ]);
  if (!partner) return null;

  // A user whose account was deleted after paying no longer has a number.
  const label = (n: number | null) => (n ? `User ${n}` : 'Deleted account');
  return {
    partner: toPartnerProfile(partner),
    totals: toTotals(partner),
    series: { clicks: fillDays(clicks), signups: fillDays(signups), earned: fillDays(earnedByDay) },
    referrals: referrals.map((r) => ({
      label: label(r.n),
      ...(withEmails ? { email: r.email, userId: r.user_id } : {}),
      joinedAt: r.referred_at.toISOString(),
      paid: Number(r.paid),
      commission: Number(r.commission),
    })),
    earnings: earnings.map((e) => ({
      amount: e.amount,
      commission: e.commission,
      status: e.status,
      paidAt: e.paid_at.toISOString(),
      label: label(e.n),
    })),
    payouts: payouts.map((o) => ({
      id: o.id, amount: o.amount, reference: o.reference, note: o.note, paidAt: o.paid_at.toISOString(),
    })),
  };
}
