import { randomUUID } from 'node:crypto';
import type { FastifyBaseLogger, FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { MAX_MINUTES, MIN_MINUTES, isProductId, productById, type BillingOverview, type CheckoutOrder } from '@parakeet/shared';
import { requireAuth } from '../lib/auth.js';
import {
  MAX_ORDERS_PER_HOUR, fulfilOrder, listPayments, markOrderFailed, reusableOrder, revokeRefunded, type FulfilResult,
} from '../lib/billing.js';
import { sql } from '../lib/db.js';
import {
  RazorpayError, capturePayment, checkoutSignatureValid, createOrder, fetchPayment, razorpayConfigured,
  webhookSignatureValid, type RazorpayPayment,
} from '../lib/razorpay.js';
import { TRIAL_PLAN } from '../lib/trial.js';
import { env } from '../env.js';

// Checkout (spec: pricing page plans). Razorpay Standard Checkout with one-time orders:
//   1. POST /v1/billing/orders   creates a Razorpay order for a product and records it as 'created'.
//   2. The browser opens Checkout with that order; on success Razorpay hands it a signed payment id.
//   3. POST /v1/billing/verify   checks the signature and the payment, then grants what was bought.
// The webhook grants the same payment if the browser never gets to step 3 (closed tab, lost network).

const CURRENCY = 'INR';
const DISABLED = { error: 'payments_disabled', message: 'Payments are not available right now. Please try again later.' };

const orderBody = z.object({
  productId: z.string().refine(isProductId, `Choose between ${MIN_MINUTES} and ${MAX_MINUTES} minutes, or a plan`),
});
const verifyBody = z.object({
  razorpay_order_id: z.string().regex(/^order_\w{1,40}$/),
  razorpay_payment_id: z.string().regex(/^pay_\w{1,40}$/),
  razorpay_signature: z.string().regex(/^[0-9a-f]{64}$/i),
});

async function overview(userId: string): Promise<BillingOverview> {
  const [[row], payments] = await Promise.all([
    sql<{ plan: string; plan_expires_at: Date | null; trial_seconds: number; trial_used_seconds: number }[]>`
      select public.current_plan(plan, plan_expires_at) as plan,
        case when plan_expires_at > now() then plan_expires_at end as plan_expires_at,
        trial_seconds, trial_used_seconds
      from public.users where id = ${userId}`,
    listPayments(userId),
  ]);
  const plan = row?.plan ?? TRIAL_PLAN;
  return {
    enabled: razorpayConfigured(),
    plan,
    planExpiresAt: row?.plan_expires_at?.toISOString() ?? null,
    minutes: { totalSeconds: row?.trial_seconds ?? 0, usedSeconds: row?.trial_used_seconds ?? 0 },
    payments,
  };
}

/** Captures the payment if it is only authorized (automatic capture off). Returns its final state. */
async function ensureCaptured(payment: RazorpayPayment): Promise<RazorpayPayment> {
  if (payment.status !== 'authorized') return payment;
  try {
    return await capturePayment(payment);
  } catch (err) {
    // Captured meanwhile by Razorpay's auto-capture or by the webhook: read the current state.
    if (err instanceof RazorpayError && err.status === 400) return fetchPayment(payment.id);
    throw err;
  }
}

/** Logs the outcomes that need a person: money taken that we didn't (or couldn't) apply. */
function logFulfil(log: FastifyBaseLogger, result: FulfilResult, p: RazorpayPayment) {
  const ctx = { orderId: p.order_id, paymentId: p.id, amount: p.amount, currency: p.currency };
  if (result === 'granted') log.info(ctx, 'payment fulfilled');
  else if (result === 'duplicate_payment') log.error(ctx, 'ACTION NEEDED: second payment for an already paid order, refund it');
  else if (result === 'mismatch') log.error(ctx, 'ACTION NEEDED: captured payment does not match its order, not applied');
}

function providerError(reply: FastifyReply, err: unknown) {
  if (!(err instanceof RazorpayError)) throw err;
  reply.log.error({ err }, 'razorpay request failed');
  return reply.code(502).send({ error: 'payment_provider', message: 'Could not reach the payment provider. Please try again.' });
}

export default async function billingRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  app.get('/v1/billing', async (req): Promise<BillingOverview> => overview(req.user.id));

  app.post('/v1/billing/orders', async (req, reply) => {
    if (!razorpayConfigured()) return reply.code(503).send(DISABLED);
    const body = orderBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'bad_request', message: body.error.issues[0]?.message ?? 'Invalid order' });
    const product = productById(body.data.productId)!;
    const { id: userId, email, provider } = req.user;

    // Payments reference the app-side user, which /v1/me normally creates first.
    await sql`
      insert into public.users (id, email, auth_provider) values (${userId}, ${email}, ${provider})
      on conflict (id) do nothing`;

    let order = await reusableOrder(userId, product);
    if ('recent' in order) {
      if (order.recent >= MAX_ORDERS_PER_HOUR) {
        return reply.code(429).send({ error: 'too_many_orders', message: 'Too many checkout attempts. Please try again in a while.' });
      }
      const id = randomUUID();
      try {
        const created = await createOrder({
          amount: product.amount,
          currency: CURRENCY,
          receipt: id.replaceAll('-', ''),
          notes: { user_id: userId, product: product.id },
        });
        order = { orderId: created.id, amount: created.amount, currency: created.currency };
      } catch (err) {
        return providerError(reply, err);
      }
      await sql`
        insert into public.payments (id, user_id, product, amount, currency, razorpay_order_id)
        values (${id}, ${userId}, ${product.id}, ${order.amount}, ${order.currency}, ${order.orderId})`;
    }

    const result: CheckoutOrder = {
      orderId: order.orderId,
      keyId: env.RAZORPAY_KEY_ID!,
      amount: order.amount,
      currency: order.currency,
      productId: product.id,
      description: product.name,
      email,
    };
    return result;
  });

  app.post('/v1/billing/verify', async (req, reply): Promise<BillingOverview> => {
    if (!razorpayConfigured()) return reply.code(503).send(DISABLED);
    const body = verifyBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'bad_request', message: 'Invalid payment confirmation' });
    const { razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: signature } = body.data;

    if (!checkoutSignatureValid(orderId, paymentId, signature)) {
      req.log.warn({ orderId, paymentId }, 'checkout signature mismatch');
      return reply.code(400).send({ error: 'bad_signature', message: 'We could not confirm this payment.' });
    }
    const [order] = await sql<{ user_id: string; status: string; amount: number; currency: string }[]>`
      select user_id, status, amount, currency from public.payments where razorpay_order_id = ${orderId}`;
    if (!order || order.user_id !== req.user.id) {
      return reply.code(404).send({ error: 'not_found', message: 'No such order' });
    }

    let payment;
    try {
      payment = await fetchPayment(paymentId);
      if (payment.order_id !== orderId) {
        return reply.code(400).send({ error: 'bad_payment', message: 'This payment is for a different order.' });
      }
      // Only capture what the order was for; anything else is left uncaptured (Razorpay refunds it).
      if (payment.amount !== order.amount || payment.currency !== order.currency) {
        logFulfil(req.log, 'mismatch', payment);
        return reply.code(409).send({ error: 'payment_mismatch', message: 'This payment does not match the order and was not applied.' });
      }
      payment = await ensureCaptured(payment);
    } catch (err) {
      return providerError(reply, err);
    }
    if (payment.status === 'refunded') return overview(req.user.id);
    if (payment.status === 'failed') {
      await markOrderFailed(orderId);
      return reply.code(402).send({
        error: 'payment_failed',
        message: 'The payment did not go through. If any amount was debited, your bank returns it within 5–7 working days.',
      });
    }
    if (payment.status !== 'captured') {
      // Still processing (e.g. some UPI and netbanking payments): the webhook grants it when it completes.
      return reply.code(202).send({
        error: 'payment_pending',
        message: 'Your payment is still processing. Your account updates as soon as it completes.',
      });
    }
    const result = await fulfilOrder(orderId, payment.id, payment.amount, payment.currency);
    logFulfil(req.log, result, payment);
    if (result === 'mismatch' || result === 'duplicate_payment' || result === 'unknown_order') {
      return reply.code(409).send({
        error: 'payment_not_applied',
        message: `We received your payment (${payment.id}) but could not apply it automatically. Our team has been alerted; contact support if it isn't sorted within a day.`,
      });
    }
    return overview(req.user.id);
  });
}

interface WebhookEvent {
  event: string;
  payload: { payment?: { entity: RazorpayPayment } };
}

/**
 * Razorpay webhook (Dashboard → Webhooks, URL https://api.<domain>/v1/billing/webhook). Subscribe to
 * payment.authorized, payment.captured, payment.failed, order.paid and refund.processed. Replies
 * 2xx once handled; errors return 5xx so Razorpay retries.
 */
export async function billingWebhookRoutes(app: FastifyInstance) {
  // The signature covers the exact bytes Razorpay sent, so keep the raw body (this plugin only).
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, body, done) => done(null, body));

  app.post('/v1/billing/webhook', async (req, reply) => {
    if (!env.RAZORPAY_WEBHOOK_SECRET || !razorpayConfigured()) return reply.code(503).send(DISABLED);
    const signature = req.headers['x-razorpay-signature'];
    const raw = req.body;
    if (typeof signature !== 'string' || !Buffer.isBuffer(raw) || !webhookSignatureValid(raw, signature)) {
      return reply.code(400).send({ error: 'bad_signature' });
    }
    const event = JSON.parse(raw.toString('utf8')) as WebhookEvent;
    const payment = event.payload?.payment?.entity;
    if (!payment?.id || !payment.order_id) return { ok: true }; // not an order payment of ours
    const log = req.log.child({ event: event.event });

    switch (event.event) {
      case 'payment.authorized': {
        // Only matters when automatic capture is off: capture payments that match one of our open orders.
        const [order] = await sql`
          select 1 from public.payments
          where razorpay_order_id = ${payment.order_id} and status in ('created', 'failed')
            and amount = ${payment.amount} and currency = ${payment.currency}`;
        if (order) await ensureCaptured(payment); // payment.captured follows and grants it
        break;
      }
      case 'payment.captured':
      case 'order.paid':
        if (payment.status === 'captured') {
          logFulfil(log, await fulfilOrder(payment.order_id, payment.id, payment.amount, payment.currency), payment);
        }
        break;
      case 'payment.failed':
        await markOrderFailed(payment.order_id);
        break;
      case 'refund.processed':
      case 'payment.refunded':
        // Partial refunds leave the payment 'captured' and keep what it granted.
        if (payment.status === 'refunded' && (await revokeRefunded(payment.id, payment.order_id))) {
          log.info({ orderId: payment.order_id, paymentId: payment.id }, 'payment refunded, grant revoked');
        }
        break;
    }
    return { ok: true };
  });
}
