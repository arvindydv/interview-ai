import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../env.js';

// Minimal Razorpay REST client (https://razorpay.com/docs/api/): orders, payments and signatures.

const API = 'https://api.razorpay.com/v1';

export const razorpayConfigured = () => Boolean(env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET);

export class RazorpayError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function call<T>(method: 'GET' | 'POST', path: string, body?: object): Promise<T> {
  const auth = Buffer.from(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`).toString('base64');
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { authorization: `Basic ${auth}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  const json = (await res.json().catch(() => ({}))) as { error?: { description?: string } };
  if (!res.ok) throw new RazorpayError(json.error?.description ?? `Razorpay HTTP ${res.status}`, res.status);
  return json as T;
}

export interface RazorpayOrder {
  id: string;
  amount: number;
  currency: string;
  status: 'created' | 'attempted' | 'paid';
}

export type RazorpayPaymentStatus = 'created' | 'authorized' | 'captured' | 'refunded' | 'failed';

export interface RazorpayPayment {
  id: string;
  order_id: string | null;
  amount: number;
  currency: string;
  status: RazorpayPaymentStatus;
}

/** `receipt` is our own reference (max 40 chars); `notes` show up in the Razorpay dashboard. */
export const createOrder = (o: { amount: number; currency: string; receipt: string; notes: Record<string, string> }) =>
  call<RazorpayOrder>('POST', '/orders', o);

export const fetchPayment = (paymentId: string) =>
  call<RazorpayPayment>('GET', `/payments/${encodeURIComponent(paymentId)}`);

/** Captures an authorized payment (only needed when automatic capture is off for the account). */
export const capturePayment = (p: RazorpayPayment) =>
  call<RazorpayPayment>('POST', `/payments/${encodeURIComponent(p.id)}/capture`, { amount: p.amount, currency: p.currency });

function hmacMatches(secret: string, payload: string | Buffer, signature: string) {
  const expected = createHmac('sha256', secret).update(payload).digest();
  const given = Buffer.from(signature, 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** The signature Checkout returns on success: HMAC-SHA256 of "order_id|payment_id" with the key secret. */
export const checkoutSignatureValid = (orderId: string, paymentId: string, signature: string) =>
  hmacMatches(env.RAZORPAY_KEY_SECRET!, `${orderId}|${paymentId}`, signature);

/** X-Razorpay-Signature: HMAC-SHA256 of the raw request body with the webhook secret. */
export const webhookSignatureValid = (rawBody: Buffer, signature: string) =>
  hmacMatches(env.RAZORPAY_WEBHOOK_SECRET!, rawBody, signature);
