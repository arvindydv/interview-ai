import { Queue } from 'bullmq';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { PROVIDER_SUBMISSION } from '@parakeet/shared';
import { requireAdmin } from '../../lib/adminAuth.js';
import { atsCredentialsConfigured, encryptAtsSecret } from '../../lib/atsCredentials.js';
import { audit } from '../../lib/audit.js';
import { sql } from '../../lib/db.js';
import { env } from '../../env.js';

// Employer/partner credentials for authorized ATS submission (apps/worker/src/queues/submit.ts).
// Each one is an API key an employer or ATS partner issued to Friday, with the written permission
// recorded (agreement_ref). Secrets are write-only: encrypted on the way in, never returned.
//
//   GET    /admin/ats-credentials             list (no secrets)
//   POST   /admin/ats-credentials             add or replace one for a provider + board
//   POST   /admin/ats-credentials/:id/verify  queue a read-only check in the worker (never a test submission)
//   DELETE /admin/ats-credentials/:id         revoke

const PROVIDERS = ['greenhouse', 'lever', 'ashby', 'smartrecruiters', 'workable', 'teamtailor'] as const;

const addBody = z.object({
  provider: z.enum(PROVIDERS),
  board: z.string().trim().min(1).max(200),
  secret: z.string().trim().min(8).max(4000),
  grantedBy: z.string().trim().min(2).max(200),
  agreementRef: z.string().trim().min(3).max(500),
});

export interface AtsCredentialRow {
  id: string;
  provider: string;
  board: string;
  grantedBy: string;
  agreementRef: string;
  verifiedAt: string | null;
  lastError: string | null;
  revokedAt: string | null;
  createdAt: string;
  /** Listings currently open on that board. */
  openListings: number;
  /** The provider has an implemented API connector (otherwise the key is stored but unused). */
  connectorImplemented: boolean;
}

const submitQueue = new Queue('autosubmit', { connection: { url: env.REDIS_URL } });

export default async function adminAtsCredentialRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAdmin);

  app.get('/admin/ats-credentials', async (): Promise<AtsCredentialRow[]> => {
    const rows = await sql<{ id: string; provider: string; board: string; granted_by: string; agreement_ref: string; verified_at: Date | null; last_error: string | null; revoked_at: Date | null; created_at: Date; open: number }[]>`
      select c.id, c.provider, c.board, c.granted_by, c.agreement_ref, c.verified_at, c.last_error, c.revoked_at, c.created_at,
             (select count(*)::int from public.job_listings l join public.job_sources s on s.id = l.source_id
               where s.provider = c.provider and s.board = c.board and l.closed_at is null and l.duplicate_of is null) as open
      from public.ats_credentials c order by c.revoked_at nulls first, c.created_at desc`;
    return rows.map((r) => ({
      id: r.id, provider: r.provider, board: r.board, grantedBy: r.granted_by, agreementRef: r.agreement_ref,
      verifiedAt: r.verified_at?.toISOString() ?? null, lastError: r.last_error, revokedAt: r.revoked_at?.toISOString() ?? null,
      createdAt: r.created_at.toISOString(), openListings: r.open, connectorImplemented: Boolean(PROVIDER_SUBMISSION[r.provider]?.connectorImplemented),
    }));
  });

  app.post('/admin/ats-credentials', async (req, reply) => {
    if (!atsCredentialsConfigured()) return reply.code(503).send({ error: 'not_configured', message: 'Set ATS_CREDENTIALS_KEY on the API and the worker.' });
    const body = addBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'bad_request', message: 'Provider, board, secret, granted by and agreement reference are required.' });
    const d = body.data;
    const [row] = await sql<{ id: string }[]>`
      insert into public.ats_credentials (provider, board, secret_enc, granted_by, agreement_ref)
      values (${d.provider}, ${d.board}, ${encryptAtsSecret(d.secret)}, ${d.grantedBy}, ${d.agreementRef})
      on conflict (provider, board) do update set
        secret_enc = excluded.secret_enc, granted_by = excluded.granted_by, agreement_ref = excluded.agreement_ref,
        verified_at = null, last_error = null, revoked_at = null, updated_at = now()
      returning id`;
    await audit({ userId: null, actor: 'admin', action: 'ats_credential.added', targetType: 'ats_credential', targetId: row.id,
      detail: { admin: req.admin.email, provider: d.provider, board: d.board, grantedBy: d.grantedBy, agreementRef: d.agreementRef }, ip: req.ip });
    return { id: row.id };
  });

  app.post<{ Params: { id: string } }>('/admin/ats-credentials/:id/verify', async (req, reply) => {
    if (!z.uuid().safeParse(req.params.id).success) return reply.notFound('No such credential.');
    const [row] = await sql<{ id: string }[]>`select id from public.ats_credentials where id = ${req.params.id} and revoked_at is null`;
    if (!row) return reply.notFound('No such credential.');
    await submitQueue.add('autosubmit.verify', { credentialId: row.id }, { jobId: `verify-${row.id}-${Date.now()}`, removeOnComplete: { age: 3600 }, removeOnFail: { age: 24 * 3600 } });
    await audit({ userId: null, actor: 'admin', action: 'ats_credential.verify_requested', targetType: 'ats_credential', targetId: row.id, detail: { admin: req.admin.email }, ip: req.ip });
    return { queued: true };
  });

  app.delete<{ Params: { id: string } }>('/admin/ats-credentials/:id', async (req, reply) => {
    if (!z.uuid().safeParse(req.params.id).success) return reply.notFound('No such credential.');
    const [row] = await sql<{ id: string; provider: string; board: string }[]>`
      update public.ats_credentials set revoked_at = now(), updated_at = now()
      where id = ${req.params.id} and revoked_at is null returning id, provider, board`;
    if (!row) return reply.notFound('No such credential.');
    await audit({ userId: null, actor: 'admin', action: 'ats_credential.revoked', targetType: 'ats_credential', targetId: row.id,
      detail: { admin: req.admin.email, provider: row.provider, board: row.board }, ip: req.ip });
    return { revoked: true };
  });
}
