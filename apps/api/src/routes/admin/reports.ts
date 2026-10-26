import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AdminReport, Paged, ReportReason, ReportStatus } from '@parakeet/shared';
import { audit, requireAdmin } from '../../lib/adminAuth.js';
import { sql } from '../../lib/db.js';
import { reportPatch } from '../../lib/reports.js';

const PAGE_SIZE = 25;
const uuid = z.uuid();

const likePattern = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
const pageOf = (raw?: string) => Math.max(1, Math.min(10_000, Number(raw) || 1));

interface ReportRow {
  id: string;
  user_id: string;
  email: string;
  turn_id: string;
  live_turn_id: string | null;
  reason: ReportReason;
  details: string;
  question: string;
  answer: string;
  model: string | null;
  status: ReportStatus;
  admin_note: string;
  reviewed_by: string | null;
  reviewed_at: Date | null;
  created_at: Date;
}

const toReport = (r: ReportRow): AdminReport => ({
  id: r.id,
  userId: r.user_id,
  userEmail: r.email,
  turnId: r.turn_id,
  liveTurnId: r.live_turn_id,
  reason: r.reason,
  details: r.details,
  question: r.question,
  answer: r.answer,
  model: r.model,
  status: r.status,
  adminNote: r.admin_note,
  reviewedBy: r.reviewed_by,
  reviewedAt: r.reviewed_at?.toISOString() ?? null,
  createdAt: r.created_at.toISOString(),
});

const COLUMNS = sql`
  r.id, r.user_id, u.email, r.turn_id, r.live_turn_id, r.reason, r.details, r.question, r.answer, r.model,
  r.status, r.admin_note, r.reviewed_by, r.reviewed_at, r.created_at`;

export default async function adminReportRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAdmin);

  app.get<{ Querystring: { q?: string; status?: string; reason?: string; page?: string } }>(
    '/admin/reports',
    async (req): Promise<Paged<AdminReport> & { open: number }> => {
      const q = (req.query.q ?? '').trim();
      const status = req.query.status ?? '';
      const reason = req.query.reason ?? '';
      const page = pageOf(req.query.page);
      const [rows, [{ open }]] = await Promise.all([
        sql<(ReportRow & { total: number })[]>`
          select ${COLUMNS}, count(*) over()::int as total
          from public.content_reports r join public.users u on u.id = r.user_id
          where (${status} = '' or r.status = ${status})
            and (${reason} = '' or r.reason = ${reason})
            and (${q} = '' or u.email ilike ${likePattern(q)} or r.details ilike ${likePattern(q)}
                 or r.answer ilike ${likePattern(q)} or r.question ilike ${likePattern(q)})
          order by r.created_at desc
          limit ${PAGE_SIZE} offset ${(page - 1) * PAGE_SIZE}`,
        sql<{ open: number }[]>`select count(*)::int as open from public.content_reports where status = 'open'`,
      ]);
      return { rows: rows.map(toReport), total: rows[0]?.total ?? 0, page, pageSize: PAGE_SIZE, open };
    },
  );

  // POST rather than PATCH: the API's CORS preflight only allows GET, HEAD and POST.
  app.post<{ Params: { id: string } }>('/admin/reports/:id/review', async (req, reply) => {
    const id = req.params.id;
    if (!uuid.safeParse(id).success) return reply.code(404).send({ error: 'not_found', message: 'No such report' });
    const body = reportPatch.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'bad_request', message: body.error.issues[0]?.message ?? 'Invalid update' });
    const { status, adminNote } = body.data;
    const [row] = await sql<ReportRow[]>`
      update public.content_reports r set
        status = coalesce(${status ?? null}, r.status),
        admin_note = coalesce(${adminNote ?? null}, r.admin_note),
        reviewed_by = ${req.admin.email},
        reviewed_at = now()
      from public.users u
      where r.id = ${id} and u.id = r.user_id
      returning ${COLUMNS}`;
    if (!row) return reply.code(404).send({ error: 'not_found', message: 'No such report' });
    await audit(req, 'report.review', id, { status: row.status, ...(adminNote !== undefined ? { note: true } : {}) });
    return toReport(row);
  });
}
