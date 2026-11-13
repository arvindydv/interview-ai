import { rmSync } from 'node:fs';
import { Queue, UnrecoverableError, Worker, type Job } from 'bullmq';
import type { Page } from 'playwright-core';
import { BOT_PLATFORMS, BOT_RESTRICTED_RETRY_HOURS, type BotPlatform, type BotSessionStatus } from '@parakeet/shared';
import { sql } from '../db.js';
import { env } from '../env.js';
import { SiteBlocked, VerificationNeeded, between, humanCheck, openBrowser, sleep } from './jobBot/browser.js';
import { buildConfig, userDir } from './jobBot/config.js';
import { indeed } from './jobBot/platforms/indeed.js';
import { LinkedInDailyLimit, linkedin } from './jobBot/platforms/linkedin.js';
import { naukri } from './jobBot/platforms/naukri.js';
import type { JobRef, PlatformBot, Result } from './jobBot/platforms/types.js';

// EXPERIMENTAL, DISABLED BY DEFAULT. Platform bot for LinkedIn, Indeed and Naukri, kept for reference
// and allowlisted personal testing only. LinkedIn's User Agreement (§8.2) and Indeed's terms (§A.3,
// §D.21) prohibit automated applications, and Naukri refuses automated browsers; production uses
// Assisted Apply for these sites (apps/api/src/routes/jobBot.ts).
//
// It runs only when ALL of these hold: JOB_BOT_EXPERIMENTAL=true on the worker, the user's email is in
// JOB_BOT_USER_EMAILS, and the user pressed Run or Connect. It is NEVER scheduled: there is no tick, and
// startup removes the scheduler older versions created. Do not add one.
//
// "jobbot.run" applies on each connected platform up to its daily limit, headless; "jobbot.connect"
// opens a visible window on the site's own login page and waits for the user. One job at a time: a
// user's Chrome profile can only be open once.

export const JOB_BOT_QUEUE = 'jobbot';
const BOTS: Record<BotPlatform, PlatformBot> = { linkedin, naukri, indeed };
const MAX_FAILURES_IN_A_ROW = 4;
const CONNECT_WAIT_MS = 15 * 60_000;

type Data = { userId?: string; platform?: BotPlatform; dryRun?: boolean; limit?: number };
const connection = { url: env.REDIS_URL };
const queue = new Queue<Data>(JOB_BOT_QUEUE, { connection });

const allowedEmails = () => new Set(env.JOB_BOT_USER_EMAILS.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean));

async function allowed(userId: string): Promise<boolean> {
  if (!env.JOB_BOT_EXPERIMENTAL) return false;
  const [u] = await sql<{ email: string }[]>`select email from public.users where id = ${userId}`;
  return Boolean(u && allowedEmails().has(u.email.toLowerCase()));
}

async function setStatus(userId: string, platform: BotPlatform, status: BotSessionStatus, message: string | null, ran = false) {
  // A refused site is left alone for a day; any other status clears that.
  const retryAfter = status === 'access_restricted' ? sql`now() + make_interval(hours => ${BOT_RESTRICTED_RETRY_HOURS})` : sql`null`;
  await sql`
    insert into public.job_bot_sessions (user_id, platform, status, message, last_run_at, retry_after)
    values (${userId}, ${platform}, ${status}, ${message}, ${ran ? sql`now()` : null}, ${retryAfter})
    on conflict (user_id, platform) do update set status = excluded.status, message = excluded.message,
      last_run_at = coalesce(excluded.last_run_at, job_bot_sessions.last_run_at), retry_after = excluded.retry_after,
      updated_at = now()`;
}

async function appliedToday(userId: string, platform: BotPlatform): Promise<number> {
  const [{ n }] = await sql<{ n: number }[]>`
    select count(*)::int as n from public.job_bot_applications
    where user_id = ${userId} and platform = ${platform} and outcome = 'applied'
      and (updated_at at time zone 'Asia/Kolkata')::date = (now() at time zone 'Asia/Kolkata')::date`;
  return n;
}

/** Jobs handled for good: applied, or skipped for a reason that won't change. needs_answer and failed are retried. */
async function seen(userId: string, platform: BotPlatform, jobId: string): Promise<boolean> {
  const [row] = await sql`
    select 1 from public.job_bot_applications
    where user_id = ${userId} and platform = ${platform} and job_id = ${jobId}
      and outcome in ('applied', 'skipped', 'already_applied', 'external')`;
  return Boolean(row);
}

/**
 * Stores what happened to a job. The platforms only report 'applied' after the site's own confirmation
 * ("Application sent", "successfully applied"), so applied rows carry evidence 'verified'.
 */
async function record(userId: string, platform: BotPlatform, job: JobRef, result: Result) {
  if (result.outcome === 'dry-run') return;
  const evidence = result.outcome === 'applied' ? 'verified' : null;
  await sql`
    insert into public.job_bot_applications (user_id, platform, job_id, title, company, location, url, outcome, detail, evidence)
    values (${userId}, ${platform}, ${job.id}, ${job.title.slice(0, 300)}, ${job.company.slice(0, 200)}, ${job.location.slice(0, 200)},
            ${job.url}, ${result.outcome}, ${result.detail.slice(0, 2000) || null}, ${evidence})
    on conflict (user_id, platform, job_id) do update set
      title = excluded.title, company = excluded.company, location = excluded.location, url = excluded.url,
      outcome = excluded.outcome, detail = excluded.detail, evidence = excluded.evidence, updated_at = now()
    where job_bot_applications.outcome not in ('applied', 'assisted')`;
}

/** Whether a run should use the platform: connected, or refused earlier and due for one more try. */
async function usable(userId: string, platform: BotPlatform): Promise<{ ok: boolean; why: string }> {
  const [row] = await sql<{ status: BotSessionStatus; due: boolean }[]>`
    select status, coalesce(retry_after <= now(), true) as due from public.job_bot_sessions where user_id = ${userId} and platform = ${platform}`;
  if (row?.status === 'connected') return { ok: true, why: '' };
  if (row?.status === 'access_restricted') return row.due ? { ok: true, why: '' } : { ok: false, why: 'access restricted by the site; retrying later' };
  return { ok: false, why: 'not connected' };
}

async function runPlatform(page: Page, userId: string, bot: PlatformBot, config: Awaited<ReturnType<typeof buildConfig>>['config'], data: Data, log: (s: string) => void) {
  const p = bot.platform;
  const limit = data.limit ?? config.dailyLimit[p];
  const target = data.dryRun ? limit : limit - (await appliedToday(userId, p));
  if (target <= 0) return { applied: 0, note: 'daily limit reached' };
  await page.goto(bot.homeUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
  if (!(await bot.isSignedIn(page)) || (await humanCheck(page))) {
    await setStatus(userId, p, 'disconnected', 'Signed out: connect again.');
    return { applied: 0, note: 'signed out' };
  }
  let done = 0;
  let failures = 0;
  const counts: Record<string, number> = {};
  let stopped: string | null = null;
  searches: for (const s of config.searches) {
    // A network error on one search page shouldn't end the whole run.
    try {
    for await (const job of bot.search(page, s, config)) {
      if (done >= target || failures >= MAX_FAILURES_IN_A_ROW) break searches;
      if (await seen(userId, p, job.id)) continue;
      let result: Result;
      try {
        result = await bot.apply(page, job, config, Boolean(data.dryRun));
      } catch (err) {
        if (err instanceof VerificationNeeded || err instanceof SiteBlocked) throw err;
        if (err instanceof LinkedInDailyLimit) {
          stopped = 'LinkedIn’s own daily Easy Apply limit for this account is reached (applications from anywhere count, other tools included). Trying again in the next run.';
          break searches;
        }
        result = { outcome: 'failed', detail: (err as Error).message.split('\n')[0].slice(0, 300) };
      }
      await record(userId, p, job, result);
      counts[result.outcome] = (counts[result.outcome] ?? 0) + 1;
      log(`${p} ${result.outcome}: ${job.title || job.id} — ${job.company}${result.detail ? ` (${result.detail.slice(0, 120)})` : ''}`);
      failures = result.outcome === 'failed' ? failures + 1 : 0;
      if (result.outcome === 'applied' || result.outcome === 'dry-run') {
        done++;
        if (done < target) await between(config.pauseSeconds);
      } else {
        await between([4, 9]);
      }
    }
    } catch (err) {
      if (err instanceof VerificationNeeded || err instanceof SiteBlocked) throw err;
      log(`${p} search "${s.keywords}" in ${s.location} failed: ${(err as Error).message.split('\n')[0]}`);
    }
    await between([5, 10]);
  }
  if (failures >= MAX_FAILURES_IN_A_ROW) stopped = `Stopped after ${failures} failures in a row; the site may have changed.`;
  return { applied: done, counts, note: stopped };
}

async function run(job: Job<Data>) {
  const userId = job.data.userId!;
  if (!(await allowed(userId))) return { skipped: 'not enabled (JOB_BOT_EXPERIMENTAL and JOB_BOT_USER_EMAILS)' };
  const { config, missing } = await buildConfig(userId);
  if (missing.length) return { skipped: `missing: ${missing.join(', ')}` };
  const platforms = (job.data.platform ? [job.data.platform] : [...BOT_PLATFORMS]).filter((p) => config.dailyLimit[p] > 0 || job.data.limit);
  const out: Record<string, unknown> = {};
  const context = await openBrowser(userId, { visible: false });
  try {
    const page = context.pages()[0] ?? (await context.newPage());
    for (const p of platforms) {
      const use = await usable(userId, p);
      if (!use.ok) {
        out[p] = use.why;
        continue;
      }
      try {
        const result = await runPlatform(page, userId, BOTS[p], config, job.data, (s) => job.log(s).catch(() => {}));
        out[p] = result;
        // The card shows why a run applied to nothing.
        const why = result.note ?? (result.applied === 0 && 'counts' in result && Object.keys(result.counts ?? {}).length === 0 ? 'No new jobs found for your searches this run.' : null);
        await setStatus(userId, p, 'connected', why, true);
      } catch (err) {
        if (err instanceof SiteBlocked) {
          // Recorded as a restriction, not "no jobs"; not tried again for a day. Assisted Apply still works.
          await setStatus(userId, p, 'access_restricted', `${err.message}. The site blocks automated background browsers, so the bot doesn’t apply here; use Assisted Apply for its jobs. Checked again in ${BOT_RESTRICTED_RETRY_HOURS} hours.`, true);
          out[p] = 'blocked by the site';
          continue;
        }
        if (!(err instanceof VerificationNeeded)) throw err;
        await setStatus(userId, p, 'needs_verification', `${err.message}. Use Verify and complete it in the window that opens.`, true);
        out[p] = 'needs verification';
      }
    }
  } finally {
    await context.close().catch(() => {});
  }
  return out;
}

/** Opens a visible window on the site's login page (or home, to clear a check) and waits for the user. */
async function connect(job: Job<Data>) {
  const { userId, platform } = job.data as Required<Pick<Data, 'userId' | 'platform'>>;
  if (!(await allowed(userId))) throw new UnrecoverableError('not enabled for this account');
  const bot = BOTS[platform];
  await setStatus(userId, platform, 'connecting', 'A Chrome window is open on the computer running Friday: sign in there.');
  let context;
  try {
    context = await openBrowser(userId, { visible: true });
  } catch (err) {
    await setStatus(userId, platform, 'disconnected', `Couldn't open a window to sign in (${(err as Error).message.split('\n')[0]}). Signing in needs the worker running on a computer with a screen.`);
    return { connected: false };
  }
  try {
    const page = context.pages()[0] ?? (await context.newPage());
    const wasSignedIn = await bot.isSignedIn(page);
    await page.goto(wasSignedIn ? bot.homeUrl : bot.loginUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
    const until = Date.now() + CONNECT_WAIT_MS;
    while (Date.now() < until) {
      await sleep(3000);
      const live = context.pages().find((pg) => !pg.isClosed());
      if (!live) break;
      if ((await bot.isSignedIn(live)) && !(await humanCheck(live)) && !/login|signin|auth/i.test(new URL(live.url()).pathname)) {
        await sleep(2000);
        await setStatus(userId, platform, 'connected', null);
        return { connected: true };
      }
    }
    await setStatus(userId, platform, 'disconnected', 'Sign-in wasn’t finished. Try Connect again.');
    return { connected: false };
  } finally {
    await context.close().catch(() => {});
  }
}

/** The user disconnected the bot or deleted their Jobs data: their browser profile and resume copy go. */
async function forget(userId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(userId)) throw new UnrecoverableError('bad user id');
  rmSync(userDir(userId), { recursive: true, force: true });
  return { forgotten: userId };
}

const RUN_OPTS = { attempts: 1, removeOnComplete: { age: 7 * 24 * 3600 }, removeOnFail: { age: 7 * 24 * 3600 } };

/** Queues a run unless one is already waiting for the user. */
export async function queueBotRun(userId: string, extra: Omit<Data, 'userId'> = {}) {
  await queue.add('jobbot.run', { userId, ...extra }, { ...RUN_OPTS, jobId: `run-${userId}-${Date.now() - (Date.now() % 600_000)}` });
}

/** Removes the automatic schedule older versions created; the bot is never scheduled. */
export async function removeJobBotSchedule() {
  await queue.removeJobScheduler('jobbot-tick').catch(() => false);
}

/** Starts the worker only when JOB_BOT_EXPERIMENTAL is on; returns null otherwise. */
export function startJobBotWorker() {
  void removeJobBotSchedule();
  if (!env.JOB_BOT_EXPERIMENTAL) return null;
  const worker = new Worker<Data>(
    JOB_BOT_QUEUE,
    async (job) => {
      if (job.name === 'jobbot.run') return run(job);
      if (job.name === 'jobbot.connect') return connect(job);
      if (job.name === 'jobbot.forget') return forget(job.data.userId!);
      throw new UnrecoverableError(`No processor for job "${job.name}"`);
    },
    // Applying takes a minute or more per job, with pauses: a long lock.
    { connection, concurrency: 1, lockDuration: 10 * 60_000 },
  );
  worker.on('completed', (job, result) => console.log(`[jobbot] ${job.name} #${job.id} done`, JSON.stringify(result)));
  worker.on('failed', (job, err) => console.error(`[jobbot] ${job?.name} #${job?.id} failed:`, err.message));
  return worker;
}

export const closeJobBotQueue = () => queue.close();
