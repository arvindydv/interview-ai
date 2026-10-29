import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

// lib/metaCapi.ts reads env (and so DATABASE_URL etc.) on import.
process.env.SUPABASE_URL ??= 'http://127.0.0.1:54321';
process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
process.env.REDIS_URL ??= 'redis://127.0.0.1:6380';
process.env.META_PIXEL_ID = '1583041433148120';
process.env.META_CAPI_ACCESS_TOKEN = 'EAAtest-secret-token';
process.env.APP_URL = 'https://friday-ai.in';
const { MetaCapiError, purchaseEvent, sendEvents } = await import('../src/lib/metaCapi.js');
const { purchaseEventId } = await import('@parakeet/shared');

const TOKEN = 'EAAtest-secret-token';

const order = {
  orderId: 'order_Abc123',
  userId: '6f1c1f9e-6a43-4c5e-9c55-0d1f5b3c2a10',
  product: 'monthly',
  amount: 2999_00,
  currency: 'INR',
  paidAt: new Date('2026-10-29T10:00:00Z'),
  fbp: 'fb.1.1761730000000.1234567890',
  fbc: 'fb.1.1761730000000.IwAR0abc',
  clientIp: '203.0.113.7',
  userAgent: 'Mozilla/5.0',
};

/** Replaces fetch for one call and records what was sent. */
function mockFetch(reply: { status: number; body: unknown } | Error) {
  const calls: { url: string; init: RequestInit }[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    if (reply instanceof Error) throw reply;
    return new Response(JSON.stringify(reply.body), { status: reply.status });
  }) as typeof fetch;
  return { calls, restore: () => (globalThis.fetch = original) };
}

test('a purchase is reported in rupees, in INR, under the id the browser pixel uses', () => {
  const e = purchaseEvent(order, 'https://friday-ai.in/billing');
  assert.equal(e.event_name, 'Purchase');
  assert.equal(e.event_id, 'purchase.order_Abc123');
  assert.equal(e.event_id, purchaseEventId(order.orderId));
  assert.equal(e.event_time, Date.parse('2026-10-29T10:00:00Z') / 1000);
  assert.equal(e.action_source, 'website');
  assert.deepEqual(e.custom_data, {
    currency: 'INR', value: 2999, order_id: 'order_Abc123', content_ids: ['monthly'], content_type: 'product',
  });
});

test('only matching keys are sent about the buyer: hashed user id, IP, user agent and Meta cookies', () => {
  const e = purchaseEvent(order, 'https://friday-ai.in/billing');
  assert.deepEqual(e.user_data, {
    external_id: [createHash('sha256').update(order.userId).digest('hex')],
    client_ip_address: '203.0.113.7',
    client_user_agent: 'Mozilla/5.0',
    fbp: order.fbp,
    fbc: order.fbc,
  });
  assert.ok(!JSON.stringify(e).includes(order.userId), 'raw user id must not be sent');
});

test('missing cookies are left out rather than sent empty', () => {
  const e = purchaseEvent({ ...order, fbp: null, fbc: null, clientIp: null, userAgent: null }, 'https://friday-ai.in/billing');
  assert.deepEqual(Object.keys(e.user_data), ['external_id']);
});

test('the token goes in the request body, never the URL', async () => {
  const m = mockFetch({ status: 200, body: { events_received: 1 } });
  try {
    await sendEvents([purchaseEvent(order, 'https://friday-ai.in/billing')]);
  } finally {
    m.restore();
  }
  assert.equal(m.calls.length, 1);
  const { url, init } = m.calls[0];
  assert.equal(url, 'https://graph.facebook.com/v23.0/1583041433148120/events');
  assert.ok(!url.includes(TOKEN));
  const body = JSON.parse(String(init.body));
  assert.equal(body.access_token, TOKEN);
  assert.equal(body.data[0].event_id, 'purchase.order_Abc123');
  assert.equal(body.test_event_code, undefined);
});

test('errors from Meta never carry the token', async () => {
  const m = mockFetch({ status: 400, body: { error: { message: `Invalid OAuth access token - ${TOKEN}` } } });
  const err = await sendEvents([]).catch((e) => e).finally(m.restore);
  assert.ok(err instanceof MetaCapiError);
  assert.equal(err.status, 400);
  assert.ok(!err.message.includes(TOKEN), err.message);
  assert.match(err.message, /\[redacted\]/);
});

test('network failures are reported as MetaCapiError without the token', async () => {
  const m = mockFetch(new Error(`connect ECONNREFUSED ${TOKEN}`));
  const err = await sendEvents([]).catch((e) => e).finally(m.restore);
  assert.ok(err instanceof MetaCapiError);
  assert.equal(err.status, 0);
  assert.ok(!err.message.includes(TOKEN));
});
