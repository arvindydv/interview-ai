import { Queue, QueueEvents } from 'bullmq';
import type { EmailJob } from '@parakeet/emails';
import { env } from '../env.js';

// Queue names are shared with apps/worker.
export const SYSTEM_QUEUE = 'system';

const connection = { url: env.REDIS_URL };
export const systemQueue = new Queue(SYSTEM_QUEUE, { connection });
export const systemQueueEvents = new QueueEvents(SYSTEM_QUEUE, { connection });

// Product emails, rendered and sent by apps/worker. Auth emails (codes, links) are sent by Supabase.
export const emailQueue = new Queue<EmailJob>('email', {
  connection,
  defaultJobOptions: {
    attempts: 6,
    backoff: { type: 'exponential', delay: 15_000 }, // 15 s, 30 s, 1 min, 2 min, 4 min
    removeOnComplete: { age: 7 * 24 * 3600 },
    removeOnFail: { age: 30 * 24 * 3600 },
  },
});

// Resume analysis (spec A2), run by apps/worker. Job name "resume.parse", data { resumeId }.
export const PROFILE_QUEUE = 'profile';
export const profileQueue = new Queue<{ resumeId: string }>(PROFILE_QUEUE, {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5_000 },
    removeOnComplete: { age: 24 * 3600 },
    removeOnFail: { age: 7 * 24 * 3600 },
  },
});

// Mock interview debriefs (spec F2), run by apps/worker. Job "practice.score", data { sessionId }.
export const PRACTICE_QUEUE = 'practice';
export const practiceQueue = new Queue<{ sessionId: string }>(PRACTICE_QUEUE, {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 3_000 },
    removeOnComplete: { age: 24 * 3600 },
    removeOnFail: { age: 7 * 24 * 3600 },
  },
});

// History (spec G2/G3), run by apps/worker: "history.summary" { sessionId } writes a post-interview
// summary; "history.purge" { userId? } clears question and answer text past the retention setting (also
// run hourly by the worker for everyone).
export const HISTORY_QUEUE = 'history';
export const historyQueue = new Queue<{ sessionId?: string; userId?: string }>(HISTORY_QUEUE, {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5_000 },
    removeOnComplete: { age: 24 * 3600 },
    removeOnFail: { age: 7 * 24 * 3600 },
  },
});

/**
 * Queues an email. `dedupeKey` becomes the job ID, so retried requests can't send it twice.
 * Never throws: email is best-effort and must not fail the request that triggered it.
 */
export async function sendEmail(job: EmailJob, dedupeKey: string, log: { error: (o: object, m: string) => void }) {
  try {
    await emailQueue.add(job.template, job, { jobId: dedupeKey });
  } catch (err) {
    log.error({ err, template: job.template }, 'failed to enqueue email');
  }
}

// Friday Jobs matches, run by apps/worker: "matches.refresh" { userId } rescores listings for one user.
export const MATCHES_QUEUE = 'matches';
export const matchesQueue = new Queue<{ userId: string }>(MATCHES_QUEUE, { connection });

/** Queues a match refresh; one already waiting for this user absorbs it. Never throws. */
export async function refreshMatches(userId: string, log: { error: (o: object, m: string) => void }) {
  try {
    await matchesQueue.add('matches.refresh', { userId }, {
      jobId: `refresh-${userId}`,
      removeOnComplete: true,
      removeOnFail: { age: 24 * 3600 },
    });
  } catch (err) {
    log.error({ err }, 'failed to enqueue match refresh');
  }
}
