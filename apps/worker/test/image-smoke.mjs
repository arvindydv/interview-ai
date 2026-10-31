// Smoke test of the worker image's Auto Apply browser, run inside the built image by CI
// (.github/workflows/ci.yml): Chromium is there and starts with its sandbox under the seccomp profile
// the browser container gets (deploy/chromium-seccomp.json), the extension's filler is packaged where
// autoapply/cloud.ts reads it, and it fills a form in a sandboxed tab. Nothing leaves the machine.
//
//   docker run --rm --security-opt seccomp=deploy/chromium-seccomp.json -v "$PWD/apps/worker/test:/smoke:ro" \
//     parakeet-worker node /smoke/image-smoke.mjs
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

// SMOKE_ROOT: the repository's root in the image (/app), or elsewhere to try this outside the image.
const root = process.env.SMOKE_ROOT ?? '/app';
const require = createRequire(`${root}/apps/worker/package.json`);
const { chromium } = require('playwright-core');

const fail = (msg) => {
  console.error(`✖ ${msg}`);
  process.exit(1);
};
const chrome = process.env.AUTO_APPLY_CHROME ?? '/usr/bin/chromium';
const filler = `${root}/apps/extension/src/filler.js`;
if (!existsSync(chrome)) fail(`no Chromium at ${chrome}`);
if (!existsSync(filler)) fail(`no filler at ${filler}`);
if (!existsSync(`${root}/apps/worker/dist/applier.js`) || !existsSync(`${root}/apps/worker/dist/browserServer.js`)) fail('applier or browserServer not built');
console.log('✔ Chromium, the filler, the applier and the browser server are in the image');

const browser = await chromium.launch({ executablePath: chrome, headless: true, chromiumSandbox: true }).catch((err) => fail(`Chromium didn't start with its sandbox: ${err.message.split('\n')[0]}`));
console.log(`✔ Chromium ${browser.version()} started with its sandbox`);

const status = await browser.newPage();
const sandbox = await status.goto('chrome://sandbox').then(() => status.innerText('body'), () => '');
console.log(`  chrome://sandbox: ${sandbox.replace(/\s+/g, ' ').slice(0, 300)}`);
if (!/adequately sandboxed/i.test(sandbox)) fail('Chromium says it is not adequately sandboxed');

const page = await browser.newPage();
await page.setContent('<form><label>Full name <input name="name" required></label><label>Resume <input type="file" name="resume"></label></form>');
await page.evaluate(readFileSync(filler, 'utf8'));
const r = await page.evaluate(() =>
  window.__fridayFill(
    {
      form: [{ key: 'name', label: 'Full name', type: 'text', required: true, options: [], kind: 'standard' }, { key: 'resume', label: 'Resume', type: 'file', required: true, options: [], kind: 'resume' }],
      answers: [{ key: 'name', label: 'Full name', value: 'Asha Rao', source: 'profile' }, { key: 'resume', label: 'Resume', value: 'r.pdf', source: 'file' }],
    },
    { name: 'r.pdf', base64: btoa('%PDF-1.4') },
    false,
  ),
);
const filled = await page.evaluate(() => [document.querySelector('[name=name]').value, document.querySelector('[name=resume]').files[0]?.name]);
await browser.close();
if (r.outcome !== 'dry_run' || filled[0] !== 'Asha Rao' || filled[1] !== 'r.pdf') fail(`the filler didn't fill the form: ${JSON.stringify({ r, filled })}`);
console.log('✔ the filler filled a form (name and resume) in a sandboxed tab');
