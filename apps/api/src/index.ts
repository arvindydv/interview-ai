import Fastify from 'fastify';
import cors from '@fastify/cors';
import sensible from '@fastify/sensible';
import websocket from '@fastify/websocket';
import { Agent, setGlobalDispatcher } from 'undici';
import { env } from './env.js';
import { sql } from './lib/db.js';
import { redis } from './lib/redis.js';
import { emailQueue, historyQueue, matchesQueue, practiceQueue, profileQueue, systemQueue, systemQueueEvents } from './lib/queues.js';
import healthRoutes from './routes/health.js';
import meRoutes from './routes/me.js';
import emailCheckRoutes from './routes/emailCheck.js';
import jobRoutes from './routes/jobs.js';
import liveRoutes from './routes/live.js';
import profileRoutes from './routes/profile.js';
import interviewRoutes from './routes/interviews.js';
import practiceRoutes from './routes/practice.js';
import historyRoutes from './routes/history.js';
import settingsRoutes from './routes/settings.js';
import billingRoutes, { billingWebhookRoutes } from './routes/billing.js';
import reportRoutes from './routes/reports.js';
import listingRoutes from './routes/listings.js';
import jobFeedRoutes from './routes/jobFeed.js';
import autoApplyRoutes from './routes/autoApply.js';
import jobResumeRoutes from './routes/jobResumes.js';
import adminAuthRoutes from './routes/admin/auth.js';
import adminOverviewRoutes from './routes/admin/overview.js';
import adminUserRoutes from './routes/admin/users.js';
import adminReportRoutes from './routes/admin/reports.js';

// Keep HTTPS connections (Deepgram, OpenRouter, Claude) open between requests. With the default 4 s,
// every practice interviewer turn paid a fresh TLS handshake (about 1 s from Mumbai) on each service.
setGlobalDispatcher(new Agent({ keepAliveTimeout: 60_000, keepAliveMaxTimeout: 10 * 60_000 }));

const app = Fastify({
  logger: { level: env.NODE_ENV === 'production' ? 'info' : 'debug' },
  // Real client IPs behind Caddy, for the free-trial network limit and the admin login rate limit.
  trustProxy: (_address: string, hop: number) => hop < env.TRUST_PROXY,
});

await app.register(cors, {
  origin: env.CORS_ORIGINS.split(',').map((o) => o.trim()),
  // The plugin's default is only GET, HEAD and POST; the website also edits and deletes.
  methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'],
  credentials: true,
});
await app.register(sensible);
// Room for a question with the maximum number of screenshots (see IMAGE_LIMITS).
await app.register(websocket, { options: { maxPayload: 32 * 1024 * 1024 } });

await app.register(healthRoutes);
await app.register(meRoutes);
await app.register(emailCheckRoutes);
await app.register(jobRoutes);
await app.register(liveRoutes);
await app.register(profileRoutes);
await app.register(interviewRoutes);
await app.register(practiceRoutes);
await app.register(historyRoutes);
await app.register(settingsRoutes);
await app.register(billingRoutes);
await app.register(billingWebhookRoutes);
await app.register(reportRoutes);
await app.register(listingRoutes);
await app.register(jobFeedRoutes);
await app.register(autoApplyRoutes);
await app.register(jobResumeRoutes);
await app.register(adminAuthRoutes);
await app.register(adminOverviewRoutes);
await app.register(adminUserRoutes);
await app.register(adminReportRoutes);

const shutdown = async () => {
  await app.close();
  await Promise.allSettled([sql.end(), redis.quit(), systemQueue.close(), systemQueueEvents.close(), emailQueue.close(), profileQueue.close(), practiceQueue.close(), historyQueue.close(), matchesQueue.close()]);
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen({ port: env.PORT, host: env.HOST });
