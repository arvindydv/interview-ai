import type { FastifyInstance } from 'fastify';
import type { HealthReport } from '@parakeet/shared';
import { sql } from '../lib/db.js';
import { redis } from '../lib/redis.js';
import { env } from '../env.js';

async function timed(fn: () => Promise<unknown>) {
  const start = performance.now();
  try {
    await fn();
    return { ok: true, latencyMs: Math.round(performance.now() - start) };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export async function healthReport(): Promise<HealthReport> {
  const [postgres, redisCheck, auth] = await Promise.all([
    timed(() => sql`select 1`),
    timed(() => redis.ping()),
    timed(async () => {
      const res = await fetch(`${env.SUPABASE_URL}/auth/v1/health`, {
        signal: AbortSignal.timeout(2000),
      });
      if (!res.ok && res.status !== 401) throw new Error(`HTTP ${res.status}`);
    }),
  ]);
  const checks = { postgres, redis: redisCheck, auth };
  const ok = Object.values(checks).every((c) => c.ok);
  // GIT_SHA is set in the Docker image, so a deploy can check that the new build is the one serving.
  return { ok, version: process.env.GIT_SHA ?? process.env.npm_package_version ?? '0.0.0', checks };
}

export default async function healthRoutes(app: FastifyInstance) {
  // Liveness for the container healthcheck: the process is up and serving. Unlike /health it doesn't
  // touch Postgres, Redis or Auth, so an outage there doesn't get healthy containers restarted.
  app.get('/livez', async () => ({ ok: true }));

  app.get('/health',async (_req, reply): Promise<HealthReport> => {
    const report = await healthReport();
    reply.code(report.ok ? 200 : 503);
    return report;
  });
}
