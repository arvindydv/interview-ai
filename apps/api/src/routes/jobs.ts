import type { FastifyInstance } from 'fastify';
import type { PingJobResult } from '@parakeet/shared';
import { requireAuth } from '../lib/auth.js';
import { systemQueue, systemQueueEvents } from '../lib/queues.js';

// Round-trips a job through Redis → apps/worker → back, to prove the background pipeline works.
export default async function jobRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  app.post('/v1/jobs/ping', async (req, reply): Promise<PingJobResult | void> => {
    const job = await systemQueue.add('ping', { userId: req.user.id, queuedAt: Date.now() }, {
      removeOnComplete: 100,
      removeOnFail: 100,
    });
    try {
      const result = await job.waitUntilFinished(systemQueueEvents, 5000);
      return { jobId: job.id!, result };
    } catch {
      return reply.code(504).send({ error: 'worker_timeout', message: 'Is apps/worker running?' });
    }
  });
}
