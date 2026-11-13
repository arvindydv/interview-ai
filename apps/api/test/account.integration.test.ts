import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import Fastify, { type FastifyInstance } from 'fastify';
import sensible from '@fastify/sensible';

const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

describe('account: connections and Jobs data deletion', { skip: !serviceKey && 'set SUPABASE_SERVICE_ROLE_KEY to run against the local stack' }, () => {
  let app: FastifyInstance;
  let sql: typeof import('../src/lib/db.js').sql;
  const users: { id: string; token: string; email: string }[] = [];
  const queued: unknown[] = [];

  const call = (who: number, method: 'GET' | 'POST' | 'DELETE', url: string, body?: unknown) =>
    app.inject({ method, url, headers: { authorization: `Bearer ${users[who].token}` }, ...(body === undefined ? {} : { payload: body as object }) });

  /** Jobs data for one user: a profile, an application with its tailored resume and an event, a device, Gmail. */
  async function seed(userId: string) {
    await sql`insert into public.application_profiles (user_id, data) values (${userId}, ${sql.json({ firstName: 'A', savedAnswers: [{ question: 'CTC?', answer: '18' }] })})`;
    const [t] = await sql<{ id: string }[]>`
      insert into public.tailored_resumes (user_id, title, company, status, file) values (${userId}, 'Engineer', 'Co', 'ready', ${Buffer.from('%PDF')}) returning id`;
    const [a] = await sql<{ id: string }[]>`
      insert into public.auto_applications (user_id, tailored_resume_id, provider, apply_url, title, company, status, plan_day)
      values (${userId}, ${t.id}, 'greenhouse', 'https://e', 'Engineer', 'Co', 'prepared', current_date) returning id`;
    await sql`insert into public.auto_apply_events (application_id, user_id, kind, message) values (${a.id}, ${userId}, 'planned', 'x')`;
    await sql`insert into public.auto_apply_devices (user_id, name, token_hash) values (${userId}, 'Chrome on Linux', ${randomUUID()})`;
    await sql`insert into public.gmail_accounts (user_id, email, refresh_token, scope) values (${userId}, 'me@example.com', ${Buffer.from('enc')}, 'gmail.send')`;
    await sql`insert into public.job_bot_sessions (user_id, platform, status) values (${userId}, 'linkedin', 'connected')`;
  }
  const count = async (table: string, userId: string) =>
    (await sql<{ n: number }[]>`select count(*)::int as n from ${sql(`public.${table}`)} where user_id = ${userId}`)[0].n;

  before(async () => {
    const { env } = await import('../src/env.js');
    ({ sql } = await import('../src/lib/db.js'));
    const queues = await import('../src/lib/queues.js');
    queues.jobBotQueue.add = (async (...args: unknown[]) => {
      queued.push(args);
      return {} as never;
    }) as never;
    const supabase = async (path: string, body: unknown) => {
      const res = await fetch(`${env.SUPABASE_URL}/auth/v1${path}`, {
        method: 'POST',
        headers: { apikey: serviceKey!, authorization: `Bearer ${serviceKey}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const out = await res.json();
      assert.ok(res.ok, `${path}: ${JSON.stringify(out)}`);
      return out;
    };
    for (let i = 0; i < 2; i++) {
      const email = `account-test-${randomUUID().slice(0, 8)}@example.com`;
      const password = randomUUID();
      const id = (await supabase('/admin/users', { email, password, email_confirm: true })).id;
      const token = (await supabase('/token?grant_type=password', { email, password })).access_token;
      await sql`insert into public.users (id, email, auth_provider) values (${id}, ${email}, 'email')`;
      users.push({ id, token, email });
      await seed(id);
    }
    app = Fastify();
    await app.register(sensible);
    await app.register((await import('../src/routes/account.js')).default);
    await app.ready();
  });

  after(async () => {
    await app?.close();
    if (sql) {
      for (const u of users) await sql`delete from auth.users where id = ${u.id}`;
      await sql.end();
    }
    const queues = await import('../src/lib/queues.js');
    await Promise.all(
      [queues.systemQueue, queues.systemQueueEvents, queues.emailQueue, queues.profileQueue, queues.practiceQueue, queues.historyQueue,
       queues.tailorQueue, queues.matchesQueue, queues.autoApplyQueue, queues.coldEmailQueue, queues.jobBotQueue].map((q) => q.close()),
    );
    const { redis } = await import('../src/lib/redis.js');
    await redis.quit();
  });

  test('lists the caller’s connections only', async () => {
    const res = await call(0, 'GET', '/v1/account/connections');
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.gmail.email, 'me@example.com');
    assert.equal(body.devices.length, 1);
    assert.deepEqual(body.botSessions.map((s: { platform: string }) => s.platform), ['linkedin']);
    // Never the token itself.
    assert.doesNotMatch(res.body, /refresh|token_hash|enc/);
  });

  test('requires sign-in', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/account/connections' });
    assert.equal(res.statusCode, 401);
  });

  test('disconnecting devices revokes them and is audited', async () => {
    const res = await call(0, 'DELETE', '/v1/account/connections/devices');
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().removed, 1);
    assert.equal((await call(0, 'GET', '/v1/account/connections')).json().devices.length, 0);
    const [log] = await sql`select action, actor from public.audit_logs where user_id = ${users[0].id} order by id desc limit 1`;
    assert.deepEqual({ ...log }, { action: 'account.disconnect.devices', actor: 'user' });
    assert.equal((await call(0, 'DELETE', '/v1/account/connections/passwords')).statusCode, 400);
  });

  test('disconnecting Gmail deletes the stored token', async () => {
    assert.equal((await call(0, 'DELETE', '/v1/account/connections/gmail')).statusCode, 200);
    assert.equal(await count('gmail_accounts', users[0].id), 0);
  });

  test('Jobs data deletion needs the typed confirmation', async () => {
    for (const body of [{}, { confirm: 'delete' }, { confirm: 'yes' }]) {
      assert.equal((await call(0, 'POST', '/v1/account/jobs-data/delete', body)).statusCode, 400);
    }
    assert.equal(await count('auto_applications', users[0].id), 1);
  });

  test('Jobs data deletion removes only the caller’s data', async () => {
    const res = await call(0, 'POST', '/v1/account/jobs-data/delete', { confirm: 'DELETE' });
    assert.equal(res.statusCode, 200, res.body);
    for (const t of ['auto_applications', 'auto_apply_events', 'tailored_resumes', 'application_profiles', 'job_bot_sessions']) {
      assert.equal(await count(t, users[0].id), 0, t);
      assert.ok((await count(t, users[1].id)) > 0, `other user's ${t} kept`);
    }
    assert.equal(await count('gmail_accounts', users[1].id), 1);
    const [log] = await sql`select action from public.audit_logs where user_id = ${users[0].id} order by id desc limit 1`;
    assert.equal(log.action, 'account.jobs_data.delete');
  });
});
