import { chromium } from 'playwright-core';
import { chromePath } from './autoapply/cloud.js';

// The browser for Auto Apply from Friday's servers: the "browser" service in deploy/compose.yml, the
// only place job boards' pages are opened. It holds no secrets and can't reach the API, Redis or the
// database; the applier (applier.ts) drives it over Playwright's protocol. Chrome's sandbox stays on
// (the container gets deploy/chromium-seccomp.json for it); it only runs without one when told to.
//
//   BROWSER_WS_PATH          secret path the applier connects to, e.g. /a1b2…
//   BROWSER_PORT             default 9222
//   AUTO_APPLY_CHROME        default: the first Chromium or Chrome found
//   AUTO_APPLY_CHROME_NO_SANDBOX=1  only where the sandbox can't start, and never with secrets around

const wsPath = process.env.BROWSER_WS_PATH;
if (!wsPath || !/^\/[\w-]{24,}$/.test(wsPath)) throw new Error('Set BROWSER_WS_PATH to a long random path, e.g. /$(openssl rand -hex 24)');

const server = await chromium.launchServer({
  executablePath: chromePath(process.env.AUTO_APPLY_CHROME),
  headless: true,
  chromiumSandbox: process.env.AUTO_APPLY_CHROME_NO_SANDBOX !== '1',
  host: '0.0.0.0',
  port: Number(process.env.BROWSER_PORT ?? 9222),
  wsPath,
});
console.log(`[browser] ready on port ${process.env.BROWSER_PORT ?? 9222} (sandbox ${process.env.AUTO_APPLY_CHROME_NO_SANDBOX === '1' ? 'off' : 'on'})`);

const shutdown = async () => {
  await server.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
