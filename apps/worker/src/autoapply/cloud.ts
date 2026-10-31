import { existsSync, readFileSync } from 'node:fs';
import { isIP } from 'node:net';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import type { AutoApplyReport, AutoApplyTask } from '@parakeet/shared';

// One Auto Apply application submitted from Friday's servers: a Chromium tab opens the job board's form
// and runs the extension's own filler (apps/extension/src/filler.js) in it, exactly as the user's
// browser would. It is an ordinary, undisguised browser: when the job board shows a CAPTCHA or asks for
// a sign-in, the run stops there and reports it, and the application goes to the user's browser.
//
// The browser runs in its own container with no secrets (browserServer.ts); this side drives it.

const FILLER = readFileSync(new URL('../../../extension/src/filler.js', import.meta.url), 'utf8');

/** Longest a run may take; well inside the 15-minute claim lease. */
const RUN_TIMEOUT_MS = 8 * 60_000;

export interface CloudFile {
  name: string;
  base64: string;
}

export interface CloudResult extends AutoApplyReport {
  /** The job board's submit button was pressed. */
  clicked: boolean;
}

export function chromePath(configured?: string) {
  const path = configured ?? ['/usr/bin/chromium', '/usr/bin/google-chrome-stable', '/usr/bin/chromium-browser'].find((p) => existsSync(p));
  if (!path) throw new Error('No Chrome or Chromium found; set AUTO_APPLY_CHROME');
  return path;
}

export function launchBrowser(opts: { executablePath: string; noSandbox?: boolean; args?: string[] }) {
  return chromium.launch({ executablePath: opts.executablePath, headless: true, chromiumSandbox: !opts.noSandbox, args: opts.args ?? [] });
}

/** Addresses a job board page has no business reaching: this machine, the private network, cloud metadata. */
export function privateHost(host: string) {
  const h = host.replace(/^\[|\]$/g, '').toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.internal')) return true;
  const v = isIP(h);
  if (v === 4) {
    const [a, b] = h.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  if (v === 6) return h === '::1' || h === '::' || /^f[cd]/.test(h) || /^fe[89ab]/.test(h) || h.startsWith('::ffff:');
  return false;
}

/**
 * Fills and submits one application. onSubmitting runs before the submit button is pressed and must
 * record it; if it throws, the button is never pressed.
 */
export async function submitInCloud(
  browser: Browser,
  task: AutoApplyTask,
  files: { resume: CloudFile; coverLetter: CloudFile | null },
  onSubmitting: () => Promise<void>,
  timeoutMs = RUN_TIMEOUT_MS,
): Promise<CloudResult> {
  const context: BrowserContext = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'en-US', acceptDownloads: false });
  let page: Page | null = null;
  let clicked = false;
  /** The page moved on after the click: the job board may have the application whatever it shows now. */
  let movedOn = false;
  let finished = false;
  let settle!: (r: AutoApplyReport) => void;
  const done = new Promise<AutoApplyReport>((resolve) => (settle = resolve));
  const finish = (r: AutoApplyReport) => {
    if (finished) return;
    finished = true;
    settle(r);
  };
  const pageEvidence = async (p: Page) =>
    p
      .evaluate(() => ({ url: location.href, text: (document.body?.innerText ?? '').replace(/\s+/g, ' ').slice(0, 2000) }))
      .catch(() => ({ url: p.url(), text: '' }));

  try {
    await context.route('**/*', (route) => {
      let host = '';
      try {
        host = new URL(route.request().url()).hostname;
      } catch {
        // data:, blob: and the like
      }
      return host && privateHost(host) ? route.abort('blockedbyclient') : route.continue();
    });

    // The filler's messages (the extension gets these through chrome.runtime).
    await context.exposeBinding('__fridayCloudSend', async (source, msg: { type?: string; reason?: string }) => {
      if (!page || source.frame !== page.mainFrame()) return;
      if (msg?.type === 'submitting' && !clicked) {
        try {
          await onSubmitting();
        } catch (err) {
          finish({ outcome: 'failed', message: `Didn’t submit: ${(err as Error).message}` });
          // Never answer: the filler waits here, so the button is never pressed, until the tab closes.
          await new Promise(() => {});
        }
        clicked = true;
      } else if (msg?.type === 'needs-user') {
        const p = page;
        // A check after the page moved on: it may have gone through, so the user is asked, never resent.
        if (movedOn) return finish({ outcome: 'submitted', evidence: await pageEvidence(p), message: 'A check appeared after submitting' });
        const reason = msg.reason === 'login_required' ? 'login_required' : 'captcha';
        finish({ outcome: reason, message: reason === 'captcha' ? 'The job board asked for a CAPTCHA check' : 'The job board asked for a sign-in' });
      }
    });

    page = await context.newPage();
    const p = page;
    p.on('dialog', (d) => void d.dismiss().catch(() => {}));
    p.on('crash', () => finish({ outcome: 'failed', message: 'The job board’s page crashed' }));
    p.on('framenavigated', (f) => {
      if (clicked && f === p.mainFrame()) movedOn = true;
    });

    // Every page load: fill it, or once submitted, look for the confirmation (as background.js does).
    const run = async () => {
      if (finished) return;
      const phase = clicked ? 'check' : 'fill';
      try {
        await p.evaluate(FILLER);
        const report = await p.evaluate(
          ([t, resume, cover, ph]) => {
            const w = window as unknown as Record<string, any>;
            if (w.__fridayStarted) return null;
            w.__fridayStarted = true;
            return ph === 'check' ? w.__fridayCheck() : w.__fridayFill(t, resume, true, cover);
          },
          [task, files.resume, files.coverLetter, phase] as const,
        );
        if (!report) return;
        if (report.outcome === 'dry_run') return finish({ outcome: 'failed', message: 'Nothing was submitted' });
        // Anything but a confirmation after the page moved on: the user is asked, never resent.
        if (movedOn && report.outcome !== 'submitted') return finish({ outcome: 'submitted', evidence: await pageEvidence(p), message: report.message });
        finish(report);
      } catch {
        // The page navigated mid-run (a next step, or the confirmation): the next load carries on.
      }
    };
    p.on('load', () => void run());

    const opened = await p.goto(task.applyUrl, { waitUntil: 'load', timeout: 60_000 }).then(
      (res) => (res && res.status() >= 400 ? `The job board answered ${res.status()}` : null),
      (err: Error) => `Couldn’t open the job board: ${err.message.split('\n')[0]}`,
    );
    if (opened) finish({ outcome: 'failed', message: opened });

    let timer: NodeJS.Timeout | undefined;
    const timedOut = new Promise<'timeout'>((resolve) => (timer = setTimeout(() => resolve('timeout'), timeoutMs)));
    const report = await Promise.race([done, timedOut]);
    clearTimeout(timer);
    if (report !== 'timeout') return { ...report, clicked };
    finished = true;
    if (!clicked) return { outcome: 'failed', message: 'Timed out', clicked };
    // Sent, but no confirmation in time: the API's check decides (most likely "unverified").
    return { outcome: 'submitted', evidence: await pageEvidence(p), clicked };
  } catch (err) {
    finished = true;
    return clicked
      ? { outcome: 'submitted', evidence: { url: page?.url() ?? '', text: '' }, message: (err as Error).message, clicked }
      : { outcome: 'failed', message: `The browser stopped: ${(err as Error).message.split('\n')[0]}`, clicked };
  } finally {
    await context.close().catch(() => {});
  }
}
