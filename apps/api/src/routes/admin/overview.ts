import type { FastifyInstance } from 'fastify';
import type { Queue } from 'bullmq';
import { ROUND_TYPES, type AdminOverview, type AdminSystem, type Breakdown, type DayPoint, type QueueStats } from '@parakeet/shared';
import { env } from '../../env.js';
import { audit, requireAdmin } from '../../lib/adminAuth.js';
import { sql } from '../../lib/db.js';
import { connectionCount, onlineUserIds } from '../../lib/liveRegistry.js';
import { llmConfigured } from '../../lib/llm.js';
import { emailQueue, profileQueue, systemQueue } from '../../lib/queues.js';
import { getSettings } from '../../lib/settings.js';
import { healthReport } from '../health.js';

const SERIES_DAYS = 30;

/** Turns sparse per-day counts into a dense series ending today (UTC), zero-filled. */
export function fillDays(rows: { day: string; n: number }[], days = SERIES_DAYS): DayPoint[] {
  const byDay = new Map(rows.map((r) => [r.day, r.n]));
  const out: DayPoint[] = [];
  const today = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - i));
    const day = d.toISOString().slice(0, 10);
    out.push({ day, value: byDay.get(day) ?? 0 });
  }
  return out;
}

const queues: Record<string, Queue> = { system: systemQueue, email: emailQueue, profile: profileQueue };

export default async function adminOverviewRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAdmin);

  app.get('/admin/overview', async (): Promise<AdminOverview> => {
    // Start of the first day in the series (UTC midnight).
    const since = sql`(date_trunc('day', now() at time zone 'utc') - make_interval(days => ${SERIES_DAYS - 1})) at time zone 'utc'`;
    const utcDay = (col: string) => sql`to_char((${sql(col)} at time zone 'utc')::date, 'YYYY-MM-DD')`;

    const [[k], signups, questions, activeUsers, plans, os, fields, rounds, models, turnStatus, [funnel]] = await Promise.all([
      sql<
        {
          total_users: number; new_users_7d: number; new_users_prev_7d: number; active_today: number; active_7d: number;
          active_30d: number; questions_today: number; questions_7d: number; questions_prev_7d: number; tokens_in_30d: string;
          tokens_out_30d: string; avg_ttft_7d: number | null; turns_7d: number; errors_7d: number; suspended: number;
        }[]
      >`
        select
          (select count(*)::int from public.users) as total_users,
          (select count(*)::int from public.users where created_at >= now() - interval '7 days') as new_users_7d,
          (select count(*)::int from public.users where created_at >= now() - interval '14 days' and created_at < now() - interval '7 days') as new_users_prev_7d,
          (select count(distinct user_id)::int from public.live_sessions where connected_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc') as active_today,
          (select count(distinct user_id)::int from public.live_sessions where connected_at >= now() - interval '7 days') as active_7d,
          (select count(distinct user_id)::int from public.live_sessions where connected_at >= now() - interval '30 days') as active_30d,
          (select count(*)::int from public.live_turns where status <> 'blocked' and created_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc') as questions_today,
          (select count(*)::int from public.live_turns where status <> 'blocked' and created_at >= now() - interval '7 days') as questions_7d,
          (select count(*)::int from public.live_turns where status <> 'blocked' and created_at >= now() - interval '14 days' and created_at < now() - interval '7 days') as questions_prev_7d,
          (select coalesce(sum(tokens_in), 0) from public.live_turns where created_at >= now() - interval '30 days') as tokens_in_30d,
          (select coalesce(sum(tokens_out), 0) from public.live_turns where created_at >= now() - interval '30 days') as tokens_out_30d,
          (select round(avg(ttft_ms))::int from public.live_turns where status = 'done' and created_at >= now() - interval '7 days') as avg_ttft_7d,
          (select count(*)::int from public.live_turns where status in ('done', 'error') and created_at >= now() - interval '7 days') as turns_7d,
          (select count(*)::int from public.live_turns where status = 'error' and created_at >= now() - interval '7 days') as errors_7d,
          (select count(*)::int from public.users where status = 'suspended') as suspended`,
      sql<{ day: string; n: number }[]>`
        select ${utcDay('created_at')} as day, count(*)::int as n from public.users where created_at >= ${since} group by 1`,
      sql<{ day: string; n: number }[]>`
        select ${utcDay('created_at')} as day, count(*)::int as n from public.live_turns
        where status <> 'blocked' and created_at >= ${since} group by 1`,
      sql<{ day: string; n: number }[]>`
        select ${utcDay('connected_at')} as day, count(distinct user_id)::int as n from public.live_sessions
        where connected_at >= ${since} group by 1`,
      sql<Breakdown[]>`select plan as label, count(*)::int as value from public.users group by 1 order by 2 desc`,
      sql<Breakdown[]>`
        select os as label, count(*)::int as value from public.devices group by 1 order by 2 desc limit 8`,
      // Current (latest) interview per user.
      sql<Breakdown[]>`
        select coalesce(nullif(field, ''), 'Not set') as label, count(*)::int as value
        from (select distinct on (user_id) field from public.interview_sessions order by user_id, updated_at desc) i
        group by 1 order by 2 desc limit 8`,
      sql<Breakdown[]>`
        select round_type as label, count(*)::int as value
        from (select distinct on (user_id) round_type from public.interview_sessions order by user_id, updated_at desc) i
        group by 1 order by 2 desc`,
      sql<Breakdown[]>`
        select coalesce(model, 'unknown') as label, count(*)::int as value from public.live_turns
        where status <> 'blocked' and created_at >= now() - interval '30 days' group by 1 order by 2 desc limit 6`,
      sql<Breakdown[]>`
        select status as label, count(*)::int as value from public.live_turns
        where created_at >= now() - interval '30 days' group by 1 order by 2 desc`,
      sql<{ users: number; devices: number; resumes: number; interviews: number; asked: number }[]>`
        select
          (select count(*)::int from public.users) as users,
          (select count(distinct user_id)::int from public.devices) as devices,
          (select count(distinct user_id)::int from public.resumes) as resumes,
          (select count(distinct user_id)::int from public.interview_sessions) as interviews,
          (select count(distinct user_id)::int from public.live_turns where status = 'done') as asked`,
    ]);

    const roundLabel = (id: string) => ROUND_TYPES.find((r) => r.id === id)?.label ?? id;

    return {
      kpis: {
        totalUsers: k.total_users,
        newUsers7d: k.new_users_7d,
        newUsersPrev7d: k.new_users_prev_7d,
        activeToday: k.active_today,
        active7d: k.active_7d,
        active30d: k.active_30d,
        liveNow: onlineUserIds().size,
        questionsToday: k.questions_today,
        questions7d: k.questions_7d,
        questionsPrev7d: k.questions_prev_7d,
        tokensIn30d: Number(k.tokens_in_30d),
        tokensOut30d: Number(k.tokens_out_30d),
        avgTtftMs7d: k.avg_ttft_7d,
        errorRate7d: k.turns_7d ? k.errors_7d / k.turns_7d : 0,
        suspendedUsers: k.suspended,
      },
      series: {
        signups: fillDays(signups),
        questions: fillDays(questions),
        activeUsers: fillDays(activeUsers),
      },
      breakdowns: {
        plans: [...plans],
        os: [...os],
        fields: [...fields],
        rounds: rounds.map((r) => ({ label: roundLabel(r.label), value: r.value })),
        models: [...models],
        turnStatus: [...turnStatus],
      },
      funnel: [
        { label: 'Signed up', value: funnel.users },
        { label: 'Installed desktop', value: funnel.devices },
        { label: 'Added resume', value: funnel.resumes },
        { label: 'Set up interview', value: funnel.interviews },
        { label: 'Got an answer', value: funnel.asked },
      ],
    };
  });

  app.get('/admin/system', async (): Promise<AdminSystem> => {
    const [health, settings, queueStats] = await Promise.all([
      healthReport(),
      getSettings(),
      Promise.all(
        Object.entries(queues).map(async ([name, q]): Promise<QueueStats> => {
          try {
            const [counts, failed] = await Promise.all([
              q.getJobCounts('waiting', 'active', 'delayed', 'completed', 'failed'),
              q.getFailed(0, 19),
            ]);
            return {
              name,
              counts,
              failed: failed.map((j) => ({
                id: String(j.id),
                name: j.name,
                failedReason: j.failedReason ?? '',
                attemptsMade: j.attemptsMade,
                timestamp: j.timestamp,
              })),
            };
          } catch {
            return { name, counts: {}, failed: [] };
          }
        }),
      ),
    ]);
    return {
      health,
      queues: queueStats,
      liveConnections: connectionCount(),
      llmConfigured: llmConfigured(),
      models: { fast: settings.fastModel || env.LLM_FAST_MODEL, vision: settings.visionModel || env.LLM_VISION_MODEL },
    };
  });

  app.post<{ Params: { name: string } }>('/admin/queues/:name/retry-failed', async (req, reply) => {
    const q = queues[req.params.name];
    if (!q) return reply.code(404).send({ error: 'not_found', message: 'Unknown queue' });
    await q.retryJobs({ state: 'failed' });
    await audit(req, 'queue.retry_failed', req.params.name);
    return { ok: true };
  });

  app.post<{ Params: { name: string } }>('/admin/queues/:name/clean-failed', async (req, reply) => {
    const q = queues[req.params.name];
    if (!q) return reply.code(404).send({ error: 'not_found', message: 'Unknown queue' });
    const removed = await q.clean(0, 10_000, 'failed');
    await audit(req, 'queue.clean_failed', req.params.name, { removed: removed.length });
    return { ok: true, removed: removed.length };
  });
}
