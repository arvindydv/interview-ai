// What can be bought, and the REST shapes for checkout (Razorpay Standard Checkout, one-time payments).
// The API charges exactly these amounts; the pricing and billing pages display them.

import type { TrialBalance } from './api.js';
import { JOBS_PLANS, JOBS_PLAN_DAYS, isJobsPlanId, type JobsPlanId } from './jobsPlans.js';

/** Live session price for minute packs, in rupees. */
export const PRICE_PER_MINUTE = 10;
/** Free live session time, once per person (granted by the API's lib/freeTrial.ts when the desktop app first signs in). */
export const FREE_MINUTES = 10;

/** Minutes someone can buy in one payment, when they pick their own amount. */
export const MIN_MINUTES = 10;
export const MAX_MINUTES = 1000;
/** Amounts offered as one-click choices on the billing page. */
export const MINUTE_PRESETS = [30, 60, 120] as const;

/**
 * `minutes_<n>` buys n minutes (MIN_MINUTES..MAX_MINUTES); `monthly` and `yearly` are plans;
 * `jobs_<plan>` is a Friday Jobs plan (jobsPlans.ts).
 */
export type ProductId = 'monthly' | 'yearly' | `minutes_${number}` | `jobs_${JobsPlanId}`;

export type Product =
  | { id: ProductId; kind: 'minutes'; name: string; /** paise */ amount: number; minutes: number }
  | { id: ProductId; kind: 'plan'; name: string; /** paise */ amount: number; plan: 'monthly' | 'yearly'; days: number }
  | { id: ProductId; kind: 'jobs_plan'; name: string; /** paise */ amount: number; plan: JobsPlanId; days: number };

/** A Friday Jobs plan for JOBS_PLAN_DAYS days. */
export const jobsPlanProduct = (plan: JobsPlanId): Product => ({
  id: `jobs_${plan}`,
  kind: 'jobs_plan',
  name: `Friday Jobs ${JOBS_PLANS[plan].name}`,
  amount: JOBS_PLANS[plan].amount,
  plan,
  days: JOBS_PLAN_DAYS,
});

export const isValidMinutes = (n: number) => Number.isInteger(n) && n >= MIN_MINUTES && n <= MAX_MINUTES;

/** A minute pack for `minutes` minutes, priced at PRICE_PER_MINUTE. Check isValidMinutes first. */
export const minutesProduct = (minutes: number): Product => ({
  id: `minutes_${minutes}`,
  kind: 'minutes',
  name: `${minutes} minutes`,
  amount: minutes * PRICE_PER_MINUTE * 100,
  minutes,
});

// Plans are a single payment for a fixed period and don't renew (see the refund policy). Buying again
// while one is active extends it.
export const PLANS = {
  monthly: { id: 'monthly', kind: 'plan', name: 'Monthly plan', amount: 2999_00, plan: 'monthly', days: 30 },
  yearly: { id: 'yearly', kind: 'plan', name: 'Yearly plan', amount: 19999_00, plan: 'yearly', days: 365 },
} as const satisfies Record<string, Product>;

/** The product an id names, or null if it names none (unknown id, or minutes out of range). */
export function productById(id: unknown): Product | null {
  if (id === 'monthly' || id === 'yearly') return PLANS[id];
  if (typeof id === 'string' && id.startsWith('jobs_') && isJobsPlanId(id.slice(5))) return jobsPlanProduct(id.slice(5) as JobsPlanId);
  const m = typeof id === 'string' ? /^minutes_([1-9]\d{0,5})$/.exec(id) : null;
  return m && isValidMinutes(Number(m[1])) ? minutesProduct(Number(m[1])) : null;
}

export const isProductId = (id: unknown): id is ProductId => productById(id) !== null;

/** 299900 → "₹2,999" */
export const formatInr = (paise: number) =>
  `₹${(paise / 100).toLocaleString('en-IN', { maximumFractionDigits: paise % 100 ? 2 : 0, minimumFractionDigits: paise % 100 ? 2 : 0 })}`;

/** "free" → "Free" */
export const planLabel = (plan: string) => plan.charAt(0).toUpperCase() + plan.slice(1).replace(/[_-]/g, ' ');

/** POST /v1/billing/orders */
export interface CreateOrderInput {
  productId: ProductId;
  /**
   * Sent only when the visitor allowed marketing cookies: lets the API report the purchase to Meta's
   * Conversions API once it is paid. `fbp`/`fbc` are the Meta Pixel's _fbp/_fbc cookies.
   */
  tracking?: { consent: true; fbp?: string; fbc?: string };
}

/**
 * Meta event id of the Purchase for an order. The browser pixel and the API's Conversions API event
 * both use it, so Meta counts the purchase once.
 */
export const purchaseEventId = (orderId: string) => `purchase.${orderId}`;

/** Everything the browser needs to open Razorpay Checkout for an order. */
export interface CheckoutOrder {
  orderId: string;
  keyId: string;
  /** paise */
  amount: number;
  currency: string;
  productId: ProductId;
  description: string;
  email: string;
}

/** POST /v1/billing/verify: the fields Razorpay Checkout hands to its success handler. */
export interface VerifyPaymentInput {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}

export type PaymentStatus = 'created' | 'paid' | 'failed' | 'refunded';

export interface Payment {
  id: string;
  productId: ProductId;
  /** paise */
  amount: number;
  currency: string;
  status: PaymentStatus;
  /** Razorpay payment id (pay_…), once paid. */
  paymentId: string | null;
  createdAt: string;
  paidAt: string | null;
}

/** GET /v1/billing */
export interface BillingOverview {
  /** False until Razorpay keys are configured on the API. */
  enabled: boolean;
  plan: string;
  /** When a monthly/yearly plan ends. Null for the free plan and plans without an end date. */
  planExpiresAt: string | null;
  /** Minutes balance (free trial plus any minutes bought). Only spent while the plan is 'free'. */
  minutes: TrialBalance;
  payments: Payment[];
}
