// End-to-end test of Auto Apply's API against the local stack (`pnpm infra:up`): settings and consent,
// the extension's device tokens, claiming, every report outcome (including a CAPTCHA the user finishes
// in the tab), answers, retries and confirmation. A real Supabase user, Postgres and Redis. Skipped
// unless SUPABASE_SERVICE_ROLE_KEY is set, e.g.
//   SUPABASE_SERVICE_ROLE_KEY=$(npx supabase status -o env | sed -n 's/^SERVICE_ROLE_KEY="\(.*\)"/\1/p') pnpm test
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import Fastify, { type FastifyInstance } from 'fastify';
import sensible from '@fastify/sensible';
import type { AutoApplyDeviceToken, AutoApplyOverview, AutoApplyTask } from '@parakeet/shared';

const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const APPLIER_TOKEN = `applier-test-${randomUUID()}`;

describe('auto apply', { skip: !serviceKey && 'set SUPABASE_SERVICE_ROLE_KEY to run against the local stack' }, () => {
  let app: FastifyInstance;
  let sql: typeof import('../src/lib/db.js').sql;
  let userId: string;
  let userToken: string;
  let sourceId: string;
  const email = `autoapply-test-${randomUUID().slice(0, 8)}@example.com`;
  const board = `friday-qa-${randomUUID().slice(0, 8)}`;

  const call = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, body?: unknown, token: string | null = userToken) =>
    app.inject({ method, url, headers: token ? { authorization: `Bearer ${token}` } : {}, ...(body === undefined ? {} : { payload: body as object }) });

  const PROFILE = {
    firstName: 'Asha', lastName: 'Rao', email, phone: '+91 98765 43210', city: 'Bengaluru', country: 'India',
    linkedin: '', github: '', portfolio: '', website: '',
    workAuthorization: [{ country: 'India', authorized: true, needsSponsorship: false }],
    noticePeriodDays: 30, currentSalary: '', expectedSalary: '', willingToRelocate: null, earliestStart: '', gender: '', savedAnswers: [],
  };

  /** A listing, a match and an application in the given state, with a tailored resume ready to send. */
  async function seed(opts: { status?: string; reason?: string | null; score?: number; title?: string; form?: unknown[]; answers?: unknown[] } = {}) {
    const title = opts.title ?? `Engineer ${randomUUID().slice(0, 6)}`;
    const [l] = await sql<{ id: string }[]>`
      insert into public.job_listings (source_id, external_id, title, company, apply_url, description_text)
      values (${sourceId}, ${randomUUID()}, ${title}, 'QA Co', 'https://jobs.lever.co/x/y', 'Build things.') returning id`;
    const [t] = await sql<{ id: string }[]>`
      insert into public.tailored_resumes (user_id, listing_id, title, company, status, content, file, file_name, cover_letter, cover_letter_file)
      values (${userId}, ${l.id}, ${title}, 'QA Co', 'ready', '{"format":"pdf"}', ${Buffer.from('%PDF-1.4 resume')}, 'Asha Rao Resume.pdf',
              'Dear team', ${Buffer.from('%PDF-1.4 cover')}) returning id`;
    const form = opts.form ?? [{ key: 'name', label: 'Full name', type: 'text', required: true, options: [], kind: 'standard' }];
    const answers = opts.answers ?? [{ key: 'name', label: 'Full name', value: 'Asha Rao', source: 'profile' }];
    const [a] = await sql<{ id: string }[]>`
      insert into public.auto_applications (user_id, listing_id, tailored_resume_id, provider, apply_url, title, company, score, status,
                                            reason_code, form, answers, plan_day)
      values (${userId}, ${l.id}, ${t.id}, 'lever', ${`https://jobs.lever.co/${board}/${l.id}/apply`}, ${title}, 'QA Co', ${opts.score ?? 80},
              ${opts.status ?? 'prepared'}, ${opts.reason ?? null}, ${sql.json(form as never)}, ${sql.json(answers as never)}, current_date)
      returning id`;
    return { listingId: l.id, appId: a.id };
  }

  const appRow = async (id: string) =>
    (await sql<{ status: string; reason_code: string | null; retry_at: Date | null; missing: string[]; claimed_by: string | null }[]>`
      select status, reason_code, retry_at, missing, claimed_by from public.auto_applications where id = ${id}`)[0];

  /** Claims until it gets this application (others seeded earlier may come first). */
  async function claimAs(token: string) {
    const res = await call('POST', '/v1/auto-apply/claim', { device: 'test' }, token);
    assert.equal(res.statusCode, 200, res.body);
    return (res.json() as { task: AutoApplyTask | null }).task;
  }

  before(async () => {
    // The applier's token (routes/applier.ts), set before the API reads its environment.
    process.env.APPLIER_TOKEN_SHA256 = createHash('sha256').update(APPLIER_TOKEN).digest('hex');
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
    const password = randomUUID();
    userId = (await supabase('/admin/users', { email, password, email_confirm: true })).id;
    userToken = (await supabase('/token?grant_type=password', { email, password })).access_token;
    await sql`insert into public.users (id, email, auth_provider) values (${userId}, ${email}, 'email')`;
    [{ id: sourceId }] = await sql<{ id: string }[]>`
      insert into public.job_sources (provider, board, company, enabled) values ('lever', ${board}, 'QA Co', false) returning id`;

    const routes = (await import('../src/routes/autoApply.js')).default;
    app = Fastify();
    await app.register(sensible);
    await app.register(routes);
    await app.register((await import('../src/routes/applier.js')).default);
    await app.ready();
  });

  after(async () => {
    await app?.close();
    let appIds = new Set<string>();
    if (sql) {
      if (userId) {
        appIds = new Set((await sql<{ id: string }[]>`select id from public.auto_applications where user_id = ${userId}`).map((r) => r.id));
        await sql`delete from auth.users where id = ${userId}`;
        await sql`delete from public.users where id = ${userId}`;
      }
      if (sourceId) await sql`delete from public.job_sources where id = ${sourceId}`;
      await sql.end();
    }
    // Jobs this test queued for the worker: dropped, so a running worker doesn't pick them up.
    const queues = await import('../src/lib/queues.js');
    for (const job of await queues.autoApplyQueue.getJobs(['waiting', 'delayed', 'prioritized', 'paused'])) {
      if (job && (job.data?.userId === userId || appIds.has(job.data?.applicationId))) await job.remove().catch(() => {});
    }
    await Promise.all(
      [queues.systemQueue, queues.systemQueueEvents, queues.emailQueue, queues.profileQueue, queues.practiceQueue, queues.historyQueue,
       queues.tailorQueue, queues.matchesQueue, queues.autoApplyQueue].map((q) => q.close()),
    );
    const { redis } = await import('../src/lib/redis.js');
    await redis.quit();
  });

  test('needs a resume, a complete profile and consent before it turns on', async () => {
    let res = await call('PUT', '/v1/auto-apply/settings', { enabled: true });
    assert.equal(res.statusCode, 409);
    assert.match(res.json().message, /Upload your resume/);
    assert.match(res.json().message, /application profile/);
    assert.match(res.json().message, /Agree/);

    await sql`
      insert into public.resumes (user_id, file_name, mime_type, text, status, file)
      values (${userId}, 'resume.pdf', 'application/pdf', 'Asha Rao, engineer', 'ready', ${Buffer.from('%PDF')})`;
    res = await call('PUT', '/v1/auto-apply/profile', { ...PROFILE, phone: '12' });
    assert.equal(res.statusCode, 200);
    res = await call('PUT', '/v1/auto-apply/settings', { enabled: true, consent: true });
    assert.equal(res.statusCode, 409);
    assert.match(res.json().message, /Phone/);

    res = await call('PUT', '/v1/auto-apply/profile', PROFILE);
    assert.equal(res.statusCode, 200);
    res = await call('PUT', '/v1/auto-apply/settings', { enabled: true, consent: true, minScore: 60 });
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(res.json().enabled, true);
    assert.equal(res.json().minScore, 60);
    assert.ok(res.json().consentedAt);
  });

  test('common questions are saved, and older clients that don’t send them get the defaults', async () => {
    const full = {
      ...PROFILE, noticePeriodDays: 30, currentSalary: '₹18 LPA', expectedSalary: '₹25 LPA', languages: ['English', 'Hindi'],
      otherCountries: { authorized: false, needsSponsorship: true }, workplaces: ['hybrid', 'onsite'], willingToTravel: true,
      hometown: 'Lucknow, Uttar Pradesh', securityClearance: false, recordingConsent: true, backgroundCheckConsent: true,
      preferredName: 'Ash', pronouns: 'she/her', letAiDecide: false,
    };
    let res = await call('PUT', '/v1/auto-apply/profile', full);
    assert.equal(res.statusCode, 200, res.body);
    let profile = ((await call('GET', '/v1/auto-apply')).json() as AutoApplyOverview).profile;
    for (const [k, v] of Object.entries(full)) assert.deepEqual(profile[k as keyof typeof profile], v, k);
    assert.equal((await call('PUT', '/v1/auto-apply/profile', { ...full, workplaces: ['office'] })).statusCode, 400);

    res = await call('PUT', '/v1/auto-apply/profile', PROFILE);
    assert.equal(res.statusCode, 200, res.body);
    profile = ((await call('GET', '/v1/auto-apply')).json() as AutoApplyOverview).profile;
    assert.deepEqual(profile.languages, []);
    assert.equal(profile.otherCountries, null);
    assert.equal(profile.letAiDecide, true);
  });

  test('a profile not saved yet is filled in from the resume', async () => {
    const { prefillFromResume } = await import('../src/routes/autoApply.js');
    const { EMPTY_APPLICATION_PROFILE } = await import('@parakeet/shared');
    const text = `Asha Rao\nBengaluru · +91 98765 43210 · asha@example.com\nlinkedin.com/in/asha-rao-12/ · https://github.com/asharao\n` +
      `Experience 2019 - 2023\nProject: github.com/asharao/payments-engine\nLanguages: English (fluent), Hindi, Kannada\n`;
    const parsed = { name: 'Asha K Rao' } as Parameters<typeof prefillFromResume>[2];
    assert.deepEqual(prefillFromResume(EMPTY_APPLICATION_PROFILE, text, parsed), {
      firstName: 'Asha', lastName: 'K Rao', linkedin: 'https://linkedin.com/in/asha-rao-12', github: 'https://github.com/asharao',
      phone: '+91 98765 43210', languages: ['English', 'Hindi', 'Kannada'],
    });
    // What the user already has is kept.
    const mine = { ...EMPTY_APPLICATION_PROFILE, linkedin: 'https://linkedin.com/in/me', languages: ['Tamil'] };
    const out = prefillFromResume(mine, text, parsed);
    assert.equal(out.linkedin, undefined);
    assert.equal(out.languages, undefined);
    assert.deepEqual(prefillFromResume(EMPTY_APPLICATION_PROFILE, 'No links here. 2019 - 2023', null), {});
  });

  test('the free plan caps the daily limit', async () => {
    const res = await call('PUT', '/v1/auto-apply/settings', { dailyLimit: 400 });
    assert.equal(res.statusCode, 402);
    assert.equal((await call('PUT', '/v1/auto-apply/settings', { dailyLimit: 3 })).json().dailyLimit, 3);
  });

  test('Friday’s servers submit by default, and the user can keep everything in their browser', async () => {
    assert.equal((await call('GET', '/v1/auto-apply')).json().settings.cloudSubmit, true);
    assert.equal((await call('PUT', '/v1/auto-apply/settings', { cloudSubmit: false })).json().cloudSubmit, false);
    assert.equal((await call('PUT', '/v1/auto-apply/settings', { minScore: 70 })).json().cloudSubmit, false, 'kept when other settings change');
    assert.equal((await call('PUT', '/v1/auto-apply/settings', { cloudSubmit: true })).json().cloudSubmit, true);
  });

  test('bad input is refused', async () => {
    assert.equal((await call('PUT', '/v1/auto-apply/settings', { minScore: 10 })).statusCode, 400);
    assert.equal((await call('PUT', '/v1/auto-apply/settings', { timezone: 'Mars/Base' })).statusCode, 400);
    assert.equal((await call('GET', '/v1/auto-apply/applications/not-a-uuid')).statusCode, 404);
    assert.equal((await call('GET', '/v1/auto-apply', undefined, null)).statusCode, 401);
    assert.equal((await call('GET', '/v1/auto-apply', undefined, 'fdx_made-up')).statusCode, 403);
    assert.equal((await call('POST', '/v1/auto-apply/claim', { device: 'x' }, 'fdx_made-up')).statusCode, 401);
  });

  describe('devices', () => {
    let device: AutoApplyDeviceToken;

    test('the extension gets a token of its own, good only for its routes', async () => {
      const res = await call('POST', '/v1/auto-apply/devices', { name: 'Chrome on Linux' });
      assert.equal(res.statusCode, 200, res.body);
      device = res.json();
      assert.match(device.token, /^fdx_/);
      assert.equal(device.userId, userId);
      assert.equal(device.email, email);

      // Its own routes work...
      const who = await call('GET', '/v1/auto-apply/device', undefined, device.token);
      assert.equal(who.statusCode, 200);
      assert.equal(who.json().email, email);
      assert.equal(who.json().enabled, true);
      // ...nothing else does, and it can't mint more devices or remove others.
      assert.equal((await call('GET', '/v1/auto-apply', undefined, device.token)).statusCode, 403);
      assert.equal((await call('PUT', '/v1/auto-apply/settings', { enabled: false }, device.token)).statusCode, 403);
      assert.equal((await call('POST', '/v1/auto-apply/devices', { name: 'x' }, device.token)).statusCode, 403);
      assert.equal((await call('DELETE', `/v1/auto-apply/devices/${device.device.id}`, undefined, device.token)).statusCode, 403);

      const overview = (await call('GET', '/v1/auto-apply')).json() as AutoApplyOverview;
      assert.deepEqual(overview.devices.map((d) => d.id), [device.device.id]);
      assert.ok(overview.devices[0].lastSeenAt);
    });

    test('a claim by a device is leased to it', async () => {
      const { appId } = await seed({ score: 99 });
      const task = await claimAs(device.token);
      assert.equal(task?.id, appId);
      assert.equal(task?.resumeFileName, 'Asha Rao Resume.pdf');
      assert.equal(task?.coverLetterFileName, 'Asha Rao Cover Letter.pdf');
      const row = await appRow(appId);
      assert.equal(row.status, 'pending');
      assert.equal(row.reason_code, 'submitting');
      assert.equal(row.claimed_by, device.device.id);

      const resume = await call('GET', task!.resumePath, undefined, device.token);
      assert.equal(resume.statusCode, 200);
      assert.equal(resume.headers['content-type'], 'application/pdf');
      assert.equal(resume.body, '%PDF-1.4 resume');
      assert.equal((await call('GET', task!.coverLetterPath!, undefined, device.token)).body, '%PDF-1.4 cover');

      const res = await call('POST', `/v1/auto-apply/applications/${appId}/report`, {
        outcome: 'submitted',
        evidence: { url: `https://jobs.lever.co/${board}/x/thanks`, text: 'Application submitted!' },
      }, device.token);
      assert.equal(res.json().status, 'submitted');
    });

    test('disconnecting a device stops it at once', async () => {
      const other = (await call('POST', '/v1/auto-apply/devices', { name: 'Old laptop' })).json() as AutoApplyDeviceToken;
      assert.equal((await call('DELETE', `/v1/auto-apply/devices/${other.device.id}`)).statusCode, 200);
      assert.equal((await call('POST', '/v1/auto-apply/claim', { device: 'x' }, other.token)).statusCode, 401);
      // The extension can disconnect itself.
      assert.equal((await call('DELETE', '/v1/auto-apply/devices/self', undefined, device.token)).statusCode, 200);
      assert.equal((await call('GET', '/v1/auto-apply/device', undefined, device.token)).statusCode, 401);
      assert.equal(((await call('GET', '/v1/auto-apply')).json() as AutoApplyOverview).devices.length, 0);
    });
  });

  test('claims go best match first, and only after a back-off', async () => {
    await sql`update public.auto_applications set status = 'skipped' where user_id = ${userId} and status = 'prepared'`;
    const low = await seed({ score: 60 });
    const high = await seed({ score: 95 });
    const later = await seed({ score: 99 });
    await sql`update public.auto_applications set retry_at = now() + interval '1 hour' where id = ${later.appId}`;
    assert.equal((await claimAs(userToken))?.id, high.appId);
    assert.equal((await claimAs(userToken))?.id, low.appId);
    assert.equal(await claimAs(userToken), null);
    for (const id of [high.appId, low.appId]) {
      await call('POST', `/v1/auto-apply/applications/${id}/report`, { outcome: 'submitted', evidence: { url: 'https://jobs.lever.co/a/b/thanks', text: '' } });
    }
    await sql`update public.auto_applications set status = 'skipped' where id = ${later.appId}`;
  });

  test('a verified submission lands in the Applied list', async () => {
    const { appId, listingId } = await seed();
    await claimAs(userToken);
    const res = await call('POST', `/v1/auto-apply/applications/${appId}/report`, {
      outcome: 'submitted',
      evidence: { url: 'https://jobs.lever.co/qa/123', text: 'Thanks for applying! We have received your application.' },
    });
    assert.equal(res.json().status, 'submitted');
    const [j] = await sql<{ status: string }[]>`select status from public.job_applications where user_id = ${userId} and listing_id = ${listingId}`;
    assert.equal(j.status, 'applied');
    // Reporting twice is refused rather than counted twice.
    assert.equal((await call('POST', `/v1/auto-apply/applications/${appId}/report`, { outcome: 'submitted' })).statusCode, 409);
  });

  test('an unconfirmed submission waits for the user to confirm it', async () => {
    const { appId } = await seed();
    await claimAs(userToken);
    const res = await call('POST', `/v1/auto-apply/applications/${appId}/report`, { outcome: 'submitted', evidence: { url: 'https://jobs.lever.co/qa/1/apply', text: 'Loading…' } });
    assert.equal(res.json().status, 'pending');
    assert.equal((await appRow(appId)).reason_code, 'unverified');
    assert.equal((await call('POST', `/v1/auto-apply/applications/${appId}/retry`)).statusCode, 409);
    assert.equal((await call('POST', `/v1/auto-apply/applications/${appId}/confirm`)).json().status, 'submitted');
  });

  test('a CAPTCHA hands the application to the user, who can finish it in that tab', async () => {
    const { appId } = await seed();
    await claimAs(userToken);
    const report = (body: unknown) => call('POST', `/v1/auto-apply/applications/${appId}/report`, body);
    assert.equal((await report({ outcome: 'captcha' })).json().status, 'pending');
    assert.equal((await appRow(appId)).reason_code, 'captcha');
    // The extension gave up watching: still waiting for the user, nothing changes.
    assert.equal((await report({ outcome: 'captcha', message: 'Waited' })).json().status, 'pending');
    assert.equal((await appRow(appId)).reason_code, 'captcha');
    // The user ticked the box and the confirmation showed in the tab.
    assert.equal((await report({ outcome: 'submitted', evidence: { url: 'https://jobs.lever.co/a/b/thanks', text: '' } })).json().status, 'submitted');
  });

  test('the user can say they sent one themselves after a sign-in', async () => {
    const { appId } = await seed();
    await claimAs(userToken);
    await call('POST', `/v1/auto-apply/applications/${appId}/report`, { outcome: 'login_required' });
    assert.equal((await call('POST', `/v1/auto-apply/applications/${appId}/confirm`)).json().status, 'submitted');
  });

  test('a CAPTCHA can be tried again', async () => {
    const { appId } = await seed();
    await claimAs(userToken);
    await call('POST', `/v1/auto-apply/applications/${appId}/report`, { outcome: 'captcha' });
    assert.equal((await call('POST', `/v1/auto-apply/applications/${appId}/retry`)).json().status, 'prepared');
    // Friday's servers would meet the same check: only the user's browser takes it now.
    const [{ needs_browser }] = await sql<{ needs_browser: boolean }[]>`select needs_browser from public.auto_applications where id = ${appId}`;
    assert.equal(needs_browser, true);
    assert.equal((await claimAs(userToken))?.id, appId);
    await call('POST', `/v1/auto-apply/applications/${appId}/report`, { outcome: 'submitted', evidence: { url: 'https://jobs.lever.co/a/b/thanks', text: '' } });
  });

  test('questions found only on the live form wait for answers, which are remembered', async () => {
    const first = await seed();
    const second = await seed();
    await claimAs(userToken);
    const res = await call('POST', `/v1/auto-apply/applications/${first.appId}/report`, {
      outcome: 'needs_answers',
      unanswered: ['Do you have a valid driving licence? *'],
    });
    assert.equal(res.json().status, 'pending');
    let row = await appRow(first.appId);
    assert.equal(row.reason_code, 'needs_answers');
    assert.deepEqual(row.missing, ['extra:do you have a valid driving licence']);
    const detail = (await call('GET', `/v1/auto-apply/applications/${first.appId}`)).json();
    assert.equal(detail.missing[0].label, 'Do you have a valid driving licence?');

    // The second application has the same question waiting.
    const extra = { key: 'cards[a][field0]', label: 'Do you have a valid driving licence?', type: 'text', required: true, options: [], kind: 'custom' };
    await sql`
      update public.auto_applications set status = 'pending', reason_code = 'needs_answers', missing = ${[extra.key]},
             form = form || ${sql.json([extra] as never)}::jsonb
      where id = ${second.appId}`;

    const answer = await call('POST', `/v1/auto-apply/applications/${first.appId}/answers`, { answers: { 'extra:do you have a valid driving licence': 'Yes' } });
    assert.equal(answer.statusCode, 200, answer.body);
    assert.equal(answer.json().status, 'prepared');
    row = await appRow(second.appId);
    assert.equal(row.status, 'prepared', 'the saved answer filled the other application');
    const overview = (await call('GET', '/v1/auto-apply')).json() as AutoApplyOverview;
    assert.ok(overview.profile.savedAnswers.some((a) => a.question === 'Do you have a valid driving licence?' && a.answer === 'Yes'));
    // Answering one that isn't waiting is refused.
    assert.equal((await call('POST', `/v1/auto-apply/applications/${first.appId}/answers`, { answers: {} })).statusCode, 409);
    await sql`update public.auto_applications set status = 'skipped' where id in ${sql([first.appId, second.appId])}`;
  });

  test('select answers must be one of the options', async () => {
    const q = { key: 'auth', label: 'Authorized to work?', type: 'select', required: true, options: ['Yes', 'No'], kind: 'custom' };
    const { appId } = await seed({ status: 'pending', reason: 'needs_answers', form: [q], answers: [] });
    await sql`update public.auto_applications set missing = '{auth}' where id = ${appId}`;
    assert.equal((await call('POST', `/v1/auto-apply/applications/${appId}/answers`, { answers: { auth: 'Maybe' } })).statusCode, 400);
    const ok = await call('POST', `/v1/auto-apply/applications/${appId}/answers`, { answers: { auth: 'yes' } });
    assert.equal(ok.json().status, 'prepared');
    const detail = (await call('GET', `/v1/auto-apply/applications/${appId}`)).json();
    assert.equal(detail.answers[0].value, 'Yes');
    await call('POST', `/v1/auto-apply/applications/${appId}/skip`);
  });

  test('failed submissions back off, then fail after three tries; Retry starts over', async () => {
    const { appId } = await seed();
    for (let i = 1; i <= 3; i++) {
      await sql`update public.auto_applications set retry_at = null where id = ${appId}`;
      assert.equal((await claimAs(userToken))?.id, appId);
      const res = await call('POST', `/v1/auto-apply/applications/${appId}/report`, { outcome: 'failed', message: 'No submit button found' });
      const row = await appRow(appId);
      if (i < 3) {
        assert.equal(res.json().status, 'prepared');
        assert.ok(row.retry_at && row.retry_at.getTime() > Date.now() + 25 * 60_000, 'retried later, not straight away');
      } else {
        assert.equal(res.json().status, 'failed');
        assert.equal(row.reason_code, 'submit_failed');
      }
    }
    const retry = await call('POST', `/v1/auto-apply/applications/${appId}/retry`);
    assert.equal(retry.json().status, 'preparing');
    await call('POST', `/v1/auto-apply/applications/${appId}/skip`);
  });

  test('applications being sent can’t be removed; others can, and come back with Retry', async () => {
    const { appId } = await seed();
    await claimAs(userToken);
    assert.equal((await call('POST', `/v1/auto-apply/applications/${appId}/skip`)).statusCode, 409);
    await call('POST', `/v1/auto-apply/applications/${appId}/report`, { outcome: 'failed' });
    assert.equal((await call('POST', `/v1/auto-apply/applications/${appId}/skip`)).json().status, 'skipped');
    assert.equal((await appRow(appId)).reason_code, 'removed_by_user');
  });

  test('a closed listing can’t be retried', async () => {
    const { appId, listingId } = await seed({ status: 'failed', reason: 'submit_failed' });
    await sql`update public.job_listings set closed_at = now() where id = ${listingId}`;
    assert.equal((await call('POST', `/v1/auto-apply/applications/${appId}/retry`)).statusCode, 409);
  });

  test('turned off, nothing is handed out', async () => {
    await seed();
    await call('PUT', '/v1/auto-apply/settings', { enabled: false });
    assert.equal(await claimAs(userToken), null);
    await call('PUT', '/v1/auto-apply/settings', { enabled: true });
    assert.ok(await claimAs(userToken));
  });

  test('another user’s application is invisible', async () => {
    const [other] = await sql<{ id: string }[]>`
      select id from public.auto_applications where user_id <> ${userId} limit 1`;
    if (!other) return;
    assert.equal((await call('GET', `/v1/auto-apply/applications/${other.id}`)).statusCode, 404);
    assert.equal((await call('POST', `/v1/auto-apply/applications/${other.id}/report`, { outcome: 'failed' })).statusCode, 404);
    assert.equal((await call('GET', `/v1/auto-apply/applications/${other.id}/resume`)).statusCode, 404);
  });

  describe('Friday’s servers (the applier)', () => {
    const asApplier = (method: 'GET' | 'POST', url: string, body?: unknown, claim?: string, headers: Record<string, string> = {}) =>
      app.inject({
        method,
        url,
        headers: { authorization: `Bearer ${APPLIER_TOKEN}`, ...(claim ? { 'x-applier-claim': claim } : {}), ...headers },
        ...(body === undefined ? {} : { payload: body as object }),
      });
    /** Only this test user's applications: the database is shared with real local data. */
    const claimCloud = async () => {
      const res = await asApplier('POST', '/v1/applier/claim', { userId });
      assert.equal(res.statusCode, 200, res.body);
      return res.json().task as (AutoApplyTask & { claim: string }) | null;
    };
    const via = async (id: string) =>
      (await sql<{ submitted_via: string | null; needs_browser: boolean; submit_clicked_at: Date | null }[]>`
        select submitted_via, needs_browser, submit_clicked_at from public.auto_applications where id = ${id}`)[0];

    before(async () => {
      // Earlier tests' leftovers aren't part of these.
      await sql`update public.auto_applications set status = 'skipped', reason_code = 'removed_by_user' where user_id = ${userId} and status in ('prepared', 'pending')`;
      await sql`update public.auto_apply_settings set enabled = true, cloud_submit = true where user_id = ${userId}`;
      await sql`update public.auto_apply_devices set revoked_at = now() where user_id = ${userId} and revoked_at is null`;
    });

    test('only the applier’s token works, and never from outside the server', async () => {
      const claim = (headers: Record<string, string>) => app.inject({ method: 'POST', url: '/v1/applier/claim', headers, payload: { userId } });
      assert.equal((await claim({})).statusCode, 401);
      assert.equal((await claim({ authorization: 'Bearer wrong' })).statusCode, 401);
      assert.equal((await claim({ authorization: `Bearer ${userToken}` })).statusCode, 401);
      assert.equal((await claim({ authorization: `Bearer ${APPLIER_TOKEN}`, 'x-forwarded-for': '203.0.113.9' })).statusCode, 401);
      // And the applier's token is nobody's session.
      assert.equal((await call('GET', '/v1/auto-apply', undefined, APPLIER_TOKEN)).statusCode, 401);
    });

    test('takes only job boards it can do, for users who want it, one at a time, never what needs a browser', async () => {
      const workday = await seed({ score: 99 });
      await sql`update public.auto_applications set provider = 'workday' where id = ${workday.appId}`;
      const browserOnly = await seed({ score: 98 });
      await sql`update public.auto_applications set needs_browser = true where id = ${browserOnly.appId}`;
      const a = await seed({ score: 90 });
      const b = await seed({ score: 80 });

      await sql`update public.auto_apply_settings set cloud_submit = false where user_id = ${userId}`;
      assert.equal(await claimCloud(), null, 'turned off by the user');
      await sql`update public.auto_apply_settings set cloud_submit = true where user_id = ${userId}`;

      const task = await claimCloud();
      assert.equal(task?.id, a.appId);
      assert.match(task!.claim, /^cloud:/);
      assert.equal(await claimCloud(), null, 'one at a time per user');
      // The extension can't report on it while the servers hold it.
      const device = (await call('POST', '/v1/auto-apply/devices', { name: 'Chrome on Linux' })).json() as AutoApplyDeviceToken;
      assert.equal((await call('POST', `/v1/auto-apply/applications/${a.appId}/report`, { outcome: 'failed' }, device.token)).statusCode, 409);

      // Files only with the claim.
      assert.equal((await asApplier('GET', task!.resumePath)).statusCode, 409);
      assert.equal((await asApplier('GET', task!.resumePath, undefined, `cloud:${randomUUID()}`)).statusCode, 409);
      const file = await asApplier('GET', task!.resumePath, undefined, task!.claim);
      assert.equal(file.statusCode, 200);
      assert.equal(file.body, '%PDF-1.4 resume');
      assert.equal((await asApplier('GET', task!.coverLetterPath!, undefined, task!.claim)).body, '%PDF-1.4 cover');

      const res = await asApplier('POST', `/v1/applier/applications/${a.appId}/report`,
        { outcome: 'submitted', evidence: { url: 'https://jobs.lever.co/x/y/thanks', text: '' }, clicked: true }, task!.claim);
      assert.equal(res.json().status, 'submitted');
      assert.equal((await via(a.appId)).submitted_via, 'cloud');
      assert.equal((await appRow(a.appId)).claimed_by, null);
      // A late or repeated report for a claim that's over changes nothing.
      assert.equal((await asApplier('POST', `/v1/applier/applications/${a.appId}/report`, { outcome: 'failed', clicked: false }, task!.claim)).statusCode, 409);

      assert.equal((await claimCloud())?.id, b.appId);
      await call('DELETE', `/v1/auto-apply/devices/${device.device.id}`);
      await sql`update public.auto_applications set status = 'skipped' where id in (${b.appId}, ${workday.appId}, ${browserOnly.appId})`;
    });

    test('a CAPTCHA goes to the user’s browser when there is one, otherwise waits for the user', async () => {
      const a = await seed({ score: 90 });
      let task = await claimCloud();
      await asApplier('POST', `/v1/applier/applications/${a.appId}/report`, { outcome: 'captcha', clicked: false }, task!.claim);
      assert.equal((await appRow(a.appId)).reason_code, 'captcha');
      assert.equal((await via(a.appId)).needs_browser, true);
      // Retry: still only for a browser.
      assert.equal((await call('POST', `/v1/auto-apply/applications/${a.appId}/retry`)).json().status, 'prepared');
      assert.equal(await claimCloud(), null);

      const b = await seed({ score: 85 });
      const device = (await call('POST', '/v1/auto-apply/devices', { name: 'Chrome on Linux' })).json() as AutoApplyDeviceToken;
      task = await claimCloud();
      assert.equal(task?.id, b.appId);
      const res = await asApplier('POST', `/v1/applier/applications/${b.appId}/report`, { outcome: 'login_required', clicked: false }, task!.claim);
      assert.equal(res.json().status, 'prepared');
      assert.equal((await via(b.appId)).needs_browser, true);
      assert.equal(await claimCloud(), null, 'the servers don’t take it again');
      // The extension does.
      const claimed = new Set([(await claimAs(device.token))?.id, (await claimAs(device.token))?.id]);
      assert.ok(claimed.has(b.appId));
      await call('DELETE', `/v1/auto-apply/devices/${device.device.id}`);
      await sql`update public.auto_applications set status = 'skipped' where id in (${a.appId}, ${b.appId})`;
    });

    test('once submit is pressed, nothing is ever sent again: a failure or a lost claim asks the user', async () => {
      const a = await seed({ score: 90 });
      const task = await claimCloud();
      assert.equal((await asApplier('POST', `/v1/applier/applications/${a.appId}/submitting`, {}, `cloud:${randomUUID()}`)).statusCode, 409, 'not without the claim');
      assert.equal((await asApplier('POST', `/v1/applier/applications/${a.appId}/submitting`, {}, task!.claim)).statusCode, 200);
      assert.ok((await via(a.appId)).submit_clicked_at);
      // Even if the applier forgets it pressed submit, the recorded click counts.
      const res = await asApplier('POST', `/v1/applier/applications/${a.appId}/report`, { outcome: 'failed', message: 'page error', clicked: false }, task!.claim);
      assert.equal(res.json().status, 'pending');
      assert.equal((await appRow(a.appId)).reason_code, 'unverified');
      assert.equal(await claimCloud(), null);
      assert.equal((await call('POST', `/v1/auto-apply/applications/${a.appId}/retry`)).statusCode, 409, 'and it can’t be retried');

      // The same for the extension: a failure after its submit click is never retried.
      const b = await seed({ score: 80 });
      await sql`update public.auto_apply_settings set cloud_submit = false where user_id = ${userId}`;
      assert.equal((await claimAs(userToken))?.id, b.appId);
      await call('POST', `/v1/auto-apply/applications/${b.appId}/report`, { outcome: 'failed', message: 'no confirmation', afterSubmit: true });
      assert.equal((await appRow(b.appId)).reason_code, 'unverified');
      await sql`update public.auto_apply_settings set cloud_submit = true where user_id = ${userId}`;
    });

    test('a failure before submitting is tried again later', async () => {
      const a = await seed({ score: 90 });
      const task = await claimCloud();
      const res = await asApplier('POST', `/v1/applier/applications/${a.appId}/report`, { outcome: 'failed', message: 'The job board answered 500', clicked: false }, task!.claim);
      assert.equal(res.json().status, 'prepared');
      const row = await appRow(a.appId);
      assert.ok(row.retry_at && row.retry_at > new Date());
      assert.equal((await via(a.appId)).needs_browser, false, 'no browser connected: the servers try again');
      await sql`update public.auto_applications set status = 'skipped' where id = ${a.appId}`;
    });

    test('analytics count what the servers sent and what needed a browser', async () => {
      const res = await call('GET', '/v1/jobs-analytics?days=7');
      const c = res.json().autoApplyChannels;
      assert.equal(c.submitted.cloud, 1);
      assert.ok(c.submitted.browser >= 1);
      assert.equal(c.handedToBrowser, 1);
      assert.equal(c.waitedForUser, 1);
      assert.equal(c.unverified.cloud, 1);
      assert.equal(c.cloudFailures, 1);
      assert.equal(c.cloudShare, 0.333);
    });
  });
});
