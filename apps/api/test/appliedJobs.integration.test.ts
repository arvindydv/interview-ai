// The Applied Jobs dashboard (routes/appliedJobs.ts) against the local stack: what counts as applied
// (evidence only), Verified vs You confirmed, dedupe across Auto Apply / bot / the user's own records,
// today and this month in the user's timezone, filters, search, pagination, Needs your action with its
// questions, and signed resume downloads (owner only, untampered, unexpired). Skipped unless
// SUPABASE_SERVICE_ROLE_KEY is set, e.g.
//   SUPABASE_SERVICE_ROLE_KEY=$(npx supabase status -o env | sed -n 's/^SERVICE_ROLE_KEY="\(.*\)"/\1/p') pnpm test
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import Fastify, { type FastifyInstance } from 'fastify';
import sensible from '@fastify/sensible';
import type { AppliedJobsPage } from '@parakeet/shared';

const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

describe('applied jobs dashboard', { skip: !serviceKey && 'set SUPABASE_SERVICE_ROLE_KEY to run against the local stack' }, () => {
  let app: FastifyInstance;
  let sql: typeof import('../src/lib/db.js').sql;
  const users: { id: string; token: string }[] = [];
  let sourceId: string;
  const board = `friday-applied-${randomUUID().slice(0, 8)}`;

  const call = (url: string, token: string | null) =>
    app.inject({ method: 'GET', url, headers: token ? { authorization: `Bearer ${token}` } : {} });
  const page = async (token: string, query = '') => {
    const res = await call(`/v1/applied-jobs${query}`, token);
    assert.equal(res.statusCode, 200, res.body);
    return res.json() as AppliedJobsPage;
  };

  async function listing(title: string, company = 'QA Co') {
    const [l] = await sql<{ id: string }[]>`
      insert into public.job_listings (source_id, external_id, title, company, apply_url, description_text, location)
      values (${sourceId}, ${randomUUID()}, ${title}, ${company}, ${`https://jobs.lever.co/${board}/${randomUUID()}`}, 'Build.', 'Bengaluru')
      returning id`;
    return l.id;
  }

  async function auto(userId: string, opts: {
    title: string; company?: string; status: string; reason?: string | null; via?: string | null; submittedAt?: string; channel?: string | null;
    form?: unknown[]; missing?: string[]; resume?: boolean; failure?: unknown; externalId?: string;
  }) {
    const company = opts.company ?? 'QA Co';
    const listingId = await listing(opts.title, company);
    let tailoredId: string | null = null;
    if (opts.resume !== false) {
      [{ id: tailoredId }] = await sql<{ id: string }[]>`
        insert into public.tailored_resumes (user_id, listing_id, title, company, status, content, file, file_name)
        values (${userId}, ${listingId}, ${opts.title}, ${company}, 'ready', '{"format":"pdf"}', ${Buffer.from(`%PDF-1.4 ${opts.title}`)}, 'Asha Rao Resume.pdf')
        returning id`;
    }
    const [a] = await sql<{ id: string }[]>`
      insert into public.auto_applications (user_id, listing_id, tailored_resume_id, provider, apply_url, title, company, score, status,
        reason_code, submitted_via, submitted_at, channel, form, missing, plan_day, failure, external_application_id)
      values (${userId}, ${listingId}, ${tailoredId}, 'lever', 'https://jobs.lever.co/x/y/apply', ${opts.title}, ${company}, 85, ${opts.status},
        ${opts.reason ?? null}, ${opts.via ?? null}, ${opts.submittedAt ?? null}, ${opts.channel ?? null},
        ${opts.form ? sql.json(opts.form as never) : null}, ${opts.missing ?? []}, current_date,
        ${opts.failure ? sql.json(opts.failure as never) : null}, ${opts.externalId ?? null})
      returning id`;
    return { id: a.id, listingId };
  }

  before(async () => {
    const { env } = await import('../src/env.js');
    ({ sql } = await import('../src/lib/db.js'));
    const supabase = async (path: string, body: unknown) => {
      const res = await fetch(`${env.SUPABASE_URL}/auth/v1${path}`, {
        method: 'POST',
        headers: { apikey: serviceKey!, authorization: `Bearer ${serviceKey}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      assert.ok(res.ok, `${path}: ${JSON.stringify(json)}`);
      return json;
    };
    for (let i = 0; i < 2; i++) {
      const email = `applied-test-${randomUUID().slice(0, 8)}@example.com`;
      const password = randomUUID();
      const id = (await supabase('/admin/users', { email, password, email_confirm: true })).id;
      const token = (await supabase('/token?grant_type=password', { email, password })).access_token;
      await sql`insert into public.users (id, email, auth_provider) values (${id}, ${email}, 'email')`;
      users.push({ id, token });
    }
    [{ id: sourceId }] = await sql<{ id: string }[]>`
      insert into public.job_sources (provider, board, company, enabled) values ('lever', ${board}, 'QA Co', false) returning id`;

    app = Fastify();
    await app.register(sensible);
    await app.register((await import('../src/routes/appliedJobs.js')).default);
    await app.ready();
  });

  after(async () => {
    await app?.close();
    if (sql) {
      for (const u of users) {
        await sql`delete from auth.users where id = ${u.id}`;
        await sql`delete from public.users where id = ${u.id}`;
      }
      if (sourceId) await sql`delete from public.job_sources where id = ${sourceId}`;
      await sql.end();
    }
  });

  test('counts only applications with evidence, labelled Verified or You confirmed', async () => {
    const [u] = users;
    await auto(u.id, { title: 'Verified Engineer', status: 'submitted', via: 'cloud', submittedAt: new Date().toISOString(), channel: 'cloud_form' });
    await auto(u.id, { title: 'Api Engineer', status: 'submitted', via: 'api', submittedAt: new Date().toISOString(), channel: 'api', externalId: 'gh-123' });
    await auto(u.id, { title: 'Confirmed Engineer', status: 'submitted', via: 'user', submittedAt: new Date().toISOString() });
    // None of these count.
    await auto(u.id, { title: 'Queued Engineer', status: 'preparing' });
    await auto(u.id, { title: 'Prepared Engineer', status: 'prepared', channel: 'cloud_form' });
    await auto(u.id, { title: 'Submitting Engineer', status: 'pending', reason: 'submitting', channel: 'cloud_form' });
    await auto(u.id, { title: 'Unverified Engineer', status: 'pending', reason: 'unverified', channel: 'cloud_form' });
    await auto(u.id, {
      title: 'Failed Engineer', status: 'failed', reason: 'submit_failed',
      failure: { code: 'http_429', httpStatus: 429, message: 'Rate limited by the ATS; contact asha@example.com', retryable: true, at: new Date().toISOString() },
    });
    await auto(u.id, { title: 'Skipped Engineer', status: 'skipped', reason: 'listing_closed' });

    const p = await page(u.token, '?status=all&pageSize=100');
    assert.equal(p.stats.total, 3);
    assert.equal(p.stats.verified, 2);
    assert.equal(p.stats.userConfirmed, 1);
    assert.equal(p.stats.today, 3);
    assert.equal(p.stats.thisMonth, 3);
    assert.equal(p.stats.failed, 1);
    assert.equal(p.stats.inProgress, 3);
    assert.equal(p.stats.needsAction, 1);
    assert.deepEqual(p.stats.byPlatform, [{ platform: 'lever', submitted: 3 }]);

    const by = new Map(p.items.map((i) => [i.title, i]));
    assert.equal(by.get('Verified Engineer')!.evidence, 'verified');
    assert.equal(by.get('Api Engineer')!.evidenceDetail, 'ATS application id gh-123');
    assert.equal(by.get('Confirmed Engineer')!.evidence, 'user_confirmed');
    for (const t of ['Queued Engineer', 'Prepared Engineer', 'Submitting Engineer', 'Unverified Engineer', 'Failed Engineer']) {
      assert.equal(by.get(t)!.evidence, null, t);
      assert.equal(by.get(t)!.appliedAt, null, t);
    }
    assert.equal(by.get('Unverified Engineer')!.status, 'needs_action');
    const failed = by.get('Failed Engineer')!;
    assert.equal(failed.status, 'failed');
    assert.equal(failed.failure?.code, 'http_429');
    assert.doesNotMatch(failed.failure!.message, /asha@example\.com/, 'failure details are redacted');

    // Skipped rows are hidden unless asked for.
    const def = await page(u.token, '?pageSize=100');
    assert.ok(!def.items.some((i) => i.status === 'skipped'));
    assert.ok((await page(u.token, '?status=skipped')).items.every((i) => i.status === 'skipped'));
  });

  test('the same job in two tables is one row, the one with evidence', async () => {
    const [u] = users;
    const { listingId } = await auto(u.id, { title: 'Dedupe Engineer', company: 'Dup Co', status: 'submitted', via: 'cloud', submittedAt: new Date().toISOString() });
    // Auto Apply's confirm also records it in the user's own list (markApplied), and the bot saw it too.
    await sql`
      insert into public.job_applications (user_id, listing_id, title, company, apply_url, status, applied_at)
      values (${u.id}, ${listingId}, 'Dedupe Engineer', 'Dup Co', 'https://x.test', 'applied', now())`;
    await sql`
      insert into public.job_bot_applications (user_id, platform, job_id, title, company, url, outcome)
      values (${u.id}, 'linkedin', ${randomUUID()}, 'dedupe engineer ', 'DUP CO', 'https://linkedin.test/1', 'failed')`;
    const p = await page(u.token, '?q=dedupe&status=all');
    assert.equal(p.items.length, 1);
    assert.equal(p.items[0].id.startsWith('auto:'), true);
    assert.equal(p.items[0].evidence, 'verified');
    assert.equal(p.stats.total, 4);
  });

  test('today and this month are in the user’s timezone', async () => {
    const [, v] = users;
    // 23:30 UTC yesterday is already today in Kolkata (UTC+5:30) when it's before 18:30 UTC now; build a
    // timestamp that is "today" in Kolkata but "yesterday" in UTC by taking Kolkata midnight + 1 minute.
    const [{ kolkata_midnight }] = await sql<{ kolkata_midnight: Date }[]>`
      select (date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata') + interval '1 minute' as kolkata_midnight`;
    await auto(v.id, { title: 'Tz Engineer', status: 'submitted', via: 'cloud', submittedAt: kolkata_midnight.toISOString() });
    await auto(v.id, { title: 'Old Engineer', status: 'submitted', via: 'cloud', submittedAt: new Date(Date.now() - 45 * 86400_000).toISOString() });
    let p = await page(v.token);
    assert.equal(p.stats.today, 1);
    assert.equal(p.stats.total, 2);
    // Los Angeles is 13½ hours behind: Kolkata's 00:01 is LA's previous morning, which is LA's "today" only
    // while LA itself is still on that date. Whatever the clock, the count follows LA's calendar.
    await sql`insert into public.auto_apply_settings (user_id, timezone) values (${v.id}, 'America/Los_Angeles')`;
    const [{ same }] = await sql<{ same: boolean }[]>`
      select (${kolkata_midnight}::timestamptz at time zone 'America/Los_Angeles')::date = (now() at time zone 'America/Los_Angeles')::date as same`;
    p = await page(v.token);
    assert.equal(p.stats.today, same ? 1 : 0);
  });

  test('filters, search and stable pagination', async () => {
    const [u] = users;
    const all = await page(u.token, '?status=all&pageSize=100');
    const first = await page(u.token, '?status=all&pageSize=2&page=1');
    const second = await page(u.token, '?status=all&pageSize=2&page=2');
    assert.equal(first.total, all.total);
    assert.equal(first.items.length, 2);
    assert.deepEqual([...first.items, ...second.items].map((i) => i.id), all.items.slice(0, 4).map((i) => i.id));
    assert.ok((await page(u.token, '?evidence=user_confirmed')).items.every((i) => i.evidence === 'user_confirmed'));
    assert.ok((await page(u.token, '?channel=api')).items.every((i) => i.channel === 'api'));
    assert.ok((await page(u.token, '?platform=lever&status=submitted')).items.every((i) => i.platform === 'lever' && i.status === 'submitted'));
    const search = await page(u.token, '?q=Api%20Eng');
    assert.deepEqual(search.items.map((i) => i.title), ['Api Engineer']);
    assert.equal((await call('/v1/applied-jobs?status=bogus', u.token)).statusCode, 400);
    assert.equal((await call('/v1/applied-jobs', null)).statusCode, 401);
  });

  test('needs your action lists the questions to answer once, and assisted jobs to confirm', async () => {
    const [u] = users;
    await auto(u.id, {
      title: 'Question Engineer', status: 'pending', reason: 'needs_answers',
      form: [
        { key: 'name', label: 'Full name', type: 'text', required: true, options: [], kind: 'standard' },
        { key: 'q1', label: 'Years of Kafka experience?', type: 'text', required: true, options: [], kind: 'custom' },
        { key: 'q2', label: 'Current CTC?', type: 'text', required: true, options: [], kind: 'custom' },
      ],
      missing: ['q1', 'q2'],
    });
    await auto(u.id, { title: 'Assisted Engineer', status: 'prepared', channel: 'assisted' });
    await sql`
      insert into public.job_bot_applications (user_id, platform, job_id, title, company, url, outcome, detail)
      values (${u.id}, 'indeed', ${randomUUID()}, 'Bot Question Engineer', 'QA Co', 'https://indeed.test/1', 'needs_answer',
              'Notice period in days (needs a number) | Willing to relocate to Pune? (options: Yes, No)'),
             (${u.id}, 'naukri', ${randomUUID()}, 'Naukri Engineer', 'QA Co', 'https://naukri.test/1', 'assisted', 'Added by you')`;
    const p = await page(u.token, '?status=needs_action&pageSize=100');
    const by = new Map(p.items.map((i) => [i.title, i]));
    assert.deepEqual(by.get('Question Engineer')!.questions, [
      { key: 'q1', label: 'Years of Kafka experience?' },
      { key: 'q2', label: 'Current CTC?' },
    ]);
    assert.equal(by.get('Assisted Engineer')!.channel, 'assisted');
    assert.match(by.get('Assisted Engineer')!.action!, /confirm/);
    assert.deepEqual(by.get('Bot Question Engineer')!.questions.map((q) => q.label), ['Notice period in days', 'Willing to relocate to Pune?']);
    assert.equal(by.get('Naukri Engineer')!.channel, 'assisted');
    // Needs-action rows come first in the default list.
    const def = await page(u.token, '?pageSize=100');
    const firstOther = def.items.findIndex((i) => i.status !== 'needs_action');
    assert.ok(def.items.slice(firstOther).every((i) => i.status !== 'needs_action'));
  });

  test('resume links: owner only, untampered, unexpired', async () => {
    const [u, v] = users;
    const p = await page(u.token, '?q=Verified%20Engineer');
    const url = new URL(p.items.find((i) => i.title === 'Verified Engineer')!.resumeUrl!);
    const path = `${url.pathname}${url.search}`;
    let res = await app.inject({ method: 'GET', url: path });
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(res.headers['content-type'], 'application/pdf');
    assert.equal(res.headers['cache-control'], 'private, no-store');
    assert.match(res.body, /%PDF-1.4 Verified Engineer/);
    const [log] = await sql<{ action: string }[]>`select action from public.audit_logs where user_id = ${u.id} and action = 'resume.download' limit 1`;
    assert.equal(log?.action, 'resume.download');

    // Tampered signature, someone else's user id, and an expired link.
    const params = url.searchParams;
    const sig = params.get('sig')!;
    res = await app.inject({ method: 'GET', url: path.replace(sig, `${sig.slice(0, -2)}xx`) });
    assert.equal(res.statusCode, 403);
    res = await app.inject({ method: 'GET', url: path.replace(u.id, v.id) });
    assert.equal(res.statusCode, 403);
    const { signDownload } = await import('../src/lib/signedUrl.js');
    const id = decodeURIComponent(url.pathname.split('/')[3]);
    const old = signDownload(u.id, `applied-resume:${id}`, 60, Date.now() - 3600_000);
    res = await app.inject({ method: 'GET', url: `${url.pathname}?u=${u.id}&exp=${old.exp}&sig=${old.sig}` });
    assert.equal(res.statusCode, 403);

    // A valid signature for user v on u's application: signed, but not theirs.
    const forged = signDownload(v.id, `applied-resume:${id}`);
    res = await app.inject({ method: 'GET', url: `${url.pathname}?u=${v.id}&exp=${forged.exp}&sig=${forged.sig}` });
    assert.equal(res.statusCode, 404);

    // v's dashboard never shows u's applications.
    const vp = await page(v.token, '?status=all&pageSize=100');
    assert.ok(!vp.items.some((i) => i.id === id));
  });
});
