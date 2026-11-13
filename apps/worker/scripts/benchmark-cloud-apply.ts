// Benchmarks Auto Apply from Friday's servers without touching any real job board: a Chromium browser
// server (as the "browser" container runs it) and submitInCloud (what the applier calls) fill stand-in
// Lever and Ashby forms served from this process over HTTPS; Chromium resolves those hostnames here and
// every other hostname to nothing. Measures, per application: wall time, CPU seconds and peak memory (PSS) of
// the whole Chromium process tree (sampled from /proc every 200 ms), and the driver's own memory.
//
// The stand-in pages carry a synthetic bundle (--bundle-kb, default 1500 KB of script building a large
// DOM) so a tab weighs roughly what a real ATS page does; --bundle-kb 0 measures the bare minimum.
//
//   cd apps/worker && node --import tsx scripts/benchmark-cloud-apply.ts [--runs 6] [--concurrency 1,2,4] [--bundle-kb 1500]
//
// Linux only (reads /proc). Prints a JSON summary per concurrency level.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { createServer as createHttps } from 'node:https';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import type { AutoApplyTask } from '@parakeet/shared';
import { chromePath, submitInCloud } from '../src/autoapply/cloud.js';

const arg = (name: string, dflt: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : dflt;
};
const RUNS = Number(arg('runs', '6'));
const LEVELS = arg('concurrency', '1,2,4').split(',').map(Number);
const BUNDLE_KB = Number(arg('bundle-kb', '1500'));
const PORT = 8454;
const HOSTS = ['jobs.lever.co', 'jobs.ashbyhq.com'];

// ---- stand-in boards -----------------------------------------------------------------------------

/** Script of about `kb` KB that builds a few thousand DOM nodes, like an ATS page's framework bundle. */
const bundle = (() => {
  if (!BUNDLE_KB) return '';
  // Real code, so it is parsed and compiled like a framework bundle (about 1 KB per function).
  const fn = (i: number) => `function m${i}(a){const o={k:${i},v:[${Array.from({ length: 60 }, (_, j) => j * i).join(',')}]};return a?o.v.map((x)=>x+a).filter((x)=>x%3).reduce((s,x)=>s+x,0):o;}\n`;
  const filler = Array.from({ length: Math.max(1, BUNDLE_KB - 2) }, (_, i) => fn(i)).join('') +
    `for (let i = 0; i < ${Math.max(1, BUNDLE_KB - 2)}; i += 7) window['m' + i](i);\n`;
  return `${filler}
    (() => { const root = document.createElement('div'); root.style.display = 'none';
      for (let i = 0; i < 4000; i++) { const d = document.createElement('div'); d.className = 'c' + i; d.textContent = 'item ' + i; root.append(d); }
      document.body.append(root); window.__state = Array.from({ length: 20000 }, (_, i) => ({ i, s: 'v' + i })); })();`;
})();

const page = (body: string, script = '') =>
  `<!doctype html><html><head><meta charset="utf-8"><title>QA Co</title><script src="/bundle.js"></script></head><body>${body}${script ? `<script>${script}</script>` : ''}</body></html>`;

const leverForm = (id: string) => `
  <h2>Backend Engineer</h2>
  <form method="POST" action="/bench/${id}/apply" enctype="multipart/form-data">
    <label>Resume/CV <input type="file" name="resume" required></label>
    <label>Full name <input name="name" required></label>
    <label>Email <input type="email" name="email" required></label>
    <label>Phone <input name="phone"></label>
    <label>Current company <input name="org"></label>
    <div class="application-question"><div class="text">Are you authorized to work in India?</div>
      <label><input type="radio" name="cards[abc][field0]" value="Yes" required> Yes</label>
      <label><input type="radio" name="cards[abc][field0]" value="No"> No</label></div>
    <label>Notice period <textarea name="cards[abc][field1]"></textarea></label>
    <button type="submit">Submit application</button>
  </form>`;

const ashbyApp = `
  setTimeout(() => {
    document.getElementById('root').innerHTML = \`
      <form id="f">
        <div><label for="_systemfield_name">Name</label><input id="_systemfield_name"></div>
        <div><label for="_systemfield_email">Email</label><input id="_systemfield_email"></div>
        <div><label for="_systemfield_resume">Resume</label><input id="_systemfield_resume" type="file"></div>
        <button type="submit">Submit Application</button>
      </form>\`;
    document.getElementById('f').onsubmit = async (e) => {
      e.preventDefault();
      await fetch('/submit', { method: 'POST', body: '{}' });
      document.getElementById('root').innerHTML = '<h1>Your application was successfully submitted.</h1>';
    };
  }, 300);`;

let submissions = 0;
function boards(req: IncomingMessage, res: ServerResponse) {
  const host = (req.headers.host ?? '').split(':')[0];
  const url = new URL(req.url ?? '/', `https://${host}`);
  const html = (b: string) => res.writeHead(200, { 'content-type': 'text/html' }).end(b);
  if (url.pathname === '/bundle.js') return res.writeHead(200, { 'content-type': 'text/javascript', 'cache-control': 'no-store' }).end(bundle);
  if (req.method === 'POST') {
    submissions++;
    req.resume();
    if (host === 'jobs.ashbyhq.com') return req.on('end', () => res.writeHead(200, { 'content-type': 'application/json' }).end('{}'));
    const id = /^\/bench\/([\w-]+)\/apply$/.exec(url.pathname)?.[1] ?? 'x';
    return req.on('end', () => res.writeHead(303, { location: `/bench/${id}/thanks` }).end());
  }
  if (host === 'jobs.lever.co') {
    if (url.pathname.endsWith('/thanks')) return html(page('<h1>Application submitted!</h1><p>Thanks for applying to QA Co.</p>'));
    return html(page(leverForm(url.pathname.split('/')[2])));
  }
  if (host === 'jobs.ashbyhq.com') return html(page('<div id="root">Loading…</div>', ashbyApp));
  res.writeHead(404).end();
}

// ---- /proc sampling ------------------------------------------------------------------------------

const TICK = 100; // USER_HZ
const PAGE_KB = 4;

function treeOf(root: number): number[] {
  const children = new Map<number, number[]>();
  for (const d of readdirSync('/proc')) {
    if (!/^\d+$/.test(d)) continue;
    try {
      const stat = readFileSync(`/proc/${d}/stat`, 'utf8');
      const ppid = Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1]);
      (children.get(ppid) ?? children.set(ppid, []).get(ppid)!).push(Number(d));
    } catch {}
  }
  const out: number[] = [];
  const walk = (p: number) => {
    out.push(p);
    for (const c of children.get(p) ?? []) walk(c);
  };
  walk(root);
  return out;
}

/** Memory (MB, proportional set size) and CPU seconds (utime+stime) of a process tree. */
function sample(root: number) {
  let rssKb = 0;
  let cpu = 0;
  let procs = 0;
  for (const pid of treeOf(root)) {
    try {
      // PSS: shared pages split between the processes sharing them, so the tree's sum is what it really uses.
      const pss = /^Pss:\s+(\d+)/m.exec(readFileSync(`/proc/${pid}/smaps_rollup`, 'utf8'));
      rssKb += pss ? Number(pss[1]) : Number(readFileSync(`/proc/${pid}/statm`, 'utf8').split(' ')[1]) * PAGE_KB;
      const f = readFileSync(`/proc/${pid}/stat`, 'utf8').slice(readFileSync(`/proc/${pid}/stat`, 'utf8').lastIndexOf(')') + 2).split(' ');
      cpu += (Number(f[11]) + Number(f[12])) / TICK;
      procs++;
    } catch {}
  }
  return { rssMb: rssKb / 1024, cpu, procs };
}

// ---- run -----------------------------------------------------------------------------------------

const work = mkdtempSync(join(tmpdir(), 'friday-bench-'));
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=bench',
  '-keyout', join(work, 'key.pem'), '-out', join(work, 'cert.pem')], { stdio: 'ignore' });
const server = createHttps({ key: readFileSync(join(work, 'key.pem')), cert: readFileSync(join(work, 'cert.pem')) }, boards);
await new Promise<void>((r) => server.listen(PORT, '127.0.0.1', r));

const rules = [...HOSTS.map((h) => `MAP ${h} 127.0.0.1:${PORT}`), 'MAP * ~NOTFOUND'].join(', ');
const browserServer = await chromium.launchServer({
  executablePath: chromePath(process.env.AUTO_APPLY_CHROME),
  headless: true,
  args: [`--host-resolver-rules=${rules}`, '--ignore-certificate-errors'],
});
const browserPid = browserServer.process().pid!;
const browser = await chromium.connect(browserServer.wsEndpoint());
await new Promise((r) => setTimeout(r, 1500));
const idle = sample(browserPid);
const driverIdleMb = process.memoryUsage().rss / 1024 / 1024;

const PDF = { name: 'Asha Rao Resume.pdf', base64: Buffer.from('%PDF-1.4\n% bench resume\n'.padEnd(150_000, ' ')).toString('base64') };
const A = (key: string, label: string, value: string, source = 'profile') => ({ key, label, value, source }) as AutoApplyTask['answers'][number];
const Q = (key: string, label: string, type = 'text', required = true, options: string[] = [], kind = 'custom') =>
  ({ key, label, type, required, options, kind }) as AutoApplyTask['form'][number];

function task(i: number): AutoApplyTask {
  const ashby = i % 3 === 2;
  const base = { id: `bench-${i}`, title: 'Backend Engineer', company: 'QA Co', resumePath: '', resumeFileName: PDF.name,
    coverLetterPath: null, coverLetterFileName: null, leaseUntil: new Date(Date.now() + 15 * 60_000).toISOString() };
  return ashby
    ? {
        ...base, provider: 'ashby', applyUrl: `https://jobs.ashbyhq.com/qa/bench-${i}/application`,
        form: [Q('_systemfield_name', 'Name', 'text', true, [], 'standard'), Q('_systemfield_email', 'Email', 'text', true, [], 'standard'),
          Q('_systemfield_resume', 'Resume', 'file', true, [], 'resume')],
        answers: [A('_systemfield_name', 'Name', 'Asha Rao'), A('_systemfield_email', 'Email', 'asha@example.com'),
          A('_systemfield_resume', 'Resume', PDF.name, 'file')],
      }
    : {
        ...base, provider: 'lever', applyUrl: `https://jobs.lever.co/bench/b${i}/apply`,
        form: [Q('resume', 'Resume/CV', 'file', true, [], 'resume'), Q('name', 'Full name', 'text', true, [], 'standard'),
          Q('email', 'Email', 'text', true, [], 'standard'), Q('phone', 'Phone', 'text', false, [], 'standard'),
          Q('org', 'Current company', 'text', false, [], 'standard'),
          Q('cards[abc][field0]', 'Are you authorized to work in India?', 'select', true, ['Yes', 'No']),
          Q('cards[abc][field1]', 'Notice period', 'textarea', false)],
        answers: [A('resume', 'Resume/CV', PDF.name, 'file'), A('name', 'Full name', 'Asha Rao'), A('email', 'Email', 'asha@example.com'),
          A('phone', 'Phone', '+91 90000 00000'), A('org', 'Current company', 'Acme'),
          A('cards[abc][field0]', 'Are you authorized to work in India?', 'Yes', 'ai'), A('cards[abc][field1]', 'Notice period', '30 days')],
      };
}

const results: unknown[] = [];
let n = 0;
for (const k of LEVELS) {
  const before = sample(browserPid);
  let peakRss = before.rssMb;
  let peakProcs = before.procs;
  let driverPeak = process.memoryUsage().rss;
  const timer = setInterval(() => {
    const s = sample(browserPid);
    peakRss = Math.max(peakRss, s.rssMb);
    peakProcs = Math.max(peakProcs, s.procs);
    driverPeak = Math.max(driverPeak, process.memoryUsage().rss);
  }, 200);
  const outcomes: Record<string, number> = {};
  const walls: number[] = [];
  const started = Date.now();
  let next = 0;
  const total = RUNS * k;
  await Promise.all(
    Array.from({ length: k }, async () => {
      while (next < total) {
        next++;
        const t = task(n++);
        const t0 = Date.now();
        const r = await submitInCloud(browser, t, { resume: PDF, coverLetter: null }, async () => {}, 120_000);
        walls.push(Date.now() - t0);
        outcomes[r.outcome] = (outcomes[r.outcome] ?? 0) + 1;
      }
    }),
  );
  clearInterval(timer);
  const after = sample(browserPid);
  const elapsed = (Date.now() - started) / 1000;
  walls.sort((a, b) => a - b);
  const out = {
    concurrency: k,
    applications: total,
    outcomes,
    elapsedS: +elapsed.toFixed(1),
    perApplicationWallS: { p50: +(walls[Math.floor(walls.length / 2)] / 1000).toFixed(2), max: +(walls[walls.length - 1] / 1000).toFixed(2) },
    throughputPerHour: Math.round((total / elapsed) * 3600),
    chromiumCpuSecondsPerApplication: +((after.cpu - before.cpu) / total).toFixed(2),
    chromiumAvgCores: +((after.cpu - before.cpu) / elapsed).toFixed(2),
    chromiumIdlePssMb: Math.round(idle.rssMb),
    chromiumPeakPssMb: Math.round(peakRss),
    chromiumPeakProcesses: peakProcs,
    driverIdleRssMb: Math.round(driverIdleMb),
    driverPeakRssMb: Math.round(driverPeak / 1024 / 1024),
  };
  results.push(out);
  console.log(JSON.stringify(out));
  await new Promise((r) => setTimeout(r, 2000));
}

console.log(JSON.stringify({ bundleKb: BUNDLE_KB, boardSubmissionsReceived: submissions, cpus: (await import('node:os')).cpus().length }));
await browser.close();
await browserServer.close();
server.close();
rmSync(work, { recursive: true, force: true });
