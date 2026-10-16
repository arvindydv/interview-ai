import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AdminSession, AppSettings, AuditEntry, Paged } from '@parakeet/shared';
import {
  adminConfigured, allowLoginAttempt, audit, checkAdminCredentials, issueAdminToken, requireAdmin,
} from '../../lib/adminAuth.js';
import { sql } from '../../lib/db.js';
import { getSettings, saveSettings } from '../../lib/settings.js';

const loginBody = z.object({ email: z.string().max(320), password: z.string().max(1024) });

const settingsBody = z
  .object({
    maintenanceMode: z.boolean(),
    maintenanceMessage: z.string().max(500),
    dailyQuestionLimits: z.record(z.string().min(1).max(40), z.number().int().min(0).max(100_000)),
    fastModel: z.string().max(100).transform((s) => s.trim()),
    visionModel: z.string().max(100).transform((s) => s.trim()),
  })
  .partial();

export default async function adminAuthRoutes(app: FastifyInstance) {
  app.post('/admin/login', async (req, reply): Promise<AdminSession | void> => {
    if (!adminConfigured()) {
      return reply.code(503).send({ error: 'admin_disabled', message: 'Admin sign-in is not configured on the API (ADMIN_* env vars).' });
    }
    if (!(await allowLoginAttempt(req.ip))) {
      return reply.code(429).send({ error: 'rate_limited', message: 'Too many attempts. Try again in 15 minutes.' });
    }
    const body = loginBody.safeParse(req.body);
    if (!body.success || !checkAdminCredentials(body.data.email, body.data.password)) {
      req.log.warn({ ip: req.ip }, 'admin login failed');
      return reply.code(401).send({ error: 'invalid_credentials', message: 'Wrong email or password.' });
    }
    const session = await issueAdminToken(body.data.email.trim().toLowerCase());
    req.log.info({ ip: req.ip }, 'admin signed in');
    return session;
  });

  app.register(async (authed) => {
    authed.addHook('preHandler', requireAdmin);

    authed.get('/admin/session', async (req) => ({ email: req.admin.email }));

    authed.get('/admin/settings', async (): Promise<AppSettings> => getSettings());

    authed.put('/admin/settings', async (req, reply): Promise<AppSettings | void> => {
      const body = settingsBody.safeParse(req.body);
      if (!body.success) return reply.code(400).send({ error: 'bad_request', message: body.error.issues[0]?.message ?? 'Invalid settings' });
      const before = await getSettings();
      const after = await saveSettings(body.data);
      const changed = Object.fromEntries(
        Object.keys(body.data)
          .filter((k) => JSON.stringify(before[k as keyof AppSettings]) !== JSON.stringify(after[k as keyof AppSettings]))
          .map((k) => [k, after[k as keyof AppSettings]]),
      );
      if (Object.keys(changed).length) await audit(req, 'settings.update', null, changed);
      return after;
    });

    authed.get<{ Querystring: { page?: string } }>('/admin/audit', async (req): Promise<Paged<AuditEntry>> => {
      const page = Math.max(1, Number(req.query.page) || 1);
      const pageSize = 50;
      const rows = await sql<
        { id: string; admin_email: string; action: string; target: string | null; details: Record<string, unknown>; created_at: Date; total: number }[]
      >`
        select id, admin_email, action, target, details, created_at, count(*) over()::int as total
        from public.admin_audit order by created_at desc
        limit ${pageSize} offset ${(page - 1) * pageSize}`;
      return {
        rows: rows.map((r) => ({
          id: Number(r.id),
          adminEmail: r.admin_email,
          action: r.action,
          target: r.target,
          details: r.details,
          createdAt: r.created_at.toISOString(),
        })),
        total: rows[0]?.total ?? 0,
        page,
        pageSize,
      };
    });
  });
}
