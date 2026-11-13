import { Queue, UnrecoverableError, Worker } from 'bullmq';
import type postgres from 'postgres';
import { sql } from '../db.js';
import { env } from '../env.js';

// Data retention for Friday Jobs, run daily at 03:30 IST ("retention.run"). Each policy is one bounded SQL
// statement; days are configurable (RETENTION_* in env.ts). What is never removed by retention: submitted
// applications and the exact resume each one was sent with (the candidate can download it from Applied
// Jobs), the confirmation URL of every submission, and anything the candidate asked to keep. Deleting a
// user's account or their Jobs data (apps/api/src/routes/account.ts) removes everything immediately.

export const RETENTION_QUEUE = 'retention';
const connection = { url: env.REDIS_URL };
const queue = new Queue(RETENTION_QUEUE, { connection });

/** Rows touched per statement, so a first run on a big table doesn't hold long locks. */
const BATCH = 5000;

export interface RetentionPolicy {
  id: string;
  /** What is removed and why it's safe, for the docs and the admin console. */
  description: string;
  days: number;
  run: (db: postgres.Sql, days: number) => Promise<number>;
}

export const retentionPolicies = (): RetentionPolicy[] => [
  {
    id: 'auto_apply_event_detail',
    description: 'Auto Apply event details (model usage, raw errors, answer sources) are cleared; the event line itself stays as the application’s history.',
    days: env.RETENTION_EVENT_DETAIL_DAYS,
    run: async (db, days) =>
      (await db`
        update public.auto_apply_events set detail = null
        where id in (select id from public.auto_apply_events where detail is not null and created_at < now() - make_interval(days => ${days}) limit ${BATCH})`).count,
  },
  {
    id: 'evidence_page_text',
    description: 'The page text captured after submitting is cut to its first 200 characters (the confirmation); the confirmation URL is kept for good.',
    days: env.RETENTION_EVIDENCE_TEXT_DAYS,
    run: async (db, days) =>
      (await db`
        update public.auto_applications
        set evidence = jsonb_set(evidence, '{text}', to_jsonb(left(evidence->>'text', 200))) || '{"trimmed": true}'
        where id in (
          select id from public.auto_applications
          where evidence ? 'text' and length(evidence->>'text') > 200
            and coalesce(submitted_at, updated_at) < now() - make_interval(days => ${days})
          limit ${BATCH})`).count,
  },
  {
    id: 'unsent_resume_files',
    description: 'Tailored resume and cover-letter files made for applications that were skipped or failed are deleted (the text stays). Never files of a submitted, pending or assisted application.',
    days: env.RETENTION_UNSENT_RESUME_FILE_DAYS,
    run: async (db, days) =>
      (await db`
        update public.tailored_resumes t set file = null, cover_letter_file = null
        where t.id in (
          select t2.id from public.tailored_resumes t2
          where (t2.file is not null or t2.cover_letter_file is not null)
            and exists (
              select 1 from public.auto_applications a
              where a.tailored_resume_id = t2.id and a.status in ('skipped', 'failed')
                and a.updated_at < now() - make_interval(days => ${days}))
            and not exists (
              select 1 from public.auto_applications a
              where a.tailored_resume_id = t2.id and a.status not in ('skipped', 'failed'))
            and not exists (select 1 from public.job_bot_applications b where b.tailored_resume_id = t2.id)
          limit ${BATCH})`).count,
  },
  {
    id: 'source_runs',
    description: 'Listings sync logs (job_source_runs) are deleted; daily reports keep the aggregates.',
    days: env.RETENTION_SOURCE_RUN_DAYS,
    run: async (db, days) =>
      (await db`
        delete from public.job_source_runs
        where id in (select id from public.job_source_runs where started_at < now() - make_interval(days => ${days}) limit ${BATCH})`).count,
  },
  {
    id: 'audit_logs',
    description: 'Audit log entries are deleted after a little over a year.',
    days: env.RETENTION_AUDIT_LOG_DAYS,
    run: async (db, days) =>
      (await db`
        delete from public.audit_logs
        where id in (select id from public.audit_logs where created_at < now() - make_interval(days => ${days}) limit ${BATCH})`).count,
  },
  {
    id: 'closed_listings',
    description: 'Listings closed this long ago are deleted when no user record points at them (applications, tailored resumes, cold emails, swipes); matches and parsed requirements go with them.',
    days: env.RETENTION_CLOSED_LISTING_DAYS,
    run: async (db, days) =>
      (await db`
        delete from public.job_listings l
        where l.id in (
          select l2.id from public.job_listings l2
          where l2.closed_at < now() - make_interval(days => ${days})
            and not exists (select 1 from public.auto_applications a where a.listing_id = l2.id)
            and not exists (select 1 from public.job_applications j where j.listing_id = l2.id)
            and not exists (select 1 from public.tailored_resumes t where t.listing_id = l2.id)
            and not exists (select 1 from public.cold_emails c where c.listing_id = l2.id)
            and not exists (select 1 from public.job_swipes w where w.listing_id = l2.id)
          limit ${BATCH})`).count,
  },
];

/** Runs every policy once; a failing policy is reported and doesn't stop the others. */
export async function runRetention(db: postgres.Sql = sql) {
  const out: Record<string, number | string> = {};
  for (const p of retentionPolicies()) {
    try {
      out[p.id] = await p.run(db, p.days);
    } catch (err) {
      out[p.id] = `error: ${(err as Error).message.slice(0, 200)}`;
    }
  }
  return out;
}

export function startRetentionWorker() {
  void queue
    .upsertJobScheduler('retention-daily', { pattern: '30 3 * * *', tz: 'Asia/Kolkata' }, { name: 'retention.run', data: {} })
    .catch((err) => console.error('[retention] could not schedule:', err.message));
  const worker = new Worker(
    RETENTION_QUEUE,
    async (job) => {
      if (job.name === 'retention.run') return runRetention();
      throw new UnrecoverableError(`No processor for job "${job.name}"`);
    },
    { connection, concurrency: 1 },
  );
  worker.on('completed', (job, result) => console.log(`[retention] ${job.name} #${job.id} done`, JSON.stringify(result)));
  worker.on('failed', (job, err) => console.error(`[retention] ${job?.name} #${job?.id} failed:`, err.message));
  return worker;
}

export const closeRetentionQueue = () => queue.close();
