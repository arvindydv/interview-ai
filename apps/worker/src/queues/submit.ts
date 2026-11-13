import { randomUUID } from 'node:crypto';
import { Queue, UnrecoverableError, Worker } from 'bullmq';
import {
  EMPTY_APPLICATION_PROFILE, activeJobsPlan, redactSensitive,
  type ApplicationProfile, type FormQuestion, type PreparedAnswer,
} from '@parakeet/shared';
import { audit } from '../audit.js';
import { sql } from '../db.js';
import { env } from '../env.js';
import { ASSISTED_REASON, channelFor } from '../submit/channel.js';
import { decryptSecret, flagCredential, loadCredential } from '../submit/credentials.js';
import { basicAuth, parseSecret } from '../submit/http.js';
import { CONNECTORS_BY_PROVIDER, type AtsConnector, type SubmitResult } from '../submit/index.js';
import { closeSubmitLimiter, submitLimiter, type SubmitLimiter } from '../submit/limiter.js';

// Authorized ATS submission: prepared applications whose channel is 'api' (the employer granted us an
// API credential for their board, see submit/channel.ts) are sent here, from the worker, with no browser
// and nobody's computer on.
//
//   autosubmit.tick (every minute): queues each due API application once (jobId = application id).
//   autosubmit.send { applicationId }: claims it (lease), sends it, records the outcome.
//
// Never twice: submit_clicked_at is set before the request goes out. From then on, anything short of
// the ATS's own answer (timeout, reset, 502/504, a crash, a lapsed lease) leaves it "unverified" for the
// candidate to confirm; it is never resent. Failures where the ATS provably didn't take it (connection
// refused, 429, 500/503) go back to Prepared with a delay.

export const SUBMIT_QUEUE = 'autosubmit';
const CLAIM_PREFIX = 'api:';
/** Failed tries (not counting 429s) before an application is marked Failed. */
const MAX_ATTEMPTS = 3;
/** 429s before giving up on the API for this application. */
const MAX_RATE_LIMITED = 10;
/** Applications queued per tick. */
const BATCH = 50;

const UNVERIFIED = 'Sent to the employer’s ATS, but no answer came back. Check your email for its confirmation, then confirm it here.';

const connection = { url: env.REDIS_URL };
let queue: Queue | null = null;
const getQueue = () => (queue ??= new Queue(SUBMIT_QUEUE, { connection }));

async function logEvent(applicationId: string, userId: string, kind: string, message: string, detail?: unknown) {
  await sql`
    insert into public.auto_apply_events (application_id, user_id, kind, message, detail)
    values (${applicationId}, ${userId}, ${kind}, ${message}, ${detail === undefined ? null : sql.json(redactSensitive(detail) as never)})`;
}

/** A submitted application shows in the user's Applied list (same as apps/api/src/lib/autoApplyReports.ts). */
async function markApplied(userId: string, listingId: string | null) {
  if (!listingId) return;
  await sql`
    insert into public.job_applications (user_id, listing_id, title, company, location, apply_url, status, applied_at)
    select ${userId}, l.id, l.title, l.company, l.location, l.apply_url, 'applied', now()
    from public.job_listings l where l.id = ${listingId}
    on conflict (user_id, listing_id) do update set
      status = case when job_applications.status = 'saved' then 'applied' else job_applications.status end,
      applied_at = coalesce(job_applications.applied_at, now()), updated_at = now()`;
}

// ---- per-provider pacing -------------------------------------------------------------------------

/** Longest an application waits for its provider's slot before going back to Prepared for later. */
const MAX_SLOT_WAIT_MS = 2 * 60_000;

/** Pacing and concurrency for a provider, shared by every worker process (submit/limiter.ts). */
const limits = (c: AtsConnector) => ({ minIntervalMs: c.minIntervalMs, maxConcurrent: c.maxConcurrent ?? 2, leaseMs: c.timeoutMs + 60_000 });

// ---- tick ----------------------------------------------------------------------------------------

/** Queues every due API application (deduplicated by job id, so one in the queue isn't added twice). */
export async function tick(only?: string) {
  const due = await sql<{ id: string }[]>`
    select a.id from public.auto_applications a
    join public.auto_apply_settings s on s.user_id = a.user_id
    where a.status = 'prepared' and a.channel = 'api' and a.cancelled_at is null
      and (a.retry_at is null or a.retry_at <= now()) and a.tailored_resume_id is not null
      and s.enabled and s.consented_at is not null
      ${only ? sql`and a.user_id = ${only}` : sql``}
    order by a.score desc nulls last, a.created_at
    limit ${BATCH}`;
  if (due.length) {
    await getQueue().addBulk(due.map((a) => ({
      name: 'autosubmit.send',
      data: { applicationId: a.id },
      opts: { jobId: `send-${a.id}`, removeOnComplete: true, removeOnFail: { age: 24 * 3600 }, attempts: 1 },
    })));
  }
  return { queued: due.length };
}

// ---- send ----------------------------------------------------------------------------------------

interface Claimed {
  id: string;
  user_id: string;
  listing_id: string | null;
  provider: string;
  title: string;
  company: string;
  form: FormQuestion[] | null;
  answers: PreparedAnswer[] | null;
  tailored_resume_id: string | null;
  idempotency_key: string;
  board: string | null;
  external_id: string | null;
}

export interface SendDeps {
  fetch?: typeof fetch;
  connectors?: Record<string, AtsConnector>;
  timeoutMs?: number;
  limiter?: SubmitLimiter;
}

/**
 * Sends one API application. Safe to call any number of times, concurrently: only one call can hold the
 * claim, and only a Prepared, uncancelled, channel='api' row can be claimed.
 */
export async function sendApplication(applicationId: string, deps: SendDeps = {}) {
  const claim = `${CLAIM_PREFIX}${randomUUID()}`;
  const [app] = await sql<Claimed[]>`
    update public.auto_applications a
    set status = 'pending', reason_code = 'submitting', reason = 'Being sent to the employer’s ATS',
        claimed_by = ${claim}, claimed_at = now(), submit_clicked_at = null, updated_at = now()
    from public.auto_apply_settings s
    where a.id = ${applicationId} and s.user_id = a.user_id
      and a.status = 'prepared' and a.channel = 'api' and a.cancelled_at is null
      and (a.retry_at is null or a.retry_at <= now())
      and s.enabled and s.consented_at is not null
    returning a.id, a.user_id, a.listing_id, a.provider, a.title, a.company, a.form, a.answers, a.tailored_resume_id, a.idempotency_key,
              (select src.board from public.job_listings l join public.job_sources src on src.id = l.source_id where l.id = a.listing_id) as board,
              (select l.external_id from public.job_listings l where l.id = a.listing_id) as external_id`;
  if (!app) return { skipped: 'not claimable' };
  const userId = app.user_id;

  /** Updates the row only while our claim holds it. */
  const set = async (fields: Record<string, unknown>) => {
    const [row] = await sql<{ id: string }[]>`
      update public.auto_applications set ${sql(fields as never)}, claimed_by = null, claimed_at = null, updated_at = now()
      where id = ${app.id} and claimed_by = ${claim} returning id`;
    return Boolean(row);
  };
  const release = async (why: string, fields: Record<string, unknown> = {}) => {
    await set({ status: 'prepared', reason_code: null, reason: null, submit_clicked_at: null, ...fields });
    await logEvent(app.id, userId, 'released', why);
  };
  /** Back to another channel without sending (credential refused, form beyond this API…). */
  const fallBack = async (why: string, extra: Record<string, unknown> = {}) => {
    const channel = await channelFor({ provider: app.provider, board: app.board, userId }, { skipApi: true });
    const assisted = channel === 'assisted';
    await set({
      status: assisted ? 'pending' : 'prepared', reason_code: assisted ? 'assisted' : null, reason: assisted ? ASSISTED_REASON : null,
      channel, submit_clicked_at: null, ...extra,
    });
    await logEvent(app.id, userId, 'channel_fallback', `${why} Moved to: ${channel}.`, { channel });
    return { fallback: channel };
  };

  const connector = (deps.connectors ?? CONNECTORS_BY_PROVIDER)[app.provider];
  if (!connector) return fallBack(`No API connector for ${app.provider}.`);
  if (!app.listing_id || !app.board || !app.external_id) {
    await set({ status: 'skipped', reason_code: 'listing_closed', reason: 'The job is no longer listed.' });
    return { skipped: 'closed' };
  }

  // The daily limit, checked again at the moment of sending (the plan counted it when picking).
  const [lim] = await sql<{ daily_limit: number; jobs_plan: string | null; jobs_plan_expires_at: Date | null; sent_today: number }[]>`
    select s.daily_limit, u.jobs_plan, u.jobs_plan_expires_at,
           (select count(*)::int from public.auto_applications x
             where x.user_id = s.user_id and x.status = 'submitted'
               and (x.submitted_at at time zone s.timezone)::date = (now() at time zone s.timezone)::date) as sent_today
    from public.auto_apply_settings s join public.users u on u.id = s.user_id where s.user_id = ${userId}`;
  const limit = Math.min(lim.daily_limit, activeJobsPlan(lim.jobs_plan, lim.jobs_plan_expires_at).dailyApplications);
  if (lim.sent_today >= limit) {
    await release(`Daily limit (${limit}) reached; it waits for tomorrow`, { retry_at: new Date(Date.now() + 3600_000) });
    return { skipped: 'daily limit' };
  }

  const credential = await loadCredential(app.provider, app.board);
  if (!credential) return fallBack('The employer credential is missing, revoked or flagged.');

  // The volume this employer agreed to, per India calendar day. Counts sends in flight and unconfirmed
  // ones (they may have arrived) besides confirmed ones, so concurrent workers can undershoot, never exceed.
  const [{ sent }] = await sql<{ sent: number }[]>`
    select count(*)::int as sent
    from public.auto_applications x
    join public.job_listings l on l.id = x.listing_id
    join public.job_sources src on src.id = l.source_id
    where x.id <> ${app.id} and x.channel = 'api' and src.provider = ${app.provider} and src.board = ${app.board}
      and (x.reason_code = 'submitting'
           or ((x.status = 'submitted' or x.reason_code = 'unverified')
               and (coalesce(x.submitted_at, x.submit_clicked_at, x.updated_at) at time zone 'Asia/Kolkata')::date = (now() at time zone 'Asia/Kolkata')::date))`;
  if (sent >= credential.dailyCap) {
    await release(`${app.company} agreed to ${credential.dailyCap} a day through its API; it waits for tomorrow`, { retry_at: new Date(Date.now() + 3600_000) });
    return { skipped: 'employer daily cap' };
  }

  const [files] = await sql<{ file: Buffer | null; file_name: string | null; format: string | null; cover: Buffer | null }[]>`
    select file, file_name, content->>'format' as format, cover_letter_file as cover
    from public.tailored_resumes where id = ${app.tailored_resume_id} and status = 'ready'`;
  if (!files?.file) {
    await release('The tailored resume is missing; it will be prepared again', { status: 'preparing' });
    return { skipped: 'no resume' };
  }
  const resumeName = files.file_name ?? `Resume.${files.format ?? 'pdf'}`;
  const [profileRow] = await sql<{ data: Partial<ApplicationProfile> }[]>`select data from public.application_profiles where user_id = ${userId}`;
  const p = { ...EMPTY_APPLICATION_PROFILE, ...profileRow?.data };

  // A slot for this provider, shared with every other worker: its documented rate is never exceeded, and
  // after a 429 all workers wait out its cool-down.
  const limiter = deps.limiter ?? submitLimiter();
  const slot = await limiter.acquire(connector.provider, limits(connector), MAX_SLOT_WAIT_MS);
  if (!slot) {
    await release(`${app.provider} is busy (rate limit or cool-down); trying again shortly`, { retry_at: new Date(Date.now() + 60_000) });
    return { retry: 'provider busy' };
  }
  let result: SubmitResult;
  try {
    // Cancelled while it waited for a slot: not sent.
    const [still] = await sql<{ cancelled: boolean }[]>`select cancelled_at is not null as cancelled from public.auto_applications where id = ${app.id}`;
    if (still.cancelled) {
      await set({ status: 'skipped', reason_code: 'removed_by_user', reason: 'You cancelled it.', submit_clicked_at: null });
      await logEvent(app.id, userId, 'skipped', 'Cancelled before it was sent');
      return { skipped: 'cancelled' };
    }

    // From here the request may reach the ATS: recorded first, so a crash can never lead to a resend.
    const [marked] = await sql<{ id: string }[]>`
      update public.auto_applications set submit_clicked_at = now(), updated_at = now()
      where id = ${app.id} and claimed_by = ${claim} returning id`;
    if (!marked) return { skipped: 'claim lost' };
    await logEvent(app.id, userId, 'submitting', `Sending to ${app.provider} through the employer’s API`);

    try {
      result = await connector.submit(
        {
          applicationId: app.id, provider: app.provider, board: app.board, externalId: app.external_id, title: app.title, company: app.company,
          form: app.form ?? [], answers: app.answers ?? [],
          candidate: {
            firstName: p.firstName, lastName: p.lastName, email: p.email, phone: p.phone, city: p.city, country: p.country,
            linkedin: p.linkedin, github: p.github, portfolio: p.portfolio, website: p.website,
          },
        },
        {
          resume: { name: resumeName, mime: files.format === 'docx' ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : 'application/pdf', data: files.file },
          coverLetter: files.cover ? { name: resumeName.replace(/Resume/, 'Cover Letter').replace(/\.docx$/i, '.pdf'), mime: 'application/pdf', data: files.cover } : null,
        },
        credential.secret,
        { idempotencyKey: app.idempotency_key, fetch: deps.fetch, timeoutMs: deps.timeoutMs },
      );
    } catch (err) {
      // A bug in the connector, after submit_clicked_at: we can't know, so the candidate confirms.
      result = { outcome: 'uncertain', httpStatus: null, message: `Connector error: ${(err as Error).message.slice(0, 200)}` };
    }
  } finally {
    await slot.release();
  }
  // The ATS is rate-limiting: every worker leaves it alone until it says to come back.
  if (result.outcome === 'failed' && result.code === 'rate_limited') {
    await limiter.coolDown(connector.provider, result.retryAfterMs ?? 60_000);
  }
  return record(app, claim, result, credential.id, set, release, fallBack);
}

async function record(
  app: Claimed,
  claim: string,
  result: SubmitResult,
  credentialId: string,
  set: (f: Record<string, unknown>) => Promise<boolean>,
  release: (why: string, f?: Record<string, unknown>) => Promise<void>,
  fallBack: (why: string, extra?: Record<string, unknown>) => Promise<{ fallback: string }>,
) {
  const userId = app.user_id;
  const failure = (r: Extract<SubmitResult, { outcome: 'failed' | 'uncertain' }>) =>
    sql.json(redactSensitive({
      code: r.outcome === 'uncertain' ? 'uncertain' : r.code, httpStatus: r.httpStatus, message: r.message,
      retryable: r.outcome === 'failed' ? r.retryable : false, at: new Date().toISOString(),
    }) as never);

  if (result.outcome === 'submitted') {
    // Recorded truthfully even if the candidate cancelled while it was on its way.
    await set({
      status: 'submitted', reason_code: null, reason: null, submitted_at: new Date(), submitted_via: 'api',
      external_application_id: result.externalId, failure: null,
      evidence: sql.json({ kind: 'api', provider: app.provider, httpStatus: result.httpStatus, externalId: result.externalId, text: result.evidence, at: new Date().toISOString() } as never),
    });
    await logEvent(app.id, userId, 'submitted', `Submitted through ${app.provider}’s API; the ATS accepted it`, { externalId: result.externalId, httpStatus: result.httpStatus });
    await markApplied(userId, app.listing_id);
    await audit({ userId, actor: 'worker', action: 'application.submitted', targetType: 'auto_application', targetId: app.id, detail: { channel: 'api', provider: app.provider, credentialId } });
    return { submitted: true, externalId: result.externalId };
  }

  if (result.outcome === 'uncertain') {
    await set({ status: 'pending', reason_code: 'unverified', reason: UNVERIFIED, submitted_via: 'api', failure: failure(result) });
    await logEvent(app.id, userId, 'unverified', `No definite answer from ${app.provider}: ${result.message}`, { httpStatus: result.httpStatus });
    return { unverified: true };
  }

  // failed: the ATS did not take it (or already has one from this candidate).
  const [{ cancelled }] = await sql<{ cancelled: boolean }[]>`select cancelled_at is not null as cancelled from public.auto_applications where id = ${app.id}`;
  switch (result.code) {
    case 'duplicate':
      await set({ status: 'skipped', reason_code: 'already_applied', reason: 'The employer already has an application from you for this job.', submit_clicked_at: null, failure: failure(result) });
      await logEvent(app.id, userId, 'skipped', `Already applied: ${result.message}`);
      return { skipped: 'duplicate' };
    case 'closed':
      await set({ status: 'skipped', reason_code: 'listing_closed', reason: 'The job no longer accepts applications.', submit_clicked_at: null, failure: failure(result) });
      await logEvent(app.id, userId, 'skipped', `Closed: ${result.message}`);
      return { skipped: 'closed' };
    case 'auth':
      await flagCredential(credentialId, `HTTP ${result.httpStatus ?? '?'}: ${result.message}`);
      await audit({ userId: null, actor: 'worker', action: 'ats_credential.refused', targetType: 'ats_credential', targetId: credentialId, detail: { provider: app.provider, httpStatus: result.httpStatus } });
      if (cancelled) break;
      return fallBack(`${app.provider} refused the employer credential (HTTP ${result.httpStatus}).`, { failure: failure(result) });
    case 'unsupported_form':
      if (cancelled) break;
      return fallBack(result.message + '.', { failure: failure(result) });
    default:
      break;
  }
  if (cancelled) {
    await set({ status: 'skipped', reason_code: 'removed_by_user', reason: 'You cancelled it.', submit_clicked_at: null, failure: failure(result) });
    await logEvent(app.id, userId, 'skipped', 'Cancelled; it was not sent');
    return { skipped: 'cancelled' };
  }

  if (result.code === 'validation') {
    // The ATS named fields: the candidate answers them, like any missing question.
    if (result.fields?.length) {
      await set({ status: 'pending', reason_code: 'needs_answers', reason: `The employer’s ATS rejected: ${result.message.slice(0, 200)}`, missing: result.fields, submit_clicked_at: null, failure: failure(result) });
      await logEvent(app.id, userId, 'needs_answers', result.message, { fields: result.fields });
      return { pending: 'needs_answers' };
    }
    await set({ status: 'failed', reason_code: 'submit_failed', reason: `The employer’s ATS rejected it: ${result.message.slice(0, 200)}`, submit_clicked_at: null, failure: failure(result) });
    await logEvent(app.id, userId, 'submit_failed', result.message, { httpStatus: result.httpStatus, via: 'api' });
    return { failed: 'validation' };
  }

  // Retryable: rate limited, server error, never connected.
  const [{ fails, limited }] = await sql<{ fails: number; limited: number }[]>`
    select count(*) filter (where kind = 'submit_failed')::int as fails, count(*) filter (where kind = 'rate_limited')::int as limited
    from public.auto_apply_events
    where application_id = ${app.id}
      and id > coalesce((select max(id) from public.auto_apply_events where application_id = ${app.id} and kind = 'retry'), 0)`;
  if (result.code === 'rate_limited') {
    if (limited + 1 >= MAX_RATE_LIMITED) {
      return fallBack(`${app.provider} kept rate-limiting (${MAX_RATE_LIMITED} times).`);
    }
    const ms = result.retryAfterMs ?? 60_000;
    await release(`Rate limited by ${app.provider}; trying again in ${Math.ceil(ms / 1000)}s`, {
      retry_at: new Date(Date.now() + ms), failure: failure(result),
    });
    await logEvent(app.id, userId, 'rate_limited', result.message, { retryAfterMs: ms });
    return { retry: 'rate_limited', afterMs: ms };
  }
  if (fails + 1 >= MAX_ATTEMPTS) {
    await set({ status: 'failed', reason_code: 'submit_failed', reason: `Couldn’t submit after ${MAX_ATTEMPTS} tries: ${result.message.slice(0, 200)}`, submit_clicked_at: null, failure: failure(result) });
    await logEvent(app.id, userId, 'submit_failed', result.message, { httpStatus: result.httpStatus, via: 'api', final: true });
    return { failed: result.code };
  }
  const mins = 15 * 2 ** fails;
  await release(`${app.provider} didn’t take it (${result.code}); trying again in ${mins} min`, {
    retry_at: new Date(Date.now() + mins * 60_000), failure: failure(result),
  });
  await logEvent(app.id, userId, 'submit_failed', result.message, { httpStatus: result.httpStatus, via: 'api', code: result.code });
  return { retry: result.code, afterMin: mins };
}

// ---- credential check ----------------------------------------------------------------------------

/**
 * A read-only check of a credential (admin console → "Verify"). Never a test submission. Ashby has an
 * endpoint that only describes the key (apiKey.info); Greenhouse's and Lever's application keys can't be
 * checked without applying, so those are verified by their first real submission (a 401/403 flags them).
 */
export async function verifyCredential(credentialId: string, f: typeof fetch = fetch) {
  const [c] = await sql<{ id: string; provider: string; board: string; secret_enc: Buffer }[]>`
    select id, provider, board, secret_enc from public.ats_credentials where id = ${credentialId} and revoked_at is null`;
  if (!c) return { skipped: 'no such credential' };
  let secret: string;
  try {
    secret = decryptSecret(c.secret_enc);
  } catch {
    await flagCredential(c.id, 'Could not decrypt (ATS_CREDENTIALS_KEY changed?)');
    return { verified: false };
  }
  const { apiKey, subdomain } = parseSecret(secret) as { apiKey: string; subdomain?: string };
  let ok: boolean | null = null;
  let message = '';
  if (c.provider === 'workable') {
    // Read-only: one job from the account (r_jobs, which the connector needs anyway for questions).
    const sub = (subdomain ?? c.board).toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]*$/.test(sub)) {
      ok = false;
      message = 'Invalid Workable subdomain in the credential';
    } else {
      const res = await f(`https://${sub}.workable.com/spi/v3/jobs?limit=1`, { headers: { authorization: `Bearer ${apiKey}`, accept: 'application/json' } });
      ok = res.ok;
      message = ok ? 'Workable accepted the token' : `Workable refused the token (HTTP ${res.status})`;
    }
  } else if (c.provider === 'ashby') {
    const res = await f('https://api.ashbyhq.com/apiKey.info', { method: 'POST', headers: { authorization: basicAuth(apiKey), 'content-type': 'application/json' }, body: '{}' });
    const body = (await res.json().catch(() => null)) as { success?: boolean } | null;
    ok = res.ok && body?.success === true;
    message = ok ? 'Ashby accepted the key' : `Ashby refused the key (HTTP ${res.status})`;
  } else {
    message = `${c.provider} has no read-only endpoint for application keys; checked on its first submission`;
  }
  if (ok === true) await sql`update public.ats_credentials set verified_at = now(), last_error = null, updated_at = now() where id = ${c.id}`;
  if (ok === false) await flagCredential(c.id, message);
  await audit({ userId: null, actor: 'worker', action: 'ats_credential.verified', targetType: 'ats_credential', targetId: c.id, detail: { ok, message } });
  return { verified: ok, message };
}

// ---- worker --------------------------------------------------------------------------------------

export function startSubmitWorker() {
  const q = getQueue();
  void q
    .upsertJobScheduler('autosubmit-tick', { pattern: '* * * * *' }, { name: 'autosubmit.tick', data: {} })
    .catch((err) => console.error('[autosubmit] could not schedule the tick:', err.message));
  const worker = new Worker(
    SUBMIT_QUEUE,
    async (job) => {
      if (job.name === 'autosubmit.tick') return tick();
      if (job.name === 'autosubmit.send') return sendApplication(job.data.applicationId);
      if (job.name === 'autosubmit.verify') return verifyCredential(job.data.credentialId);
      throw new UnrecoverableError(`No processor for job "${job.name}"`);
    },
    // Pacing per provider is shared by every worker process through Redis (submit/limiter.ts).
    { connection, concurrency: 4 },
  );
  worker.on('completed', (job, result) => {
    if (job.name !== 'autosubmit.tick' || (result as { queued?: number })?.queued) console.log(`[autosubmit] ${job.name} #${job.id} done`, JSON.stringify(result));
  });
  worker.on('failed', (job, err) => console.error(`[autosubmit] ${job?.name} #${job?.id} failed:`, err.message));
  return worker;
}

export const closeSubmitQueue = () => Promise.all([queue?.close(), closeSubmitLimiter()]);
