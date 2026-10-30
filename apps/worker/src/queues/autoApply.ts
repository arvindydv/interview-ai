import { Queue, UnrecoverableError, Worker, type Job } from 'bullmq';
import type { EmailJob } from '@parakeet/emails';
import {
  AUTO_APPLY_LIMITS, AUTO_APPLY_PROVIDERS, EMPTY_APPLICATION_PROFILE, missingProfileFields, type ApplicationProfile,
  type AutoApplyProvider, type AutoApplyReason, type FormQuestion, type PreparedAnswer, type ResumeProfile,
} from '@parakeet/shared';
import { sql } from '../db.js';
import { env } from '../env.js';
import { bulkModel } from '../llm.js';
import { answerForm } from '../autoapply/answers.js';
import { FormUnavailableError, fetchForm, submitUrl } from '../autoapply/forms.js';
import { createTailoring, runTailoring } from './tailor.js';

// Friday Jobs Auto Apply, prepared on the server so it carries on while the user's computer is off.
//
//   autoapply.tick (every 10 minutes): returns stalled work to the queue, expires stale applications,
//     and queues a plan for every user with Auto Apply on.
//   autoapply.plan { userId }: picks today's jobs (best matches at or above the user's minimum score,
//     not applied to before, up to the daily limit) and queues each for preparation.
//   autoapply.prepare { applicationId }: tailors the resume, reads the job board's form and answers it.
//     Ends Prepared (ready for the extension to submit), Pending (needs the user), Failed or Skipped.
//
// Every step is idempotent and records what it did in auto_apply_events, so a retried or resumed job
// picks up where the last one stopped. Submission is done by the Friday extension through the API.

export const AUTO_APPLY_QUEUE = 'autoapply';

const connection = { url: env.REDIS_URL };
const queue = new Queue(AUTO_APPLY_QUEUE, { connection });
const emailQueue = new Queue<EmailJob>('email', {
  connection,
  defaultJobOptions: { attempts: 6, backoff: { type: 'exponential', delay: 15_000 }, removeOnComplete: { age: 7 * 24 * 3600 } },
});

const PREPARE_OPTS = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 30_000 },
  removeOnComplete: { age: 24 * 3600 },
  removeOnFail: { age: 7 * 24 * 3600 },
};
/** A preparation not finished in this long is assumed lost (worker restart) and queued again. */
const STALLED_PREPARE_MIN = 20;
/** The extension's lease on an application it is submitting. */
export const CLAIM_LEASE_MIN = 15;

export async function logEvent(applicationId: string, userId: string, kind: string, message: string, detail?: unknown) {
  await sql`
    insert into public.auto_apply_events (application_id, user_id, kind, message, detail)
    values (${applicationId}, ${userId}, ${kind}, ${message}, ${detail === undefined ? null : sql.json(detail as never)})`;
}

async function setStatus(
  id: string,
  userId: string,
  status: 'prepared' | 'pending' | 'failed' | 'skipped',
  reasonCode: AutoApplyReason | null,
  reason: string | null,
) {
  await sql`
    update public.auto_applications
    set status = ${status}, reason_code = ${reasonCode}, reason = ${reason}, updated_at = now()
    where id = ${id}`;
  await logEvent(id, userId, status, reason ?? `Marked ${status}`);
}

async function prepareJob(id: string, delay = 0) {
  await queue.add('autoapply.prepare', { applicationId: id }, { ...PREPARE_OPTS, delay, jobId: `prepare-${id}-${Date.now()}` });
}

// ---- tick ----------------------------------------------------------------------------------------

async function tick() {
  // Preparations lost to a restart: queue them again.
  const stalled = await sql<{ id: string; user_id: string }[]>`
    update public.auto_applications set updated_at = now()
    where status = 'preparing' and updated_at < now() - make_interval(mins => ${STALLED_PREPARE_MIN})
    returning id, user_id`;
  for (const a of stalled) {
    await logEvent(a.id, a.user_id, 'resumed', 'Preparation stalled; started again');
    await prepareJob(a.id);
  }

  // Submissions the extension claimed but never reported: back to Prepared for another try.
  const lapsed = await sql<{ id: string; user_id: string }[]>`
    update public.auto_applications
    set status = 'prepared', reason_code = null, reason = null, claimed_by = null, claimed_at = null, updated_at = now()
    where status = 'pending' and reason_code = 'submitting'
      and claimed_at < now() - make_interval(mins => ${CLAIM_LEASE_MIN})
    returning id, user_id`;
  for (const a of lapsed) await logEvent(a.id, a.user_id, 'lease_expired', 'The browser stopped before finishing; it will be tried again');

  // The job was taken down: nothing to apply to.
  const closed = await sql<{ id: string; user_id: string }[]>`
    update public.auto_applications a
    set status = 'skipped', reason_code = 'listing_closed', reason = 'The job is no longer listed.', updated_at = now()
    where a.status in ('preparing', 'prepared', 'pending') and coalesce(a.reason_code, '') <> 'submitting'
      and not exists (select 1 from public.job_listings l where l.id = a.listing_id and l.closed_at is null)
    returning id, user_id`;
  for (const a of closed) await logEvent(a.id, a.user_id, 'skipped', 'The job is no longer listed.');

  // Prepared but never submitted (the browser hasn't been opened in a week).
  const expired = await sql<{ id: string; user_id: string }[]>`
    update public.auto_applications
    set status = 'skipped', reason_code = 'expired',
        reason = ${`Not submitted within ${AUTO_APPLY_LIMITS.expireDays} days.`}, updated_at = now()
    where status = 'prepared' and created_at < now() - make_interval(days => ${AUTO_APPLY_LIMITS.expireDays})
    returning id, user_id`;
  for (const a of expired) await logEvent(a.id, a.user_id, 'skipped', 'Expired before it was submitted.');

  const users = await sql<{ user_id: string }[]>`
    select user_id from public.auto_apply_settings where enabled and consented_at is not null`;
  await queue.addBulk(
    users.map((u) => ({
      name: 'autoapply.plan',
      data: { userId: u.user_id },
      // One plan per user at a time.
      opts: { jobId: `plan-${u.user_id}`, removeOnComplete: true, removeOnFail: { age: 3600 } },
    })),
  );
  return { stalled: stalled.length, lapsed: lapsed.length, closed: closed.length, expired: expired.length, planned: users.length };
}

// ---- plan ----------------------------------------------------------------------------------------

export async function planUser(userId: string) {
  const [settings] = await sql<{ enabled: boolean; consented_at: Date | null; min_score: number; daily_limit: number; timezone: string; today: string }[]>`
    select enabled, consented_at, min_score, daily_limit, timezone,
           to_char((now() at time zone timezone)::date, 'YYYY-MM-DD') as today
    from public.auto_apply_settings where user_id = ${userId}`;
  if (!settings?.enabled || !settings.consented_at) return { skipped: 'off' };

  const [profileRow] = await sql<{ data: Partial<ApplicationProfile> }[]>`
    select data from public.application_profiles where user_id = ${userId}`;
  const profile = { ...EMPTY_APPLICATION_PROFILE, ...profileRow?.data };
  if (missingProfileFields(profile).length) return { skipped: 'profile incomplete' };
  const [resume] = await sql<{ ok: boolean }[]>`
    select file is not null and status = 'ready' as ok from public.resumes where user_id = ${userId} order by created_at desc limit 1`;
  if (!resume?.ok) return { skipped: 'no resume file' };

  const [{ used, backlog }] = await sql<{ used: number; backlog: number }[]>`
    select count(*) filter (where plan_day = ${settings.today}::date and status <> 'skipped')::int as used,
           count(*) filter (where status in ('preparing', 'prepared'))::int as backlog
    from public.auto_applications where user_id = ${userId}`;
  const room = Math.min(settings.daily_limit - used, AUTO_APPLY_LIMITS.maxBacklog - backlog);
  if (room <= 0) {
    await sql`update public.auto_apply_settings set planned_at = now() where user_id = ${userId}`;
    return { skipped: used >= settings.daily_limit ? 'daily limit reached' : 'backlog full', used, backlog };
  }

  // Best matches first. Never the same job twice, nor the same role at the same company (reposts,
  // several locations), nor anything the user already applied to themselves.
  const picks = await sql<{ id: string; title: string; company: string; provider: AutoApplyProvider; board: string; external_id: string; score: number }[]>`
    select l.id, l.title, l.company, s.provider, s.board, l.external_id, m.score
    from public.job_matches m
    join public.job_listings l on l.id = m.listing_id
    join public.job_sources s on s.id = l.source_id
    where m.user_id = ${userId} and m.score >= ${settings.min_score}
      and l.closed_at is null and l.duplicate_of is null
      and s.provider in ${sql(AUTO_APPLY_PROVIDERS as unknown as string[])}
      and not exists (
        select 1 from public.auto_applications a
        where a.user_id = ${userId}
          and (a.listing_id = l.id or (lower(a.company) = lower(l.company) and lower(a.title) = lower(l.title))))
      and not exists (
        select 1 from public.job_applications j
        where j.user_id = ${userId} and j.status <> 'saved'
          and (j.listing_id = l.id or (lower(j.company) = lower(l.company) and lower(j.title) = lower(l.title))))
    order by m.score desc, l.posted_at desc nulls last
    limit ${room}`;

  // The same role can appear twice in one batch (two listings); keep the first.
  const seen = new Set<string>();
  const rows = picks.filter((p) => {
    const k = `${p.company.toLowerCase()}|${p.title.toLowerCase()}`;
    return !seen.has(k) && seen.add(k);
  });
  const created = rows.length
    ? await sql<{ id: string; title: string; company: string }[]>`
        insert into public.auto_applications ${sql(
          rows.map((p) => ({
            user_id: userId,
            listing_id: p.id,
            provider: p.provider,
            apply_url: submitUrl(p.provider, p.board, p.external_id),
            title: p.title,
            company: p.company,
            score: p.score,
            plan_day: settings.today,
          })),
        )}
        on conflict (user_id, listing_id) do nothing
        returning id, title, company`
    : [];
  for (const a of created) {
    await logEvent(a.id, userId, 'planned', `Picked for ${settings.today}: ${a.title} at ${a.company}`);
    await prepareJob(a.id);
  }
  await sql`update public.auto_apply_settings set planned_at = now() where user_id = ${userId}`;
  return { planned: created.length, used, backlog, room };
}

// ---- prepare -------------------------------------------------------------------------------------

interface PrepareRow {
  id: string;
  user_id: string;
  status: string;
  listing_id: string | null;
  tailored_resume_id: string | null;
  provider: AutoApplyProvider;
  title: string;
  company: string;
  form: FormQuestion[] | null;
  board: string | null;
  external_id: string | null;
  location: string | null;
  description: string | null;
  closed: boolean | null;
}

async function prepare(job: Job<{ applicationId: string }>) {
  const id = job.data.applicationId;
  const lastAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
  const [app] = await sql<PrepareRow[]>`
    select a.id, a.user_id, a.status, a.listing_id, a.tailored_resume_id, a.provider, a.title, a.company, a.form,
           s.board, l.external_id, l.location, l.description_text as description, l.closed_at is not null as closed
    from public.auto_applications a
    left join public.job_listings l on l.id = a.listing_id
    left join public.job_sources s on s.id = l.source_id
    where a.id = ${id}`;
  if (!app) return { skipped: 'deleted' };
  if (app.status !== 'preparing') return { skipped: `status ${app.status}` };
  const userId = app.user_id;
  await sql`update public.auto_applications set attempts = attempts + 1, updated_at = now() where id = ${id}`;

  if (!app.listing_id || app.closed || !app.board || !app.external_id) {
    await setStatus(id, userId, 'skipped', 'listing_closed', 'The job is no longer listed.');
    return { skipped: 'closed' };
  }

  try {
    const model = bulkModel();

    // 1. The resume, tailored to this job (reused if it was already tailored from the current resume).
    let tailoredId = app.tailored_resume_id;
    const [existing] = await sql<{ id: string; status: string }[]>`
      select t.id, t.status from public.tailored_resumes t
      where t.user_id = ${userId} and t.listing_id = ${app.listing_id}
        and t.resume_id = (select id from public.resumes where user_id = ${userId} order by created_at desc limit 1)`;
    if (existing?.status === 'ready') {
      tailoredId = existing.id;
    } else {
      tailoredId = await createTailoring(userId, app.listing_id);
      if (!tailoredId) throw new Error('Could not create the tailored resume');
      const run = await runTailoring(tailoredId, { model, lastAttempt });
      if (run.status !== 'ready') {
        await setStatus(id, userId, 'failed', 'tailoring_failed', run.error ?? 'Resume tailoring failed.');
        return { failed: 'tailoring', error: run.error };
      }
      await logEvent(id, userId, 'tailored', `Resume tailored (${run.applied ?? 0} lines rewritten)`, { model: run.model, usage: run.usage });
    }
    await sql`update public.auto_applications set tailored_resume_id = ${tailoredId}, updated_at = now() where id = ${id}`;

    // 2. The job board's form.
    let form = app.form;
    if (!form) {
      try {
        form = await fetchForm(app.provider, app.board, app.external_id);
      } catch (err) {
        if (err instanceof FormUnavailableError) {
          await setStatus(id, userId, 'skipped', 'listing_closed', 'The job board no longer accepts applications for this job.');
          return { skipped: 'form gone' };
        }
        throw err;
      }
      await sql`update public.auto_applications set form = ${sql.json(form as never)}, updated_at = now() where id = ${id}`;
      await logEvent(id, userId, 'form', `Read the application form (${form.length} questions)`);
    }

    // 3. The answers.
    const [ctx] = await sql<{ profile: Partial<ApplicationProfile> | null; resume_profile: ResumeProfile | null; resume_text: string; file_name: string | null }[]>`
      select p.data as profile, r.parsed_json as resume_profile, r.text as resume_text, t.file_name
      from public.resumes r
      left join public.application_profiles p on p.user_id = r.user_id
      left join public.tailored_resumes t on t.id = ${tailoredId}
      where r.user_id = ${userId} order by r.created_at desc limit 1`;
    const { answers, missing, usage } = await answerForm(form, {
      profile: { ...EMPTY_APPLICATION_PROFILE, ...ctx.profile },
      resume: ctx.resume_profile,
      resumeText: ctx.resume_text,
      job: { title: app.title, company: app.company, location: app.location ?? '', description: app.description ?? '' },
      resumeFileName: ctx.file_name ?? 'Resume.pdf',
      model,
    });
    await sql`
      update public.auto_applications
      set answers = ${sql.json(answers as never)}, missing = ${missing.map((q) => q.key)}, updated_at = now()
      where id = ${id}`;
    await logEvent(id, userId, 'answered', `Answered ${answers.filter((a) => a.value !== null).length} of ${form.length} questions`, {
      model,
      usage,
      sources: countSources(answers),
    });

    if (missing.length) {
      const list = missing.map((q) => q.label).slice(0, 3).join('; ');
      await setStatus(id, userId, 'pending', 'needs_answers', `Needs your answer: ${list}${missing.length > 3 ? ` and ${missing.length - 3} more` : ''}`);
      await notifyAttention(userId);
      return { pending: missing.length };
    }
    await setStatus(id, userId, 'prepared', null, null);
    return { prepared: true, questions: form.length };
  } catch (err) {
    if (err instanceof UnrecoverableError || lastAttempt) {
      await setStatus(id, userId, 'failed', 'form_unavailable', `Preparation failed: ${(err as Error).message.slice(0, 200)}`);
    } else {
      await logEvent(id, userId, 'retry', `Attempt ${job.attemptsMade + 1} failed; retrying`, { error: (err as Error).message.slice(0, 500) });
    }
    throw err;
  }
}

function countSources(answers: PreparedAnswer[]) {
  const out: Record<string, number> = {};
  for (const a of answers) if (a.value !== null) out[a.source] = (out[a.source] ?? 0) + 1;
  return out;
}

/** At most one "applications need you" email a day, sent a little later so it covers the whole batch. */
export async function notifyAttention(userId: string) {
  const [u] = await sql<{ email: string | null; name: string | null; day: string }[]>`
    select u.email, p.data->>'firstName' as name, to_char((now() at time zone coalesce(s.timezone, 'UTC'))::date, 'YYYY-MM-DD') as day
    from public.users u
    left join public.application_profiles p on p.user_id = u.id
    left join public.auto_apply_settings s on s.user_id = u.id
    where u.id = ${userId}`;
  if (!u?.email) return;
  await queue.add(
    'autoapply.notify',
    { userId },
    { jobId: `notify-${userId}-${u.day}`, delay: 30 * 60_000, removeOnComplete: { age: 2 * 24 * 3600 }, removeOnFail: { age: 2 * 24 * 3600 } },
  );
}

const ATTENTION_LABELS: Partial<Record<AutoApplyReason, string>> = {
  needs_answers: 'Need your answers',
  captcha: 'Need a CAPTCHA check',
  login_required: 'Need you to sign in to the job board',
  unverified: 'Need you to confirm they were sent',
};

async function notify(userId: string) {
  const [u] = await sql<{ email: string | null; name: string | null }[]>`
    select u.email, p.data->>'firstName' as name from public.users u
    left join public.application_profiles p on p.user_id = u.id where u.id = ${userId}`;
  const rows = await sql<{ reason_code: AutoApplyReason; n: number }[]>`
    select reason_code, count(*)::int as n from public.auto_applications
    where user_id = ${userId} and status = 'pending' and reason_code <> 'submitting' group by 1`;
  if (!u?.email || !rows.length) return { skipped: 'nothing waiting' };
  await emailQueue.add(
    'autoApplyAttention',
    {
      template: 'autoApplyAttention',
      to: u.email,
      props: {
        name: u.name ?? '',
        appUrl: env.APP_URL,
        jobsUrl: env.JOBS_URL,
        waiting: rows.map((r) => [ATTENTION_LABELS[r.reason_code] ?? 'Need you', String(r.n)] as [string, string]),
      },
    },
    { jobId: `aa-attention-${userId}-${new Date().toISOString().slice(0, 10)}` },
  );
  return { emailed: rows.reduce((n, r) => n + r.n, 0) };
}

// ---- worker --------------------------------------------------------------------------------------

export function startAutoApplyWorker() {
  void queue
    .upsertJobScheduler('autoapply-tick', { pattern: '*/10 * * * *' }, { name: 'autoapply.tick', data: {} })
    .catch((err) => console.error('[autoapply] could not schedule the tick:', err.message));

  const worker = new Worker(
    AUTO_APPLY_QUEUE,
    async (job) => {
      switch (job.name) {
        case 'autoapply.tick':
          return tick();
        case 'autoapply.plan':
          return planUser(job.data.userId);
        case 'autoapply.prepare':
          return prepare(job as Job<{ applicationId: string }>);
        case 'autoapply.notify':
          return notify(job.data.userId);
        default:
          throw new UnrecoverableError(`No processor for job "${job.name}"`);
      }
    },
    // Preparation is mostly waiting on the model and job boards; scale out with more worker processes.
    { connection, concurrency: 6 },
  );
  worker.on('completed', (job, result) => {
    if (job.name !== 'autoapply.tick' || Object.values(result ?? {}).some((v) => v)) {
      console.log(`[autoapply] ${job.name} #${job.id} done`, JSON.stringify(result));
    }
  });
  worker.on('failed', (job, err) => console.error(`[autoapply] ${job?.name} #${job?.id} failed (attempt ${job?.attemptsMade}):`, err.message));
  return worker;
}

export const closeAutoApplyQueue = () => Promise.all([queue.close(), emailQueue.close()]);
