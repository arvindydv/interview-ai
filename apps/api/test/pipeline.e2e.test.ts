// The whole application pipeline, end to end, with the real code at every step:
//
//   discovery (listings sync of a Greenhouse board) → matching (requirements, eligibility, score) →
//   Auto Apply plan → preparation (resume tailored in the candidate's own PDF, form read, answers) →
//   channel chosen by authorization (the employer's API credential) → authorized API submission →
//   evidence → Applied Jobs dashboard (Verified, signed download of the exact resume sent).
//
// Plus: an unknown screening answer (Needs your action → answered once → remembered → sent), an
// authorization failure (403 → credential flagged → Assisted Apply → "I applied" → You confirmed),
// duplicate prevention (re-plan, concurrent sends) and worker recovery (a send lost after the request
// went out becomes Unverified, never resent, never counted).
//
// Only two things are mocked: the model (no API calls, deterministic output) and HTTP to the job board,
// which answers from fixtures and fails the test if anything else is contacted. Nothing reaches a real
// ATS. Queues go to Redis database 15, which no dev worker reads.
//
// Needs the local stack and SUPABASE_SERVICE_ROLE_KEY (skipped otherwise), and apps/worker/.venv with
// PyMuPDF for the resume file (python/requirements.txt).
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, mock, test } from 'node:test';
import Fastify, { type FastifyInstance } from 'fastify';
import sensible from '@fastify/sensible';
import type { AppliedJobsPage } from '@parakeet/shared';

const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PYTHON = new URL('../../worker/.venv/bin/python', import.meta.url).pathname;
const runnable = Boolean(serviceKey) && existsSync(PYTHON);

process.env.REDIS_URL = 'redis://127.0.0.1:6380/15';
process.env.ATS_CREDENTIALS_KEY = randomBytes(32).toString('base64');
process.env.AUTO_APPLY_CLOUD_FORM_PROVIDERS = '';
process.env.ANTHROPIC_API_KEY ??= 'test-not-used';
process.env.RESUME_PYTHON = PYTHON;

const BOARD = `e2e-${randomUUID().slice(0, 8)}`;
const ROLE = 'Zyxquant Backend Engineer';
const RESUME_LINE = 'Built backend services in TypeScript and PostgreSQL for payments';
const TAILORED_LINE = 'Built payments backend services in TypeScript and PostgreSQL';
const JOBS = { main: 9_000_001, unknown: 9_000_002, denied: 9_000_003, lost: 9_000_004 };

const description = (extra = '') =>
  `<h3>Requirements</h3><ul><li>3+ years building backend services with TypeScript and Node.js</li>` +
  `<li>Strong PostgreSQL experience</li></ul><h3>Nice to have</h3><ul><li>Redis</li></ul>${extra}`;

/** The board's public API, and its application endpoint as the employer's key would see it. */
const posts: { url: string; auth: string | null; body: FormData | null }[] = [];
let denyIds = new Set<number>();
let hangIds = new Set<number>();

function boardFixture() {
  const now = new Date().toISOString();
  return {
    jobs: Object.entries(JOBS).map(([k, id]) => ({
      id,
      title: `${ROLE}${k === 'main' ? '' : ` (${k})`}`,
      location: { name: 'Bengaluru, India' },
      content: description(k === 'unknown' ? '<p>Kubernetes is used across our platform.</p>' : '').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
      absolute_url: `https://boards.greenhouse.io/${BOARD}/jobs/${id}`,
      first_published: now,
      updated_at: now,
      departments: [{ name: 'Engineering' }],
    })),
  };
}

function questionsFixture(id: number) {
  const q = (label: string, name: string, type = 'input_text', required = true) => ({ label, required, fields: [{ name, type, values: [] }] });
  const base = [
    q('First Name', 'first_name'), q('Last Name', 'last_name'), q('Email', 'email'), q('Phone', 'phone'),
    q('Resume/CV', 'resume', 'input_file'),
    q('What is your notice period?', 'question_100'),
  ];
  if (id === JOBS.unknown) base.push(q('How many years of hands-on Kubernetes experience do you have?', 'question_200'));
  return { id, questions: base, location_questions: [], compliance: null, demographic_questions: null, education: null };
}

const realFetch = globalThis.fetch;
const boardFetch = (async (input: string | URL | Request, init: RequestInit = {}) => {
  const url = String(input instanceof Request ? input.url : input);
  const method = (init.method ?? 'GET').toUpperCase();
  // Supabase auth for the test users, and nothing else outside the board.
  if (url.startsWith('http://127.0.0.1:54321/')) return realFetch(input, init);
  assert.ok(url.startsWith(`https://boards-api.greenhouse.io/v1/boards/${BOARD}/`), `unexpected request: ${method} ${url}`);
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  if (method === 'GET' && url.includes('/jobs?content=true')) return json(200, boardFixture());
  const id = Number(/\/jobs\/(\d+)/.exec(url)?.[1]);
  if (method === 'GET') return json(200, questionsFixture(id));
  posts.push({ url, auth: new Headers(init.headers).get('authorization'), body: init.body instanceof FormData ? init.body : null });
  if (denyIds.has(id)) return json(403, { error: 'Unauthorized' });
  if (hangIds.has(id)) {
    return new Promise<Response>((_, reject) => init.signal?.addEventListener('abort', () => reject(Object.assign(new Error('timed out'), { name: 'TimeoutError' }))));
  }
  return json(200, { success: true });
}) as typeof fetch;

describe('application pipeline end to end', { skip: !runnable && 'needs SUPABASE_SERVICE_ROLE_KEY and apps/worker/.venv' }, () => {
  let app: FastifyInstance;
  let sql: typeof import('../src/lib/db.js').sql;
  let worker: {
    syncSource: typeof import('../../worker/src/queues/listings.js').syncSource;
    refresh: typeof import('../../worker/src/queues/matches.js').refresh;
    planUser: typeof import('../../worker/src/queues/autoApply.js').planUser;
    prepare: typeof import('../../worker/src/queues/autoApply.js').prepare;
    rechannel: typeof import('../../worker/src/queues/autoApply.js').rechannel;
    sweepLapsedClaims: typeof import('../../worker/src/queues/autoApply.js').sweepLapsedClaims;
    resumeStalledPreparations: typeof import('../../worker/src/queues/autoApply.js').resumeStalledPreparations;
    sendApplication: typeof import('../../worker/src/queues/submit.js').sendApplication;
  };
  const closers: (() => Promise<unknown>)[] = [];
  let userId = '';
  let token = '';
  let sourceId = '';
  let originalResume: Buffer;

  const call = (method: 'GET' | 'POST', url: string, body?: unknown) =>
    app.inject({ method, url, payload: body as never, headers: { authorization: `Bearer ${token}` } });
  const dashboard = async (query = '') => {
    const res = await call('GET', `/v1/applied-jobs${query}`);
    assert.equal(res.statusCode, 200, res.body);
    return res.json() as AppliedJobsPage;
  };
  const application = async (externalId: number) =>
    (await sql<{ id: string; status: string; reason_code: string | null; channel: string | null; submitted_via: string | null;
      external_application_id: string | null; tailored_resume_id: string | null; missing: string[] }[]>`
      select a.id, a.status, a.reason_code, a.channel, a.submitted_via, a.external_application_id, a.tailored_resume_id, a.missing
      from public.auto_applications a join public.job_listings l on l.id = a.listing_id
      where a.user_id = ${userId} and l.source_id = ${sourceId} and l.external_id = ${String(externalId)}`)[0];
  const prepareJob = (id: string) => worker.prepare({ id: `e2e-${randomUUID()}`, data: { applicationId: id }, attemptsMade: 0, opts: { attempts: 3 } } as never);

  before(async () => {
    // The model: tailoring rewrites one line of the candidate's own resume (no new facts), the cover
    // letter is plain, and the answering model claims nothing (basis "none"), so only facts decide.
    mock.module(new URL('../../worker/src/llm.ts', import.meta.url).href, {
      namedExports: {
        llmConfigured: () => true,
        defaultModel: () => 'claude-sonnet-5-5',
        bulkModel: () => 'claude-haiku-5-5',
        PermanentError: class PermanentError extends Error {},
        structured: async (req: { name: string; user: string }) => {
          const usage = { input_tokens: 1000, output_tokens: 200 };
          if (req.name === 'resume_edits') {
            const id = new RegExp(`^(\\S+) \\[edit[^\\]]*\\] ${RESUME_LINE}`, 'm').exec(req.user)?.[1];
            return {
              data: { edits: id ? [{ id, text: TAILORED_LINE }] : [], bold: ['TypeScript', 'PostgreSQL'], matchedKeywords: ['TypeScript', 'PostgreSQL'], missingKeywords: [], changes: ['Led with payments'] },
              stop: 'end_turn', usage,
            };
          }
          if (req.name === 'cover_letter') return { data: { body: 'Dear Hiring Team,\n\nI build backend services.\n\nRegards,\nAsha Rao' }, stop: 'end_turn', usage };
          const keys = [...req.user.matchAll(/"key":"([^"]+)"/g)].map((m) => m[1]);
          return { data: { answers: keys.map((key) => ({ key, answer: null, basis: 'none' })) }, stop: 'end_turn', usage };
        },
      },
    });
    globalThis.fetch = boardFetch;

    const { env } = await import('../src/env.js');
    ({ sql } = await import('../src/lib/db.js'));
    const auth = async (path: string, body: unknown) => {
      const res = await realFetch(`${env.SUPABASE_URL}/auth/v1${path}`, {
        method: 'POST',
        headers: { apikey: serviceKey!, authorization: `Bearer ${serviceKey}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      assert.ok(res.ok, `${path}: ${JSON.stringify(json)}`);
      return json;
    };
    const email = `pipeline-${randomUUID().slice(0, 8)}@example.com`;
    const password = randomUUID();
    userId = (await auth('/admin/users', { email, password, email_confirm: true })).id;
    token = (await auth('/token?grant_type=password', { email, password })).access_token;
    await sql`insert into public.users (id, email, auth_provider) values (${userId}, ${email}, 'email')`;

    // The candidate: their own resume file, its analysis, a complete profile, Auto Apply on.
    const dir = mkdtempSync(join(tmpdir(), 'e2e-resume-'));
    const pdf = join(dir, 'resume.pdf');
    const made = spawnSync(PYTHON, ['-c', `
import fitz, sys
doc = fitz.open(); page = doc.new_page()
y = 72
for line in ["Asha Rao", "Backend Engineer, 4 years", "Experience", ${JSON.stringify(RESUME_LINE)}, "Designed REST APIs with Node.js and Redis caching", "Skills: TypeScript, Node.js, PostgreSQL, Redis"]:
    page.insert_textbox(fitz.Rect(72, y, 540, y + 20), line, fontsize=11); y += 40
doc.save(sys.argv[1])`, pdf], { encoding: 'utf8' });
    assert.equal(made.status, 0, made.stderr);
    originalResume = readFileSync(pdf);
    const text = `Asha Rao\nBackend Engineer, 4 years\nExperience\n${RESUME_LINE}\nDesigned REST APIs with Node.js and Redis caching\nSkills: TypeScript, Node.js, PostgreSQL, Redis`;
    const parsed: import('@parakeet/shared').ResumeProfile = {
      name: 'Asha Rao', headline: 'Backend Engineer', summary: 'I build backend services for payments.', totalYearsExperience: 4,
      skills: ['TypeScript', 'Node.js', 'PostgreSQL', 'Redis'].map((name) => ({ name, years: 4 })),
      experience: [{ title: 'Backend Engineer', company: 'Paytech', period: '2022–present', highlights: [RESUME_LINE] }],
      projects: [], education: [], certifications: [], stories: [],
    };
    await sql`
      insert into public.resumes (user_id, file_name, mime_type, text, parsed_json, status, file)
      values (${userId}, 'Asha Rao.pdf', 'application/pdf', ${text}, ${sql.json(parsed as never)}, 'ready', ${originalResume})`;
    await sql`insert into public.job_preferences (user_id, roles, locations) values (${userId}, ${[ROLE]}, ${['Bengaluru']})`;
    const profile = {
      firstName: 'Asha', lastName: 'Rao', email, phone: '+91 98450 12345', city: 'Bengaluru', country: 'India',
      workAuthorization: [{ country: 'India', authorized: true, needsSponsorship: false }],
      otherCountries: { authorized: false, needsSponsorship: true }, noticePeriodDays: 30, letAiDecide: false, savedAnswers: [],
    };
    await sql`insert into public.application_profiles (user_id, data) values (${userId}, ${sql.json(profile as never)})`;
    await sql`
      insert into public.auto_apply_settings (user_id, enabled, min_score, daily_limit, consented_at, cloud_submit)
      values (${userId}, true, 60, 5, now(), true)`;

    // The employer's board, and the API key the employer granted (recorded with its agreement).
    [{ id: sourceId }] = await sql<{ id: string }[]>`
      insert into public.job_sources (provider, board, company, enabled) values ('greenhouse', ${BOARD}, 'Zyxquant', true) returning id`;
    const { encryptSecret } = await import('../../worker/src/submit/credentials.js');
    await sql`
      insert into public.ats_credentials (provider, board, secret_enc, granted_by, agreement_ref)
      values ('greenhouse', ${BOARD}, ${encryptSecret('gh-employer-key')}, 'Zyxquant (test)', 'e2e-fixture')`;

    const listings = await import('../../worker/src/queues/listings.js');
    const matches = await import('../../worker/src/queues/matches.js');
    const autoApply = await import('../../worker/src/queues/autoApply.js');
    const submit = await import('../../worker/src/queues/submit.js');
    const tailor = await import('../../worker/src/queues/tailor.js');
    worker = { syncSource: listings.syncSource, refresh: matches.refresh, planUser: autoApply.planUser, prepare: autoApply.prepare,
      rechannel: autoApply.rechannel, sweepLapsedClaims: autoApply.sweepLapsedClaims, resumeStalledPreparations: autoApply.resumeStalledPreparations, sendApplication: submit.sendApplication };
    closers.push(listings.closeListingsQueue, matches.closeMatchesQueue, autoApply.closeAutoApplyQueue, async () => submit.closeSubmitQueue(),
      async () => (tailor as { closeTailorQueue?: () => Promise<unknown> }).closeTailorQueue?.());

    app = Fastify();
    await app.register(sensible);
    await app.register((await import('../src/routes/autoApply.js')).default);
    await app.register((await import('../src/routes/appliedJobs.js')).default);
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
      await sql`delete from public.ats_credentials where board = ${BOARD}`;
      if (sourceId) await sql`delete from public.job_sources where id = ${sourceId}`;
      await sql.end();
    }
    for (const close of closers) await close().catch(() => {});
    await (await import('../../worker/src/db.js')).sql.end({ timeout: 1 });
    await (await import('../src/lib/queues.js')).closeQueues();
    await (await import('../src/lib/redis.js')).redis.quit();
  });

  test('discovery: the board sync stores the jobs', async () => {
    const r = await worker.syncSource({ data: { sourceId }, attemptsMade: 0, opts: { attempts: 1 } });
    // The dev worker's scheduler mustn't sync this fake board against the real Greenhouse.
    await sql`update public.job_sources set enabled = false where id = ${sourceId}`;
    assert.ok(r && !('skipped' in r), JSON.stringify(r));
    const [{ n }] = await sql<{ n: number }[]>`select count(*)::int as n from public.job_listings where source_id = ${sourceId} and closed_at is null`;
    assert.equal(n, 4);
  });

  test('matching: requirements read from the description, eligible, scored and explained', async () => {
    await worker.refresh({ data: { userId } });
    const rows = await sql<{ score: number; eligible: boolean; explanation: { mandatoryMatched: string[]; reasons: string[]; rejections: string[] } }[]>`
      select m.score, m.eligible, m.explanation from public.job_matches m join public.job_listings l on l.id = m.listing_id
      where m.user_id = ${userId} and l.source_id = ${sourceId}`;
    assert.equal(rows.length, 4);
    for (const r of rows) {
      assert.ok(r.eligible, JSON.stringify(r.explanation.rejections));
      assert.ok(r.score >= 60, `score ${r.score}`);
      assert.ok(r.explanation.mandatoryMatched.includes('TypeScript'), JSON.stringify(r.explanation));
      assert.ok(r.explanation.reasons.length > 0);
    }
  });

  test('plan and preparation: tailored resume, answers from the profile, channel = the employer API', async () => {
    // This user also matches real listings in the dev database; keep the test to the fixture board.
    await sql`delete from public.job_matches m using public.job_listings l
              where m.user_id = ${userId} and l.id = m.listing_id and l.source_id <> ${sourceId}`;
    const plan = await worker.planUser(userId);
    assert.equal((plan as { planned?: number }).planned, 4, JSON.stringify(plan));
    for (const id of Object.values(JOBS)) await prepareJob((await application(id)).id);

    const main = await application(JOBS.main);
    assert.equal(main.status, 'prepared');
    assert.equal(main.channel, 'api', 'a board with an employer credential goes through its API');
    const [t] = await sql<{ file: Buffer; content: { edits: { after: string }[] } }[]>`select file, content from public.tailored_resumes where id = ${main.tailored_resume_id}`;
    assert.deepEqual(t.content.edits.map((e) => e.after), [TAILORED_LINE], 'one line reworded, nothing invented');
    assert.ok(!t.file.equals(originalResume), 'a job-specific file, not the original');
    const [{ answers }] = await sql<{ answers: { key: string; value: unknown; source: string }[] }[]>`select answers from public.auto_applications where id = ${main.id}`;
    assert.equal(answers.find((a) => a.key === 'question_100')?.source, 'profile', 'notice period comes from the profile');
  });

  test('unknown screening answer: never guessed, waits for the candidate, answered once, remembered', async () => {
    const u = await application(JOBS.unknown);
    assert.deepEqual([u.status, u.reason_code, u.missing], ['pending', 'needs_answers', ['question_200']]);
    const needs = await dashboard('?status=needs_action');
    const item = needs.items.find((i) => i.id.endsWith(u.id));
    assert.ok(item, 'listed under Needs your action');
    assert.ok(item.questions.some((q) => /Kubernetes/.test(q.label)));

    const res = await call('POST', `/v1/auto-apply/applications/${u.id}/answers`, { answers: { question_200: '1' } });
    assert.equal(res.statusCode, 200, res.body);
    const [{ data }] = await sql<{ data: { savedAnswers: { question: string; answer: string }[] } }[]>`select data from public.application_profiles where user_id = ${userId}`;
    assert.ok(data.savedAnswers.some((a) => /Kubernetes/.test(a.question) && a.answer === '1'), 'saved for next time');
    await worker.rechannel();
    assert.deepEqual([(await application(JOBS.unknown)).status, (await application(JOBS.unknown)).channel], ['prepared', 'api']);
  });

  test('authorized submission: sent once through the employer API, verified, on the dashboard with the exact resume', async () => {
    const main = await application(JOBS.main);
    const before = posts.length;
    // The same application sent twice at once (a duplicated job, two workers): one request.
    const results = await Promise.all([worker.sendApplication(main.id, { fetch: boardFetch }), worker.sendApplication(main.id, { fetch: boardFetch })]);
    const sent = posts.slice(before);
    assert.equal(sent.length, 1, JSON.stringify(results));
    assert.equal(sent[0].url, `https://boards-api.greenhouse.io/v1/boards/${BOARD}/jobs/${JOBS.main}`);
    assert.equal(sent[0].auth, `Basic ${Buffer.from('gh-employer-key:').toString('base64')}`);
    const resumePart = sent[0].body?.get('resume') as Blob | null;
    assert.ok(resumePart, 'the tailored resume is attached');

    const done = await application(JOBS.main);
    assert.deepEqual([done.status, done.submitted_via, done.channel], ['submitted', 'api', 'api']);

    const page = await dashboard();
    const row = page.items.find((i) => i.id.endsWith(main.id))!;
    assert.equal(row.status, 'submitted');
    assert.equal(row.evidence, 'verified');
    assert.equal(row.channel, 'api');
    assert.ok(page.stats.total >= 1 && page.stats.today >= 1);
    assert.ok(row.resumeUrl, 'downloadable');
    const file = await app.inject({ method: 'GET', url: new URL(row.resumeUrl!, 'http://x').pathname + new URL(row.resumeUrl!, 'http://x').search });
    assert.equal(file.statusCode, 200);
    const [t] = await sql<{ file: Buffer }[]>`select file from public.tailored_resumes where id = ${done.tailored_resume_id}`;
    assert.ok(file.rawPayload.equals(t.file), 'the exact file that was sent');
    assert.ok(file.rawPayload.equals(Buffer.from(await resumePart.arrayBuffer())));
  });

  test('duplicates: re-planning never applies to the same job again; a sent application is never resent', async () => {
    const plan = await worker.planUser(userId);
    assert.equal((plan as { planned?: number }).planned ?? 0, 0, JSON.stringify(plan));
    const before = posts.length;
    const again = await worker.sendApplication((await application(JOBS.main)).id, { fetch: boardFetch });
    assert.deepEqual(again, { skipped: 'not claimable' });
    assert.equal(posts.length, before);
  });

  test('worker recovery: a send lost after the request went out is Unverified, never resent, never counted', async () => {
    const lost = await application(JOBS.lost);
    hangIds = new Set([JOBS.lost]);
    const r = await worker.sendApplication(lost.id, { fetch: boardFetch, timeoutMs: 200 });
    hangIds = new Set();
    const after1 = await application(JOBS.lost);
    assert.deepEqual([after1.status, after1.reason_code], ['pending', 'unverified'], JSON.stringify(r));

    // A worker that died mid-send leaves the claim: the sweep after the lease marks it Unverified too.
    const crashed = await application(JOBS.unknown);
    await sql`
      update public.auto_applications set status = 'pending', reason_code = 'submitting', claimed_by = 'worker:crashed',
        claimed_at = now() - interval '1 hour', submit_clicked_at = now() - interval '1 hour' where id = ${crashed.id}`;
    await worker.sweepLapsedClaims();
    assert.deepEqual([(await application(JOBS.unknown)).status, (await application(JOBS.unknown)).reason_code], ['pending', 'unverified']);
    const posted = posts.filter((p) => p.url.endsWith(`/${JOBS.unknown}`)).length;
    assert.equal(await worker.sendApplication(crashed.id, { fetch: boardFetch }).then(() => posts.filter((p) => p.url.endsWith(`/${JOBS.unknown}`)).length), posted);

    // A preparation lost to a restart is queued again; a cancelled one is left alone.
    const stalled = await sql<{ id: string }[]>`
      insert into public.auto_applications (user_id, provider, apply_url, title, company, status, plan_day, updated_at)
      values (${userId}, 'greenhouse', 'https://example.com', 'Stalled', 'Zyxquant', 'preparing', current_date, now() - interval '1 hour'),
             (${userId}, 'greenhouse', 'https://example.com', 'Cancelled', 'Zyxquant', 'preparing', current_date, now() - interval '1 hour')
      returning id`;
    await sql`update public.auto_applications set cancelled_at = now() where id = ${stalled[1].id}`;
    const resumed = (await worker.resumeStalledPreparations()).map((r) => r.id);
    assert.ok(resumed.includes(stalled[0].id) && !resumed.includes(stalled[1].id));
    await sql`delete from public.auto_applications where id in ${sql(stalled.map((r) => r.id))}`;

    const page = await dashboard();
    const counted = page.items.filter((i) => i.evidence).map((i) => i.id.split(':')[1]);
    assert.ok(!counted.includes(lost.id) && !counted.includes(crashed.id));
  });

  test('authorization failure: 403 flags the credential, falls back to Assisted Apply, the candidate confirms', async () => {
    const denied = await application(JOBS.denied);
    denyIds = new Set([JOBS.denied]);
    await worker.sendApplication(denied.id, { fetch: boardFetch });
    denyIds = new Set();
    const [cred] = await sql<{ last_error: string | null }[]>`select last_error from public.ats_credentials where board = ${BOARD}`;
    assert.ok(cred.last_error, 'credential flagged');
    const a = await application(JOBS.denied);
    // No browser connected and server form filling off: the candidate submits it.
    assert.deepEqual([a.status, a.reason_code, a.channel], ['pending', 'assisted', 'assisted']);
    const before = (await dashboard()).stats.total;
    assert.ok((await dashboard('?status=needs_action')).items.some((i) => i.id.endsWith(a.id)));

    const res = await call('POST', `/v1/auto-apply/applications/${a.id}/confirm`);
    assert.equal(res.statusCode, 200, res.body);
    const page = await dashboard();
    const row = page.items.find((i) => i.id.endsWith(a.id))!;
    assert.deepEqual([row.status, row.evidence], ['submitted', 'user_confirmed']);
    assert.equal(page.stats.total, before + 1);
    assert.ok(page.stats.verified >= 1 && page.stats.userConfirmed >= 1);
  });
});
