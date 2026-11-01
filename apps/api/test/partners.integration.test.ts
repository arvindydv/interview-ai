// End-to-end test of referral partners against the local stack (`pnpm infra:up`): link clicks,
// attribution, commission through real checkout, rate changes and refunds. Razorpay is replaced by a
// fake fetch. Skipped unless SUPABASE_SERVICE_ROLE_KEY is set, e.g.
//   SUPABASE_SERVICE_ROLE_KEY=$(npx supabase status -o env | sed -n 's/^SERVICE_ROLE_KEY="\(.*\)"/\1/p') pnpm test
import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import Fastify, { type FastifyInstance } from 'fastify';
import type { PartnerDashboard, ReferralClaimResult } from '@parakeet/shared';

process.env.SUPABASE_URL ??= 'http://127.0.0.1:54321';
process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
process.env.REDIS_URL ??= 'redis://127.0.0.1:6380';

const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const RZP_SECRET = 'test-razorpay-secret';

describe('referral partners', { skip: !serviceKey && 'set SUPABASE_SERVICE_ROLE_KEY to run against the local stack' }, () => {
  let app: FastifyInstance;
  let sql: typeof import('../src/lib/db.js').sql;
  let redis: typeof import('../src/lib/redis.js').redis;
  let revokeRefunded: typeof import('../src/lib/billing.js').revokeRefunded;
  const tag = randomUUID().slice(0, 8);
  const code = `test-${tag}`;
  let partnerId: string;
  const users: Record<'partner' | 'fan' | 'other' | 'old', { id: string; token: string }> = {} as never;

  const realFetch = globalThis.fetch;
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
    return realFetch(input, init);
  };

  const post = (who: keyof typeof users | null, url: string, payload: object, remoteAddress = '203.0.113.7') =>
    app.inject({
      method: 'POST', url, payload, remoteAddress,
      headers: who ? { authorization: `Bearer ${users[who].token}` } : {},
    });

  const claim = async (who: keyof typeof users, c = code) => {
    const res = await post(who, '/v1/referrals/claim', { code: c });
    assert.equal(res.statusCode, 200, res.body);
    return res.json() as ReferralClaimResult;
  };

  /** Buys a product through checkout and confirms it. Returns the payment id. */
  const buy = async (who: keyof typeof users, productId: string) => {
    const order = await post(who, '/v1/billing/orders', { productId });
    assert.equal(order.statusCode, 200, order.body);
    const { orderId, amount } = order.json() as { orderId: string; amount: number };
    const paymentId = `pay_${randomUUID().replaceAll('-', '').slice(0, 14)}`;
    payments.set(paymentId, { order_id: orderId, amount });
    const signature = createHmac('sha256', RZP_SECRET).update(`${orderId}|${paymentId}`).digest('hex');
    const res = await post(who, '/v1/billing/verify', { razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: signature });
    assert.equal(res.statusCode, 200, res.body);
    return { paymentId, orderId };
  };

  const dashboard = async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/partner', headers: { authorization: `Bearer ${users.partner.token}` } });
    assert.equal(res.statusCode, 200, res.body);
    return res.json() as PartnerDashboard;
  };

  before(async () => {
    Object.assign(process.env, { RAZORPAY_KEY_ID: 'rzp_test_partners', RAZORPAY_KEY_SECRET: RZP_SECRET });
    const { env } = await import('../src/env.js');
    ({ sql } = await import('../src/lib/db.js'));
    ({ redis } = await import('../src/lib/redis.js'));
    ({ revokeRefunded } = await import('../src/lib/billing.js'));

    const authAdmin = async (path: string, body: unknown) => {
      const res = await realFetch(`${env.SUPABASE_URL}/auth/v1${path}`, {
        method: 'POST',
        headers: { apikey: serviceKey!, authorization: `Bearer ${serviceKey}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      assert.ok(res.ok, `${path}: ${JSON.stringify(json)}`);
      return json;
    };
    for (const who of ['partner', 'fan', 'other', 'old'] as const) {
      const email = `partners-${who}-${tag}@example.com`;
      const password = randomUUID();
      const id = (await authAdmin('/admin/users', { email, password, email_confirm: true })).id as string;
      const token = (await authAdmin('/token?grant_type=password', { email, password })).access_token as string;
      users[who] = { id, token };
      await sql`insert into public.users (id, email) values (${id}, ${email})`;
    }
    await sql`update public.users set created_at = now() - interval '30 days' where id = ${users.old.id}`;
    [{ id: partnerId }] = await sql<{ id: string }[]>`
      insert into public.partners (user_id, code, name, commission_bps)
      values (${users.partner.id}, ${code}, 'Test Partner', 2000) returning id`;

    globalThis.fetch = fakeFetch as typeof fetch;
    app = Fastify({ trustProxy: false });
    await app.register((await import('../src/routes/billing.js')).default);
    await app.register((await import('../src/routes/referrals.js')).default);
    await app.register((await import('../src/routes/referrals.js')).referralClickRoutes);
  });

  after(async () => {
    globalThis.fetch = realFetch;
    await app?.close();
    if (sql) {
      const ids = Object.values(users).map((u) => u.id);
      await sql`delete from public.partners where code = ${code}`;
      await sql`delete from public.users where id = any(${ids})`;
      await sql`delete from auth.users where id = any(${ids})`;
      await sql.end();
      await redis.quit();
    }
  });

  test('a visit counts once per visitor per hour; unknown codes are refused', async () => {
    const first = await post(null, '/v1/referrals/click', { code: code.toUpperCase() });
    assert.equal(first.statusCode, 200, first.body);
    assert.deepEqual(first.json(), { name: 'Test Partner' });
    await post(null, '/v1/referrals/click', { code });
    await post(null, '/v1/referrals/click', { code }, '203.0.113.8');
    assert.equal((await post(null, '/v1/referrals/click', { code: 'no-such-code-xyz' })).statusCode, 404);
    assert.equal((await dashboard()).totals.clicks, 2);
  });

  test('only new accounts are attributed, once, and never to their own partner', async () => {
    assert.deepEqual(await claim('partner'), { attributed: false, reason: 'own_code' });
    assert.deepEqual(await claim('old'), { attributed: false, reason: 'not_new' });
    assert.deepEqual(await claim('fan', 'no-such-code-xyz'), { attributed: false, reason: 'unknown_code' });
    assert.deepEqual(await claim('fan'), { attributed: true });
    assert.deepEqual(await claim('fan'), { attributed: true }, 'claiming again is harmless');

    const [{ id: otherPartner }] = await sql<{ id: string }[]>`
      insert into public.partners (user_id, code, name, commission_bps)
      values (${users.other.id}, ${`${code}-b`}, 'Other', 5000) returning id`;
    assert.deepEqual(await claim('fan', `${code}-b`), { attributed: false, reason: 'already_referred' });
    await sql`delete from public.partners where id = ${otherPartner}`;
  });

  test('payments earn commission at the rate in effect when paid; refunds take it back', async () => {
    const monthly = await buy('fan', 'monthly'); // ₹2,999 at 20%
    await sql`update public.partners set commission_bps = 1000 where id = ${partnerId}`;
    await buy('fan', 'minutes_10'); // ₹100 at 10%

    let d = await dashboard();
    assert.equal(d.totals.signups, 1);
    assert.equal(d.totals.payingUsers, 1);
    assert.equal(d.totals.revenue, 2999_00 + 100_00);
    assert.equal(d.totals.earned, 599_80 + 10_00);
    assert.equal(d.series.earned.at(-1)!.value, 599_80 + 10_00);
    assert.deepEqual(d.referrals.map((r) => [r.label, r.paid, r.commission, r.email]), [['User 1', 2999_00 + 100_00, 609_80, undefined]]);

    assert.equal(await revokeRefunded(monthly.paymentId, monthly.orderId), true);
    d = await dashboard();
    assert.equal(d.totals.revenue, 100_00);
    assert.equal(d.totals.earned, 10_00);
    assert.deepEqual(d.earnings.map((e) => e.status).sort(), ['paid', 'refunded']);
  });

  test('payouts reduce the balance; an inactive partner stops earning', async () => {
    await sql`insert into public.partner_payouts (partner_id, amount, created_by) values (${partnerId}, 4_00, 'test')`;
    await sql`update public.partners set active = false where id = ${partnerId}`;
    await buy('fan', 'minutes_10');
    const d = await dashboard();
    assert.equal(d.totals.earned, 10_00);
    assert.equal(d.totals.paidOut, 4_00);
    assert.equal(d.totals.balance, 6_00);
  });
});
