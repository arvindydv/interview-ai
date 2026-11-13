import type { FastifyInstance } from 'fastify';
import { Queue } from 'bullmq';
import { redactSensitive } from '@parakeet/shared';
import { requireAdmin } from '../../lib/adminAuth.js';
import { sql } from '../../lib/db.js';
import { redis } from '../../lib/redis.js';
import { env } from '../../env.js';

// GET /admin/worker-health: is the always-on pipeline healthy? Queue depths and failures, live worker
// processes (heartbeats, apps/worker/src/heartbeat.ts), applications stuck mid-way, when the schedulers
// last ran, and alerts for anything past its threshold. Read-only.

/** Every queue the worker serves (submit: API submissions, when that worker runs). */
export const WORKER_QUEUES = [
  'system', 'email', 'profile', 'practice', 'history', 'listings', 'matches', 'discovery', 'tailor', 'autoapply', 'coldemail',
  'submit', 'retention', 'jobbot',
] as const;

/** Thresholds for alerts. */
export const HEALTH_THRESHOLDS = {
  /** No worker heartbeat for this long: nothing is processing. */
  heartbeatMissingS: 90,
  /** Jobs waiting in one queue. */
  backlog: 500,
  /** Failed jobs kept in one queue (BullMQ keeps them a week). */
  failed: 50,
  /** Applications preparing longer than this are stuck (the tick re-queues them at 20). */
  preparingMin: 30,
  /** Submissions claimed longer than this have lost their lease (15 min). */
  submittingMin: 20,
  /** Auto Apply's tick runs every 10 minutes. */
  tickLateMin: 30,
  /** Listings syncs run every 30 minutes. */
  syncLateMin: 120,
} as const;

export interface WorkerHealth {
  at: string;
  workers: { host: string; pid: number; startedAt: string; at: string; queues: string[]; rssMb: number }[];
  queues: { name: string; waiting: number; active: number; delayed: number; failed: number; completed: number }[];
  recentFailures: { queue: string; name: string; id: string | null; reason: string; at: string | null; attempts: number }[];
  stuck: { preparing: number; submitting: number; oldestPreparingMin: number | null; oldestSubmittingMin: number | null };
  schedulers: { autoApplyTickAt: string | null; listingsSyncAt: string | null; listingsSyncFailures24h: number; retentionAt: string | null };
  alerts: { level: 'warning' | 'critical'; message: string }[];
}

let queues: Map<string, Queue> | null = null;
const getQueues = () =>
  (queues ??= new Map(WORKER_QUEUES.map((name) => [name, new Queue(name, { connection: { url: env.REDIS_URL } })])));

async function heartbeats(): Promise<WorkerHealth['workers']> {
  const keys: string[] = [];
  let cursor = '0';
  do {
    const [next, batch] = await redis.scan(cursor, 'MATCH', 'worker:heartbeat:*', 'COUNT', 200);
    cursor = next;
    keys.push(...batch);
  } while (cursor !== '0');
  if (!keys.length) return [];
  const values = await redis.mget(...keys);
  return values.flatMap((v) => {
    try {
      return v ? [JSON.parse(v) as WorkerHealth['workers'][number]] : [];
    } catch {
      return [];
    }
  });
}

export async function workerHealth(): Promise<WorkerHealth> {
  const qs = getQueues();
  const [workers, queueRows, failures, [stuck], [sched]] = await Promise.all([
    heartbeats(),
    Promise.all(
      [...qs].map(async ([name, q]) => {
        const c = await q.getJobCounts('waiting', 'active', 'delayed', 'failed', 'completed');
        return { name, waiting: c.waiting ?? 0, active: c.active ?? 0, delayed: c.delayed ?? 0, failed: c.failed ?? 0, completed: c.completed ?? 0 };
      }),
    ),
    Promise.all(
      [...qs].map(async ([name, q]) =>
        (await q.getJobs(['failed'], 0, 9)).filter(Boolean).map((j) => ({
          queue: name,
          name: j.name,
          id: j.id ?? null,
          // Job data and errors can carry addresses or tokens.
          reason: redactSensitive(String(j.failedReason ?? '')).slice(0, 300),
          at: j.finishedOn ? new Date(j.finishedOn).toISOString() : null,
          attempts: j.attemptsMade,
        })),
      ),
    ),
    sql<{ preparing: number; submitting: number; oldest_preparing: number | null; oldest_submitting: number | null }[]>`
      select
        count(*) filter (where status = 'preparing' and updated_at < now() - make_interval(mins => ${HEALTH_THRESHOLDS.preparingMin}))::int as preparing,
        count(*) filter (where status = 'pending' and reason_code = 'submitting' and claimed_at < now() - make_interval(mins => ${HEALTH_THRESHOLDS.submittingMin}))::int as submitting,
        (extract(epoch from now() - min(updated_at) filter (where status = 'preparing')) / 60)::int as oldest_preparing,
        (extract(epoch from now() - min(claimed_at) filter (where status = 'pending' and reason_code = 'submitting')) / 60)::int as oldest_submitting
      from public.auto_applications
      where status in ('preparing', 'pending')`,
    sql<{ tick: Date | null; sync: Date | null; sync_failures: number }[]>`
      select (select max(planned_at) from public.auto_apply_settings) as tick,
             (select max(finished_at) from public.job_source_runs) as sync,
             (select count(*)::int from public.job_source_runs where started_at > now() - interval '24 hours' and ok = false) as sync_failures`,
  ]);

  const retention = await qs.get('retention')!.getJobs(['completed'], 0, 0).catch(() => []);
  const recentFailures = failures.flat().sort((a, b) => (b.at ?? '').localeCompare(a.at ?? '')).slice(0, 25);

  const alerts: WorkerHealth['alerts'] = [];
  const now = Date.now();
  const live = workers.filter((w) => now - Date.parse(w.at) < HEALTH_THRESHOLDS.heartbeatMissingS * 1000);
  if (!live.length) alerts.push({ level: 'critical', message: 'No worker is running (no heartbeat in the last 90 seconds).' });
  for (const q of queueRows) {
    if (q.waiting > HEALTH_THRESHOLDS.backlog) alerts.push({ level: 'warning', message: `${q.name}: ${q.waiting} jobs waiting.` });
    if (q.failed > HEALTH_THRESHOLDS.failed) alerts.push({ level: 'warning', message: `${q.name}: ${q.failed} failed jobs.` });
  }
  if (stuck.preparing) alerts.push({ level: 'warning', message: `${stuck.preparing} applications preparing for over ${HEALTH_THRESHOLDS.preparingMin} minutes.` });
  if (stuck.submitting) alerts.push({ level: 'critical', message: `${stuck.submitting} submissions past their lease: the applier may be down.` });
  const minsAgo = (d: Date | null) => (d ? (now - d.getTime()) / 60_000 : Infinity);
  const [{ enabled }] = await sql<{ enabled: number }[]>`select count(*)::int as enabled from public.auto_apply_settings where enabled`;
  if (enabled && minsAgo(sched.tick) > HEALTH_THRESHOLDS.tickLateMin) alerts.push({ level: 'warning', message: 'Auto Apply hasn’t planned anyone in 30 minutes.' });
  if (minsAgo(sched.sync) > HEALTH_THRESHOLDS.syncLateMin) alerts.push({ level: 'warning', message: 'No listings sync finished in the last 2 hours.' });

  return {
    at: new Date().toISOString(),
    workers,
    queues: queueRows,
    recentFailures,
    stuck: { preparing: stuck.preparing, submitting: stuck.submitting, oldestPreparingMin: stuck.oldest_preparing, oldestSubmittingMin: stuck.oldest_submitting },
    schedulers: {
      autoApplyTickAt: sched.tick?.toISOString() ?? null,
      listingsSyncAt: sched.sync?.toISOString() ?? null,
      listingsSyncFailures24h: sched.sync_failures,
      retentionAt: retention[0]?.finishedOn ? new Date(retention[0].finishedOn).toISOString() : null,
    },
    alerts,
  };
}

export default async function adminWorkerHealthRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAdmin);
  app.get('/admin/worker-health', async (): Promise<WorkerHealth> => workerHealth());
}
