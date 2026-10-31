// End-to-end test of Auto Apply from Friday's servers, laid out as in production (deploy/compose.yml):
// the real API in its own process (apps/api, on the local database: `pnpm infra:up`), a separate
// Playwright browser server (as browserServer.ts runs in the browser container), and the applier
// (src/applier.ts) talking only to those two with its token. Stand-in job boards are served from this
// process; Chromium resolves the job boards' hostnames to them and every other hostname to nothing, so
// no real job board is reached, and the applier only claims this test's own user's applications.
//
//   pnpm --filter @parakeet/worker test:applier
//
//   c1 lever       classic form → confirmation page → Submitted, with the tailored resume
//   c2 ashby       single-page app, cover letter → Submitted
//   c3 greenhouse  "I'm not a robot" box, a browser connected → handed to the browser, nothing sent
//   c4 lever       a CAPTCHA challenge after pressing submit → handed to the browser, nothing sent
//   c5 lever       a required question that wasn't prepared → Needs answers, nothing sent
//   c6 lever       sent, no confirmation → Pending "unverified", marked as sent so it's never resent
//   c7 lever       the job board errors → back to Prepared for later; no browser, so the servers again
//   c8 greenhouse  "I'm not a robot" box, no browser connected → waits for the user
//   c9 workday     sign-in boards are never taken by the servers
//   c10 lever      sent, then a challenge on the next page → "unverified", never handed on (it may have gone)
//   c11 lever      the API won't record the submit click → the button is never pressed
//   off            the user turned server submission off → never taken
//   private        a job board page can't reach this machine or the private network
import assert from 'node:assert/strict';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createServer as createHttps } from 'node:https';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { chromium, type BrowserServer } from 'playwright-core';
import type { AutoApplyTask } from '@parakeet/shared';
import { Applier } from '../src/applier.js';
import { submitInCloud } from '../src/autoapply/cloud.js';

const root = fileURLToPath(new URL('../../..', import.meta.url));
const apiEnv = Object.fromEntries(
  readFileSync(join(root, 'apps/api/.env'), 'utf8')
    .split('\n')
    .map((l) => /^([A-Z_]+)=(.*)$/.exec(l.trim()))
    .filter((m): m is RegExpExecArray => Boolean(m))
    .map((m) => [m[1], m[2].replace(/^"|"$/g, '')]),
);
const sql = postgres(apiEnv.DATABASE_URL, { onnotice: () => {} });
const API_PORT = 4101;
const APPLIER_TOKEN = `applier-e2e-${randomUUID()}`;
/** Stands in for this machine's private services (Redis, the API, cloud metadata): must never be reached. */
const PRIVATE_PORT = 8445;
let privateHits = 0;

const BOARDS_PORT = 8444;
const HOSTS = ['jobs.lever.co', 'jobs.ashbyhq.com', 'boards.greenhouse.io', 'qa.wd1.myworkdayjobs.com'];
const work = mkdtempSync(join(tmpdir(), 'friday-applier-'));
const run = randomUUID().slice(0, 6);
const email = `applier-e2e-${run}@example.com`;
const PDF = Buffer.from('%PDF-1.4\n% Asha Rao resume\n');
const COVER = Buffer.from('%PDF-1.4\n% Asha Rao cover letter\n');

const log = (...a: unknown[]) => console.log(`[applier ${new Date().toISOString().slice(11, 19)}]`, ...a);

// ---- the stand-in job boards ---------------------------------------------------------------------

const received: Record<string, Record<string, unknown>[]> = {};

const page = (title: string, body: string, script = '') =>
  `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body>${body}${script ? `<script>${script}</script>` : ''}</body></html>`;

const leverForm = (id: string, extra = '', onsubmit = '') => `
  <h2>QA Engineer</h2>
  <form method="POST" action="/qa-lever/${id}/apply" enctype="multipart/form-data" ${onsubmit ? `onsubmit="${onsubmit}"` : ''}>
    <label>Resume/CV <input type="file" name="resume" required></label>
    <label>Full name <input name="name" required></label>
    <label>Email <input type="email" name="email" required></label>
    <div class="application-question"><div class="text">Are you authorized to work in India?</div>
      <label><input type="radio" name="cards[abc][field0]" value="Yes" required> Yes</label>
      <label><input type="radio" name="cards[abc][field0]" value="No"> No</label></div>
    ${extra}
    <button type="submit">Submit application</button>
  </form>`;

// What an invisible reCAPTCHA does to a visitor it doesn't trust: a challenge instead of sending.
const challengeOnSubmit =
  "event.preventDefault(); const f = document.createElement('iframe'); f.src = 'https://www.google.com/recaptcha/api2/bframe?k=test'; f.width = 400; f.height = 580; document.body.append(f);";

const ashbyApp = `
  setTimeout(() => {
    document.getElementById('root').innerHTML = \`
      <form id="f">
        <div><label for="_systemfield_name">Name</label><input id="_systemfield_name"></div>
        <div><label for="_systemfield_resume">Resume</label><input id="_systemfield_resume" type="file"></div>
        <div><label for="cover">Cover letter</label><input id="cover" type="file"></div>
        <button type="submit">Submit Application</button>
      </form>\`;
    document.getElementById('f').onsubmit = async (e) => {
      e.preventDefault();
      const file = (id) => document.getElementById(id).files[0];
      await fetch('/submit', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
        name: document.getElementById('_systemfield_name').value, resume: file('_systemfield_resume')?.name ?? null, cover: file('cover')?.name ?? null }) });
      document.getElementById('root').innerHTML = '<h1>Your application was successfully submitted.</h1>';
    };
  }, 500);`;

const greenhouseForm = (token: string) => `
  <form method="POST" action="/embed/job_app/submit?token=${token}" enctype="multipart/form-data">
    <label>First Name <input name="first_name" id="first_name" required></label>
    <label>Resume/CV <input type="file" name="resume" id="resume"></label>
    <iframe title="reCAPTCHA" src="https://www.google.com/recaptcha/api2/anchor?k=test" width="304" height="78"></iframe>
    <button type="submit">Submit Application</button>
  </form>`;

async function body(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const buf = Buffer.concat(chunks);
  if (/json/.test(req.headers['content-type'] ?? '')) return JSON.parse(buf.toString());
  const fd = await new Request('http://x', { method: 'POST', headers: { 'content-type': req.headers['content-type']! }, body: buf }).formData();
  const out: Record<string, unknown> = {};
  for (const [k, v] of fd) out[k] = typeof v === 'string' ? v : { name: v.name, size: v.size, text: Buffer.from(await v.arrayBuffer()).toString() };
  return out;
}

function boards(req: IncomingMessage, res: ServerResponse) {
  const host = (req.headers.host ?? '').split(':')[0];
  const url = new URL(req.url ?? '/', `https://${host}`);
  const html = (b: string, status = 200) => res.writeHead(status, { 'content-type': 'text/html' }).end(b);
  const record = async (id: string) => void (received[id] ??= []).push(await body(req));
  const redirect = (to: string) => res.writeHead(303, { location: to }).end();

  if (host === 'jobs.lever.co') {
    const m = /^\/qa-lever\/(c\d+)\/(apply|thanks|processing|check)$/.exec(url.pathname);
    if (!m) return html('not found', 404);
    const [, id, step] = m;
    if (req.method === 'POST') return void record(id).then(() => redirect(`/qa-lever/${id}/${id === 'c6' ? 'processing' : id === 'c10' ? 'check' : 'thanks'}`));
    if (step === 'thanks') return html(page('Thanks', '<h1>Application submitted!</h1><p>Thanks for applying to QA Co.</p>'));
    if (step === 'processing') return html(page('QA Co', '<p>We’re processing your request.</p>'));
    if (step === 'check') return html(page('QA Co', '<iframe src="https://www.google.com/recaptcha/api2/bframe?k=test" width="400" height="580"></iframe>'));
    if (id === 'c7') return html('Internal error', 500);
    const extra = id === 'c5' ? '<label>Years of Rust experience <input name="cards[x][field9]" required></label>' : '';
    // c1 also tries to reach private addresses, as a hostile page would.
    const probe = id === 'c1' ? `<img src="http://127.0.0.1:${PRIVATE_PORT}/x"><img src="http://169.254.169.254/latest/meta-data/"><img src="http://localhost:${PRIVATE_PORT}/y">` : '';
    return html(page('QA Co', leverForm(id, extra, id === 'c4' ? challengeOnSubmit : '') + probe));
  }
  if (host === 'jobs.ashbyhq.com') {
    if (req.method === 'POST') return void record('c2').then(() => res.writeHead(200, { 'content-type': 'application/json' }).end('{}'));
    return html(page('QA Co', '<div id="root">Loading…</div>', ashbyApp));
  }
  if (host === 'boards.greenhouse.io') {
    const token = url.searchParams.get('token') ?? '';
    if (req.method === 'POST') return void record(token).then(() => redirect(`/embed/job_app/confirmation?token=${token}`));
    return html(page('QA Co', greenhouseForm(token)));
  }
  html('not found', 404);
}

// ---- data ----------------------------------------------------------------------------------------

const A = (key: string, label: string, value: string, source = 'profile') => ({ key, label, value, source });
const Q = (key: string, label: string, type = 'text', required = true, options: string[] = [], kind = 'custom') => ({ key, label, type, required, options, kind });

const lever = {
  form: [Q('resume', 'Resume/CV', 'file', true, [], 'resume'), Q('name', 'Full name', 'text', true, [], 'standard'),
    Q('email', 'Email', 'text', true, [], 'standard'), Q('cards[abc][field0]', 'Are you authorized to work in India?', 'select', true, ['Yes', 'No'])],
  answers: [A('resume', 'Resume/CV', 'Asha Rao Resume.pdf', 'file'), A('name', 'Full name', 'Asha Rao'), A('email', 'Email', email),
    A('cards[abc][field0]', 'Are you authorized to work in India?', 'Yes', 'ai')],
};
const greenhouse = {
  form: [Q('first_name', 'First Name', 'text', true, [], 'standard'), Q('resume', 'Resume/CV', 'file', true, [], 'resume')],
  answers: [A('first_name', 'First Name', 'Asha'), A('resume', 'Resume/CV', 'Asha Rao Resume.pdf', 'file')],
};

type Scenario = { provider: string; url: string; form: unknown[]; answers: unknown[] };
const SCENARIOS: Record<string, Scenario> = {
  c1: { provider: 'lever', url: 'https://jobs.lever.co/qa-lever/c1/apply', ...lever },
  c2: {
    provider: 'ashby',
    url: 'https://jobs.ashbyhq.com/qa-ashby/c2/application',
    form: [Q('_systemfield_name', 'Name', 'text', true, [], 'standard'), Q('_systemfield_resume', 'Resume', 'file', true, [], 'resume'), Q('cover', 'Cover letter', 'file', false)],
    answers: [A('_systemfield_name', 'Name', 'Asha Rao'), A('_systemfield_resume', 'Resume', 'Asha Rao Resume.pdf', 'file'),
      A('cover', 'Cover letter', 'Asha Rao Cover Letter.pdf', 'cover_letter')],
  },
  c3: { provider: 'greenhouse', url: 'https://boards.greenhouse.io/embed/job_app?for=qa&token=c3', ...greenhouse },
  c4: { provider: 'lever', url: 'https://jobs.lever.co/qa-lever/c4/apply', ...lever },
  c5: { provider: 'lever', url: 'https://jobs.lever.co/qa-lever/c5/apply', ...lever },
  c6: { provider: 'lever', url: 'https://jobs.lever.co/qa-lever/c6/apply', ...lever },
  c7: { provider: 'lever', url: 'https://jobs.lever.co/qa-lever/c7/apply', ...lever },
  c8: { provider: 'greenhouse', url: 'https://boards.greenhouse.io/embed/job_app?for=qa&token=c8', ...greenhouse },
  c9: { provider: 'workday', url: 'https://qa.wd1.myworkdayjobs.com/en-US/qa/job/c9/apply/applyManually', ...greenhouse },
  c10: { provider: 'lever', url: 'https://jobs.lever.co/qa-lever/c10/apply', ...lever },
};

let userId = '';
let deviceId = '';
const sourceIds: string[] = [];
const apps: Record<string, string> = {};

async function seed() {
  userId = randomUUID();
  await sql`insert into auth.users (id, email, aud, role) values (${userId}, ${email}, 'authenticated', 'authenticated')`;
  await sql`insert into public.users (id, email, auth_provider) values (${userId}, ${email}, 'email')`;
  await sql`insert into public.auto_apply_settings (user_id, enabled, consented_at, daily_limit) values (${userId}, true, now(), 20)`;
  // Score order is dispatch order: one application per user at a time, best first.
  let score = 100;
  for (const [id, s] of Object.entries(SCENARIOS)) {
    const [src] = await sql<{ id: string }[]>`
      insert into public.job_sources (provider, board, company, enabled) values (${s.provider}, ${`qa-${run}-${id}`}, 'QA Co', false) returning id`;
    sourceIds.push(src.id);
    const [l] = await sql<{ id: string }[]>`
      insert into public.job_listings (source_id, external_id, title, company, apply_url)
      values (${src.id}, ${id}, ${`QA Engineer ${id}`}, 'QA Co', ${s.url}) returning id`;
    const [t] = await sql<{ id: string }[]>`
      insert into public.tailored_resumes (user_id, listing_id, title, company, status, content, file, file_name, cover_letter, cover_letter_file)
      values (${userId}, ${l.id}, ${`QA Engineer ${id}`}, 'QA Co', 'ready', '{"format":"pdf"}', ${PDF}, 'Asha Rao Resume.pdf', 'Dear QA Co', ${COVER})
      returning id`;
    const [a] = await sql<{ id: string }[]>`
      insert into public.auto_applications (user_id, listing_id, tailored_resume_id, provider, apply_url, title, company, score, status, form, answers, plan_day)
      values (${userId}, ${l.id}, ${t.id}, ${s.provider}, ${s.url}, ${`QA Engineer ${id}`}, 'QA Co', ${--score}, 'prepared',
              ${sql.json(s.form as never)}, ${sql.json(s.answers as never)}, current_date)
      returning id`;
    apps[id] = a.id;
  }
  // A browser running the extension, for the hand-offs.
  [{ id: deviceId }] = await sql<{ id: string }[]>`
    insert into public.auto_apply_devices (user_id, name, token_hash, last_seen_at) values (${userId}, 'Chrome on Linux', ${`qa-${run}`}, now()) returning id`;
}

async function cleanup() {
  if (sourceIds.length) await sql`delete from public.job_sources where id in ${sql(sourceIds)}`;
  if (userId) await sql`delete from auth.users where id = ${userId}`;
  // Emails the API queued about applications waiting: not for a deleted user.
  const { Queue } = await import('bullmq');
  const q = new Queue('autoapply', { connection: { url: apiEnv.REDIS_URL } });
  for (const job of await q.getJobs(['waiting', 'delayed', 'prioritized', 'paused'])) {
    if (job?.data?.userId === userId) await job.remove().catch(() => {});
  }
  await q.close();
}

const row = async (id: string) =>
  (await sql<{ status: string; reason_code: string | null; needs_browser: boolean; submit_clicked_at: Date | null; retry_at: Date | null; missing: string[]; claimed_by: string | null }[]>`
    select status, reason_code, needs_browser, submit_clicked_at, retry_at, missing, claimed_by from public.auto_applications where id = ${apps[id]}`)[0];

let applier: Applier;
/** Has the applier claim and submit one of this user's applications; returns the scenario it took. */
async function next() {
  const r = await applier.once();
  if (!r) return null;
  return { id: Object.entries(apps).find(([, v]) => v === r.task.id)![0], status: r.status, result: r.result };
}

const results: [string, string, string?][] = [];
async function check(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    results.push(['✔', name]);
    log('✔', name);
  } catch (err) {
    results.push(['✖', name, (err as Error).message]);
    log('✖', name, '\n   ', (err as Error).message);
  }
}

let browserServer: BrowserServer | undefined;
let api: ChildProcess | undefined;
try {
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=friday-applier',
    '-keyout', join(work, 'key.pem'), '-out', join(work, 'cert.pem')], { stdio: 'ignore' });
  const server = createHttps({ key: readFileSync(join(work, 'key.pem')), cert: readFileSync(join(work, 'cert.pem')) }, boards);
  await new Promise<void>((r) => server.listen(BOARDS_PORT, '127.0.0.1', r));
  server.unref();
  const priv = createServer((_req, res) => {
    privateHits++;
    res.end('secret');
  });
  await new Promise<void>((r) => priv.listen(PRIVATE_PORT, '127.0.0.1', r));
  priv.unref();

  // The API, with the applier's token.
  api = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
    cwd: join(root, 'apps/api'),
    env: { ...process.env, PORT: String(API_PORT), NODE_ENV: 'test', APPLIER_TOKEN_SHA256: createHash('sha256').update(APPLIER_TOKEN).digest('hex') },
    stdio: ['ignore', 'ignore', process.env.E2E_VERBOSE ? 'inherit' : 'ignore'],
  });
  for (let i = 0; ; i++) {
    if (await fetch(`http://127.0.0.1:${API_PORT}/livez`).then((r) => r.ok, () => false)) break;
    if (i > 120) throw new Error('The API didn’t start');
    await new Promise((r) => setTimeout(r, 500));
  }

  await seed();
  log('seeded', Object.keys(apps).length, 'applications for', email);

  // The browser on its own, as in the browser container; the applier connects to it.
  const rules = [...HOSTS.map((h) => `MAP ${h} 127.0.0.1:${BOARDS_PORT}`), 'MAP * ~NOTFOUND', 'EXCLUDE 127.0.0.1', 'EXCLUDE localhost'].join(', ');
  browserServer = await chromium.launchServer({
    executablePath: process.env.CHROME ?? join(homedir(), '.cache/ms-playwright/chromium-1243/chrome-linux64/chrome'),
    headless: true,
    args: [`--host-resolver-rules=${rules}`, '--ignore-certificate-errors'],
    wsPath: `/${randomUUID()}`,
  });
  applier = new Applier({
    apiUrl: `http://127.0.0.1:${API_PORT}`,
    token: APPLIER_TOKEN,
    browserWs: browserServer.wsEndpoint(),
    noSandbox: false,
    slots: 1,
    idleMs: 0,
    onlyUser: userId,
  });

  await check('c1 lever: filled on the server and submitted; the job board confirmed it', async () => {
    const r = await next();
    assert.equal(r?.id, 'c1');
    assert.equal(r?.status, 'submitted');
    const row1 = await row('c1');
    assert.equal(row1.status, 'submitted');
    assert.equal(row1.claimed_by, null);
    const got = received.c1?.[0] as Record<string, any>;
    assert.equal(received.c1.length, 1);
    assert.equal(got.name, 'Asha Rao');
    assert.equal(got['cards[abc][field0]'], 'Yes');
    assert.equal(got.resume.name, 'Asha Rao Resume.pdf');
    assert.equal(got.resume.text, PDF.toString());
    const [applied] = await sql`select status from public.job_applications where user_id = ${userId} and title = 'QA Engineer c1'`;
    assert.equal(applied?.status, 'applied');
  });

  await check('c2 ashby: late-rendered form, resume and cover letter → Submitted', async () => {
    const r = await next();
    assert.equal(r?.id, 'c2');
    assert.equal((await row('c2')).status, 'submitted');
    assert.deepEqual(received.c2, [{ name: 'Asha Rao', resume: 'Asha Rao Resume.pdf', cover: 'Asha Rao Cover Letter.pdf' }]);
  });

  await check('c3 greenhouse: an "I’m not a robot" box goes to the user’s browser, untouched and unsent', async () => {
    const r = await next();
    assert.equal(r?.id, 'c3');
    const row3 = await row('c3');
    assert.equal(row3.status, 'prepared');
    assert.equal(row3.needs_browser, true);
    assert.equal(row3.submit_clicked_at, null);
    assert.equal(received.c3, undefined);
  });

  await check('c4 lever: a CAPTCHA challenge after submit goes to the browser; nothing was sent', async () => {
    const r = await next();
    assert.equal(r?.id, 'c4', 'c3 is not taken again');
    const row4 = await row('c4');
    assert.equal(row4.status, 'prepared');
    assert.equal(row4.needs_browser, true);
    assert.equal(received.c4, undefined);
  });

  await check('c5 lever: an unprepared required question → Needs answers, nothing sent', async () => {
    const r = await next();
    assert.equal(r?.id, 'c5');
    const row5 = await row('c5');
    assert.equal(row5.status, 'pending');
    assert.equal(row5.reason_code, 'needs_answers');
    assert.ok(row5.missing.length >= 1);
    assert.equal(received.c5, undefined);
  });

  await check('c6 lever: sent with no confirmation → Pending "unverified", marked as sent', async () => {
    const r = await next();
    assert.equal(r?.id, 'c6');
    const row6 = await row('c6');
    assert.equal(row6.status, 'pending');
    assert.equal(row6.reason_code, 'unverified');
    assert.ok(row6.submit_clicked_at, 'the submit click was recorded first');
    assert.equal(received.c6.length, 1);
  });

  // From here on no browser is connected.
  await sql`update public.auto_apply_devices set revoked_at = now() where id = ${deviceId}`;

  await check('c7 lever: the job board errors → tried again later by the servers', async () => {
    const r = await next();
    assert.equal(r?.id, 'c7');
    const row7 = await row('c7');
    assert.equal(row7.status, 'prepared');
    assert.equal(row7.needs_browser, false);
    assert.ok(row7.retry_at && row7.retry_at > new Date());
  });

  await check('c8 greenhouse: a CAPTCHA with no browser connected waits for the user', async () => {
    const r = await next();
    assert.equal(r?.id, 'c8');
    const row8 = await row('c8');
    assert.equal(row8.status, 'pending');
    assert.equal(row8.reason_code, 'captcha');
    assert.equal(row8.needs_browser, true);
    assert.equal(received.c8, undefined);
  });

  await check('c10 lever: a challenge after the page moved on → "unverified", never handed on', async () => {
    const r = await next();
    assert.equal(r?.id, 'c10');
    const row10 = await row('c10');
    assert.equal(row10.status, 'pending');
    assert.equal(row10.reason_code, 'unverified');
    assert.equal(row10.needs_browser, false);
    assert.equal(received.c10.length, 1);
  });

  await check('c11: if the submit click can’t be recorded, the button is never pressed', async () => {
    const b = await chromium.connect(browserServer!.wsEndpoint());
    const task = { id: randomUUID(), provider: 'lever', applyUrl: 'https://jobs.lever.co/qa-lever/c11/apply', title: 'QA', company: 'QA Co',
      ...lever, resumePath: '', resumeFileName: 'Asha Rao Resume.pdf', coverLetterPath: null, coverLetterFileName: null, leaseUntil: '' } as unknown as AutoApplyTask;
    const result = await submitInCloud(b, task, { resume: { name: 'Asha Rao Resume.pdf', base64: PDF.toString('base64') }, coverLetter: null }, async () => {
      throw new Error('API unreachable');
    });
    await b.close();
    assert.equal(result.outcome, 'failed');
    assert.equal(result.clicked, false);
    await new Promise((r) => setTimeout(r, 1500));
    assert.equal(received.c11, undefined);
  });

  await check('c9 workday, and everything handed on, is left alone', async () => {
    assert.equal(await next(), null);
    assert.equal((await row('c9')).status, 'prepared');
  });

  await check('server submission off: nothing is taken', async () => {
    await sql`update public.auto_applications set retry_at = null where id = ${apps.c7}`;
    await sql`update public.auto_apply_settings set cloud_submit = false where user_id = ${userId}`;
    assert.equal(await next(), null);
    await sql`update public.auto_apply_settings set cloud_submit = true where user_id = ${userId}`;
    const r = await next();
    assert.equal(r?.id, 'c7', 'and on again, the retry is taken');
  });

  await check('no job board page reached this machine or the private network', async () => {
    assert.equal(privateHits, 0);
  });

  await check('nothing was sent twice, and nothing else reached a job board', async () => {
    assert.deepEqual(Object.keys(received).sort(), ['c1', 'c10', 'c2', 'c6']);
    for (const k of Object.keys(received)) assert.equal(received[k].length, 1, k);
  });
} catch (err) {
  results.push(['✖', 'setup', (err as Error).message]);
  log('✖ setup', err);
} finally {
  await applier?.stop().catch(() => {});
  await browserServer?.close().catch(() => {});
  api?.kill();
  await cleanup().catch((err) => log('cleanup failed', err.message));
  await sql.end();
  rmSync(work, { recursive: true, force: true });
}

const failed = results.filter((r) => r[0] === '✖');
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
process.exit(failed.length ? 1 : 0);
