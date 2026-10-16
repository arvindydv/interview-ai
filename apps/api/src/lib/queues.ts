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
