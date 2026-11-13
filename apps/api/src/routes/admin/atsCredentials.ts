import { Queue } from 'bullmq';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { INDIA_ELIGIBLE, PROVIDER_SUBMISSION } from '@parakeet/shared';
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
//   PATCH  /admin/ats-credentials/:id         change the daily cap agreed with the employer
//   DELETE /admin/ats-credentials/:id         revoke
//   GET    /admin/ats-credentials/targets     employer boards ranked by the jobs a credential would unlock

const PROVIDERS = ['greenhouse', 'lever', 'ashby', 'smartrecruiters', 'workable', 'teamtailor'] as const;

const addBody = z.object({
  provider: z.enum(PROVIDERS),
  board: z.string().trim().min(1).max(200),
  secret: z.string().trim().min(8).max(4000),
  grantedBy: z.string().trim().min(2).max(200),
  agreementRef: z.string().trim().min(3).max(500),
  /** Applications a day the employer agreed to receive through its API. */
  dailyCap: z.coerce.number().int().min(1).max(1000).default(10),
});
const capBody = z.object({ dailyCap: z.coerce.number().int().min(1).max(1000) });

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
  dailyCap: number;
  /** Sent through the API today (India day), including ones in flight or unconfirmed. */
  sentToday: number;
  /** Listings currently open on that board. */
  openListings: number;
  /** The provider has an implemented API connector (otherwise the key is stored but unused). */
  connectorImplemented: boolean;
}

/** An employer board where a credential would open automatic submission, with what it would unlock. */
export interface AtsCredentialTarget {
  provider: string;
  board: string;
  company: string;
  /** Unique open listings on the board. */
  openListings: number;
  /** …of them tech roles open to candidates in India. */
  indiaTech: number;
  /** …posted (or first seen) in the last 30 days: the board's flow, not its backlog. */
  indiaTech30d: number;
  /** Eligible matches for any user on this board right now. */
  eligibleMatches: number;
  connectorImplemented: boolean;
  credential: 'active' | 'flagged' | 'revoked' | null;
}

let queue: Queue | null = null;
const submitQueue = () => (queue ??= new Queue('autosubmit', { connection: { url: env.REDIS_URL } }));

export default async function adminAtsCredentialRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAdmin);
  app.addHook('onClose', async () => {
    await queue?.close();
    queue = null;
  });

  app.get('/admin/ats-credentials', async (): Promise<AtsCredentialRow[]> => {
    const rows = await sql<{ id: string; provider: string; board: string; granted_by: string; agreement_ref: string; verified_at: Date | null; last_error: string | null; revoked_at: Date | null; created_at: Date; open: number; daily_cap: number; sent_today: number }[]>`
      select c.id, c.provider, c.board, c.granted_by, c.agreement_ref, c.verified_at, c.last_error, c.revoked_at, c.created_at, c.daily_cap,
             (select count(*)::int from public.auto_applications x join public.job_listings l on l.id = x.listing_id
               join public.job_sources s on s.id = l.source_id
               where s.provider = c.provider and s.board = c.board and x.channel = 'api'
                 and (x.reason_code = 'submitting' or ((x.status = 'submitted' or x.reason_code = 'unverified')
                      and (coalesce(x.submitted_at, x.submit_clicked_at, x.updated_at) at time zone 'Asia/Kolkata')::date = (now() at time zone 'Asia/Kolkata')::date))) as sent_today,
             (select count(*)::int from public.job_listings l join public.job_sources s on s.id = l.source_id
               where s.provider = c.provider and s.board = c.board and l.closed_at is null and l.duplicate_of is null) as open
      from public.ats_credentials c order by c.revoked_at nulls first, c.created_at desc`;
    return rows.map((r) => ({
      id: r.id, provider: r.provider, board: r.board, grantedBy: r.granted_by, agreementRef: r.agreement_ref,
      verifiedAt: r.verified_at?.toISOString() ?? null, lastError: r.last_error, revokedAt: r.revoked_at?.toISOString() ?? null,
      createdAt: r.created_at.toISOString(), dailyCap: r.daily_cap, sentToday: r.sent_today, openListings: r.open, connectorImplemented: Boolean(PROVIDER_SUBMISSION[r.provider]?.connectorImplemented),
    }));
  });

  app.get<{ Querystring: { limit?: string } }>('/admin/ats-credentials/targets', async (req): Promise<AtsCredentialTarget[]> => {
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 300);
    const providers = Object.values(PROVIDER_SUBMISSION).filter((p) => p.apiExists).map((p) => p.provider);
    const rows = await sql<{ provider: string; board: string; company: string; open: number; india: number; india30: number; matches: number; cred: AtsCredentialTarget['credential'] }[]>`
      select s.provider, s.board, s.company,
             count(l.id)::int as open,
             count(l.id) filter (where l.tech_category is not null and l.eligibility = any(${[...INDIA_ELIGIBLE]}::text[]))::int as india,
             count(l.id) filter (where l.tech_category is not null and l.eligibility = any(${[...INDIA_ELIGIBLE]}::text[])
                                   and coalesce(l.posted_at, l.first_seen_at) > now() - interval '30 days')::int as india30,
             (select count(*)::int from public.job_matches m join public.job_listings x on x.id = m.listing_id
               where x.source_id = s.id and x.closed_at is null and m.eligible) as matches,
             (select case when c.revoked_at is not null then 'revoked' when c.last_error is not null then 'flagged' else 'active' end
                from public.ats_credentials c where c.provider = s.provider and c.board = s.board) as cred
      from public.job_sources s
      join public.job_listings l on l.source_id = s.id and l.closed_at is null and l.duplicate_of is null
      where s.enabled and s.provider = any(${providers}::text[])
      group by s.id, s.provider, s.board, s.company
      having count(l.id) filter (where l.tech_category is not null and l.eligibility = any(${[...INDIA_ELIGIBLE]}::text[])) > 0
      order by india desc, open desc
      limit ${limit}`;
    return rows.map((r) => ({
      provider: r.provider, board: r.board, company: r.company, openListings: r.open, indiaTech: r.india, indiaTech30d: r.india30,
      eligibleMatches: r.matches, connectorImplemented: Boolean(PROVIDER_SUBMISSION[r.provider]?.connectorImplemented), credential: r.cred,
    }));
  });

  app.post('/admin/ats-credentials', async (req, reply) => {
    if (!atsCredentialsConfigured()) return reply.code(503).send({ error: 'not_configured', message: 'Set ATS_CREDENTIALS_KEY on the API and the worker.' });
    const body = addBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'bad_request', message: 'Provider, board, secret, granted by and agreement reference are required.' });
    const d = body.data;
    const [row] = await sql<{ id: string }[]>`
      insert into public.ats_credentials (provider, board, secret_enc, granted_by, agreement_ref, daily_cap)
      values (${d.provider}, ${d.board}, ${encryptAtsSecret(d.secret)}, ${d.grantedBy}, ${d.agreementRef}, ${d.dailyCap})
      on conflict (provider, board) do update set
        secret_enc = excluded.secret_enc, granted_by = excluded.granted_by, agreement_ref = excluded.agreement_ref, daily_cap = excluded.daily_cap,
        verified_at = null, last_error = null, revoked_at = null, updated_at = now()
      returning id`;
    await audit({ userId: null, actor: 'admin', action: 'ats_credential.added', targetType: 'ats_credential', targetId: row.id,
      detail: { admin: req.admin.email, provider: d.provider, board: d.board, grantedBy: d.grantedBy, agreementRef: d.agreementRef, dailyCap: d.dailyCap }, ip: req.ip });
    return { id: row.id };
  });

  app.post<{ Params: { id: string } }>('/admin/ats-credentials/:id/verify', async (req, reply) => {
    if (!z.uuid().safeParse(req.params.id).success) return reply.notFound('No such credential.');
    const [row] = await sql<{ id: string }[]>`select id from public.ats_credentials where id = ${req.params.id} and revoked_at is null`;
    if (!row) return reply.notFound('No such credential.');
    await submitQueue().add('autosubmit.verify', { credentialId: row.id }, { jobId: `verify-${row.id}-${Date.now()}`, removeOnComplete: { age: 3600 }, removeOnFail: { age: 24 * 3600 } });
    await audit({ userId: null, actor: 'admin', action: 'ats_credential.verify_requested', targetType: 'ats_credential', targetId: row.id, detail: { admin: req.admin.email }, ip: req.ip });
    return { queued: true };
  });

  app.patch<{ Params: { id: string } }>('/admin/ats-credentials/:id', async (req, reply) => {
    const body = capBody.safeParse(req.body);
    if (!z.uuid().safeParse(req.params.id).success || !body.success) return reply.code(400).send({ error: 'bad_request', message: 'A daily cap from 1 to 1000.' });
    const [row] = await sql<{ id: string; provider: string; board: string }[]>`
      update public.ats_credentials set daily_cap = ${body.data.dailyCap}, updated_at = now()
      where id = ${req.params.id} and revoked_at is null returning id, provider, board`;
    if (!row) return reply.notFound('No such credential.');
    await audit({ userId: null, actor: 'admin', action: 'ats_credential.cap_changed', targetType: 'ats_credential', targetId: row.id,
      detail: { admin: req.admin.email, provider: row.provider, board: row.board, dailyCap: body.data.dailyCap }, ip: req.ip });
    return { dailyCap: body.data.dailyCap };
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
