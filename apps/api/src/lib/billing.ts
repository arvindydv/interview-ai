import { productById, type Payment, type PaymentStatus, type Product, type ProductId } from '@parakeet/shared';
import { sql } from './db.js';

// Payment bookkeeping. The checkout callback (POST /v1/billing/verify) and the Razorpay webhook both
// report the same payment, in either order and possibly more than once (webhooks are retried), so
// every transition is conditional on the current status and grants or takes back exactly once.
// Row locks make concurrent reports of the same payment safe: the second waits, re-checks the
// status and finds nothing to do.

/** An unpaid order for the same product is handed out again for this long instead of creating a new one. */
const REUSE_ORDER_MINUTES = 15;
/** New orders a user may open per hour; well above any real checkout, it stops scripted abuse. */
export const MAX_ORDERS_PER_HOUR = 20;

export type FulfilResult =
  /** Marked paid and granted now. */
  | 'granted'
  /** This payment was already applied (or refunded). */
  | 'already_applied'
  /** The order was already paid by a different payment: the customer paid twice and needs a refund. */
  | 'duplicate_payment'
  /** Amount or currency don't match the order. Never granted. */
  | 'mismatch'
  /** Not one of our orders (e.g. another integration on the same Razorpay account). */
  | 'unknown_order';

/**
 * Marks an order paid and grants what was bought: minutes are added to the metered allowance; a plan
 * starts now, or extends one that is still running. `amount` is in paise and must match the order.
 */
export async function fulfilOrder(orderId: string, paymentId: string, amount: number, currency: string): Promise<FulfilResult> {
  return sql.begin(async (tx) => {
    const [p] = await tx<{ id: string; user_id: string; product: string }[]>`
      update public.payments set status = 'paid', razorpay_payment_id = ${paymentId}, paid_at = now()
      where razorpay_order_id = ${orderId} and status in ('created', 'failed')
        and amount = ${amount} and currency = ${currency}
      returning id, user_id, product`;
    if (!p) {
      const [row] = await tx<{ status: PaymentStatus; razorpay_payment_id: string | null }[]>`
        select status, razorpay_payment_id from public.payments where razorpay_order_id = ${orderId}`;
      if (!row) return 'unknown_order';
      if (row.status === 'paid' || row.status === 'refunded') {
        return row.razorpay_payment_id === paymentId ? 'already_applied' : 'duplicate_payment';
      }
      return 'mismatch';
    }
    const product = productById(p.product);
    if (!product) throw new Error(`payment ${p.id} has unknown product ${p.product}`);
    if (product.kind === 'minutes') {
      const seconds = product.minutes * 60;
      await tx`update public.users set trial_seconds = trial_seconds + ${seconds} where id = ${p.user_id}`;
      await tx`update public.payments set granted_seconds = ${seconds} where id = ${p.id}`;
    } else if (product.kind === 'jobs_plan') {
      // Friday Jobs plans: the bought tier from now, extending the days left on the current one.
      await tx`
        update public.users set
          jobs_plan = ${product.plan},
          jobs_plan_expires_at = greatest(now(), coalesce(jobs_plan_expires_at, now())) + make_interval(days => ${product.days})
        where id = ${p.user_id}`;
      await tx`update public.payments set granted_days = ${product.days} where id = ${p.id}`;
    } else {
      // Extends a running plan (paid days are never lost). A running yearly plan keeps its name when
      // monthly time is added to it; both are unlimited.
      await tx`
        update public.users set
          plan = case when public.current_plan(plan, plan_expires_at) = 'yearly' then 'yearly' else ${product.plan} end,
          plan_expires_at = greatest(now(), coalesce(plan_expires_at, now())) + make_interval(days => ${product.days})
        where id = ${p.user_id}`;
      await tx`update public.payments set granted_days = ${product.days} where id = ${p.id}`;
    }
    return 'granted';
  });
}

/** Records a failed attempt. Razorpay lets the user retry the same order, so a later success still counts. */
export async function markOrderFailed(orderId: string) {
  await sql`update public.payments set status = 'failed' where razorpay_order_id = ${orderId} and status = 'created'`;
}

/**
 * A payment was refunded in full: takes back what it granted. Minutes already used are not clawed
 * back (the balance never drops below what was used); a plan is shortened by the days it added.
 * A refund that arrives before the payment was applied marks the order refunded, so a late
 * (retried) capture event can't grant it afterwards. Returns true if a grant was taken back.
 */
export async function revokeRefunded(paymentId: string, orderId: string | null): Promise<boolean> {
  return sql.begin(async (tx) => {
    const [p] = await tx<{ user_id: string; granted_seconds: number; granted_days: number; was_paid: boolean; product: string }[]>`
      with target as (
        select id, status from public.payments
        where (razorpay_payment_id = ${paymentId} and status = 'paid')
           or (razorpay_order_id = ${orderId} and status in ('created', 'failed'))
        for update
      )
      update public.payments p
      set status = 'refunded', refunded_at = now(), razorpay_payment_id = ${paymentId}
      from target t where p.id = t.id
      returning p.user_id, p.granted_seconds, p.granted_days, t.status = 'paid' as was_paid, p.product`;
    if (!p?.was_paid) return false;
    if (p.granted_seconds > 0) {
      await tx`
        update public.users set trial_seconds = greatest(trial_seconds - ${p.granted_seconds}, trial_used_seconds)
        where id = ${p.user_id}`;
    }
    if (p.granted_days > 0 && p.product.startsWith('jobs_')) {
      await tx`
        update public.users set jobs_plan_expires_at = jobs_plan_expires_at - make_interval(days => ${p.granted_days})
        where id = ${p.user_id} and jobs_plan_expires_at is not null`;
    } else if (p.granted_days > 0) {
      await tx`
        update public.users set plan_expires_at = plan_expires_at - make_interval(days => ${p.granted_days})
        where id = ${p.user_id} and plan_expires_at is not null`;
    }
    return true;
  });
}

export type OpenOrder = { orderId: string; amount: number; currency: string };

/**
 * A recent unpaid order for this product (so repeated clicks on Buy reuse one order), or the number
 * of orders opened in the last hour when there is none.
 */
export async function reusableOrder(userId: string, product: Product): Promise<OpenOrder | { recent: number }> {
  const [row] = await sql<{ razorpay_order_id: string | null; amount: number; currency: string; recent: number }[]>`
    select o.razorpay_order_id, o.amount, o.currency,
      (select count(*)::int from public.payments r
       where r.user_id = ${userId} and r.created_at > now() - interval '1 hour') as recent
    from (select 1) one
    left join lateral (
      select razorpay_order_id, amount, currency from public.payments
      where user_id = ${userId} and product = ${product.id} and amount = ${product.amount}
        and status in ('created', 'failed')
        and created_at > now() - make_interval(mins => ${REUSE_ORDER_MINUTES})
      order by created_at desc limit 1
    ) o on true`;
  return row.razorpay_order_id
    ? { orderId: row.razorpay_order_id, amount: row.amount, currency: row.currency }
    : { recent: row.recent };
}

/** The user's payments, newest first. Orders that were opened but never paid are left out. */
export async function listPayments(userId: string, limit = 50): Promise<Payment[]> {
  const rows = await sql<
    {
      id: string; product: string; amount: number; currency: string; status: PaymentStatus;
      razorpay_payment_id: string | null; created_at: Date; paid_at: Date | null;
    }[]
  >`
    select id, product, amount, currency, status, razorpay_payment_id, created_at, paid_at
    from public.payments
    where user_id = ${userId} and status <> 'created'
    order by created_at desc
    limit ${limit}`;
  return rows.map((r) => ({
    id: r.id,
    productId: r.product as ProductId,
    amount: r.amount,
    currency: r.currency,
    status: r.status,
    paymentId: r.razorpay_payment_id,
    createdAt: r.created_at.toISOString(),
    paidAt: r.paid_at?.toISOString() ?? null,
  }));
}
