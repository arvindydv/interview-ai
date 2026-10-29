import { createHash } from 'node:crypto';
import type { FastifyBaseLogger } from 'fastify';
import { purchaseEventId } from '@parakeet/shared';
import { env } from '../env.js';
import { sql } from './db.js';

// Meta Conversions API (https://developers.facebook.com/docs/marketing-api/conversions-api): reports
// verified purchases to the website's Meta Pixel from the server, where ad blockers can't drop them.
// The browser pixel reports the same purchase with the same event id; Meta keeps one of the two.
//
// Only what Meta needs to match the event to an ad click is sent: a hash of our user id, the
// buyer's IP, user agent and the pixel's _fbp/_fbc cookies, and the order value. Never their email,
// name or anything from their interviews. The access token is a secret: it goes in the request
// body (not the URL, which proxies log) and never into logs or errors.

const GRAPH_URL = 'https://graph.facebook.com/v23.0';

export const metaCapiConfigured = () => Boolean(env.META_PIXEL_ID && env.META_CAPI_ACCESS_TOKEN);

export class MetaCapiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export interface MetaServerEvent {
  event_name: 'Purchase';
  event_time: number;
  event_id: string;
  action_source: 'website';
  event_source_url: string;
  user_data: {
    external_id: string[];
    client_ip_address?: string;
    client_user_agent?: string;
    fbp?: string;
    fbc?: string;
  };
  custom_data: { currency: string; value: number; order_id: string; content_ids: string[]; content_type: 'product' };
}

export interface PaidOrder {
  orderId: string;
  userId: string;
  product: string;
  /** paise */
  amount: number;
  currency: string;
  paidAt: Date;
  fbp: string | null;
  fbc: string | null;
  clientIp: string | null;
  userAgent: string | null;
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/** The Purchase event for a paid order. `value` is in rupees, as Meta expects (not paise). */
export function purchaseEvent(o: PaidOrder, sourceUrl: string): MetaServerEvent {
  return {
    event_name: 'Purchase',
    event_time: Math.floor(o.paidAt.getTime() / 1000),
    event_id: purchaseEventId(o.orderId),
    action_source: 'website',
    event_source_url: sourceUrl,
    user_data: {
      external_id: [sha256(o.userId)],
      ...(o.clientIp ? { client_ip_address: o.clientIp } : {}),
      ...(o.userAgent ? { client_user_agent: o.userAgent } : {}),
      ...(o.fbp ? { fbp: o.fbp } : {}),
      ...(o.fbc ? { fbc: o.fbc } : {}),
    },
    custom_data: {
      currency: o.currency,
      value: o.amount / 100,
      order_id: o.orderId,
      content_ids: [o.product],
      content_type: 'product',
    },
  };
}

/** Removes the token from anything that might end up in a log, in case Meta ever echoes it. */
const redact = (s: string) => (env.META_CAPI_ACCESS_TOKEN ? s.replaceAll(env.META_CAPI_ACCESS_TOKEN, '[redacted]') : s);

export async function sendEvents(events: MetaServerEvent[]): Promise<{ events_received?: number }> {
  let res: Response;
  try {
    res = await fetch(`${GRAPH_URL}/${env.META_PIXEL_ID}/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        data: events,
        access_token: env.META_CAPI_ACCESS_TOKEN,
        ...(env.META_CAPI_TEST_EVENT_CODE ? { test_event_code: env.META_CAPI_TEST_EVENT_CODE } : {}),
      }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    throw new MetaCapiError(redact(`Meta request failed: ${(err as Error).message}`), 0);
  }
  const json = (await res.json().catch(() => ({}))) as { error?: { message?: string }; events_received?: number };
  if (!res.ok) throw new MetaCapiError(redact(json.error?.message ?? `Meta HTTP ${res.status}`), res.status);
  return json;
}

/**
 * Reports a paid order to Meta once. Both the checkout callback and the (repeated) webhook deliveries
 * call this; claiming the row first means only one of them sends. If sending fails the claim is
 * released, so the next report of the same payment tries again. Never throws: tracking must not
 * break payments.
 */
export async function reportPurchase(orderId: string, log: FastifyBaseLogger) {
  if (!metaCapiConfigured()) return;
  try {
    const [row] = await sql<
      {
        user_id: string; product: string; amount: number; currency: string; paid_at: Date;
        meta_fbp: string | null; meta_fbc: string | null; meta_client_ip: string | null; meta_user_agent: string | null;
      }[]
    >`
      update public.payments set meta_purchase = 'sending'
      where razorpay_order_id = ${orderId} and status = 'paid' and meta_consent and meta_purchase is null
      returning user_id, product, amount, currency, paid_at, meta_fbp, meta_fbc, meta_client_ip, meta_user_agent`;
    if (!row) return; // no consent, not paid, or already reported
    const event = purchaseEvent(
      {
        orderId,
        userId: row.user_id,
        product: row.product,
        amount: row.amount,
        currency: row.currency,
        paidAt: row.paid_at,
        fbp: row.meta_fbp,
        fbc: row.meta_fbc,
        clientIp: row.meta_client_ip,
        userAgent: row.meta_user_agent,
      },
      `${env.APP_URL}/billing`,
    );
    try {
      await sendEvents([event]);
    } catch (err) {
      await sql`update public.payments set meta_purchase = null where razorpay_order_id = ${orderId} and meta_purchase = 'sending'`;
      const { message, status } = err instanceof MetaCapiError ? err : { message: redact(String(err)), status: 0 };
      log.warn({ orderId, status, message }, 'meta purchase event not sent');
      return;
    }
    await sql`
      update public.payments
      set meta_purchase = 'sent', meta_fbp = null, meta_fbc = null, meta_client_ip = null, meta_user_agent = null
      where razorpay_order_id = ${orderId}`;
    log.info({ orderId, eventId: event.event_id }, 'meta purchase event sent');
  } catch (err) {
    log.error({ orderId, message: redact((err as Error).message) }, 'meta purchase report failed');
  }
}
