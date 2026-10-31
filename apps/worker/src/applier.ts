import { existsSync } from 'node:fs';
import { chromium, type Browser } from 'playwright-core';
import type { AutoApplyTask } from '@parakeet/shared';
import { chromePath, launchBrowser, submitInCloud, type CloudResult } from './autoapply/cloud.js';

// Auto Apply from Friday's servers: the "applier" service in deploy/compose.yml (`pnpm applier`).
// It takes prepared applications from the API (apps/api/src/routes/applier.ts), submits each in the
// browser container (browserServer.ts) and reports what the job board said. Least privilege: one API
// token that only works on those routes, and only for applications it holds a claim on; no database,
// Redis or other secrets, and no job board page ever runs in this process.
//
//   APPLIER_API_URL          the API inside the server's network, e.g. http://api:4000
//   APPLIER_TOKEN            its token (the API has the sha256 as APPLIER_TOKEN_SHA256)
//   AUTO_APPLY_BROWSER_WS    the browser container, e.g. ws://browser:9222/<BROWSER_WS_PATH>. Unset (dev
//                            and tests): a local Chrome is launched here instead.
//   AUTO_APPLY_CLOUD_SLOTS   applications sent at once (default 2)
//
// Not started by `pnpm dev`: it submits real applications for every user with Auto Apply on.

export interface ApplierConfig {
  apiUrl: string;
  token: string;
  browserWs?: string;
  chrome?: string;
  noSandbox: boolean;
  slots: number;
  /** Time between claims when there was nothing to do. */
  idleMs: number;
  /** Tests: one user's applications only. */
  onlyUser?: string;
}

export function applierConfig(e: NodeJS.ProcessEnv = process.env): ApplierConfig {
  if (!e.APPLIER_TOKEN) throw new Error('APPLIER_TOKEN is required');
  return {
    apiUrl: (e.APPLIER_API_URL ?? 'http://127.0.0.1:4000').replace(/\/$/, ''),
    token: e.APPLIER_TOKEN,
    browserWs: e.AUTO_APPLY_BROWSER_WS || undefined,
    chrome: e.AUTO_APPLY_CHROME || undefined,
    noSandbox: e.AUTO_APPLY_CHROME_NO_SANDBOX === '1',
    slots: Math.max(1, Math.min(20, Number(e.AUTO_APPLY_CLOUD_SLOTS ?? 2) || 2)),
    idleMs: 30_000,
  };
}

type ClaimedTask = AutoApplyTask & { claim: string };

class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const log = (...a: unknown[]) => console.log('[applier]', ...a);

export class Applier {
  private browser: Promise<Browser> | null = null;
  private running = 0;
  private stopped = false;

  constructor(
    private readonly cfg: ApplierConfig,
    /** Tests pass their own browser. */
    private readonly openBrowser?: () => Promise<Browser>,
  ) {}

  private async api(path: string, init: RequestInit & { claim?: string } = {}) {
    const { claim, ...rest } = init;
    let res: Response;
    try {
      res = await fetch(`${this.cfg.apiUrl}${path}`, {
        ...rest,
        headers: {
          authorization: `Bearer ${this.cfg.token}`,
          ...(rest.body ? { 'content-type': 'application/json' } : {}),
          ...(claim ? { 'x-applier-claim': claim } : {}),
        },
        signal: AbortSignal.timeout(30_000),
      });
    } catch (err) {
      throw new ApiError(`Can’t reach the API (${(err as Error).message})`, 0);
    }
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { message?: string };
      throw new ApiError(body.message ?? `HTTP ${res.status}`, res.status);
    }
    return res;
  }

  private getBrowser() {
    this.browser ??= (
      this.openBrowser?.() ??
      (this.cfg.browserWs
        ? chromium.connect(this.cfg.browserWs, { timeout: 30_000 })
        : launchBrowser({ executablePath: chromePath(this.cfg.chrome), noSandbox: this.cfg.noSandbox }))
    ).then((b) => {
      b.on('disconnected', () => (this.browser = null));
      return b;
    });
    this.browser.catch(() => (this.browser = null));
    return this.browser;
  }

  /** The next application for the servers, or null. */
  async claim(): Promise<ClaimedTask | null> {
    const { task } = (await (await this.api('/v1/applier/claim', { method: 'POST', body: JSON.stringify(this.cfg.onlyUser ? { userId: this.cfg.onlyUser } : {}) })).json()) as { task: ClaimedTask | null };
    return task;
  }

  /** Reports, retried for a few minutes; after that the API's sweeper settles it (never resending a click). */
  private async report(task: ClaimedTask, result: CloudResult) {
    for (let i = 0; i < 6; i++) {
      try {
        const res = await this.api(`/v1/applier/applications/${task.id}/report`, { method: 'POST', body: JSON.stringify(result), claim: task.claim });
        return ((await res.json()) as { status: string }).status;
      } catch (err) {
        // 4xx: the claim lapsed or the report is wrong; retrying won't help.
        if (err instanceof ApiError && err.status >= 400 && err.status < 500) {
          log(`report for ${task.id} refused:`, err.message);
          return null;
        }
        await sleep(5_000 * 2 ** i);
      }
    }
    log(`report for ${task.id} not delivered; the lease sweeper settles it`);
    return null;
  }

  private async file(task: ClaimedTask, path: string) {
    return Buffer.from(await (await this.api(path, { claim: task.claim })).arrayBuffer()).toString('base64');
  }

  /** Submits one claimed application and reports it. */
  async run(task: ClaimedTask) {
    let result: CloudResult;
    try {
      const resume = await this.file(task, task.resumePath);
      const cover = task.coverLetterPath ? await this.file(task, task.coverLetterPath).catch(() => null) : null;
      result = await submitInCloud(
        await this.getBrowser(),
        task,
        { resume: { name: task.resumeFileName, base64: resume }, coverLetter: cover && task.coverLetterFileName ? { name: task.coverLetterFileName, base64: cover } : null },
        // Must be stored before the click; if the API can't take it, the click doesn't happen.
        async () => void (await this.api(`/v1/applier/applications/${task.id}/submitting`, { method: 'POST', body: '{}', claim: task.claim })),
      );
    } catch (err) {
      result = { outcome: 'failed', message: (err as Error).message.slice(0, 500), clicked: false };
    }
    const status = await this.report(task, result);
    log(`${task.company} — ${task.title}: ${result.outcome}${result.message ? ` (${result.message})` : ''} → ${status ?? 'unreported'}`);
    return { result, status };
  }

  /** Claims and submits one application; null when there was none. */
  async once() {
    const task = await this.claim();
    return task ? { task, ...(await this.run(task)) } : null;
  }

  async start() {
    log(`submitting up to ${this.cfg.slots} at a time via ${this.cfg.apiUrl}${this.cfg.browserWs ? ', browser container' : ', local browser'}`);
    while (!this.stopped) {
      if (this.running >= this.cfg.slots) {
        await sleep(1_000);
        continue;
      }
      let task: ClaimedTask | null = null;
      try {
        task = await this.claim();
      } catch (err) {
        log('claim failed:', (err as Error).message);
      }
      if (!task) {
        await sleep(this.cfg.idleMs);
        continue;
      }
      this.running++;
      void this.run(task).finally(() => this.running--);
    }
  }

  /** Stops claiming and waits for the applications in flight. */
  async stop() {
    this.stopped = true;
    while (this.running > 0) await sleep(500);
    await (await this.browser?.catch(() => null))?.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (existsSync('.env')) process.loadEnvFile('.env');
  const applier = new Applier(applierConfig());
  const shutdown = async () => {
    await applier.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  await applier.start();
}
