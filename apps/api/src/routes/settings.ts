import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { HISTORY_RETENTIONS, type AccountSettings, type DeviceInfo, type HistoryRetention } from '@parakeet/shared';
import { requireAuth } from '../lib/auth.js';
import { sql } from '../lib/db.js';
import { historyQueue } from '../lib/queues.js';
import { ensureUser } from '../lib/users.js';

// Account settings and data controls (spec G3): retention, devices, export, delete my data.

const patchBody = z.object({
  historyRetention: z.enum(HISTORY_RETENTIONS.map((r) => r.id) as [HistoryRetention, ...HistoryRetention[]]),
});

const uuid = z.uuid();

export default async function settingsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  async function devices(userId: string): Promise<DeviceInfo[]> {
    const rows = await sql<{ id: string; os: string; os_version: string | null; app_version: string | null; last_seen: Date }[]>`
      select id, os, os_version, app_version, last_seen from public.devices where user_id = ${userId} order by last_seen desc`;
    return rows.map((d) => ({ id: d.id, os: d.os, osVersion: d.os_version, appVersion: d.app_version, lastSeen: d.last_seen.toISOString() }));
  }

  app.get('/v1/settings', async (req): Promise<AccountSettings> => {
    const [row] = await sql<{ history_retention: HistoryRetention }[]>`
      select history_retention from public.users where id = ${req.user.id}`;
    return { historyRetention: row?.history_retention ?? 'forever', devices: await devices(req.user.id) };
  });

  app.patch('/v1/settings', async (req, reply): Promise<AccountSettings | void> => {
    const body = patchBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'bad_request', message: 'Invalid setting' });
    await ensureUser(req);
    await sql`update public.users set history_retention = ${body.data.historyRetention} where id = ${req.user.id}`;
    // A shorter period applies to what's already saved, not only to new sessions.
    if (body.data.historyRetention !== 'forever') {
      await historyQueue.add('history.purge', { userId: req.user.id }).catch((err) => req.log.error({ err }, 'failed to enqueue purge'));
    }
    return { historyRetention: body.data.historyRetention, devices: await devices(req.user.id) };
  });

  // Forgets a desktop install; it registers again the next time it signs in.
  app.delete<{ Params: { id: string } }>('/v1/devices/:id', async (req, reply) => {
    if (!uuid.safeParse(req.params.id).success) return reply.code(404).send({ error: 'not_found' });
    const res = await sql`delete from public.devices where id = ${req.params.id} and user_id = ${req.user.id}`;
    if (!res.count) return reply.code(404).send({ error: 'not_found', message: 'No such device' });
    return { ok: true };
  });

  // Everything we hold about the user, as one JSON file (DPDP Act right to access).
  app.get('/v1/export', async (req, reply) => {
    const id = req.user.id;
    const [account] = await sql`
      select id, email, auth_provider, public.current_plan(plan, plan_expires_at) as plan, plan_expires_at, history_retention,
             trial_seconds, trial_used_seconds, created_at
      from public.users where id = ${id}`;
    const [interviews, resumes, practice, sessions, turns, deviceRows, payments] = await Promise.all([
      sql`select id, field, company, role, round_type, jd_text as job_description, instructions, status as stage, scheduled_at, notes, created_at, updated_at
          from public.interview_sessions where user_id = ${id} order by created_at`,
      sql`select file_name, text, parsed_json as profile, created_at from public.resumes where user_id = ${id}`,
      sql`select id, title, round_type, difficulty, status, questions, answers, result, score, created_at, completed_at
          from public.practice_sessions where user_id = ${id} order by created_at`,
      sql`select id, connected_at, disconnected_at, seconds, summary from public.live_sessions
          where user_id = ${id} and deleted_at is null order by connected_at`,
      sql`select live_session_id, question, answer, status, model, created_at from public.live_turns
          where user_id = ${id} and question <> '' order by created_at`,
      sql`select os, os_version, app_version, last_seen from public.devices where user_id = ${id}`,
      sql`select product, amount, currency, status, created_at, paid_at, refunded_at from public.payments where user_id = ${id} order by created_at`,
    ]);
    const date = new Date().toISOString().slice(0, 10);
    reply.header('content-disposition', `attachment; filename="friday-ai-data-${date}.json"`);
    return {
      exportedAt: new Date().toISOString(),
      account: account ?? null,
      interviews,
      resumes,
      practiceSessions: practice,
      liveSessions: sessions,
      questionsAndAnswers: turns,
      devices: deviceRows,
      payments,
    };
  });

  // Deletes the user's content (interviews, resume, practice, history text) but keeps the account,
  // usage and payment records, which billing and tax law need.
  app.delete('/v1/data', async (req) => {
    const id = req.user.id;
    await sql.begin(async (tx) => {
      await tx`delete from public.practice_sessions where user_id = ${id}`;
      await tx`delete from public.interview_sessions where user_id = ${id}`;
      await tx`delete from public.resumes where user_id = ${id}`;
      await tx`update public.live_sessions set deleted_at = coalesce(deleted_at, now()), summary = null, summary_status = null where user_id = ${id}`;
      await tx`update public.live_turns set question = '', answer = '' where user_id = ${id} and (question <> '' or answer <> '')`;
    });
    req.log.info({ userId: id }, 'user deleted their data');
    return { ok: true };
  });
}
