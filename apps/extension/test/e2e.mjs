// End-to-end test of Auto Apply's submission path: the real extension (built from src/) in Chromium,
// a real API on the local stack (`pnpm infra:up`), and stand-in job boards served from this process.
// Chromium resolves the job boards' hostnames (jobs.lever.co, boards.greenhouse.io, …) to the stand-in
// server and every other hostname to nothing, so no real job board is ever reached.
//
//   SUPABASE_SERVICE_ROLE_KEY=$(npx supabase status -o env | sed -n 's/^SERVICE_ROLE_KEY="\(.*\)"/\1/p') \
//     pnpm --filter @parakeet/extension test:e2e
//
// Each scenario is a prepared application in the database; the extension claims them best score first:
//   1 lever      classic form POST, confirmation on the next page (re-injected after navigating)
//   2 ashby      single-page app: late-rendered form, Yes/No buttons, custom listbox, cover letter
//   3 greenhouse searchable dropdowns (one falling back to "Other"), then an "I'm not a robot" box:
//                left for the user, who sends it in that tab → Submitted
//   4 lever      a required question that wasn't prepared → Needs answers, nothing sent
//   5 lever      the user closes the tab while it loads → retried later
//   6 lever      sent, no confirmation, tab closed → Pending "unverified", never sent twice
//   7 lever      the API is down when the result comes in → delivered later, nothing claimed meanwhile
//   8 lever      plain success after the outage
//   9 workday    sign-in first: left for the user, who signs in; the form is then filled and sent
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer as createHttp, request as httpRequest } from 'node:http';
import { createServer as createHttps } from 'node:https';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { chromium } from 'playwright-core';

const root = fileURLToPath(new URL('../../..', import.meta.url));
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!serviceKey) {
  console.log('Skipped: set SUPABASE_SERVICE_ROLE_KEY to run against the local stack.');
  process.exit(0);
}
const apiEnv = Object.fromEntries(
  readFileSync(join(root, 'apps/api/.env'), 'utf8')
    .split('\n')
    .map((l) => /^([A-Z_]+)=(.*)$/.exec(l.trim()))
    .filter(Boolean)
    .map((m) => [m[1], m[2].replace(/^"|"$/g, '')]),
);
const sql = postgres(apiEnv.DATABASE_URL, { onnotice: () => {} });
const SUPABASE_URL = apiEnv.SUPABASE_URL;

const API_PORT = 4100;
const PROXY_PORT = 4199;
const BOARDS_PORT = 8443;
const JOBS_HOST = 'jobs.friday.test';
const HOSTS = ['jobs.lever.co', 'jobs.ashbyhq.com', 'boards.greenhouse.io', 'qa.wd1.myworkdayjobs.com', JOBS_HOST];
const work = mkdtempSync(join(tmpdir(), 'friday-e2e-'));
const run = randomUUID().slice(0, 6);
const email = `autoapply-e2e-${run}@example.com`;
const PDF = Buffer.from('%PDF-1.4\n% Asha Rao resume\n');
const COVER = Buffer.from('%PDF-1.4\n% Asha Rao cover letter\n');

const log = (...a) => console.log(`[e2e ${new Date().toISOString().slice(11, 19)}]`, ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(what, fn, ms = 90_000, every = 500) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}`);
    await sleep(every);
  }
}

// ---- the stand-in job boards ---------------------------------------------------------------------

/** Every application each stand-in board received, by scenario. */
const received = {};
let apiDown = false;
/** Scenario 7: the API goes down the moment the job board has the application. */
let onReceived = () => {};

const page = (title, body, script = '') =>
  `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body>${body}${script ? `<script>${script}</script>` : ''}</body></html>`;

const leverForm = (id, extra = '') => `
  <h2>QA Engineer</h2>
  <form method="POST" action="/qa-lever/${id}/apply" enctype="multipart/form-data">
    <ul>
      <li class="application-question"><label>Resume/CV <input type="file" name="resume" required></label></li>
      <li class="application-question"><label>Full name <input name="name" required></label></li>
      <li class="application-question"><label>Email <input type="email" name="email" required></label></li>
      <li class="application-question"><label>Phone <input name="phone" required></label></li>
      <li class="application-question"><label>Current location <input name="location"></label></li>
      <li class="application-question"><div class="text">Are you authorized to work in India?</div>
        <label><input type="radio" name="cards[abc][field0]" value="Yes" required> Yes</label>
        <label><input type="radio" name="cards[abc][field0]" value="No"> No</label></li>
      <li class="application-question"><label>Why do you want to work here? <textarea name="cards[abc][field1]" required></textarea></label></li>
      ${extra}
      <li class="application-question"><label>Gender <select name="eeo[gender]"><option value="">Select…</option><option>Male</option><option>Female</option><option>Decline to self-identify</option></select></label></li>
    </ul>
    <button type="submit">Submit application</button>
  </form>`;

const ashbyApp = `
  setTimeout(() => {
    document.getElementById('root').innerHTML = \`
      <form id="f">
        <div><label for="_systemfield_name">Name</label><input id="_systemfield_name"></div>
        <div><label for="_systemfield_email">Email</label><input id="_systemfield_email" type="email"></div>
        <div><label for="_systemfield_resume">Resume</label><input id="_systemfield_resume" type="file"></div>
        <div><label for="cover">Cover letter</label><input id="cover" type="file"></div>
        <div class="q"><div>Are you willing to work from Bengaluru?</div>
          <input type="checkbox" name="q_bool" style="display:none">
          <button type="button" data-v="Yes">Yes</button><button type="button" data-v="No">No</button></div>
        <div class="q"><div>Years of experience</div>
          <input type="hidden" name="q_years"><button type="button" aria-haspopup="listbox" id="years">Select…</button></div>
        <button type="submit">Submit Application</button>
      </form>\`;
    let bool = null;
    document.querySelectorAll('[data-v]').forEach((b) => (b.onclick = () => { bool = b.dataset.v; b.setAttribute('aria-pressed', 'true'); }));
    document.getElementById('years').onclick = () => {
      const ul = document.createElement('ul');
      ul.setAttribute('role', 'listbox');
      ul.innerHTML = ['0-2', '3-5', '6+'].map((o) => '<li role="option">' + o + '</li>').join('');
      ul.querySelectorAll('li').forEach((li) => (li.onclick = () => {
        document.querySelector('[name=q_years]').value = li.textContent;
        document.getElementById('years').textContent = li.textContent;
        ul.remove();
      }));
      document.body.append(ul);
    };
    document.getElementById('f').onsubmit = async (e) => {
      e.preventDefault();
      const file = (id) => document.getElementById(id).files[0];
      const body = {
        name: document.getElementById('_systemfield_name').value,
        email: document.getElementById('_systemfield_email').value,
        resume: file('_systemfield_resume')?.name ?? null,
        resumeSize: file('_systemfield_resume')?.size ?? 0,
        cover: file('cover')?.name ?? null,
        willing: bool,
        years: document.querySelector('[name=q_years]').value,
      };
      await fetch('/qa-ashby/s2/submit', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      document.getElementById('root').innerHTML = '<h1>Your application was successfully submitted.</h1><p>Thanks for applying!</p>';
    };
  }, 600);`;

const greenhouseForm = `
  <h2>QA Engineer at QA Co</h2>
  <form method="POST" action="/embed/job_app/submit?token=s3" enctype="multipart/form-data">
    <label>First Name <input name="first_name" id="first_name" required></label>
    <label>Last Name <input name="last_name" id="last_name" required></label>
    <label>Email <input name="email" id="email" required></label>
    <label>Resume/CV <input type="file" name="resume" id="resume"></label>
    <div class="field"><label for="country">Country</label>
      <div class="select__control"><input role="combobox" aria-autocomplete="list" id="country" autocomplete="off"></div>
      <input type="hidden" name="country_value"></div>
    <div class="field"><label for="school--0">School</label>
      <div class="select__control"><input role="combobox" aria-autocomplete="list" id="school--0" autocomplete="off"></div>
      <input type="hidden" name="school_value"></div>
    <input type="hidden" name="g-recaptcha-response" id="g-recaptcha-response">
    <iframe title="reCAPTCHA" src="https://www.google.com/recaptcha/api2/anchor?k=test" width="304" height="78"></iframe>
    <button type="submit">Submit Application</button>
  </form>`;

// Searchable dropdowns like Greenhouse's react-select: type to filter, click an option.
const greenhouseScript = `
  const lists = { country: ['India', 'Indonesia', 'Ireland'], 'school--0': ['IIT Bombay', 'IIT Delhi', 'Other'] };
  for (const [id, options] of Object.entries(lists)) {
    const input = document.getElementById(id);
    const hidden = input.closest('.field').querySelector('input[type=hidden]');
    input.addEventListener('input', () => {
      document.querySelectorAll('.menu').forEach((m) => m.remove());
      const menu = document.createElement('div');
      menu.className = 'menu';
      for (const o of options.filter((o) => o.toLowerCase().startsWith(input.value.toLowerCase()))) {
        const d = document.createElement('div');
        d.setAttribute('role', 'option');
        d.textContent = o;
        d.onclick = () => { hidden.value = o; input.value = o; menu.remove(); };
        menu.append(d);
      }
      input.closest('.field').append(menu);
    });
  }`;

const workdaySignIn = `
  <div id="root"><h2>Sign in to continue</h2><label>Email <input type="email"></label><label>Password <input type="password"></label>
  <button>Sign In</button></div>`;
const workdayForm = `
  <form method="POST" action="/en-US/qa/job/s9/submit" enctype="multipart/form-data">
    <label>First Name <input name="firstName" required></label>
    <label>Last Name <input name="lastName" required></label>
    <label>Email <input name="email" required></label>
    <label>Phone <input name="phone" required></label>
    <label>Resume <input type="file" name="resume"></label>
    <button type="submit">Submit</button>
  </form>`;

async function formData(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = Buffer.concat(chunks);
  if (/json/.test(req.headers['content-type'] ?? '')) return JSON.parse(body.toString());
  const fd = await new Request('http://x', { method: 'POST', headers: { 'content-type': req.headers['content-type'] }, body }).formData();
  const out = {};
  for (const [k, v] of fd) out[k] = typeof v === 'string' ? v : { name: v.name, size: v.size, text: Buffer.from(await v.arrayBuffer()).toString() };
  return out;
}

function boards(req, res) {
  const host = (req.headers.host ?? '').split(':')[0];
  const url = new URL(req.url, `https://${host}`);
  const html = (body, status = 200) => res.writeHead(status, { 'content-type': 'text/html' }).end(body);
  const record = async (id) => {
    (received[id] ??= []).push(await formData(req));
    onReceived(id);
  };
  const redirect = (to) => res.writeHead(303, { location: to }).end();

  if (host === JOBS_HOST) {
    // The Friday Jobs site, signed in: what session.js reads.
    return html(page('Friday Jobs', '<h1>Auto Apply</h1>', `localStorage.setItem('sb-qa-auth-token', ${JSON.stringify(JSON.stringify(boards.session))});`));
  }
  if (host === 'jobs.lever.co') {
    const m = /^\/qa-lever\/(s\d+)\/(apply|thanks|processing)$/.exec(url.pathname);
    if (!m) return html('not found', 404);
    const [, id, step] = m;
    if (req.method === 'POST') return record(id).then(() => redirect(`/qa-lever/${id}/${id === 's6' ? 'processing' : 'thanks'}`));
    if (step === 'thanks') return html(page('Thanks', '<h1>Application submitted!</h1><p>Thanks for applying to QA Co.</p>'));
    if (step === 'processing') return html(page('QA Co', '<p>We’re processing your request.</p>'));
    if (id === 's5') return html(page('QA Co', '<p>Loading…</p>'));
    return html(page('QA Co', leverForm(id, id === 's4' ? '<li class="application-question"><label>Years of Rust experience <input name="cards[x][field9]" required></label></li>' : '')));
  }
  if (host === 'jobs.ashbyhq.com') {
    if (req.method === 'POST') return record('s2').then(() => res.writeHead(200, { 'content-type': 'application/json' }).end('{}'));
    return html(page('QA Co', '<div id="root">Loading…</div>', ashbyApp));
  }
  if (host === 'boards.greenhouse.io') {
    if (req.method === 'POST') return record('s3').then(() => redirect('/embed/job_app/confirmation?token=s3'));
    if (url.pathname.includes('confirmation')) return html(page('Thanks', '<h1>Thank you for applying.</h1>'));
    return html(page('QA Co', greenhouseForm, greenhouseScript));
  }
  if (host === 'qa.wd1.myworkdayjobs.com') {
    if (req.method === 'POST') return record('s9').then(() => redirect('/en-US/qa/job/s9/applicationSubmitted'));
    if (url.pathname.endsWith('applicationSubmitted')) return html(page('Submitted', '<h1>Application Submitted</h1>'));
    return html(page('QA Co', workdaySignIn, `window.__form = ${JSON.stringify(workdayForm)};`));
  }
  html('not found', 404);
}

// ---- setup ---------------------------------------------------------------------------------------

async function supabase(path, body) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1${path}`, {
    method: 'POST',
    headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`${path}: ${JSON.stringify(json)}`);
  return json;
}

const ANSWER = (key, label, value, source = 'profile') => ({ key, label, value, source });
const Q = (key, label, type = 'text', required = true, options = [], kind = 'custom') => ({ key, label, type, required, options, kind });

const leverTask = {
  form: [
    Q('resume', 'Resume/CV', 'file', true, [], 'resume'),
    Q('name', 'Full name', 'text', true, [], 'standard'),
    Q('email', 'Email', 'text', true, [], 'standard'),
    Q('phone', 'Phone', 'text', true, [], 'standard'),
    Q('location', 'Current location', 'text', false, [], 'standard'),
    Q('cards[abc][field0]', 'Are you authorized to work in India?', 'select', true, ['Yes', 'No']),
    Q('cards[abc][field1]', 'Why do you want to work here?', 'textarea'),
    Q('eeo[gender]', 'Gender', 'select', false, ['Male', 'Female', 'Decline to self-identify'], 'eeo'),
  ],
  answers: [
    ANSWER('resume', 'Resume/CV', 'Asha Rao Resume.pdf', 'file'),
    ANSWER('name', 'Full name', 'Asha Rao'),
    ANSWER('email', 'Email', email),
    ANSWER('phone', 'Phone', '+91 98765 43210'),
    ANSWER('location', 'Current location', 'Bengaluru, India'),
    ANSWER('cards[abc][field0]', 'Are you authorized to work in India?', 'Yes', 'ai'),
    ANSWER('cards[abc][field1]', 'Why do you want to work here?', 'I build test tooling and QA Co ships carefully.', 'ai'),
    ANSWER('eeo[gender]', 'Gender', 'Decline to self-identify', 'declined'),
  ],
};

const SCENARIOS = {
  s1: { provider: 'lever', url: 'https://jobs.lever.co/qa-lever/s1/apply', ...leverTask },
  s2: {
    provider: 'ashby',
    url: 'https://jobs.ashbyhq.com/qa-ashby/s2/application',
    form: [
      Q('_systemfield_name', 'Name', 'text', true, [], 'standard'),
      Q('_systemfield_email', 'Email', 'text', true, [], 'standard'),
      Q('_systemfield_resume', 'Resume', 'file', true, [], 'resume'),
      Q('cover', 'Cover letter', 'file', false),
      Q('q_bool', 'Are you willing to work from Bengaluru?', 'checkbox', true, ['Yes', 'No']),
      Q('q_years', 'Years of experience', 'select', true, ['0-2', '3-5', '6+']),
    ],
    answers: [
      ANSWER('_systemfield_name', 'Name', 'Asha Rao'),
      ANSWER('_systemfield_email', 'Email', email),
      ANSWER('_systemfield_resume', 'Resume', 'Asha Rao Resume.pdf', 'file'),
      ANSWER('cover', 'Cover letter', 'Asha Rao Cover Letter.pdf', 'cover_letter'),
      ANSWER('q_bool', 'Are you willing to work from Bengaluru?', 'Yes', 'ai'),
      ANSWER('q_years', 'Years of experience', '3-5', 'ai'),
    ],
  },
  s3: {
    provider: 'greenhouse',
    url: 'https://boards.greenhouse.io/embed/job_app?for=qa-gh&token=s3',
    form: [Q('first_name', 'First Name', 'text', true, [], 'standard'), Q('last_name', 'Last Name', 'text', true, [], 'standard'),
      Q('email', 'Email', 'text', true, [], 'standard'), Q('resume', 'Resume/CV', 'file', true, [], 'resume'),
      Q('country', 'Country', 'select', true, [], 'standard'), Q('school--0', 'School', 'select', true)],
    answers: [ANSWER('first_name', 'First Name', 'Asha'), ANSWER('last_name', 'Last Name', 'Rao'), ANSWER('email', 'Email', email),
      ANSWER('resume', 'Resume/CV', 'Asha Rao Resume.pdf', 'file'), ANSWER('country', 'Country', 'India'),
      // Not in the board's list: "Other" is chosen.
      ANSWER('school--0', 'School', 'National Institute of Technology Karnataka', 'ai')],
  },
  s4: { provider: 'lever', url: 'https://jobs.lever.co/qa-lever/s4/apply', ...leverTask },
  s5: { provider: 'lever', url: 'https://jobs.lever.co/qa-lever/s5/apply', ...leverTask },
  s6: { provider: 'lever', url: 'https://jobs.lever.co/qa-lever/s6/apply', ...leverTask },
  s7: { provider: 'lever', url: 'https://jobs.lever.co/qa-lever/s7/apply', ...leverTask },
  s8: { provider: 'lever', url: 'https://jobs.lever.co/qa-lever/s8/apply', ...leverTask },
  s9: {
    provider: 'workday',
    url: 'https://qa.wd1.myworkdayjobs.com/en-US/qa/job/s9/apply/applyManually',
    form: [Q('firstName', 'First name', 'text', true, [], 'standard'), Q('lastName', 'Last name', 'text', true, [], 'standard'),
      Q('email', 'Email', 'text', true, [], 'standard'), Q('phone', 'Phone', 'text', true, [], 'standard'), Q('resume', 'Resume', 'file', true, [], 'resume')],
    answers: [ANSWER('firstName', 'First name', 'Asha'), ANSWER('lastName', 'Last name', 'Rao'), ANSWER('email', 'Email', email),
      ANSWER('phone', 'Phone', '+91 98765 43210'), ANSWER('resume', 'Resume', 'Asha Rao Resume.pdf', 'file')],
  },
};

let userId;
const sourceIds = [];
const apps = {};

async function seed() {
  const password = randomUUID();
  userId = (await supabase('/admin/users', { email, password, email_confirm: true })).id;
  const token = await supabase('/token?grant_type=password', { email, password });
  boards.session = { access_token: token.access_token, refresh_token: token.refresh_token, expires_at: token.expires_at, user: { email } };
  await sql`insert into public.users (id, email, auth_provider) values (${userId}, ${email}, 'email')`;
  // Everything here is for the extension, not Friday's servers (apps/worker/test/applier.e2e.ts).
  await sql`insert into public.auto_apply_settings (user_id, enabled, consented_at, daily_limit, cloud_submit) values (${userId}, true, now(), 20, false)`;
  let score = 100;
  for (const [id, s] of Object.entries(SCENARIOS)) {
    const [src] = await sql`
      insert into public.job_sources (provider, board, company, enabled) values (${s.provider}, ${`qa-${run}-${id}`}, 'QA Co', false) returning id`;
    sourceIds.push(src.id);
    const [l] = await sql`
      insert into public.job_listings (source_id, external_id, title, company, apply_url)
      values (${src.id}, ${id}, ${`QA Engineer ${id}`}, 'QA Co', ${s.url}) returning id`;
    const [t] = await sql`
      insert into public.tailored_resumes (user_id, listing_id, title, company, status, content, file, file_name, cover_letter, cover_letter_file)
      values (${userId}, ${l.id}, ${`QA Engineer ${id}`}, 'QA Co', 'ready', '{"format":"pdf"}', ${PDF}, 'Asha Rao Resume.pdf', 'Dear QA Co', ${COVER})
      returning id`;
    const [a] = await sql`
      insert into public.auto_applications (user_id, listing_id, tailored_resume_id, provider, apply_url, title, company, score, status, form, answers, plan_day)
      values (${userId}, ${l.id}, ${t.id}, ${s.provider}, ${s.url}, ${`QA Engineer ${id}`}, 'QA Co', ${--score}, 'prepared',
              ${sql.json(s.form)}, ${sql.json(s.answers)}, current_date)
      returning id`;
    apps[id] = a.id;
  }
}

async function cleanup() {
  if (sourceIds.length) await sql`delete from public.job_sources where id in ${sql(sourceIds)}`;
  if (!userId) return;
  const ids = Object.values(apps);
  await sql`delete from auth.users where id = ${userId}`;
  await sql`delete from public.users where id = ${userId}`;
  // Jobs the API queued for the worker (emails about applications waiting): not for a deleted user.
  const { Queue } = createRequire(join(root, 'apps/api/package.json'))('bullmq');
  const q = new Queue('autoapply', { connection: { url: apiEnv.REDIS_URL } });
  for (const job of await q.getJobs(['waiting', 'delayed', 'prioritized', 'paused'])) {
    if (job && (job.data?.userId === userId || ids.includes(job.data?.applicationId))) await job.remove().catch(() => {});
  }
  await q.close();
}

const row = async (id) =>
  (await sql`select status, reason_code, reason, missing, retry_at, attempts from public.auto_applications where id = ${apps[id]}`)[0];
const events = async (id) => (await sql`select kind, message from public.auto_apply_events where application_id = ${apps[id]} order by id`).map((e) => `${e.kind}: ${e.message}`);
const status = (id, want, reason) =>
  until(`${id} ${want}${reason ? `/${reason}` : ''}`, async () => {
    const r = await row(id);
    return r.status === want && (!reason || r.reason_code === reason) ? r : null;
  });

// ---- run -----------------------------------------------------------------------------------------

const children = [];
let context;
const results = [];
async function check(name, fn) {
  try {
    await fn();
    results.push(['✔', name]);
    log('✔', name);
  } catch (err) {
    results.push(['✖', name, err.message]);
    log('✖', name, '\n   ', err.message);
  }
}

try {
  // TLS for the stand-in boards (Chromium is told to accept it).
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=friday-e2e',
    '-keyout', join(work, 'key.pem'), '-out', join(work, 'cert.pem')], { stdio: 'ignore' });
  const boardServer = createHttps({ key: readFileSync(join(work, 'key.pem')), cert: readFileSync(join(work, 'cert.pem')) }, boards);
  await new Promise((r) => boardServer.listen(BOARDS_PORT, '127.0.0.1', r));

  // The API, and a proxy in front of it that scenario 7 takes down.
  const api = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
    cwd: join(root, 'apps/api'),
    env: { ...process.env, PORT: String(API_PORT), NODE_ENV: 'test' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  children.push(api);
  api.stderr.on('data', (d) => process.env.E2E_VERBOSE && process.stderr.write(d));
  const proxy = createHttp((req, res) => {
    if (process.env.E2E_VERBOSE) log('api', req.method, req.url.slice(0, 60), apiDown ? '(down)' : '');
    if (apiDown) return res.writeHead(503, { 'content-type': 'application/json' }).end('{"message":"down"}');
    const up = httpRequest({ host: '127.0.0.1', port: API_PORT, path: req.url, method: req.method, headers: req.headers }, (r) => {
      res.writeHead(r.statusCode, r.headers);
      r.pipe(res);
    });
    up.on('error', () => res.writeHead(502).end());
    req.pipe(up);
  });
  await new Promise((r) => proxy.listen(PROXY_PORT, '127.0.0.1', r));
  await until('the API', () => fetch(`http://127.0.0.1:${API_PORT}/livez`).then((r) => r.ok, () => false), 60_000);

  await seed();
  log('seeded', Object.keys(apps).length, 'applications for', email);

  const ext = join(work, 'ext');
  execFileSync(process.execPath, ['build.mjs'], {
    cwd: join(root, 'apps/extension'),
    env: { ...process.env, FRIDAY_API_URL: `http://localhost:${PROXY_PORT}`, FRIDAY_JOBS_URL: `https://${JOBS_HOST}`, FRIDAY_GAP_MS: '0,0', FRIDAY_OUT: ext },
    stdio: 'ignore',
  });

  const rules = [...HOSTS.map((h) => `MAP ${h} 127.0.0.1:${BOARDS_PORT}`), 'MAP * ~NOTFOUND', 'EXCLUDE localhost', 'EXCLUDE 127.0.0.1'].join(', ');
  context = await chromium.launchPersistentContext(join(work, 'profile'), {
    executablePath: process.env.CHROME ?? join(homedir(), '.cache/ms-playwright/chromium-1243/chrome-linux64/chrome'),
    headless: process.env.HEADED ? false : true,
    ignoreHTTPSErrors: true,
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, `--host-resolver-rules=${rules}`, '--ignore-certificate-errors'],
  });
  const sw = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  const extId = new URL(sw.url()).host;
  log('extension', extId);
  // The welcome tab the extension opens on install.
  await sleep(1000);

  await check('connects with the site’s session and gets its own device token', async () => {
    const site = await context.newPage();
    await site.goto(`https://${JOBS_HOST}/auto-apply`);
    const device = await until('a device', async () => (await sql`select id, name from public.auto_apply_devices where user_id = ${userId} and revoked_at is null`)[0]);
    assert.match(device.name, /^Chrome on /);
    await until('the page marked', () => site.evaluate(() => document.documentElement.dataset.fridayDevice), 70_000);
    assert.equal(await site.evaluate(() => document.documentElement.dataset.fridayDevice), device.id);
    assert.ok(await site.evaluate(() => document.documentElement.dataset.fridayExtension));
    const stored = await sw.evaluate(() => chrome.storage.local.get('device').then((r) => r.device));
    assert.match(stored.token, /^fdx_/);
    assert.equal(stored.email, email);
    await site.close();
  });

  await check('stays paused until the user presses Start', async () => {
    await sleep(3000);
    assert.equal((await row('s1')).status, 'prepared');
  });

  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extId}/popup.html`);
  await popup.getByText(email).waitFor();
  // Scenario 7: the moment its job board has the application, the API becomes unreachable.
  onReceived = (id) => {
    if (id !== 's7') return;
    apiDown = true;
    log('API down');
    setTimeout(() => {
      apiDown = false;
      log('API up');
    }, 15_000);
  };
  await popup.getByRole('button', { name: 'Start sending applications' }).click();
  log('started');

  await check('1 lever: classic form → confirmation page → Submitted, every answer as prepared', async () => {
    await status('s1', 'submitted');
    assert.equal(received.s1?.length, 1, 'sent exactly once');
    const f = received.s1[0];
    assert.equal(f.name, 'Asha Rao');
    assert.equal(f.email, email);
    assert.equal(f.phone, '+91 98765 43210');
    assert.equal(f.location, 'Bengaluru, India');
    assert.equal(f['cards[abc][field0]'], 'Yes');
    assert.equal(f['cards[abc][field1]'], 'I build test tooling and QA Co ships carefully.');
    assert.equal(f['eeo[gender]'], 'Decline to self-identify');
    assert.equal(f.resume.name, 'Asha Rao Resume.pdf');
    assert.equal(f.resume.text, PDF.toString());
    const [applied] = await sql`select status from public.job_applications where user_id = ${userId} and listing_id = (select listing_id from public.auto_applications where id = ${apps.s1})`;
    assert.equal(applied?.status, 'applied');
  });

  await check('2 ashby: late form, Yes/No buttons, listbox, cover letter → Submitted', async () => {
    await status('s2', 'submitted');
    assert.equal(received.s2?.length, 1);
    assert.deepEqual(received.s2[0], {
      name: 'Asha Rao', email, resume: 'Asha Rao Resume.pdf', resumeSize: PDF.length, cover: 'Asha Rao Cover Letter.pdf', willing: 'Yes', years: '3-5',
    });
  });

  let s3Tab;
  await check('3 greenhouse: a CAPTCHA box is left for the user and the queue moves on', async () => {
    await status('s3', 'pending', 'captcha');
    assert.equal(received.s3, undefined, 'the extension never sends past a CAPTCHA');
    s3Tab = context.pages().find((p) => p.url().includes('token=s3'));
    assert.ok(s3Tab, 'the tab stays open for the user');
    assert.equal(await s3Tab.inputValue('#first_name'), 'Asha', 'the form was filled for them');
    assert.equal(await s3Tab.inputValue('#email'), email);
    const badge = await sw.evaluate(() => chrome.action.getBadgeText({}));
    assert.equal(badge, '!');
  });

  await check('4 lever: an unprepared required question → Needs answers, nothing sent', async () => {
    const r = await status('s4', 'pending', 'needs_answers');
    assert.equal(received.s4, undefined);
    assert.match(r.reason, /Years of Rust experience/);
    assert.equal(r.missing.length, 1);
  });

  await check('5 lever: the user closes the tab mid-way → tried again later', async () => {
    const tab = await until('the s5 tab', () => context.pages().find((p) => p.url().includes('/s5/')));
    await sleep(1500);
    await tab.close();
    const r = await until('s5 back in the queue', async () => {
      const x = await row('s5');
      return x.status === 'prepared' && x.retry_at ? x : null;
    });
    assert.ok(new Date(r.retry_at).getTime() > Date.now() + 20 * 60_000);
    assert.ok((await events('s5')).some((e) => e.includes('The tab was closed')));
    assert.equal(received.s5, undefined);
    await sql`update public.auto_applications set status = 'skipped' where id = ${apps.s5}`;
  });

  await check('6 lever: sent but no confirmation, tab closed → Pending "unverified", never sent twice', async () => {
    await until('s6 sent', () => received.s6?.length);
    const tab = await until('the s6 tab', () => context.pages().find((p) => p.url().includes('/s6/')));
    await sleep(2000);
    await tab.close();
    await status('s6', 'pending', 'unverified');
    await sleep(3000);
    assert.equal(received.s6.length, 1);
  });

  await check('7 lever: API down when the result comes in → delivered later; nothing claimed meanwhile', async () => {
    await until('s7 sent', () => received.s7?.length);
    await sleep(5000);
    assert.equal((await row('s7')).reason_code, 'submitting', 'not delivered while the API is down');
    const outbox = await sw.evaluate(() => chrome.storage.local.get('outbox').then((r) => r.outbox));
    assert.equal(outbox?.length, 1);
    assert.equal((await row('s8')).status, 'prepared', 'nothing new claimed while a result is undelivered');
    // Delivered on the next alarm after the API is back (within a minute).
    await status('s7', 'submitted');
    assert.equal(received.s7.length, 1);
  });

  await check('8 lever: the queue carries on after the outage', async () => {
    await status('s8', 'submitted');
  });

  await check('9 workday: sign-in left for the user; after it the form is filled and sent', async () => {
    await status('s9', 'pending', 'login_required');
    const tab = await until('the s9 tab', () => context.pages().find((p) => p.url().includes('/s9/')));
    // The user signs in (the page becomes the form, as Workday's app does).
    await tab.evaluate(() => (document.getElementById('root').innerHTML = window.__form));
    await status('s9', 'submitted');
    assert.equal(received.s9?.length, 1);
    assert.equal(received.s9[0].firstName, 'Asha');
    assert.equal(received.s9[0].resume.name, 'Asha Rao Resume.pdf');
  });

  await check('3 greenhouse: the user ticks the box and sends it → Submitted from that tab', async () => {
    await s3Tab.evaluate(() => {
      document.getElementById('g-recaptcha-response').value = 'solved-by-the-user';
      document.querySelector('form').requestSubmit();
    });
    await status('s3', 'submitted');
    assert.equal(received.s3?.length, 1);
    assert.equal(received.s3[0]['g-recaptcha-response'], 'solved-by-the-user');
    assert.equal(received.s3[0].first_name, 'Asha');
    assert.equal(received.s3[0].resume.name, 'Asha Rao Resume.pdf');
    assert.equal(received.s3[0].country_value, 'India', 'searchable dropdown');
    assert.equal(received.s3[0].school_value, 'Other', 'a school missing from the list falls back to Other');
  });

  await check('nothing was sent twice, and no other application was touched', async () => {
    for (const [id, list] of Object.entries(received)) assert.equal(list.length, 1, `${id} received ${list.length}`);
    const claimedAgain = await sql`
      select a.id from public.auto_applications a
      where a.user_id = ${userId} and (select count(*) from public.auto_apply_events e where e.application_id = a.id and e.kind = 'claimed') > 1
        and a.id <> ${apps.s5}`;
    assert.equal(claimedAgain.length, 0);
  });

  await check('the popup shows what happened; Disconnect revokes the token and stays disconnected', async () => {
    await popup.reload();
    await popup.getByText('Recent').waitFor();
    const text = await popup.textContent('body');
    assert.match(text, /Submitted/);
    assert.match(text, /Needs answers/);
    await popup.getByRole('button', { name: 'Disconnect this browser' }).click();
    await popup.getByRole('button', { name: 'Connect this browser' }).waitFor();
    await until('the token revoked', async () => {
      const devices = await sql`select revoked_at from public.auto_apply_devices where user_id = ${userId}`;
      return devices.length > 0 && devices.every((d) => d.revoked_at);
    }, 10_000);
    // The site's session comes round again; the extension doesn't reconnect by itself.
    const site = await context.newPage();
    await site.goto(`https://${JOBS_HOST}/auto-apply`);
    await sleep(3000);
    const [{ n }] = await sql`select count(*)::int as n from public.auto_apply_devices where user_id = ${userId} and revoked_at is null`;
    assert.equal(n, 0);
  });
} catch (err) {
  results.push(['✖', 'setup', err.stack]);
  log('✖ setup', err.stack);
} finally {
  if (process.env.E2E_VERBOSE) for (const id of Object.keys(apps)) log(id, JSON.stringify(await events(id).catch(() => [])));
  await context?.close().catch(() => {});
  for (const c of children) c.kill();
  await cleanup().catch((e) => log('cleanup failed', e.message));
  await sql.end();
  rmSync(work, { recursive: true, force: true });
  const failed = results.filter((r) => r[0] === '✖');
  console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
  process.exit(failed.length ? 1 : 0);
}
