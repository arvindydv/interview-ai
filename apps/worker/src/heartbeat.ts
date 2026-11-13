import { hostname } from 'node:os';
import { Queue } from 'bullmq';
import { redactSensitive } from '@parakeet/shared';
import { env } from './env.js';

// Worker liveness: every 30 s each worker process writes worker:heartbeat:<host>:<pid> (expires after
// 90 s) with the queues it serves. The admin health view (GET /admin/worker-health) lists live ones; no
// key means no worker is running.

export const HEARTBEAT_PREFIX = 'worker:heartbeat:';
const EVERY_MS = 30_000;
const TTL_S = 90;

export function startHeartbeat(queues: string[]) {
  const q = new Queue('system', { connection: { url: env.REDIS_URL } });
  const key = `${HEARTBEAT_PREFIX}${hostname()}:${process.pid}`;
  const startedAt = new Date().toISOString();
  const beat = async () => {
    try {
      const client = await q.getBackend().client;
      const mem = process.memoryUsage();
      await client.set(
        key,
        JSON.stringify({ host: hostname(), pid: process.pid, startedAt, at: new Date().toISOString(), queues, rssMb: Math.round(mem.rss / 1e6) }),
        { EX: TTL_S },
      );
    } catch (err) {
      console.error('[heartbeat]', (err as Error).message);
    }
  };
  void beat();
  const timer = setInterval(beat, EVERY_MS);
  timer.unref();
  return async () => {
    clearInterval(timer);
    try {
      await (await q.getBackend().client).del(key);
    } catch {}
    await q.close();
  };
}

/** Logs crashes without secrets, emails or phone numbers, then lets the process manager restart us. */
export function installCrashLogging() {
  const log = (kind: string) => (err: unknown) => {
    const e = err instanceof Error ? { message: err.message, stack: err.stack } : { message: String(err) };
    console.error(`[worker] ${kind}:`, JSON.stringify(redactSensitive(e)));
  };
  process.on('unhandledRejection', log('unhandledRejection'));
  process.on('uncaughtException', (err) => {
    log('uncaughtException')(err);
    process.exit(1);
  });
}
