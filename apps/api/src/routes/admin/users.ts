import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type {
  AdminInterviewRow, AdminTurn, AdminUserDetail, AdminUserRow, FreeTrialStatus, Paged, TurnStatus, UserStatus,
} from '@parakeet/shared';
import { audit, requireAdmin } from '../../lib/adminAuth.js';
import { forgetUserStatus } from '../../lib/auth.js';
import { sql } from '../../lib/db.js';
import { disconnectUser, onlineUserIds } from '../../lib/liveRegistry.js';
import { profileQueue } from '../../lib/queues.js';
import { fillDays } from './overview.js';

const PAGE_SIZE = 25;
const LIST_ANSWER_CHARS = 280;
const uuid = z.uuid();

/** `%` and `_` are wildcards in ILIKE; match them literally in user input. */
const likePattern = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
const pageOf = (raw?: string) => Math.max(1, Math.min(10_000, Number(raw) || 1));

interface UserRow {
  id: string;
  email: string;
  auth_provider: string;
  plan: string;
  status: UserStatus;
  created_at: Date;
  last_active_at: Date | null;
  last_sign_in_at: Date | null;
  devices: number;
  questions: number;
  has_resume: boolean;
}

const toUserRow = (r: UserRow, online: Set<string>): AdminUserRow => ({
  id: r.id,
  email: r.email,
  authProvider: r.auth_provider,
  plan: r.plan,
  status: r.status,
  createdAt: r.created_at.toISOString(),
  lastActiveAt: r.last_active_at?.toISOString() ?? null,
  lastSignInAt: r.last_sign_in_at?.toISOString() ?? null,
  devices: r.devices,
  questions: r.questions,
  hasResume: r.has_resume,
  online: online.has(r.id),
});

interface TurnRow {
  id: string;
  user_id: string;
  email: string;
  live_session_id: string | null;
  question: string;
  answer: string;
  image_count: number;
  field: string;
  company: string;
  role: string;
  has_resume: boolean;
  model: string | null;
  tier: string | null;
  status: TurnStatus;
  error_code: string | null;
  tokens_in: number;
  tokens_out: number;
  ttft_ms: number | null;
  duration_ms: number | null;
  created_at: Date;
}

const toTurn = (r: TurnRow): AdminTurn => ({
  id: r.id,
  userId: r.user_id,
  userEmail: r.email,
  liveSessionId: r.live_session_id,
  question: r.question,
  answer: r.answer,
  imageCount: r.image_count,
  field: r.field,
  company: r.company,
  role: r.role,
  hasResume: r.has_resume,
  model: r.model,
  tier: r.tier,
  status: r.status,
  errorCode: r.error_code,
  tokensIn: r.tokens_in,
  tokensOut: r.tokens_out,
  ttftMs: r.ttft_ms,
  durationMs: r.duration_ms,
  createdAt: r.created_at.toISOString(),
});

const TURN_LIST_COLUMNS = sql`
  t.id, t.user_id, u.email, t.live_session_id, t.question, left(t.answer, ${LIST_ANSWER_CHARS}) as answer, t.image_count,
  t.field, t.company, t.role, t.has_resume, t.model, t.tier, t.status, t.error_code, t.tokens_in, t.tokens_out,
  t.ttft_ms, t.duration_ms, t.created_at`;

interface InterviewRow {
  id: string;
  user_id: string;
  email: string;
  field: string;
  company: string;
  role: string;
  round_type: string;
  jd_chars: number;
  created_at: Date;
  updated_at: Date;
}

const toInterview = (r: InterviewRow): AdminInterviewRow => ({
  id: r.id,
  userId: r.user_id,
  userEmail: r.email,
  field: r.field,
  company: r.company,
  role: r.role,
  roundType: r.round_type,
  jdChars: r.jd_chars,
  createdAt: r.created_at.toISOString(),
  updatedAt: r.updated_at.toISOString(),
});

const userPatch = z.object({
  plan: z.string().trim().min(1).max(40).regex(/^[a-z0-9_-]+$/, 'Plan must be lowercase letters, digits, - or _').optional(),
  status: z.enum(['active', 'suspended']).optional(),
  adminNote: z.string().max(2000).optional(),
});

export default async function adminUserRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAdmin);

  // ---- Users -------------------------------------------------------------------------------

  app.get<{ Querystring: { q?: string; plan?: string; status?: string; sort?: string; page?: string } }>(
    '/admin/users',
    async (req): Promise<Paged<AdminUserRow>> => {
      const q = (req.query.q ?? '').trim();
      const plan = req.query.plan ?? '';
      const status = req.query.status ?? '';
      const page = pageOf(req.query.page);
      const order = {
        questions: sql`questions desc, u.created_at desc`,
        active: sql`u.last_active_at desc nulls last`,
        email: sql`u.email asc`,
      }[req.query.sort ?? ''] ?? sql`u.created_at desc`;

      const rows = await sql<(UserRow & { total: number })[]>`
        select u.id, u.email, u.auth_provider, public.current_plan(u.plan, u.plan_expires_at) as plan, u.status, u.created_at, u.last_active_at, a.last_sign_in_at,
          (select count(*)::int from public.devices d where d.user_id = u.id) as devices,
          (select count(*)::int from public.live_turns t where t.user_id = u.id and t.status <> 'blocked') as questions,
          exists (select 1 from public.resumes r where r.user_id = u.id) as has_resume,
          count(*) over()::int as total
        from public.users u
        left join auth.users a on a.id = u.id
        where (${q} = '' or u.email ilike ${likePattern(q)} or u.id::text = ${q})
          and (${plan} = '' or public.current_plan(u.plan, u.plan_expires_at) = ${plan})
          and (${status} = '' or u.status = ${status})
        order by ${order}
        limit ${PAGE_SIZE} offset ${(page - 1) * PAGE_SIZE}`;
      const online = onlineUserIds();
      return { rows: rows.map((r) => toUserRow(r, online)), total: rows[0]?.total ?? 0, page, pageSize: PAGE_SIZE };
    },
  );

  app.get<{ Params: { id: string } }>('/admin/users/:id', async (req, reply): Promise<AdminUserDetail | void> => {
    const id = req.params.id;
    if (!uuid.safeParse(id).success) return reply.code(404).send({ error: 'not_found', message: 'No such user' });

    const [[user], [stats], devices, [resume], interviews, sessions, turns, activity, minutes, sameComputer] = await Promise.all([
      sql<(UserRow & {
        admin_note: string; email_confirmed_at: Date | null; trial_seconds: number; trial_used_seconds: number;
        trial_status: FreeTrialStatus;
      })[]>`
        select u.id, u.email, u.auth_provider, public.current_plan(u.plan, u.plan_expires_at) as plan, u.status, u.created_at, u.last_active_at, u.admin_note,
          u.trial_seconds, u.trial_used_seconds, u.trial_status,
          a.last_sign_in_at, a.email_confirmed_at,
          (select count(*)::int from public.devices d where d.user_id = u.id) as devices,
          (select count(*)::int from public.live_turns t where t.user_id = u.id and t.status <> 'blocked') as questions,
          exists (select 1 from public.resumes r where r.user_id = u.id) as has_resume
        from public.users u left join auth.users a on a.id = u.id
        where u.id = ${id}`,
      sql<{
        questions: number; questions_7d: number; questions_today: number; tokens_in: string; tokens_out: string;
        sessions: number; session_seconds: number; session_seconds_7d: number; avg_ttft: number | null;
      }[]>`
        select
          count(*) filter (where status <> 'blocked')::int as questions,
          count(*) filter (where status <> 'blocked' and created_at >= now() - interval '7 days')::int as questions_7d,
          count(*) filter (where status <> 'blocked' and created_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc')::int as questions_today,
          coalesce(sum(tokens_in), 0) as tokens_in,
          coalesce(sum(tokens_out), 0) as tokens_out,
          (select count(*)::int from public.live_sessions s where s.user_id = ${id}) as sessions,
          (select coalesce(sum(seconds), 0)::int from public.live_sessions s where s.user_id = ${id}) as session_seconds,
          (select coalesce(sum(seconds), 0)::int from public.live_sessions s
            where s.user_id = ${id} and s.connected_at >= now() - interval '7 days') as session_seconds_7d,
          round(avg(ttft_ms) filter (where status = 'done'))::int as avg_ttft
        from public.live_turns where user_id = ${id}`,
      sql<{ id: string; os: string; os_version: string | null; app_version: string | null; last_seen: Date }[]>`
        select id, os, os_version, app_version, last_seen from public.devices where user_id = ${id} order by last_seen desc`,
      sql<{ id: string; file_name: string; status: string; error: string | null; char_count: number; parsed_json: unknown; created_at: Date }[]>`
        select id, file_name, status, error, length(text) as char_count, parsed_json, created_at
        from public.resumes where user_id = ${id} order by created_at desc limit 1`,
      sql<InterviewRow[]>`
        select i.id, i.user_id, u.email, i.field, i.company, i.role, i.round_type, length(i.jd_text) as jd_chars, i.created_at, i.updated_at
        from public.interview_sessions i join public.users u on u.id = i.user_id
        where i.user_id = ${id} order by i.updated_at desc limit 20`,
      sql<{
        id: string; client_session_id: string; connected_at: Date; disconnected_at: Date | null; turns: number;
        seconds: number; trial_seconds: number;
      }[]>`
        select s.id, s.client_session_id, s.connected_at, s.disconnected_at, s.seconds, s.trial_seconds,
          (select count(*)::int from public.live_turns t where t.live_session_id = s.id) as turns
        from public.live_sessions s where s.user_id = ${id} order by s.connected_at desc limit 50`,
      sql<TurnRow[]>`
        select ${TURN_LIST_COLUMNS}
        from public.live_turns t join public.users u on u.id = t.user_id
        where t.user_id = ${id} order by t.created_at desc limit 25`,
      sql<{ day: string; n: number }[]>`
        select to_char((created_at at time zone 'utc')::date, 'YYYY-MM-DD') as day, count(*)::int as n
        from public.live_turns
        where user_id = ${id} and status <> 'blocked'
          and created_at >= (date_trunc('day', now() at time zone 'utc') - interval '29 days') at time zone 'utc'
        group by 1`,
      sql<{ day: string; n: number }[]>`
        select to_char((connected_at at time zone 'utc')::date, 'YYYY-MM-DD') as day, round(sum(seconds) / 60.0, 1)::float8 as n
        from public.live_sessions
        where user_id = ${id}
          and connected_at >= (date_trunc('day', now() at time zone 'utc') - interval '29 days') at time zone 'utc'
        group by 1`,
      sql<{ id: string; email: string; created_at: Date; trial_status: FreeTrialStatus }[]>`
        select distinct u.id, u.email, u.created_at, u.trial_status
        from public.devices mine
        join public.devices other on other.machine_hash = mine.machine_hash and other.user_id <> mine.user_id
        join public.users u on u.id = other.user_id
        where mine.user_id = ${id} and mine.machine_hash is not null
        order by u.created_at desc limit 50`,
    ]);
    if (!user) return reply.code(404).send({ error: 'not_found', message: 'No such user' });

    return {
      user: {
        ...toUserRow(user, onlineUserIds()),
        adminNote: user.admin_note,
        emailConfirmedAt: user.email_confirmed_at?.toISOString() ?? null,
      },
      stats: {
        questions: stats.questions,
        questions7d: stats.questions_7d,
        questionsToday: stats.questions_today,
        tokensIn: Number(stats.tokens_in),
        tokensOut: Number(stats.tokens_out),
        sessions: stats.sessions,
        sessionSeconds: stats.session_seconds,
        sessionSeconds7d: stats.session_seconds_7d,
        avgTtftMs: stats.avg_ttft,
      },
      trial: { totalSeconds: user.trial_seconds, usedSeconds: user.trial_used_seconds },
      trialStatus: user.trial_status,
      sameComputer: sameComputer.map((u) => ({ id: u.id, email: u.email, createdAt: u.created_at.toISOString(), trialStatus: u.trial_status })),
      minutes: fillDays(minutes),
      devices: devices.map((d) => ({
        id: d.id, os: d.os, osVersion: d.os_version, appVersion: d.app_version, lastSeen: d.last_seen.toISOString(),
      })),
      resume: resume
        ? {
            id: resume.id, fileName: resume.file_name, status: resume.status, error: resume.error,
            charCount: resume.char_count, profile: resume.parsed_json, createdAt: resume.created_at.toISOString(),
          }
        : null,
      interviews: interviews.map(toInterview),
      sessions: sessions.map((s) => ({
        id: s.id,
        clientSessionId: s.client_session_id,
        connectedAt: s.connected_at.toISOString(),
        disconnectedAt: s.disconnected_at?.toISOString() ?? null,
        turns: s.turns,
        seconds: s.seconds,
        trialSeconds: s.trial_seconds,
      })),
      turns: turns.map(toTurn),
      activity: fillDays(activity),
    };
  });

  app.patch<{ Params: { id: string } }>('/admin/users/:id', async (req, reply) => {
    const id = req.params.id;
    const body = userPatch.safeParse(req.body);
    if (!uuid.safeParse(id).success) return reply.code(404).send({ error: 'not_found', message: 'No such user' });
    if (!body.success) return reply.code(400).send({ error: 'bad_request', message: body.error.issues[0]?.message ?? 'Invalid update' });
    const { plan, status, adminNote } = body.data;

    const [before] = await sql<{ plan: string; status: string }[]>`
      select public.current_plan(plan, plan_expires_at) as plan, status from public.users where id = ${id}`;
    if (!before) return reply.code(404).send({ error: 'not_found', message: 'No such user' });

    await sql.begin(async (tx) => {
      await tx`
        update public.users set
          plan = coalesce(${plan ?? null}, plan),
          -- Changing the plan by hand removes a bought plan's end date: admin-set plans don't expire.
          plan_expires_at = case
            when ${plan ?? null}::text is distinct from public.current_plan(plan, plan_expires_at) and ${plan ?? null}::text is not null then null
            else plan_expires_at end,
          status = coalesce(${status ?? null}, status),
          admin_note = coalesce(${adminNote ?? null}, admin_note)
        where id = ${id}`;
      if (status && status !== before.status) {
        // Also stop Supabase from issuing new tokens: no sign-in, no refresh, existing sessions revoked.
        await tx`update auth.users set banned_until = ${status === 'suspended' ? sql`now() + interval '100 years'` : null} where id = ${id}`;
        if (status === 'suspended') await tx`delete from auth.sessions where user_id = ${id}`;
      }
    });

    if (status && status !== before.status) {
      forgetUserStatus(id);
      if (status === 'suspended') disconnectUser(id, 'Account suspended');
      await audit(req, status === 'suspended' ? 'user.suspend' : 'user.unsuspend', id);
    }
    if (plan && plan !== before.plan) await audit(req, 'user.plan', id, { from: before.plan, to: plan });
    if (adminNote !== undefined) await audit(req, 'user.note', id);
    return { ok: true };
  });

  // Revokes every refresh token and closes live connections. Access tokens already issued stay
  // valid until they expire (Supabase default: 1 hour); suspend the user to cut them off immediately.
  app.post<{ Params: { id: string } }>('/admin/users/:id/sign-out', async (req, reply) => {
    const id = req.params.id;
    if (!uuid.safeParse(id).success) return reply.code(404).send({ error: 'not_found', message: 'No such user' });
    const deleted = await sql`delete from auth.sessions where user_id = ${id}`;
    const closed = disconnectUser(id, 'Signed out by an administrator');
    await audit(req, 'user.sign_out', id, { sessions: deleted.count, liveConnections: closed });
    return { ok: true, sessions: deleted.count, liveConnections: closed };
  });

  // Deletes the auth account; every app table cascades from it.
  app.delete<{ Params: { id: string } }>('/admin/users/:id', async (req, reply) => {
    const id = req.params.id;
    if (!uuid.safeParse(id).success) return reply.code(404).send({ error: 'not_found', message: 'No such user' });
    const [row] = await sql<{ email: string }[]>`select email from public.users where id = ${id}`;
    disconnectUser(id, 'Account deleted');
    await sql.begin(async (tx) => {
      await tx`delete from auth.users where id = ${id}`;
      await tx`delete from public.users where id = ${id}`;
    });
    forgetUserStatus(id);
    await audit(req, 'user.delete', id, { email: row?.email ?? null });
    return { ok: true };
  });

  app.delete<{ Params: { id: string; deviceId: string } }>('/admin/users/:id/devices/:deviceId', async (req, reply) => {
    const { id, deviceId } = req.params;
    if (!uuid.safeParse(id).success || !uuid.safeParse(deviceId).success) return reply.code(404).send({ error: 'not_found' });
    const res = await sql`delete from public.devices where id = ${deviceId} and user_id = ${id}`;
    if (!res.count) return reply.code(404).send({ error: 'not_found', message: 'No such device' });
    await audit(req, 'device.remove', id, { deviceId });
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>('/admin/users/:id/resume', async (req, reply) => {
    const id = req.params.id;
    if (!uuid.safeParse(id).success) return reply.code(404).send({ error: 'not_found' });
    const res = await sql`delete from public.resumes where user_id = ${id}`;
    await audit(req, 'resume.delete', id, { deleted: res.count });
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/admin/users/:id/resume/reanalyze', async (req, reply) => {
    const id = req.params.id;
    if (!uuid.safeParse(id).success) return reply.code(404).send({ error: 'not_found' });
    const [row] = await sql<{ id: string }[]>`
      update public.resumes set status = 'parsing', error = null, updated_at = now()
      where id = (select id from public.resumes where user_id = ${id} order by created_at desc limit 1)
      returning id`;
    if (!row) return reply.code(404).send({ error: 'not_found', message: 'This user has no resume' });
    await profileQueue.add('resume.parse', { resumeId: row.id }, { jobId: `resume-${row.id}-${Date.now()}` });
    await audit(req, 'resume.reanalyze', id, { resumeId: row.id });
    return { ok: true };
  });

  app.delete<{ Params: { id: string; interviewId: string } }>('/admin/users/:id/interviews/:interviewId', async (req, reply) => {
    const { id, interviewId } = req.params;
    if (!uuid.safeParse(id).success || !uuid.safeParse(interviewId).success) return reply.code(404).send({ error: 'not_found' });
    const res = await sql`delete from public.interview_sessions where id = ${interviewId} and user_id = ${id}`;
    if (!res.count) return reply.code(404).send({ error: 'not_found', message: 'No such interview' });
    await audit(req, 'interview.delete', id, { interviewId });
    return { ok: true };
  });

  // ---- Activity (live answers) -------------------------------------------------------------

  app.get<{ Querystring: { q?: string; userId?: string; status?: string; page?: string } }>(
    '/admin/activity',
    async (req): Promise<Paged<AdminTurn>> => {
      const q = (req.query.q ?? '').trim();
      const userId = uuid.safeParse(req.query.userId).success ? req.query.userId! : '';
      const status = req.query.status ?? '';
      const page = pageOf(req.query.page);
      const rows = await sql<(TurnRow & { total: number })[]>`
        select ${TURN_LIST_COLUMNS}, count(*) over()::int as total
        from public.live_turns t join public.users u on u.id = t.user_id
        where (${userId} = '' or t.user_id::text = ${userId})
          and (${status} = '' or t.status = ${status})
          and (${q} = '' or t.question ilike ${likePattern(q)} or u.email ilike ${likePattern(q)}
               or t.company ilike ${likePattern(q)} or t.role ilike ${likePattern(q)})
        order by t.created_at desc
        limit ${PAGE_SIZE} offset ${(page - 1) * PAGE_SIZE}`;
      return { rows: rows.map(toTurn), total: rows[0]?.total ?? 0, page, pageSize: PAGE_SIZE };
    },
  );

  app.get<{ Params: { id: string } }>('/admin/activity/:id', async (req, reply): Promise<AdminTurn | void> => {
    if (!uuid.safeParse(req.params.id).success) return reply.code(404).send({ error: 'not_found' });
    const [row] = await sql<TurnRow[]>`
      select t.id, t.user_id, u.email, t.live_session_id, t.question, t.answer, t.image_count, t.field, t.company, t.role,
        t.has_resume, t.model, t.tier, t.status, t.error_code, t.tokens_in, t.tokens_out, t.ttft_ms, t.duration_ms, t.created_at
      from public.live_turns t join public.users u on u.id = t.user_id
      where t.id = ${req.params.id}`;
    if (!row) return reply.code(404).send({ error: 'not_found', message: 'No such turn' });
    return toTurn(row);
  });

  // ---- Interviews --------------------------------------------------------------------------

  app.get<{ Querystring: { q?: string; round?: string; page?: string } }>(
    '/admin/interviews',
    async (req): Promise<Paged<AdminInterviewRow>> => {
      const q = (req.query.q ?? '').trim();
      const round = req.query.round ?? '';
      const page = pageOf(req.query.page);
      const rows = await sql<(InterviewRow & { total: number })[]>`
        select i.id, i.user_id, u.email, i.field, i.company, i.role, i.round_type, length(i.jd_text) as jd_chars,
          i.created_at, i.updated_at, count(*) over()::int as total
        from public.interview_sessions i join public.users u on u.id = i.user_id
        where (${round} = '' or i.round_type = ${round})
          and (${q} = '' or u.email ilike ${likePattern(q)} or i.company ilike ${likePattern(q)}
               or i.role ilike ${likePattern(q)} or i.field ilike ${likePattern(q)})
        order by i.updated_at desc
        limit ${PAGE_SIZE} offset ${(page - 1) * PAGE_SIZE}`;
      return { rows: rows.map(toInterview), total: rows[0]?.total ?? 0, page, pageSize: PAGE_SIZE };
    },
  );

  app.get<{ Params: { id: string } }>('/admin/interviews/:id', async (req, reply) => {
    if (!uuid.safeParse(req.params.id).success) return reply.code(404).send({ error: 'not_found' });
    const [row] = await sql<{ jd_text: string }[]>`select jd_text from public.interview_sessions where id = ${req.params.id}`;
    if (!row) return reply.code(404).send({ error: 'not_found', message: 'No such interview' });
    return { jobDescription: row.jd_text };
  });
}
