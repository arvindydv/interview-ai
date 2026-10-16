import Fastify from 'fastify';
import cors from '@fastify/cors';
import sensible from '@fastify/sensible';
import websocket from '@fastify/websocket';
import { env } from './env.js';
import { sql } from './lib/db.js';
import { redis } from './lib/redis.js';
import { emailQueue, profileQueue, systemQueue, systemQueueEvents } from './lib/queues.js';
import healthRoutes from './routes/health.js';
import meRoutes from './routes/me.js';
import jobRoutes from './routes/jobs.js';
import liveRoutes from './routes/live.js';
import profileRoutes from './routes/profile.js';
import adminAuthRoutes from './routes/admin/auth.js';
import adminOverviewRoutes from './routes/admin/overview.js';
import adminUserRoutes from './routes/admin/users.js';

const app = Fastify({ logger: { level: env.NODE_ENV === 'production' ? 'info' : 'debug' } });

await app.register(cors, {
  origin: env.CORS_ORIGINS.split(',').map((o) => o.trim()),
  credentials: true,
});
await app.register(sensible);
// Room for a question with the maximum number of screenshots (see IMAGE_LIMITS).
await app.register(websocket, { options: { maxPayload: 32 * 1024 * 1024 } });

await app.register(healthRoutes);
await app.register(meRoutes);
await app.register(jobRoutes);
await app.register(liveRoutes);
await app.register(profileRoutes);
await app.register(adminAuthRoutes);
await app.register(adminOverviewRoutes);
await app.register(adminUserRoutes);

const shutdown = async () => {
  await app.close();
  await Promise.allSettled([sql.end(), redis.quit(), systemQueue.close(), systemQueueEvents.close(), emailQueue.close(), profileQueue.close()]);
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen({ port: env.PORT, host: env.HOST });
