import { hostname } from 'node:os';
import { Worker, type Job } from 'bullmq';
import { env } from '../env.js';

const processors: Record<string, (job: Job) => Promise<unknown>> = {
  async ping(job) {
    return { pong: true, processedBy: `worker@${hostname()}`, queuedMs: Date.now() - job.data.queuedAt };
  },
};

export function startSystemWorker() {
  const worker = new Worker(
    'system',
    async (job) => {
      const run = processors[job.name];
      if (!run) throw new Error(`No processor for job "${job.name}"`);
      return run(job);
    },
    { connection: { url: env.REDIS_URL }, concurrency: 5 },
  );
  worker.on('failed', (job, err) => console.error(`[system] ${job?.name} #${job?.id} failed:`, err.message));
  return worker;
}
