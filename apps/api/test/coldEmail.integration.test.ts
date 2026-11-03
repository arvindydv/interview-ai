// End-to-end test of cold email's API against the local stack (`pnpm infra:up`): connecting Gmail
// through OAuth, sending with the tailored resume attached, the once-only send, the daily limit, and a
// revoked Gmail. Google's endpoints are stood in for; a real Supabase user, Postgres and Redis.
// Skipped unless SUPABASE_SERVICE_ROLE_KEY is set, e.g.
//   SUPABASE_SERVICE_ROLE_KEY=$(npx supabase status -o env | sed -n 's/^SERVICE_ROLE_KEY="\(.*\)"/\1/p') pnpm test
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import Fastify, { type FastifyInstance } from 'fastify';
import sensible from '@fastify/sensible';
import { COLD_EMAIL_LIMITS, type ColdEmail, type GmailStatus } from '@parakeet/shared';

const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

describe('cold email', { skip: !serviceKey && 'set SUPABASE_SERVICE_ROLE_KEY to run against the local stack' }, () => {
  let app: FastifyInstance;
  let sql: typeof import('../src/lib/db.js').sql;
  let userId: string;
  let userToken: string;
  let sourceId: string;
  let listingId: string;
  const email = `coldemail-test-${randomUUID().slice(0, 8)}@example.com`;
  const gmailAddress = `asha.${randomUUID().slice(0, 6)}@gmail.com`;

  // Google, stood in for: what Friday sent, and how Google answers next.
  const sentRaw: string[] = [];
  let tokenAnswer: 'ok' | 'revoked' = 'ok';
  const realFetch = globalThis.fetch;
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  const call = (method: 'GET' | 'POST' | 'DELETE', url: string, body?: unknown) =>
    app.inject({ method, url, headers: { authorization: `Bearer ${userToken}` }, ...(body === undefined ? {} : { payload: body as object }) });

  before(async () => {
    process.env.GOOGLE_CLIENT_ID = 'test-client';
    process.env.GOOGLE_CLIENT_SECRET = 'test-secret';
    process.env.GMAIL_TOKEN_KEY = Buffer.alloc(32, 3).toString('base64');
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url === 'https://oauth2.googleapis.com/token') {
        const form = new URLSearchParams(String(init?.body));
        if (tokenAnswer === 'revoked') return json({ error: 'invalid_grant' }, 400);
        if (form.get('grant_type') === 'authorization_code') {
          const claims = Buffer.from(JSON.stringify({ email: gmailAddress, email_verified: true })).toString('base64url');
          const scope = form.get('code') === 'no-send' ? 'openid email' : 'openid email https://www.googleapis.com/auth/gmail.send';
          return json({ access_token: 'at-1', expires_in: 3600, refresh_token: '1//rt', scope, id_token: `x.${claims}.y` });
        }
        return json({ access_token: 'at-2', expires_in: 3600, scope: 'https://www.googleapis.com/auth/gmail.send' });
      }
      if (url === 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send') {
        sentRaw.push(Buffer.from(JSON.parse(String(init?.body)).raw, 'base64url').toString('utf8'));
        return json({ id: `m${sentRaw.length}`, threadId: `t${sentRaw.length}` });
      }
      if (url === 'https://oauth2.googleapis.com/revoke') return json({});
      return realFetch(input, init);
    }) as typeof fetch;

    const { env } = await import('../src/env.js');
    ({ sql } = await import('../src/lib/db.js'));
    const supabase = async (path: string, body: unknown) => {
      const res = await realFetch(`${env.SUPABASE_URL}/auth/v1${path}`, {
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
    [{ id: sourceId }] = await sql<{ id: string }[]>`
      insert into public.job_sources (provider, board, company, enabled) values ('lever', ${`friday-qa-${randomUUID().slice(0, 8)}`}, 'QA Co', false) returning id`;
    [{ id: listingId }] = await sql<{ id: string }[]>`
      insert into public.job_listings (source_id, external_id, title, company, apply_url, description_text)
      values (${sourceId}, ${randomUUID()}, 'Backend Engineer', 'QA Co', 'https://jobs.lever.co/x/y', 'Email jobs@qa.co.') returning id`;

    app = Fastify();
    await app.register(sensible);
    await app.register((await import('../src/routes/coldEmail.js')).default);
    await app.ready();
  });

  after(async () => {
    globalThis.fetch = realFetch;
    await app?.close();
    if (sql) {
      if (userId) {
        await sql`delete from auth.users where id = ${userId}`;
        await sql`delete from public.users where id = ${userId}`;
      }
      if (sourceId) await sql`delete from public.job_sources where id = ${sourceId}`;
      await sql.end();
    }
    const queues = await import('../src/lib/queues.js');
    await Promise.all(
      [queues.systemQueue, queues.systemQueueEvents, queues.emailQueue, queues.profileQueue, queues.practiceQueue, queues.historyQueue,
       queues.tailorQueue, queues.matchesQueue, queues.autoApplyQueue, queues.coldEmailQueue].map((q) => q.close()),
    );
    const { redis } = await import('../src/lib/redis.js');
    await redis.quit();
  });

  test('writing an email needs a resume', async () => {
    const res = await call('POST', `/v1/job-feed/${listingId}/cold-email`);
    assert.equal(res.statusCode, 409);
    assert.match(res.json().message, /Upload your resume/);
  });

  test('connecting Gmail asks only to send, and comes back to the job', async () => {
    assert.deepEqual((await call('GET', '/v1/cold-email/gmail')).json<GmailStatus>(), {
      available: true, email: null, sentToday: 0, dailyLimit: COLD_EMAIL_LIMITS.sendsPerDay,
    });
    const res = await call('POST', '/v1/cold-email/gmail/connect', { returnTo: `/top?job=${listingId}` });
    const url = new URL(res.json().url);
    assert.equal(url.origin, 'https://accounts.google.com');
    assert.equal(url.searchParams.get('scope'), 'openid email https://www.googleapis.com/auth/gmail.send');
    const state = url.searchParams.get('state')!;

    // Elsewhere than the jobs site: refused, however it's spelled.
    for (const returnTo of ['//evil.example', '/\\evil.example', '/\t/evil.example', 'https://evil.example/']) {
      assert.equal((await call('POST', '/v1/cold-email/gmail/connect', { returnTo })).statusCode, 400, returnTo);
    }
    // A forged or missing state never connects anyone.
    let cb = await app.inject({ method: 'GET', url: `/v1/cold-email/gmail/callback?code=c&state=${state.slice(0, -2)}xx` });
    assert.equal(cb.statusCode, 302);
    assert.match(cb.headers.location!, /\/cold-emails\?gmail=expired$/);
    // The send box unticked on Google's consent screen.
    cb = await app.inject({ method: 'GET', url: `/v1/cold-email/gmail/callback?code=no-send&state=${state}` });
    assert.match(cb.headers.location!, /gmail=no_send/);
    // Each state is good for one trip to Google.
    cb = await app.inject({ method: 'GET', url: `/v1/cold-email/gmail/callback?code=good&state=${state}` });
    assert.match(cb.headers.location!, /gmail=expired/);

    // Someone else's connect link: Google approves, but the session that comes back isn't the one that started it.
    const { signState } = await import('../src/lib/gmail.js');
    cb = await app.inject({ method: 'GET', url: `/v1/cold-email/gmail/callback?code=good&state=${signState(randomUUID(), '/cold-emails')}` });
    const foreign = new URL(cb.headers.location!).searchParams.get('gmail_code')!;
    let done = await call('POST', '/v1/cold-email/gmail/complete', { code: foreign });
    assert.equal(done.statusCode, 403);
    assert.equal((await sql`select 1 from public.gmail_accounts where user_id = ${userId}`).length, 0);

    // The real thing: back to the job, and the candidate's own session claims the connection, once.
    const fresh = new URL((await call('POST', '/v1/cold-email/gmail/connect', { returnTo: `/top?job=${listingId}` })).json().url).searchParams.get('state')!;
    cb = await app.inject({ method: 'GET', url: `/v1/cold-email/gmail/callback?code=good&state=${fresh}` });
    const back = new URL(cb.headers.location!);
    assert.equal(back.origin + back.pathname, 'http://localhost:3300/top');
    assert.equal(back.searchParams.get('job'), listingId);
    assert.equal((await sql`select 1 from public.gmail_accounts where user_id = ${userId}`).length, 0, 'nothing connected before the claim');
    done = await call('POST', '/v1/cold-email/gmail/complete', { code: back.searchParams.get('gmail_code') });
    assert.equal(done.statusCode, 200);
    assert.equal((await call('POST', '/v1/cold-email/gmail/complete', { code: back.searchParams.get('gmail_code') })).statusCode, 410);
    const [account] = await sql<{ email: string; refresh_token: Buffer }[]>`select email, refresh_token from public.gmail_accounts where user_id = ${userId}`;
    assert.equal(account.email, gmailAddress);
    assert.ok(!account.refresh_token.includes(Buffer.from('1//rt')), 'refresh token is encrypted');
    assert.equal((await call('GET', '/v1/cold-email/gmail')).json<GmailStatus>().email, gmailAddress);
  });

  test('sends once, from Gmail, with the tailored resume attached, and tracks it as applied', async () => {
    const body = { to: 'Priya@QA.co', subject: 'Backend Engineer: 4 yrs Node.js', body: 'Hi Priya,\n\nI am writing about the Backend Engineer role.' };
    // Nothing written yet.
    assert.equal((await call('POST', `/v1/job-feed/${listingId}/cold-email/send`, body)).statusCode, 409);

    const [t] = await sql<{ id: string }[]>`
      insert into public.tailored_resumes (user_id, listing_id, title, company, status, content, file, file_name)
      values (${userId}, ${listingId}, 'Backend Engineer', 'QA Co', 'ready', '{"format":"pdf"}', ${Buffer.from('%PDF-1.4 tailored')}, 'Asha Rao Resume.pdf')
      returning id`;
    await sql`
      insert into public.cold_emails (user_id, listing_id, title, company, status, contacts, to_email, subject, body, match_score, tailored_id)
      values (${userId}, ${listingId}, 'Backend Engineer', 'QA Co', 'ready',
              ${sql.json([{ email: 'priya@qa.co', name: 'Priya Shah', position: 'Recruiter', source: 'finder', confidence: 91 }])},
              'jobs@qa.co', 'Draft subject', 'Draft body', 82, ${t.id})`;
    await sql`insert into public.application_profiles (user_id, data) values (${userId}, ${sql.json({ firstName: 'Asha Rao', lastName: 'Rao' })})`;
    const draft = (await call('GET', `/v1/job-feed/${listingId}/cold-email`)).json<{ email: ColdEmail }>().email;
    assert.equal(draft.attachment, 'Asha Rao Resume.pdf');
    assert.equal(draft.attachmentTailored, true);
    assert.equal(draft.matchScore, 82);

    assert.equal((await call('POST', `/v1/job-feed/${listingId}/cold-email/send`, { ...body, to: gmailAddress })).statusCode, 400);
    assert.equal((await call('POST', `/v1/job-feed/${listingId}/cold-email/send`, { ...body, to: 'not an email' })).statusCode, 400);

    const [first, second] = await Promise.all([
      call('POST', `/v1/job-feed/${listingId}/cold-email/send`, body),
      call('POST', `/v1/job-feed/${listingId}/cold-email/send`, body),
    ]);
    assert.deepEqual([first.statusCode, second.statusCode].sort(), [200, 409], 'a double click sends once');
    assert.equal(sentRaw.length, 1);
    const sent = (first.statusCode === 200 ? first : second).json<{ email: ColdEmail }>().email;
    assert.equal(sent.status, 'sent');
    assert.equal(sent.to, 'priya@qa.co');
    assert.equal(sent.toName, 'Priya Shah');
    assert.equal(sent.gmailUrl, 'https://mail.google.com/mail/u/0/#sent/t1');

    const mime = sentRaw[0];
    assert.match(mime, /^To: priya@qa\.co$/m);
    assert.ok(mime.includes(`\r\nFrom: Asha Rao <${gmailAddress}>\r\n`) || mime.startsWith(`From: Asha Rao <${gmailAddress}>\r\n`));
    assert.match(mime, /filename="Asha Rao Resume\.pdf"/);
    assert.ok(mime.includes(Buffer.from('%PDF-1.4 tailored').toString('base64')));

    const [application] = await sql<{ status: string }[]>`select status from public.job_applications where user_id = ${userId} and listing_id = ${listingId}`;
    assert.equal(application.status, 'applied');
    // Sent is final: no resend, no rewrite.
    assert.equal((await call('POST', `/v1/job-feed/${listingId}/cold-email/send`, body)).statusCode, 409);
    assert.equal((await call('POST', `/v1/job-feed/${listingId}/cold-email`)).statusCode, 409);
    assert.equal((await call('GET', '/v1/cold-emails')).json<{ items: ColdEmail[] }>().items.length, 1);
  });

  test('stops at the daily limit', async () => {
    await sql`
      insert into public.cold_emails (user_id, title, company, status, sent_at)
      select ${userId}, 'Old', 'Co', 'sent', now() from generate_series(2, ${COLD_EMAIL_LIMITS.sendsPerDay})`;
    const [{ id: other }] = await sql<{ id: string }[]>`
      insert into public.job_listings (source_id, external_id, title, company, apply_url, description_text)
      values (${sourceId}, ${randomUUID()}, 'Data Engineer', 'QA Co', 'https://jobs.lever.co/x/z', 'Build pipelines.') returning id`;
    await sql`insert into public.cold_emails (user_id, listing_id, title, company, status, subject, body) values (${userId}, ${other}, 'Data Engineer', 'QA Co', 'ready', 's', 'b')`;
    const res = await call('POST', `/v1/job-feed/${other}/cold-email/send`, { to: 'a@qa.co', subject: 'Data role', body: 'Hi there, about the data role.' });
    assert.equal(res.statusCode, 429);
    await sql`delete from public.cold_emails where user_id = ${userId} and listing_id is null`;
  });

  test('a revoked Gmail is disconnected and the email is not lost', async () => {
    const [{ listing_id }] = await sql<{ listing_id: string }[]>`
      select listing_id from public.cold_emails where user_id = ${userId} and status = 'ready'`;
    // A user with no resume file can't attach one.
    await sql`insert into public.resumes (user_id, file_name, mime_type, text, status, file) values (${userId}, 'r.pdf', 'application/pdf', 'Asha', 'ready', ${Buffer.from('%PDF own')})`;
    tokenAnswer = 'revoked';
    const { forgetAccessToken } = await import('../src/lib/gmail.js');
    forgetAccessToken(userId);
    const res = await call('POST', `/v1/job-feed/${listing_id}/cold-email/send`, { to: 'a@qa.co', subject: 'Data role', body: 'Hi there, about the data role.' });
    assert.equal(res.statusCode, 409);
    assert.equal(res.json().error, 'gmail_not_connected');
    assert.equal((await sql`select 1 from public.gmail_accounts where user_id = ${userId}`).length, 0);
    const [row] = await sql<{ status: string; sending_at: Date | null }[]>`select status, sending_at from public.cold_emails where user_id = ${userId} and listing_id = ${listing_id}`;
    assert.deepEqual(row, { status: 'ready', sending_at: null });
  });
});
