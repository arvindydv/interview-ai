// Authorized ATS submission (src/submit, queues/submit.ts). Every HTTP call goes to a mock fetch:
// nothing here ever reaches a real ATS. Connector tests are pure; the queue tests use the local
// database (`pnpm infra:up`) for claims, leases, idempotency and the recorded outcomes.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import type { FormQuestion, PreparedAnswer } from '@parakeet/shared';

process.env.ATS_CREDENTIALS_KEY = randomBytes(32).toString('base64');
process.env.AUTO_APPLY_CLOUD_FORM_PROVIDERS = '';
const { CONNECTORS_BY_PROVIDER } = await import('../src/submit/index.js');
const { encryptSecret } = await import('../src/submit/credentials.js');
const { sendApplication } = await import('../src/queues/submit.js');
const { sweepLapsedClaims, closeAutoApplyQueue } = await import('../src/queues/autoApply.js');
const { sql } = await import('../src/db.js');
import type { AtsConnector, SubmissionTask, SubmitResult } from '../src/submit/types.js';

// ---- mock HTTP -----------------------------------------------------------------------------------

type Reply = { status: number; body?: unknown; headers?: Record<string, string> } | 'refused' | 'hang' | 'reset';

interface Call { url: string; method: string; body: unknown }

/**
 * A fetch that answers the read-only lookups (questions, form definitions, configuration) itself and
 * the application POST with `reply`. Hosts are checked so a connector can't drift to another URL.
 */
function mockFetch(reply: Reply | (() => Reply | Promise<Reply>), lookups: Record<string, unknown> = {}) {
  const calls: Call[] = [];
  const fn = (async (input: string | URL, init: RequestInit = {}) => {
    const url = String(input);
    const method = init.method ?? 'GET';
    assert.match(url, /^https:\/\/(boards-api\.greenhouse\.io|api\.lever\.co|api\.eu\.lever\.co|api\.ashbyhq\.com|api\.smartrecruiters\.com)\//, url);
    calls.push({ url, method, body: init.body });
    const isLookup = method === 'GET' || url.endsWith('/jobPosting.info');
    const r: Reply = isLookup ? { status: 200, body: lookups[url.includes('ashby') ? 'ashby' : url.includes('smartrecruiters') ? 'sr' : 'gh'] ?? {} } : await (typeof reply === 'function' ? reply() : reply);
    if (r === 'refused') throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
    if (r === 'reset') throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } });
    if (r === 'hang') {
      return new Promise<Response>((_, reject) => {
        init.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'TimeoutError' })));
      });
    }
    return new Response(r.body === undefined ? '' : JSON.stringify(r.body), { status: r.status, headers: { 'content-type': 'application/json', ...(r.headers ?? {}) } });
  }) as typeof fetch;
  return { fn, calls, posts: () => calls.filter((c) => c.method === 'POST' && !c.url.endsWith('/jobPosting.info')) };
}

const FORMS: Record<string, FormQuestion[]> = {
  greenhouse: [
    { key: 'first_name', label: 'First Name', type: 'text', required: true, options: [], kind: 'standard' },
    { key: 'last_name', label: 'Last Name', type: 'text', required: true, options: [], kind: 'standard' },
    { key: 'email', label: 'Email', type: 'text', required: true, options: [], kind: 'standard' },
    { key: 'resume', label: 'Resume/CV', type: 'file', required: true, options: [], kind: 'resume' },
    { key: 'question_111', label: 'Notice period (days)', type: 'text', required: true, options: [], kind: 'custom' },
    { key: 'question_222', label: 'Willing to relocate?', type: 'select', required: true, options: ['Yes', 'No'], kind: 'custom' },
  ],
  lever: [
    { key: 'resume', label: 'Resume/CV', type: 'file', required: true, options: [], kind: 'resume' },
    { key: 'name', label: 'Full name', type: 'text', required: true, options: [], kind: 'standard' },
    { key: 'email', label: 'Email', type: 'text', required: true, options: [], kind: 'standard' },
  ],
  ashby: [
    { key: '_systemfield_name', label: 'Name', type: 'text', required: true, options: [], kind: 'standard' },
    { key: '_systemfield_email', label: 'Email', type: 'text', required: true, options: [], kind: 'standard' },
    { key: '_systemfield_resume', label: 'Resume', type: 'file', required: true, options: [], kind: 'resume' },
    { key: 'q_relocate', label: 'Willing to relocate?', type: 'select', required: true, options: ['Yes', 'No'], kind: 'custom' },
  ],
  smartrecruiters: [
    { key: 'firstName', label: 'First name', type: 'text', required: true, options: [], kind: 'standard' },
    { key: 'lastName', label: 'Last name', type: 'text', required: true, options: [], kind: 'standard' },
    { key: 'email', label: 'Email', type: 'text', required: true, options: [], kind: 'standard' },
    { key: 'resume', label: 'Resume', type: 'file', required: true, options: [], kind: 'resume' },
  ],
};
const ANSWERS: Record<string, PreparedAnswer[]> = {
  greenhouse: [
    { key: 'first_name', label: 'First Name', value: 'Asha', source: 'profile' },
    { key: 'last_name', label: 'Last Name', value: 'Rao', source: 'profile' },
    { key: 'email', label: 'Email', value: 'asha@example.com', source: 'profile' },
    { key: 'question_111', label: 'Notice period (days)', value: '30', source: 'profile' },
    { key: 'question_222', label: 'Willing to relocate?', value: 'Yes', source: 'profile' },
  ],
  lever: [{ key: 'name', label: 'Full name', value: 'Asha Rao', source: 'profile' }, { key: 'email', label: 'Email', value: 'asha@example.com', source: 'profile' }],
  ashby: [
    { key: '_systemfield_name', label: 'Name', value: 'Asha Rao', source: 'profile' },
    { key: '_systemfield_email', label: 'Email', value: 'asha@example.com', source: 'profile' },
    { key: 'q_relocate', label: 'Willing to relocate?', value: 'Yes', source: 'profile' },
  ],
  smartrecruiters: [
    { key: 'firstName', label: 'First name', value: 'Asha', source: 'profile' },
    { key: 'lastName', label: 'Last name', value: 'Rao', source: 'profile' },
    { key: 'email', label: 'Email', value: 'asha@example.com', source: 'profile' },
  ],
};
const LOOKUPS = {
  gh: { questions: [{ label: 'Willing to relocate?', required: true, fields: [{ name: 'question_222', type: 'multi_value_single_select', values: [{ label: 'Yes', value: 9001 }, { label: 'No', value: 9002 }] }] }] },
  ashby: { success: true, results: { applicationFormDefinition: { sections: [{ fields: [{ field: { path: 'q_relocate', type: 'ValueSelect', selectableValues: [{ label: 'Yes', value: 'yes_v' }, { label: 'No', value: 'no_v' }] } }] }] } } },
  sr: { questions: [] },
};
const SUCCESS: Record<string, unknown> = {
  greenhouse: { id: 7001, success: 'Candidate saved successfully' },
  lever: { ok: true, applicationId: 'lev-app-1' },
  ashby: { success: true, results: { submittedFormInstance: { id: 'ash-form-1' } } },
  smartrecruiters: { id: 'cand-1', applicationId: 'sr-app-1', createdOn: '2026-11-13T00:00:00Z' },
};
const EXPECTED_ID: Record<string, string | null> = { greenhouse: '7001', lever: 'lev-app-1', ashby: 'ash-form-1', smartrecruiters: 'sr-app-1' };

const task = (provider: string): SubmissionTask => ({
  applicationId: randomUUID(), provider, board: 'acme', externalId: randomUUID(), title: 'Backend Engineer', company: 'Acme',
  form: FORMS[provider], answers: ANSWERS[provider],
  candidate: { firstName: 'Asha', lastName: 'Rao', email: 'asha@example.com', phone: '+91 98765 43210', city: 'Bengaluru', country: 'India', linkedin: '', github: '', portfolio: '', website: '' },
});
const FILES = { resume: { name: 'Asha Rao Resume.pdf', mime: 'application/pdf', data: Buffer.from('%PDF-1.4 resume') }, coverLetter: null };

async function run(c: AtsConnector, reply: Reply, opts: { timeoutMs?: number; signal?: AbortSignal } = {}) {
  const m = mockFetch(reply, LOOKUPS);
  const r = await c.submit(task(c.provider), FILES, 'test-key-123', { idempotencyKey: randomUUID(), fetch: m.fn, timeoutMs: opts.timeoutMs ?? 2000, signal: opts.signal });
  return { r, m };
}

// ---- connectors ----------------------------------------------------------------------------------

for (const provider of ['greenhouse', 'lever', 'ashby', 'smartrecruiters']) {
  const c = CONNECTORS_BY_PROVIDER[provider];
  describe(`${provider} connector`, () => {
    test('success: submitted with the ATS id', async () => {
      const { r, m } = await run(c, { status: provider === 'smartrecruiters' ? 201 : 200, body: SUCCESS[provider] });
      assert.equal(r.outcome, 'submitted', JSON.stringify(r));
      assert.equal((r as Extract<SubmitResult, { outcome: 'submitted' }>).externalId, EXPECTED_ID[provider]);
      assert.equal(m.posts().length, 1);
      // The key never travels in the body.
      assert.ok(!String(m.posts()[0].body instanceof FormData ? [...(m.posts()[0].body as FormData).values()].join() : m.posts()[0].body).includes('test-key-123'));
    });
    test('409 / already applied → duplicate', async () => {
      assert.deepEqual(pick((await run(c, { status: 409, body: { error: 'conflict' } })).r), ['failed', 'duplicate', false]);
      assert.deepEqual(pick((await run(c, { status: 400, body: { error: 'Candidate has already applied to this job', message: 'Candidate has already applied to this job', errors: [{ message: 'Candidate has already applied' }] } })).r), ['failed', 'duplicate', false]);
    });
    test('400 → validation, not retried', async () => {
      assert.deepEqual(pick((await run(c, { status: 400, body: { error: 'Bad input', message: 'Bad input', errors: [{ message: 'Bad input' }] } })).r), ['failed', 'validation', false]);
    });
    test('401/403 → auth', async () => {
      assert.deepEqual(pick((await run(c, { status: 403, body: {} })).r), ['failed', 'auth', false]);
      assert.deepEqual(pick((await run(c, { status: 401, body: {} })).r), ['failed', 'auth', false]);
    });
    test('429 → rate_limited with Retry-After', async () => {
      const { r } = await run(c, { status: 429, body: {}, headers: { 'retry-after': '42' } });
      assert.deepEqual(pick(r), ['failed', 'rate_limited', true]);
      assert.equal((r as { retryAfterMs?: number }).retryAfterMs, 42_000);
    });
    test('500/503 → server, retryable; 502/504 → uncertain', async () => {
      assert.deepEqual(pick((await run(c, { status: 500, body: {} })).r), ['failed', 'server', true]);
      assert.deepEqual(pick((await run(c, { status: 503, body: {} })).r), ['failed', 'server', true]);
      assert.equal((await run(c, { status: 504, body: {} })).r.outcome, 'uncertain');
    });
    test('404/410 → closed', async () => {
      assert.deepEqual(pick((await run(c, { status: 404, body: {} })).r), ['failed', 'closed', false]);
      assert.deepEqual(pick((await run(c, { status: 410, body: {} })).r), ['failed', 'closed', false]);
    });
    test('connection refused before sending → network, retryable', async () => {
      assert.deepEqual(pick((await run(c, 'refused')).r), ['failed', 'network', true]);
    });
    test('timeout or reset after sending → uncertain (never resent)', async () => {
      assert.equal((await run(c, 'hang', { timeoutMs: 50 })).r.outcome, 'uncertain');
      assert.equal((await run(c, 'reset')).r.outcome, 'uncertain');
    });
    test('cancelled before sending → nothing is sent', async () => {
      const ctl = new AbortController();
      ctl.abort();
      const { r, m } = await run(c, { status: 200, body: SUCCESS[provider] }, { signal: ctl.signal });
      assert.equal(m.posts().length, 0);
      assert.equal(r.outcome, 'failed');
    });
  });
}

const pick = (r: SubmitResult) => (r.outcome === 'failed' ? [r.outcome, r.code, r.retryable] : [r.outcome]);

test('greenhouse sends option ids, question fields and the resume file', async () => {
  const m = mockFetch({ status: 200, body: SUCCESS.greenhouse }, LOOKUPS);
  await CONNECTORS_BY_PROVIDER.greenhouse.submit(task('greenhouse'), FILES, 'k', { idempotencyKey: 'x', fetch: m.fn });
  const fd = m.posts()[0].body as FormData;
  assert.equal(fd.get('first_name'), 'Asha');
  assert.equal(fd.get('question_111'), '30');
  assert.equal(fd.get('question_222'), '9001');
  assert.ok(fd.get('resume') instanceof Blob);
  assert.match(m.posts()[0].url, /^https:\/\/boards-api\.greenhouse\.io\/v1\/boards\/acme\/jobs\//);
});

test('lever refuses forms with required custom questions instead of dropping them', async () => {
  const t = task('lever');
  t.form = [...t.form, { key: 'cards[abc][field0]', label: 'Why us?', type: 'textarea', required: true, options: [], kind: 'custom' }];
  const m = mockFetch({ status: 200, body: SUCCESS.lever });
  const r = await CONNECTORS_BY_PROVIDER.lever.submit(t, FILES, 'k', { idempotencyKey: 'x', fetch: m.fn });
  assert.deepEqual(pick(r), ['failed', 'unsupported_form', false]);
  assert.equal(m.posts().length, 0);
});

test('ashby: an error in a 200 body is not a submission; select values are mapped', async () => {
  const m = mockFetch({ status: 200, body: { success: false, errors: ['Missing required field: Phone'] } }, LOOKUPS);
  const r = await CONNECTORS_BY_PROVIDER.ashby.submit(task('ashby'), FILES, 'k', { idempotencyKey: 'x', fetch: m.fn });
  assert.equal(r.outcome, 'failed');
  const fd = m.posts()[0].body as FormData;
  const form = JSON.parse(String(fd.get('applicationForm'))) as { fieldSubmissions: { path: string; value: unknown }[] };
  assert.deepEqual(form.fieldSubmissions.find((f) => f.path === 'q_relocate')?.value, 'yes_v');
  assert.equal(form.fieldSubmissions.find((f) => f.path === '_systemfield_resume')?.value, 'resume_1');
  assert.ok(fd.get('resume_1') instanceof Blob);
  assert.equal(fd.get('allowSubmissionForUnpublishedJobPosting'), 'false');
});

test('smartrecruiters: required screening questions → not sent through the API', async () => {
  const m = mockFetch({ status: 201, body: SUCCESS.smartrecruiters }, { ...LOOKUPS, sr: { questions: [{ id: 'q1', label: 'Visa?', required: true }] } });
  const r = await CONNECTORS_BY_PROVIDER.smartrecruiters.submit(task('smartrecruiters'), FILES, 'k', { idempotencyKey: 'x', fetch: m.fn });
  assert.deepEqual(pick(r), ['failed', 'unsupported_form', false]);
  assert.equal(m.posts().length, 0);
});

// ---- queue: claims, outcomes, idempotency (local database) ------------------------------------------

describe('autosubmit queue', { concurrency: 1 }, () => {
  const userId = randomUUID();
  const board = `submit-test-${randomUUID().slice(0, 8)}`;
  let sourceId: string;
  let credentialId: string;

  before(async () => {
    const email = `submit-${userId.slice(0, 8)}@example.com`;
    await sql`insert into auth.users (id, email, aud, role) values (${userId}, ${email}, 'authenticated', 'authenticated')`;
    await sql`insert into public.users (id, email) values (${userId}, ${email})`;
    await sql`insert into public.auto_apply_settings (user_id, enabled, consented_at, daily_limit) values (${userId}, true, now(), 5)`;
    await sql`insert into public.application_profiles (user_id, data) values (${userId}, ${sql.json({ firstName: 'Asha', lastName: 'Rao', email, phone: '+91 98765 43210', city: 'Bengaluru', country: 'India' })})`;
    // Disabled: the listings sync never fetches this made-up board.
    [{ id: sourceId }] = await sql<{ id: string }[]>`
      insert into public.job_sources (provider, board, company, enabled) values ('lever', ${board}, 'QA Co', false) returning id`;
    [{ id: credentialId }] = await sql<{ id: string }[]>`
      insert into public.ats_credentials (provider, board, secret_enc, granted_by, agreement_ref)
      values ('lever', ${board}, ${encryptSecret('lever-test-key')}, 'QA employer', 'test agreement') returning id`;
  });

  after(async () => {
    await sql`delete from public.ats_credentials where board = ${board}`;
    await sql`delete from public.job_sources where id = ${sourceId}`;
    await sql`delete from public.audit_logs where user_id = ${userId}`;
    await sql`delete from auth.users where id = ${userId}`;
  });

  async function seed(over: { status?: string; reason?: string | null; cancelled?: boolean } = {}) {
    const external = randomUUID();
    const [l] = await sql<{ id: string }[]>`
      insert into public.job_listings (source_id, external_id, title, company, apply_url, description_text)
      values (${sourceId}, ${external}, 'Backend Engineer', 'QA Co', ${`https://jobs.lever.co/${board}/${external}`}, 'Build things.') returning id`;
    const [t] = await sql<{ id: string }[]>`
      insert into public.tailored_resumes (user_id, listing_id, title, company, status, content, file, file_name)
      values (${userId}, ${l.id}, 'Backend Engineer', 'QA Co', 'ready', '{"format":"pdf"}', ${Buffer.from('%PDF-1.4 resume')}, 'Asha Rao Resume.pdf') returning id`;
    const [a] = await sql<{ id: string }[]>`
      insert into public.auto_applications (user_id, listing_id, tailored_resume_id, provider, apply_url, title, company, score, status, reason_code,
                                            form, answers, plan_day, channel, cancelled_at)
      values (${userId}, ${l.id}, ${t.id}, 'lever', ${`https://jobs.lever.co/${board}/${external}/apply`}, 'Backend Engineer', 'QA Co', 85,
              ${over.status ?? 'prepared'}, ${over.reason ?? null}, ${sql.json(FORMS.lever as never)}, ${sql.json(ANSWERS.lever as never)},
              current_date, 'api', ${over.cancelled ? new Date() : null})
      returning id`;
    return { appId: a.id, listingId: l.id };
  }
  const row = async (id: string) =>
    (await sql<{ status: string; reason_code: string | null; channel: string | null; submitted_via: string | null; external_application_id: string | null; retry_at: Date | null; submit_clicked_at: Date | null; missing: string[]; failure: { code: string } | null; claimed_by: string | null }[]>`
      select status, reason_code, channel, submitted_via, external_application_id, retry_at, submit_clicked_at, missing, failure, claimed_by
      from public.auto_applications where id = ${id}`)[0];
  const events = async (id: string) => (await sql<{ kind: string }[]>`select kind from public.auto_apply_events where application_id = ${id} order by id`).map((e) => e.kind);
  const fast = (m: ReturnType<typeof mockFetch>) => ({ fetch: m.fn, timeoutMs: 100 });

  test('success → submitted (verified by the ATS), applied, audited', async () => {
    const { appId, listingId } = await seed();
    const m = mockFetch({ status: 200, body: SUCCESS.lever });
    assert.deepEqual(await sendApplication(appId, fast(m)), { submitted: true, externalId: 'lev-app-1' });
    const r = await row(appId);
    assert.equal(r.status, 'submitted');
    assert.equal(r.submitted_via, 'api');
    assert.equal(r.external_application_id, 'lev-app-1');
    assert.equal(r.claimed_by, null);
    assert.match(m.posts()[0].url, new RegExp(`^https://api\\.lever\\.co/v0/postings/${board}/`));
    const [ja] = await sql`select status from public.job_applications where user_id = ${userId} and listing_id = ${listingId}`;
    assert.equal(ja.status, 'applied');
    const [au] = await sql`select action from public.audit_logs where target_id = ${appId}`;
    assert.equal(au.action, 'application.submitted');
    // Sent once: a second run finds nothing to claim.
    assert.deepEqual(await sendApplication(appId, fast(m)), { skipped: 'not claimable' });
    assert.equal(m.posts().length, 1);
  });

  test('queued twice concurrently → exactly one request', async () => {
    const { appId } = await seed();
    const m = mockFetch(async () => {
      await new Promise((r) => setTimeout(r, 50));
      return { status: 200, body: SUCCESS.lever };
    });
    const results = await Promise.all([sendApplication(appId, fast(m)), sendApplication(appId, fast(m)), sendApplication(appId, fast(m))]);
    assert.equal(m.posts().length, 1);
    assert.equal(results.filter((x) => 'submitted' in x).length, 1);
    assert.equal((await row(appId)).status, 'submitted');
  });

  test('timeout after sending → unverified, never resent', async () => {
    const { appId } = await seed();
    const m = mockFetch('hang');
    assert.deepEqual(await sendApplication(appId, { fetch: m.fn, timeoutMs: 50 }), { unverified: true });
    const r = await row(appId);
    assert.deepEqual([r.status, r.reason_code, r.submitted_via, r.failure?.code], ['pending', 'unverified', 'api', 'uncertain']);
    assert.deepEqual(await sendApplication(appId, fast(m)), { skipped: 'not claimable' });
    assert.equal(m.posts().length, 1);
  });

  test('connection refused (never sent) → back to Prepared with a delay; failed after 3 tries', async () => {
    const { appId } = await seed();
    const m = mockFetch('refused');
    for (let i = 1; i <= 3; i++) {
      await sql`update public.auto_applications set retry_at = null where id = ${appId}`;
      await sendApplication(appId, fast(m));
      const r = await row(appId);
      if (i < 3) {
        assert.deepEqual([r.status, r.submit_clicked_at], ['prepared', null]);
        assert.ok(r.retry_at && r.retry_at.getTime() > Date.now());
      } else assert.deepEqual([r.status, r.reason_code, r.failure?.code], ['failed', 'submit_failed', 'network']);
    }
    assert.equal(m.posts().length, 3);
  });

  test('5xx → retried later, not counted as sent', async () => {
    const { appId } = await seed();
    await sendApplication(appId, fast(mockFetch({ status: 503, body: {} })));
    const r = await row(appId);
    assert.deepEqual([r.status, r.failure?.code, r.submit_clicked_at], ['prepared', 'server', null]);
  });

  test('429 → waits Retry-After; not a failed attempt', async () => {
    const { appId } = await seed();
    await sendApplication(appId, fast(mockFetch({ status: 429, body: {}, headers: { 'retry-after': '120' } })));
    const r = await row(appId);
    assert.equal(r.status, 'prepared');
    const wait = r.retry_at!.getTime() - Date.now();
    assert.ok(wait > 100_000 && wait <= 121_000, String(wait));
    const ev = await events(appId);
    assert.ok(ev.includes('rate_limited') && !ev.includes('submit_failed'));
  });

  test('403 → credential flagged, application falls back to another channel without resending', async () => {
    const { appId } = await seed();
    const m = mockFetch({ status: 403, body: { ok: false, error: 'Invalid API key' } });
    await sendApplication(appId, fast(m));
    const r = await row(appId);
    // No browser connected and server-side forms off: the candidate submits.
    assert.deepEqual([r.status, r.reason_code, r.channel], ['pending', 'assisted', 'assisted']);
    const [c] = await sql<{ last_error: string | null }[]>`select last_error from public.ats_credentials where id = ${credentialId}`;
    assert.match(c.last_error ?? '', /403/);
    // The flagged credential isn't used again: the next API application falls back without a request.
    const next = await seed();
    const m2 = mockFetch({ status: 200, body: SUCCESS.lever });
    await sendApplication(next.appId, fast(m2));
    assert.equal(m2.posts().length, 0);
    assert.equal((await row(next.appId)).channel, 'assisted');
    await sql`update public.ats_credentials set last_error = null where id = ${credentialId}`;
  });

  test('404 → skipped (job closed); 409 → skipped (already applied)', async () => {
    const a = await seed();
    await sendApplication(a.appId, fast(mockFetch({ status: 404, body: {} })));
    assert.deepEqual([(await row(a.appId)).status, (await row(a.appId)).reason_code], ['skipped', 'listing_closed']);
    const b = await seed();
    await sendApplication(b.appId, fast(mockFetch({ status: 409, body: { ok: false, error: 'duplicate application' } })));
    assert.deepEqual([(await row(b.appId)).status, (await row(b.appId)).reason_code], ['skipped', 'already_applied']);
  });

  test('400 naming a field → Needs your answer for that field; otherwise Failed', async () => {
    const a = await seed();
    await sendApplication(a.appId, fast(mockFetch({ status: 400, body: { ok: false, error: 'Full name is invalid' } })));
    const r = await row(a.appId);
    assert.deepEqual([r.status, r.reason_code, r.missing], ['pending', 'needs_answers', ['name']]);
    const b = await seed();
    await sendApplication(b.appId, fast(mockFetch({ status: 422, body: { ok: false, error: 'Something unspecified' } })));
    assert.deepEqual([(await row(b.appId)).status, (await row(b.appId)).reason_code], ['failed', 'submit_failed']);
  });

  test('cancelled before sending → never claimed', async () => {
    const { appId } = await seed({ cancelled: true });
    const m = mockFetch({ status: 200, body: SUCCESS.lever });
    assert.deepEqual(await sendApplication(appId, fast(m)), { skipped: 'not claimable' });
    assert.equal(m.calls.length, 0);
  });

  test('cancelled while being sent → the real outcome is recorded', async () => {
    // The ATS took it: Submitted stands.
    const a = await seed();
    await sendApplication(a.appId, fast(mockFetch(async () => {
      await sql`update public.auto_applications set cancelled_at = now() where id = ${a.appId}`;
      return { status: 200, body: SUCCESS.lever };
    })));
    assert.equal((await row(a.appId)).status, 'submitted');
    // The ATS didn't take it: skipped, not retried.
    const b = await seed();
    await sendApplication(b.appId, fast(mockFetch(async () => {
      await sql`update public.auto_applications set cancelled_at = now() where id = ${b.appId}`;
      return { status: 503, body: {} };
    })));
    assert.deepEqual([(await row(b.appId)).status, (await row(b.appId)).reason_code], ['skipped', 'removed_by_user']);
  });

  test('worker restart: a stale in-flight lease becomes unverified (sent) or Prepared/skipped (not sent)', async () => {
    const sent = await seed({ status: 'pending', reason: 'submitting' });
    const notSent = await seed({ status: 'pending', reason: 'submitting' });
    const cancelled = await seed({ status: 'pending', reason: 'submitting', cancelled: true });
    await sql`update public.auto_applications set claimed_by = 'api:crashed', claimed_at = now() - interval '1 hour' where id in ${sql([sent.appId, notSent.appId, cancelled.appId])}`;
    await sql`update public.auto_applications set submit_clicked_at = now() - interval '1 hour' where id = ${sent.appId}`;
    await sweepLapsedClaims();
    assert.deepEqual([(await row(sent.appId)).status, (await row(sent.appId)).reason_code], ['pending', 'unverified']);
    assert.equal((await row(notSent.appId)).status, 'prepared');
    assert.deepEqual([(await row(cancelled.appId)).status, (await row(cancelled.appId)).reason_code], ['skipped', 'removed_by_user']);
    // The unverified one is never sent again.
    const m = mockFetch({ status: 200, body: SUCCESS.lever });
    assert.deepEqual(await sendApplication(sent.appId, fast(m)), { skipped: 'not claimable' });
    assert.equal(m.calls.length, 0);
  });

  test('daily limit reached at send time → waits, nothing sent', async () => {
    await sql`update public.auto_apply_settings set daily_limit = 1 where user_id = ${userId}`;
    try {
      const { appId } = await seed();
      const m = mockFetch({ status: 200, body: SUCCESS.lever });
      assert.deepEqual(await sendApplication(appId, fast(m)), { skipped: 'daily limit' });
      assert.equal(m.calls.length, 0);
      const r = await row(appId);
      assert.equal(r.status, 'prepared');
      assert.ok(r.retry_at && r.retry_at.getTime() > Date.now());
    } finally {
      await sql`update public.auto_apply_settings set daily_limit = 5 where user_id = ${userId}`;
    }
  });

  test('Auto Apply turned off → API applications are not sent', async () => {
    await sql`update public.auto_apply_settings set enabled = false where user_id = ${userId}`;
    try {
      const { appId } = await seed();
      const m = mockFetch({ status: 200, body: SUCCESS.lever });
      assert.deepEqual(await sendApplication(appId, fast(m)), { skipped: 'not claimable' });
      assert.equal(m.calls.length, 0);
    } finally {
      await sql`update public.auto_apply_settings set enabled = true where user_id = ${userId}`;
    }
  });
});

after(async () => {
  await closeAutoApplyQueue();
  await sql.end();
});
