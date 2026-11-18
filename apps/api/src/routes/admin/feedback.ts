import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AdminFeedback, FeedbackKind, FeedbackStatus, Paged } from '@parakeet/shared';
import { audit, requireAdmin } from '../../lib/adminAuth.js';
import { sql } from '../../lib/db.js';
import { feedbackPatch } from '../../lib/feedback.js';
import { forgetPublicReviews } from '../feedback.js';

const PAGE_SIZE = 25;
const uuid = z.uuid();

const likePattern = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
const pageOf = (raw?: string) => Math.max(1, Math.min(10_000, Number(raw) || 1));

interface FeedbackRow {
  id: string;
  user_id: string;
  email: string;
  kind: FeedbackKind;
  rating: number | null;
  message: string;
  display_name: string;
  role: string;
  publish: boolean;
  status: FeedbackStatus;
  admin_note: string;
  reviewed_by: string | null;
  reviewed_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

const toFeedback = (r: FeedbackRow): AdminFeedback => ({
  id: r.id,
  userId: r.user_id,
  userEmail: r.email,
  kind: r.kind,
  rating: r.rating,
  message: r.message,
  displayName: r.display_name,
  role: r.role,
  publish: r.publish,
  status: r.status,
  adminNote: r.admin_note,
  reviewedBy: r.reviewed_by,
  reviewedAt: r.reviewed_at?.toISOString() ?? null,
  createdAt: r.created_at.toISOString(),
  updatedAt: r.updated_at.toISOString(),
});

const COLUMNS = sql`
  f.id, f.user_id, u.email, f.kind, f.rating, f.message, f.display_name, f.role, f.publish, f.status,
  f.admin_note, f.reviewed_by, f.reviewed_at, f.created_at, f.updated_at`;

export default async function adminFeedbackRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAdmin);

  app.get<{ Querystring: { q?: string; status?: string; kind?: string; page?: string } }>(
    '/admin/feedback',
    async (req): Promise<Paged<AdminFeedback> & { pending: number; average: number | null }> => {
      const q = (req.query.q ?? '').trim();
      const status = req.query.status ?? '';
      const kind = req.query.kind ?? '';
      const page = pageOf(req.query.page);
      const [rows, [stats]] = await Promise.all([
        sql<(FeedbackRow & { total: number })[]>`
          select ${COLUMNS}, count(*) over()::int as total
          from public.feedback f join public.users u on u.id = f.user_id
          where (${status} = '' or f.status = ${status})
            and (${kind} = '' or f.kind = ${kind})
            and (${q} = '' or u.email ilike ${likePattern(q)} or f.message ilike ${likePattern(q)}
                 or f.display_name ilike ${likePattern(q)})
          order by f.updated_at desc
          limit ${PAGE_SIZE} offset ${(page - 1) * PAGE_SIZE}`,
        sql<{ pending: number; average: string | null }[]>`
          select count(*) filter (where status = 'new')::int as pending,
                 round(avg(rating) filter (where kind = 'review'), 1)::text as average
          from public.feedback`,
      ]);
      return {
        rows: rows.map(toFeedback),
        total: rows[0]?.total ?? 0,
        page,
        pageSize: PAGE_SIZE,
        pending: stats.pending,
        average: stats.average === null ? null : Number(stats.average),
      };
    },
  );

  // POST rather than PATCH: the API's CORS preflight only allows GET, HEAD and POST.
  app.post<{ Params: { id: string } }>('/admin/feedback/:id/review', async (req, reply) => {
    const id = req.params.id;
    if (!uuid.safeParse(id).success) return reply.code(404).send({ error: 'not_found', message: 'No such feedback' });
    const body = feedbackPatch.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'bad_request', message: body.error.issues[0]?.message ?? 'Invalid update' });
    const { status, adminNote } = body.data;
    const [row] = await sql<FeedbackRow[]>`
      update public.feedback f set
        status = coalesce(${status ?? null}, f.status),
        admin_note = coalesce(${adminNote ?? null}, f.admin_note),
        reviewed_by = ${req.admin.email},
        reviewed_at = now()
      from public.users u
      where f.id = ${id} and u.id = f.user_id
      returning ${COLUMNS}`;
    if (!row) return reply.code(404).send({ error: 'not_found', message: 'No such feedback' });
    forgetPublicReviews();
    await audit(req, 'feedback.review', id, { status: row.status, ...(adminNote !== undefined ? { note: true } : {}) });
    return toFeedback(row);
  });
}
