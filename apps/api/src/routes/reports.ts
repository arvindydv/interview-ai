import type { FastifyInstance } from 'fastify';
import type { ReportReceipt } from '@parakeet/shared';
import { requireAuth } from '../lib/auth.js';
import { sql } from '../lib/db.js';
import { redis } from '../lib/redis.js';
import { MAX_REPORTS_PER_HOUR, reportBody } from '../lib/reports.js';

/** Counts a report against the user's hourly budget. Returns false once it is spent. */
async function allowReport(userId: string) {
  const key = `reports:${userId}`;
  const n = await redis.incr(key);
  if (n === 1) await redis.expire(key, 3600);
  return n <= MAX_REPORTS_PER_HOUR;
}

export default async function reportRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  // Files a report about an AI-generated answer, identified by its turn id. The question, answer and
  // model are copied from the server's own record of the turn; the client's copy is kept only when
  // there is no record (e.g. the turn could not be saved), and the report is then marked unmatched.
  app.post('/v1/reports', async (req, reply): Promise<ReportReceipt | void> => {
    const body = reportBody.safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'bad_request', message: body.error.issues[0]?.message ?? 'Invalid report' });
    }
    if (!(await allowReport(req.user.id))) {
      return reply.code(429).send({ error: 'rate_limited', message: 'Too many reports. Please try again in an hour.' });
    }
    const { turnId, reason, details, question, answer } = body.data;

    await sql`
      insert into public.users (id, email, auth_provider)
      values (${req.user.id}, ${req.user.email}, ${req.user.provider})
      on conflict (id) do nothing`;
    const [row] = await sql<{ id: string; created_at: Date }[]>`
      with turn as (
        select id, question, answer, model from public.live_turns
        where user_id = ${req.user.id} and turn_id = ${turnId}
        order by created_at desc limit 1
      )
      insert into public.content_reports (user_id, turn_id, live_turn_id, reason, details, question, answer, model)
      select ${req.user.id}, ${turnId}, turn.id, ${reason}, ${details},
        coalesce(turn.question, ${question}), coalesce(turn.answer, ${answer}), turn.model
      from (select 1) one left join turn on true
      on conflict (user_id, turn_id) do update
        set reason = excluded.reason, details = excluded.details,
            live_turn_id = coalesce(excluded.live_turn_id, content_reports.live_turn_id),
            question = excluded.question, answer = excluded.answer, model = excluded.model,
            -- A fresh report reopens one an admin already closed.
            status = 'open', created_at = now()
      returning id, created_at`;
    req.log.info({ reportId: row.id, turnId, reason }, 'answer reported');
    return { id: row.id, createdAt: row.created_at.toISOString() };
  });
}
