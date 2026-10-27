// End-to-end test of answer reporting against the local stack (`pnpm infra:up`): a real Supabase user
// and access token, Postgres and Redis. Skipped unless SUPABASE_SERVICE_ROLE_KEY is set, e.g.
//   SUPABASE_SERVICE_ROLE_KEY=$(npx supabase status -o env | sed -n 's/^SERVICE_ROLE_KEY="\(.*\)"/\1/p') pnpm test
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import Fastify, { type FastifyInstance } from 'fastify';
import type { AdminReport, Paged } from '@parakeet/shared';

const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

describe('answer reports', { skip: !serviceKey && 'set SUPABASE_SERVICE_ROLE_KEY to run against the local stack' }, () => {
  let app: FastifyInstance;
  let sql: typeof import('../src/lib/db.js').sql;
  let redis: typeof import('../src/lib/redis.js').redis;
  let supabaseUrl: string;
  let userId: string;
  let userToken: string;
  let adminToken: string;
  const email = `report-test-${randomUUID().slice(0, 8)}@example.com`;
  const recordedTurn = `turn-${randomUUID()}`;
  const unrecordedTurn = `turn-${randomUUID()}`;
  const reportIds: string[] = [];

  const supabase = async (path: string, body: unknown) => {
    const res = await fetch(`${supabaseUrl}/auth/v1${path}`, {
      method: 'POST',
      headers: { apikey: serviceKey!, authorization: `Bearer ${serviceKey}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    assert.ok(res.ok, `${path}: ${JSON.stringify(json)}`);
    return json;
  };

  const report = (body: unknown, token: string | null = userToken) =>
    app.inject({
      method: 'POST',
      url: '/v1/reports',
      headers: token ? { authorization: `Bearer ${token}` } : {},
      payload: body as object,
    });

  before(async () => {
    const { env } = await import('../src/env.js');
    ({ sql } = await import('../src/lib/db.js'));
    ({ redis } = await import('../src/lib/redis.js'));
    const { issueAdminToken } = await import('../src/lib/adminAuth.js');
    supabaseUrl = env.SUPABASE_URL;

    const password = randomUUID();
    userId = (await supabase('/admin/users', { email, password, email_confirm: true })).id;
    userToken = (await supabase('/token?grant_type=password', { email, password })).access_token;
    adminToken = (await issueAdminToken('reviewer@test')).token;

    // An answer the API recorded for this user, as the live channel does after each turn.
    await sql`insert into public.users (id, email, auth_provider) values (${userId}, ${email}, 'email')`;
    await sql`
      insert into public.live_turns (user_id, turn_id, question, answer, model, status)
      values (${userId}, ${recordedTurn}, 'What is your weakness?', 'The recorded answer.', 'test-model', 'done')`;

    app = Fastify();
    await app.register((await import('../src/routes/reports.js')).default);
    await app.register((await import('../src/routes/admin/reports.js')).default);
  });

  after(async () => {
    await app?.close();
    if (sql) {
      if (reportIds.length) await sql`delete from public.admin_audit where target in ${sql(reportIds)}`;
      if (userId) {
        await sql`delete from auth.users where id = ${userId}`;
        await sql`delete from public.users where id = ${userId}`;
        await redis.del(`reports:${userId}`);
      }
      await sql.end();
      await redis.quit();
    }
  });

  test('requires a signed-in user', async () => {
    assert.equal((await report({ turnId: recordedTurn, reason: 'harmful' }, null)).statusCode, 401);
    assert.equal((await report({ turnId: recordedTurn, reason: 'harmful' }, 'not-a-jwt')).statusCode, 401);
  });

  test('rejects an invalid reason', async () => {
    const res = await report({ turnId: recordedTurn, reason: 'spam' });
    assert.equal(res.statusCode, 400);
    assert.equal(res.json().error, 'bad_request');
  });

  test('stores a report with the server’s copy of the answer, not the client’s', async () => {
    const res = await report({ turnId: recordedTurn, reason: 'harmful', details: ' Encourages lying ', answer: 'tampered' });
    assert.equal(res.statusCode, 200);
    const { id } = res.json();
    reportIds.push(id);
    const [row] = await sql`select * from public.content_reports where id = ${id}`;
    assert.equal(row.user_id, userId);
    assert.equal(row.reason, 'harmful');
    assert.equal(row.details, 'Encourages lying');
    assert.equal(row.answer, 'The recorded answer.');
    assert.equal(row.question, 'What is your weakness?');
    assert.equal(row.model, 'test-model');
    assert.ok(row.live_turn_id);
    assert.equal(row.status, 'open');
  });

  test('reporting the same answer again updates the report', async () => {
    const res = await report({ turnId: recordedTurn, reason: 'misleading' });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().id, reportIds[0]);
    const [{ n, reason }] = await sql`
      select count(*)::int as n, max(reason) as reason from public.content_reports where user_id = ${userId} and turn_id = ${recordedTurn}`;
    assert.equal(n, 1);
    assert.equal(reason, 'misleading');
  });

  test('keeps the client’s copy when the turn was never recorded', async () => {
    const res = await report({ turnId: unrecordedTurn, reason: 'other', question: 'Q?', answer: 'What the user saw.' });
    assert.equal(res.statusCode, 200);
    reportIds.push(res.json().id);
    const [row] = await sql`select live_turn_id, answer, question from public.content_reports where id = ${res.json().id}`;
    assert.equal(row.live_turn_id, null);
    assert.equal(row.answer, 'What the user saw.');
    assert.equal(row.question, 'Q?');
  });

  test('rate-limits a flood of reports', async () => {
    const { MAX_REPORTS_PER_HOUR } = await import('../src/lib/reports.js');
    await redis.set(`reports:${userId}`, MAX_REPORTS_PER_HOUR, 'EX', 60);
    const res = await report({ turnId: recordedTurn, reason: 'harmful' });
    assert.equal(res.statusCode, 429);
    await redis.del(`reports:${userId}`);
  });

  test('a user token cannot read reports', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/reports', headers: { authorization: `Bearer ${userToken}` } });
    assert.equal(res.statusCode, 401);
  });

  test('administrators can find and resolve a report, and the change is audited', async () => {
    const list = await app.inject({
      method: 'GET',
      url: `/admin/reports?q=${encodeURIComponent(email)}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    assert.equal(list.statusCode, 200);
    const page = list.json<Paged<AdminReport>>();
    assert.equal(page.total, 2);
    const reported = page.rows.find((r) => r.turnId === recordedTurn)!;
    assert.equal(reported.userEmail, email);
    assert.equal(reported.answer, 'The recorded answer.');

    const patch = await app.inject({
      method: 'POST',
      url: `/admin/reports/${reported.id}/review`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { status: 'actioned', adminNote: 'Prompt adjusted' },
    });
    assert.equal(patch.statusCode, 200);
    const updated = patch.json<AdminReport>();
    assert.equal(updated.status, 'actioned');
    assert.equal(updated.adminNote, 'Prompt adjusted');
    assert.equal(updated.reviewedBy, 'reviewer@test');

    const [{ n }] = await sql`
      select count(*)::int as n from public.admin_audit where action = 'report.review' and target = ${reported.id}`;
    assert.equal(n, 1);
  });
});
