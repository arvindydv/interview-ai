import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { audit } from '../lib/audit.js';
import { requireAuth } from '../lib/auth.js';
import { sql } from '../lib/db.js';
import { forgetAccessToken, gmailConfigured, revokeToken } from '../lib/gmail.js';
import { jobBotQueue } from '../lib/queues.js';
import { env } from '../env.js';

// The candidate's connected accounts and their Friday Jobs data. Friday never stores a third-party
// account password: Gmail is an OAuth refresh token (encrypted, GMAIL_TOKEN_KEY), the extension holds its
// own device token (only its hash is stored), and the experimental bot's site sessions live on the
// worker's disk. Each can be disconnected here; every change is written to the audit log.

export interface AccountConnections {
  gmail: { email: string; connectedAt: string } | null;
  devices: { id: string; name: string; connectedAt: string; lastSeenAt: string | null }[];
  botSessions: { platform: string; status: string; connectedAt: string }[];
}

const kindSchema = z.enum(['gmail', 'devices', 'bot']);
const deleteBody = z.object({ confirm: z.literal('DELETE') });

/** Revokes Gmail at Google (best effort) and deletes the stored token. True when one was connected. */
async function disconnectGmail(userId: string) {
  const [account] = await sql<{ refresh_token: Buffer }[]>`delete from public.gmail_accounts where user_id = ${userId} returning refresh_token`;
  forgetAccessToken(userId);
  if (account && gmailConfigured()) await revokeToken(account.refresh_token).catch(() => undefined);
  return Boolean(account);
}

async function disconnectDevices(userId: string) {
  return (await sql`update public.auto_apply_devices set revoked_at = now() where user_id = ${userId} and revoked_at is null`).count;
}

/** Marks the bot's sessions disconnected; the experimental worker deletes the on-disk browser profile. */
async function disconnectBot(userId: string) {
  const n = (await sql`
    update public.job_bot_sessions set status = 'disconnected', message = 'Disconnected from your account settings.', updated_at = now()
    where user_id = ${userId} and status <> 'disconnected'`).count;
  if (env.JOB_BOT_EXPERIMENTAL) {
    await jobBotQueue.add('jobbot.forget', { userId }, { jobId: `forget-${userId}-${Date.now()}`, attempts: 3, backoff: { type: 'exponential', delay: 10_000 } });
  }
  return n;
}

export default async function accountRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  app.get('/v1/account/connections', async (req): Promise<AccountConnections> => {
    const userId = req.user.id;
    const [[gmail], devices, sessions] = await Promise.all([
      sql<{ email: string; connected_at: Date }[]>`select email, connected_at from public.gmail_accounts where user_id = ${userId}`,
      sql<{ id: string; name: string; created_at: Date; last_seen_at: Date | null }[]>`
        select id, name, created_at, last_seen_at from public.auto_apply_devices
        where user_id = ${userId} and revoked_at is null order by coalesce(last_seen_at, created_at) desc`,
      sql<{ platform: string; status: string; updated_at: Date }[]>`
        select platform, status, updated_at from public.job_bot_sessions where user_id = ${userId} and status <> 'disconnected'`,
    ]);
    return {
      gmail: gmail ? { email: gmail.email, connectedAt: gmail.connected_at.toISOString() } : null,
      devices: devices.map((d) => ({ id: d.id, name: d.name, connectedAt: d.created_at.toISOString(), lastSeenAt: d.last_seen_at?.toISOString() ?? null })),
      botSessions: sessions.map((s) => ({ platform: s.platform, status: s.status, connectedAt: s.updated_at.toISOString() })),
    };
  });

  app.delete<{ Params: { kind: string } }>('/v1/account/connections/:kind', async (req, reply) => {
    const kind = kindSchema.safeParse(req.params.kind);
    if (!kind.success) return reply.code(400).send({ error: 'bad_request', message: 'Unknown connection.' });
    const userId = req.user.id;
    const removed =
      kind.data === 'gmail' ? Number(await disconnectGmail(userId)) : kind.data === 'devices' ? await disconnectDevices(userId) : await disconnectBot(userId);
    await audit({ userId, actor: 'user', action: `account.disconnect.${kind.data}`, detail: { removed }, ip: req.ip });
    return { ok: true, removed };
  });

  // Deletes everything Friday Jobs holds for the candidate (their main resume and interview data stay).
  // Applications already sent stay with the employers; only Friday's copies go.
  app.post('/v1/account/jobs-data/delete', async (req, reply) => {
    if (!deleteBody.safeParse(req.body).success) {
      return reply.code(400).send({ error: 'confirmation_required', message: 'Type DELETE to confirm.' });
    }
    const userId = req.user.id;
    await disconnectGmail(userId);
    await disconnectBot(userId);
    const counts = await sql.begin(async (tx) => {
      const del = async (table: string) => (await tx`delete from ${tx(`public.${table}`)} where user_id = ${userId}`).count;
      const out: Record<string, number> = {};
      await tx`update public.auto_apply_devices set revoked_at = now() where user_id = ${userId} and revoked_at is null`;
      // Children first where foreign keys don't cascade.
      for (const t of [
        'auto_applications', 'job_bot_applications', 'cold_emails', 'tailored_resumes', 'job_resumes', 'job_bot_sessions', 'job_bot_settings',
        'application_profiles', 'auto_apply_settings', 'job_applications', 'job_swipes', 'job_matches',
      ]) out[t] = await del(t);
      return out;
    });
    await audit({ userId, actor: 'user', action: 'account.jobs_data.delete', detail: counts, ip: req.ip });
    return { ok: true, deleted: counts };
  });
}
