// Dry run of filler.js against saved copies of job board forms: fills every prepared answer, never
// submits. The page's own scripts are removed and every network request is blocked, so nothing can
// reach the job board.
//   node test/fill.mjs tasks.json fixtures-dir out-dir
// tasks.json: [{ id, company, provider, form, answers, resume: { name, base64 } }]; fixtures-dir/<id>.html
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const [tasksFile, fixtures, outDir = 'test-out'] = process.argv.slice(2);
const tasks = JSON.parse(readFileSync(tasksFile, 'utf8')).filter((t) => existsSync(`${fixtures}/${t.id}.html`));
const filler = readFileSync(new URL('../src/filler.js', import.meta.url), 'utf8');
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome-stable', headless: true });
const results = [];
for (const t of tasks) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  try {
    await page.route('**/*', (route) => route.abort());
    const html = readFileSync(`${fixtures}/${t.id}.html`, 'utf8').replace(/<script\b[\s\S]*?<\/script>/gi, '');
    await page.setContent(html, { waitUntil: 'domcontentloaded' });
    await page.evaluate((p) => (window.__fridayProvider = p), t.provider);
    await page.addScriptTag({ content: filler });
    const r = await page.evaluate(([task, resume]) => window.__fridayFill(task, resume, false), [{ form: t.form, answers: t.answers }, t.resume]);
    await page.screenshot({ path: `${outDir}/${t.id}.png`, fullPage: true });
    results.push({ id: t.id, company: t.company, url: page.url(), ...r });
    console.log(`${t.company.padEnd(22)} filled ${r.filled}/${r.tried}  unplaced: ${JSON.stringify(r.unplaced)}  empty required: ${JSON.stringify(r.empty)}`);
    for (const x of r.results ?? []) if (!x.ok) console.log(`   ✗ ${x.label.slice(0, 90)}`);
  } catch (err) {
    console.log(`${t.company.padEnd(22)} ERROR ${err.message.split('\n')[0]}`);
    results.push({ id: t.id, company: t.company, error: err.message });
  } finally {
    await page.close();
  }
}
writeFileSync(`${outDir}/results.json`, JSON.stringify(results, null, 2));
await browser.close();
