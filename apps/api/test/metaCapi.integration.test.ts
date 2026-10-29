// End-to-end test of Meta Purchase reporting through checkout against the local stack (`pnpm infra:up`):
// a real Supabase user and Postgres, with Razorpay and Meta replaced by a fake fetch. Skipped unless
// SUPABASE_SERVICE_ROLE_KEY is set, e.g.
//   SUPABASE_SERVICE_ROLE_KEY=$(npx supabase status -o env | sed -n 's/^SERVICE_ROLE_KEY="\(.*\)"/\1/p') pnpm test
import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, test } from 'node:test';
import Fastify, { type FastifyInstance } from 'fastify';

process.env.SUPABASE_URL ??= 'http://127.0.0.1:54321';
process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
process.env.REDIS_URL ??= 'redis://127.0.0.1:6380';

const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const RZP_SECRET = 'test-razorpay-secret';
const TOKEN = 'EAAtest-integration-token';

describe('Meta Purchase reporting', { skip: !serviceKey && 'set SUPABASE_SERVICE_ROLE_KEY to run against the local stack' }, () => {
  let app: FastifyInstance;
  let sql: typeof import('../src/lib/db.js').sql;
  let redis: typeof import('../src/lib/redis.js').redis;
  let reportPurchase: typeof import('../src/lib/metaCapi.js').reportPurchase;
  let userId: string;
  let userToken: string;
  const email = `meta-test-${randomUUID().slice(0, 8)}@example.com`;

  // Razorpay and Meta are faked; everything else (Supabase JWKS) goes through.
  const realFetch = globalThis.fetch;
  let metaCalls: { body: { data: { event_id: string; custom_data: { value: number; currency: string } }[] } }[] = [];
  let metaFails = false;
  const payments = new Map<string, { order_id: string; amount: number }>();

  const fakeFetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url === 'https://api.razorpay.com/v1/orders') {
      const o = JSON.parse(String(init!.body));
      return Response.json({ id: `order_${randomUUID().replaceAll('-', '').slice(0, 14)}`, amount: o.amount, currency: o.currency, status: 'created' });
    }
    const pay = url.match(/^https:\/\/api\.razorpay\.com\/v1\/payments\/(pay_\w+)$/);
    if (pay) {
      const p = payments.get(pay[1])!;
      return Response.json({ id: pay[1], order_id: p.order_id, amount: p.amount, currency: 'INR', status: 'captured' });
    }
    if (url.startsWith('https://graph.facebook.com/')) {
      metaCalls.push({ body: JSON.parse(String(init!.body)) });
      return metaFails
        ? Response.json({ error: { message: 'Service temporarily unavailable' } }, { status: 503 })
        : Response.json({ events_received: 1 });
    }
    return realFetch(input, init);
  };

  const inject = (url: string, payload: object, headers: Record<string, string> = {}) =>
    app.inject({ method: 'POST', url, payload, headers: { authorization: `Bearer ${userToken}`, ...headers } });

  const createOrder = async (tracking?: unknown) => {
    const res = await inject('/v1/billing/orders', { productId: 'monthly', ...(tracking ? { tracking } : {}) }, { 'user-agent': 'TestAgent/1.0' });
    assert.equal(res.statusCode, 200, res.body);
    return res.json() as { orderId: string; amount: number; currency: string };
  };

  const pay = (orderId: string, amount: number) => {
    const paymentId = `pay_${randomUUID().replaceAll('-', '').slice(0, 14)}`;
    payments.set(paymentId, { order_id: orderId, amount });
    const signature = createHmac('sha256', RZP_SECRET).update(`${orderId}|${paymentId}`).digest('hex');
    return inject('/v1/billing/verify', { razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: signature });
  };

  const row = async (orderId: string) =>
    (await sql`
      select status, meta_consent, meta_fbp, meta_fbc, meta_client_ip, meta_user_agent, meta_purchase
      from public.payments where razorpay_order_id = ${orderId}`)[0];

  /** The verify route reports in the background; wait until it has called Meta and settled. */
  const settled = async (orderId: string) => {
    for (let i = 0; i < 50; i++) {
      if (metaCalls.length && (await row(orderId)).meta_purchase !== 'sending') return;
      await new Promise((r) => setTimeout(r, 20));
    }
    assert.fail('report never finished');
  };

  before(async () => {
    Object.assign(process.env, {
      RAZORPAY_KEY_ID: 'rzp_test_meta',
      RAZORPAY_KEY_SECRET: RZP_SECRET,
      META_PIXEL_ID: '1583041433148120',
      META_CAPI_ACCESS_TOKEN: TOKEN,
      APP_URL: 'https://friday-ai.in',
    });
    const { env } = await import('../src/env.js');
    ({ sql } = await import('../src/lib/db.js'));
    ({ redis } = await import('../src/lib/redis.js'));
    ({ reportPurchase } = await import('../src/lib/metaCapi.js'));

    const admin = async (path: string, body: unknown) => {
      const res = await realFetch(`${env.SUPABASE_URL}/auth/v1${path}`, {
        method: 'POST',
        headers: { apikey: serviceKey!, authorization: `Bearer ${serviceKey}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      assert.ok(res.ok, `${path}: ${JSON.stringify(json)}`);
      return json;
    };
    const password = randomUUID();
    userId = (await admin('/admin/users', { email, password, email_confirm: true })).id;
    userToken = (await admin('/token?grant_type=password', { email, password })).access_token;

    globalThis.fetch = fakeFetch as typeof fetch;
    app = Fastify();
    await app.register((await import('../src/routes/billing.js')).default);
  });

  beforeEach(async () => {
    metaCalls = [];
    metaFails = false;
    // Orders for the same product are reused for 15 minutes; start each test from a fresh one.
    if (sql) await sql`delete from public.payments where user_id = ${userId}`;
  });

  after(async () => {
    globalThis.fetch = realFetch;
    await app?.close();
    if (sql) {
      if (userId) {
        await sql`delete from auth.users where id = ${userId}`;
        await sql`delete from public.users where id = ${userId}`;
      }
      await sql.end();
      await redis.quit();
    }
  });

  test('a consented, verified payment is reported once, in INR, with the browser pixel’s event id', async () => {
    const fbp = 'fb.1.1761730000000.1234567890';
    const fbc = 'fb.1.1761730000000.IwAR0abc-_x';
    const order = await createOrder({ consent: true, fbp, fbc });
    const stored = await row(order.orderId);
    assert.equal(stored.meta_consent, true);
    assert.equal(stored.meta_fbp, fbp);
    assert.equal(stored.meta_fbc, fbc);
    assert.equal(stored.meta_user_agent, 'TestAgent/1.0');
    assert.ok(stored.meta_client_ip);

    const res = await pay(order.orderId, order.amount);
    assert.equal(res.statusCode, 200, res.body);
    await settled(order.orderId);

    assert.equal(metaCalls.length, 1);
    const [event] = metaCalls[0].body.data;
    assert.equal(event.event_id, `purchase.${order.orderId}`);
    assert.deepEqual([event.custom_data.value, event.custom_data.currency], [2999, 'INR']);

    // Sent: the matching data is no longer kept.
    const after = await row(order.orderId);
    assert.equal(after.meta_purchase, 'sent');
    assert.deepEqual([after.meta_fbp, after.meta_fbc, after.meta_client_ip, after.meta_user_agent], [null, null, null, null]);

    // Webhook deliveries and repeated reports of the same payment don't send it again.
    await Promise.all([reportPurchase(order.orderId, app.log), reportPurchase(order.orderId, app.log)]);
    assert.equal(metaCalls.length, 1);
  });

  test('concurrent reports of one payment send a single event', async () => {
    const order = await createOrder({ consent: true });
    await sql`update public.payments set status = 'paid', paid_at = now() where razorpay_order_id = ${order.orderId}`;
    await Promise.all(Array.from({ length: 5 }, () => reportPurchase(order.orderId, app.log)));
    assert.equal(metaCalls.length, 1);
  });

  test('without marketing consent nothing is stored or sent', async () => {
    const order = await createOrder();
    const stored = await row(order.orderId);
    assert.equal(stored.meta_consent, false);
    assert.equal(stored.meta_client_ip, null);
    assert.equal(stored.meta_user_agent, null);

    assert.equal((await pay(order.orderId, order.amount)).statusCode, 200);
    await reportPurchase(order.orderId, app.log);
    assert.equal((await row(order.orderId)).status, 'paid');
    assert.equal(metaCalls.length, 0);
  });

  test('withdrawing consent before paying a reused order stops the report', async () => {
    const first = await createOrder({ consent: true, fbp: 'fb.1.1761730000000.1234567890' });
    const again = await createOrder();
    assert.equal(again.orderId, first.orderId);
    const stored = await row(first.orderId);
    assert.equal(stored.meta_consent, false);
    assert.equal(stored.meta_fbp, null);
    await pay(first.orderId, first.amount);
    await reportPurchase(first.orderId, app.log);
    assert.equal(metaCalls.length, 0);
  });

  test('malformed tracking data never blocks checkout', async () => {
    const order = await createOrder({ consent: true, fbp: 'not-a-cookie', fbc: 'x'.repeat(2000) });
    const stored = await row(order.orderId);
    assert.equal(stored.meta_consent, true);
    assert.equal(stored.meta_fbp, null);
    assert.equal(stored.meta_fbc, null);
    const bogus = await inject('/v1/billing/orders', { productId: 'yearly', tracking: 'yes please' });
    assert.equal(bogus.statusCode, 200, bogus.body);
  });

  test('a failed send is retried by the next report of the payment, and the payment still succeeds', async () => {
    const order = await createOrder({ consent: true });
    metaFails = true;
    assert.equal((await pay(order.orderId, order.amount)).statusCode, 200);
    await settled(order.orderId);
    assert.equal((await row(order.orderId)).meta_purchase, null);

    metaFails = false;
    await reportPurchase(order.orderId, app.log); // e.g. the order.paid webhook arriving later
    assert.equal((await row(order.orderId)).meta_purchase, 'sent');
    assert.equal(metaCalls.length, 2);
    assert.ok(metaCalls.every((c) => c.body.data[0].event_id === `purchase.${order.orderId}`));
  });

  test('unpaid orders are not reported', async () => {
    const order = await createOrder({ consent: true });
    await reportPurchase(order.orderId, app.log);
    assert.equal(metaCalls.length, 0);
  });
});
