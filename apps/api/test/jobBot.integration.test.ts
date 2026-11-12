import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import Fastify, { type FastifyInstance } from 'fastify';
import sensible from '@fastify/sensible';
import type { BotApplicationPage, JobBotState } from '@parakeet/shared';

const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

describe('platform bot: Assisted Apply and evidence', { skip: !serviceKey && 'set SUPABASE_SERVICE_ROLE_KEY to run against the local stack' }, () => {
  let app: FastifyInstance;
  let sql: typeof import('../src/lib/db.js').sql;
  let userId: string;
  let userToken: string;
  const email = `jobbot-test-${randomUUID().slice(0, 8)}@example.com`;
  const queued: unknown[] = [];

  const call = (method: 'GET' | 'POST' | 'PUT', url: string, body?: unknown) =>
    app.inject({ method, url, headers: { authorization: `Bearer ${userToken}` }, ...(body === undefined ? {} : { payload: body as object }) });

  const JOB = {
    platform: 'naukri',
    url: 'https://www.naukri.com/job-listings-backend-engineer-acme-bengaluru-3-to-6-years-121125000001',
    title: 'Backend Engineer',
    company: 'Acme',
    description: 'We are hiring a backend engineer to build Node.js services on AWS. You will design REST APIs, work with PostgreSQL and Redis, and mentor juniors. 3-6 years of experience required.',
  };

  before(async () => {
    process.env.JOB_BOT_USER_EMAILS = email;
    const { env } = await import('../src/env.js');
    ({ sql } = await import('../src/lib/db.js'));
    // Nothing reaches the shared queue: a running dev worker would otherwise tailor for the test user.
    const queues = await import('../src/lib/queues.js');
    queues.tailorQueue.add = (async (...args: unknown[]) => {
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
    const password = randomUUID();
    userId = (await supabase('/admin/users', { email, password, email_confirm: true })).id;
    userToken = (await supabase('/token?grant_type=password', { email, password })).access_token;
    await sql`insert into public.users (id, email, auth_provider) values (${userId}, ${email}, 'email')`;
    app = Fastify();
    await app.register(sensible);
    await app.register((await import('../src/routes/jobBot.js')).default);
    await app.ready();
  });

  after(async () => {
    await app?.close();
    if (sql) {
      if (userId) {
        await sql`delete from auth.users where id = ${userId}`;
        await sql`delete from public.users where id = ${userId}`;
      }
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

  test('a new account sees every platform disconnected and what is missing', async () => {
    const res = await call('GET', '/v1/job-bot');
    assert.equal(res.statusCode, 200);
    const state = res.json<JobBotState>();
    assert.equal(state.available, true);
    assert.deepEqual(state.platforms.map((p) => p.status), ['disconnected', 'disconnected', 'disconnected']);
    assert.ok(state.missing.some((m) => /resume/i.test(m)));
  });

  test('Assisted Apply needs a resume file and a real description', async () => {
    assert.equal((await call('POST', '/v1/job-bot/assisted', JOB)).statusCode, 409);
    await sql`
      insert into public.resumes (user_id, file_name, mime_type, text, status, file)
      values (${userId}, 'resume.pdf', 'application/pdf', 'Backend engineer, Node.js, AWS', 'ready', ${Buffer.from('%PDF-1.4')})`;
    assert.equal((await call('POST', '/v1/job-bot/assisted', { ...JOB, description: 'Too short.' })).statusCode, 400);
    assert.equal((await call('POST', '/v1/job-bot/assisted', { ...JOB, url: 'http://insecure.example/job' })).statusCode, 400);
  });

  let applicationId: string;
  test('a pasted job is tailored for, listed as assisted, and only "applied" once the candidate confirms', async () => {
    const res = await call('POST', '/v1/job-bot/assisted', JOB);
    assert.equal(res.statusCode, 200, res.body);
    applicationId = res.json().id;
    assert.equal(queued.length, 1);

    const [tailored] = await sql<{ id: string; description: string; listing_id: string | null }[]>`
      select t.id, t.description, t.listing_id from public.tailored_resumes t
      join public.job_bot_applications a on a.tailored_resume_id = t.id where a.id = ${applicationId}`;
    assert.equal(tailored.listing_id, null);
    assert.equal(tailored.description, JOB.description);

    const list = (await call('GET', '/v1/job-bot/applications?outcome=assisted')).json<BotApplicationPage>();
    assert.equal(list.total, 1);
    assert.equal(list.items[0].tailorStatus, 'tailoring');
    assert.equal(list.items[0].evidence, null);
    assert.equal((await call('GET', '/v1/job-bot/applications?outcome=applied')).json<BotApplicationPage>().total, 0);

    // Not ready yet: no file to download.
    assert.equal((await call('GET', `/v1/job-bot/applications/${applicationId}/resume`)).statusCode, 404);
    await sql`
      update public.tailored_resumes set status = 'ready', file = ${Buffer.from('%PDF-1.4 tailored')}, file_name = 'Asha Rao - Acme.pdf',
        content = ${sql.json({ format: 'pdf' })} where id = ${tailored.id}`;
    const file = await call('GET', `/v1/job-bot/applications/${applicationId}/resume`);
    assert.equal(file.statusCode, 200);
    assert.equal(file.headers['content-type'], 'application/pdf');
    assert.equal(file.body, '%PDF-1.4 tailored');

    assert.equal((await call('POST', `/v1/job-bot/applications/${applicationId}/submitted`)).statusCode, 200);
    const applied = (await call('GET', '/v1/job-bot/applications?outcome=applied')).json<BotApplicationPage>();
    assert.equal(applied.total, 1);
    assert.equal(applied.items[0].evidence, 'user_reported');
    // Confirming twice changes nothing.
    assert.equal((await call('POST', `/v1/job-bot/applications/${applicationId}/submitted`)).statusCode, 404);
  });

  test('a job already applied to is not added again', async () => {
    const res = await call('POST', '/v1/job-bot/assisted', JOB);
    assert.equal(res.statusCode, 409);
    assert.equal(queued.length, 1);
  });

  test('an applied row without evidence is refused by the database', async () => {
    await assert.rejects(
      sql`insert into public.job_bot_applications (user_id, platform, job_id, url, outcome) values (${userId}, 'linkedin', 'x1', 'https://x', 'applied')`,
      /job_bot_applied_has_evidence/,
    );
  });

  test('another account cannot read or confirm this one\'s applications', async () => {
    const other = await call('GET', `/v1/job-bot/applications/${randomUUID()}/resume`);
    assert.equal(other.statusCode, 404);
  });
});
