import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Me } from '@parakeet/shared';
import { requireAuth } from '../lib/auth.js';
import { sql } from '../lib/db.js';
import { sendEmail } from '../lib/queues.js';
import { TRIAL_PLAN } from '../lib/trial.js';
import { env } from '../env.js';

/** "sourabh.k@x.com" → "Sourabh" */
/** The first word of the sign-up name, else a guess from the email address. */
function firstName(email: string, name = '') {
  const given = name.split(/\s+/)[0];
  if (given) return given;
  const local = email.split('@')[0].split(/[._+-]/)[0] || 'there';
  return local.charAt(0).toUpperCase() + local.slice(1);
}

const deviceBody = z.object({
  deviceKey: z.string().min(8).max(128),
  os: z.string().max(32),
  osVersion: z.string().max(64).optional(),
  appVersion: z.string().max(32).optional(),
});

export default async function meRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  // Returns the app-side user, creating it on first sign-in.
  app.get('/v1/me', async (req): Promise<Me> => {
    const { id, email, provider, name } = req.user;
    const [row] = await sql<
      {
        id: string; email: string; auth_provider: string; plan: string; plan_expires_at: Date | null; created_at: Date;
        trial_seconds: number; trial_used_seconds: number; inserted: boolean;
      }[]
    >`
      insert into public.users (id, email, auth_provider)
      values (${id}, ${email}, ${provider})
      on conflict (id) do update set email = excluded.email
      returning id, email, auth_provider, public.current_plan(plan, plan_expires_at) as plan,
        case when plan_expires_at > now() then plan_expires_at end as plan_expires_at,
        created_at, trial_seconds, trial_used_seconds, (xmax = 0) as inserted`;
    if (row.inserted && row.email) {
      await sendEmail(
        { template: 'welcome', to: row.email, props: { name: firstName(row.email, name), email: row.email, appUrl: env.APP_URL } },
        `welcome-${row.id}`,
        req.log,
      );
    }
    return {
      id: row.id,
      email: row.email,
      authProvider: row.auth_provider,
      plan: row.plan,
      planExpiresAt: row.plan_expires_at?.toISOString() ?? null,
      createdAt: row.created_at.toISOString(),
      trial: row.plan === TRIAL_PLAN ? { totalSeconds: row.trial_seconds, usedSeconds: row.trial_used_seconds } : null,
    };
  });

  // Desktop app heartbeat / registration (spec A1 device limits, I6 compatibility analytics).
  app.post('/v1/devices', async (req, reply) => {
    const body = deviceBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'bad_request', issues: body.error.issues });
    const d = body.data;
    await sql`
      insert into public.users (id, email, auth_provider)
      values (${req.user.id}, ${req.user.email}, ${req.user.provider})
      on conflict (id) do nothing`;
    const [row] = await sql<{ id: string; inserted: boolean; other_devices: number }[]>`
      insert into public.devices (user_id, device_key, os, os_version, app_version)
      values (${req.user.id}, ${d.deviceKey}, ${d.os}, ${d.osVersion ?? null}, ${d.appVersion ?? null})
      on conflict (user_id, device_key) do update
        set os = excluded.os, os_version = excluded.os_version,
            app_version = excluded.app_version, last_seen = now()
      returning id, (xmax = 0) as inserted,
        (select count(*)::int from public.devices o where o.user_id = ${req.user.id} and o.device_key <> ${d.deviceKey}) as other_devices`;

    // Security alert for a sign-in on an additional device (the first device is covered by the welcome email).
    if (row.inserted && row.other_devices > 0 && req.user.email) {
      const when = new Date().toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }) + ' UTC';
      await sendEmail(
        {
          template: 'newDevice',
          to: req.user.email,
          props: { email: req.user.email, appUrl: env.APP_URL, os: d.os, osVersion: d.osVersion, appVersion: d.appVersion, when },
        },
        `new-device-${row.id}`,
        req.log,
      );
    }
    return { id: row.id };
  });
}
