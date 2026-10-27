import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import {
  SEARCH_MARK, type HistoryPage, type HistoryRetention, type HistorySearchHit, type HistorySession,
  type HistorySessionSummary, type HistoryTurn, type SessionDebrief,
} from '@parakeet/shared';
import { requireAuth } from '../lib/auth.js';
import { sql } from '../lib/db.js';
import { historyQueue } from '../lib/queues.js';

// Past live sessions (spec G1/G2): browse, search, summarise and delete. Usage and billing figures stay
// in live_sessions/live_turns whatever the user deletes; only the text goes.

const PAGE = 30;

interface SummaryRow {
  id: string;
  connected_at: Date;
  disconnected_at: Date | null;
  seconds: number;
  questions: number;
  with_text: number;
  interviews: string[] | null;
  preview: string | null;
  summary_status: HistorySessionSummary['summaryStatus'];
}

const toSummary = (r: SummaryRow): HistorySessionSummary => ({
  id: r.id,
  startedAt: r.connected_at.toISOString(),
  endedAt: r.disconnected_at?.toISOString() ?? null,
  seconds: r.seconds,
  questions: r.questions,
  interviews: r.interviews ?? [],
  preview: r.preview ?? '',
  textCleared: r.questions > 0 && r.with_text === 0,
  summaryStatus: r.summary_status,
});

/** Sessions of `s` with their question counts; the caller adds the where clause. */
const SUMMARY = sql`
  select s.id, s.connected_at, s.disconnected_at, s.seconds, s.summary_status,
         coalesce(t.questions, 0) as questions, coalesce(t.with_text, 0) as with_text, t.interviews, t.preview
  from public.live_sessions s
  left join lateral (
    select count(*)::int as questions,
           count(*) filter (where question <> '')::int as with_text,
           array_remove(array_agg(distinct nullif(concat_ws(' · ', nullif(role, ''), nullif(company, '')), '')), null) as interviews,
           (array_agg(question order by created_at) filter (where question <> ''))[1] as preview
    from public.live_turns where live_session_id = s.id and status <> 'blocked'
  ) t on true`;

const uuid = z.uuid();
const notFound = (reply: FastifyReply) => reply.code(404).send({ error: 'not_found', message: 'No such session' });

export default async function historyRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  app.get<{ Querystring: { before?: string } }>('/v1/history', async (req): Promise<HistoryPage> => {
    const before = z.iso.datetime({ offset: true }).safeParse(req.query.before);
    const rows = await sql<SummaryRow[]>`
      ${SUMMARY}
      where s.user_id = ${req.user.id} and s.deleted_at is null
        ${before.success ? sql`and s.connected_at < ${before.data}` : sql``}
        -- Connections where nothing was asked and almost no time passed aren't interviews.
        and (coalesce(t.questions, 0) > 0 or s.seconds >= 60)
      order by s.connected_at desc limit ${PAGE + 1}`;
    const [{ history_retention }] = await sql<{ history_retention: HistoryRetention }[]>`
      select coalesce((select history_retention from public.users where id = ${req.user.id}), 'forever') as history_retention`;
    return {
      sessions: rows.slice(0, PAGE).map(toSummary),
      next: rows.length > PAGE ? rows[PAGE - 1].connected_at.toISOString() : null,
      retention: history_retention,
    };
  });

  app.get<{ Querystring: { q?: string } }>('/v1/history/search', async (req): Promise<{ hits: HistorySearchHit[] }> => {
    const q = (req.query.q ?? '').trim().slice(0, 200);
    if (!q) return { hits: [] };
    const opts = `StartSel=${SEARCH_MARK.start}, StopSel=${SEARCH_MARK.end}, MaxWords=40, MinWords=12, MaxFragments=2`;
    const rows = await sql<{ id: string; live_session_id: string; created_at: Date; question: string; answer: string }[]>`
      select t.id, t.live_session_id, t.created_at,
             ts_headline('simple', t.question, query, ${opts}) as question,
             ts_headline('simple', t.answer, query, ${opts}) as answer
      from public.live_turns t
      join public.live_sessions s on s.id = t.live_session_id and s.deleted_at is null,
           websearch_to_tsquery('simple', ${q}) query
      where t.user_id = ${req.user.id} and t.search @@ query
      order by ts_rank(t.search, query) desc, t.created_at desc
      limit 50`;
    return {
      hits: rows.map((r) => ({
        turnId: r.id, sessionId: r.live_session_id, createdAt: r.created_at.toISOString(), question: r.question, answer: r.answer,
      })),
    };
  });

  app.get<{ Params: { id: string } }>('/v1/history/:id', async (req, reply): Promise<{ session: HistorySession } | void> => {
    if (!uuid.safeParse(req.params.id).success) return notFound(reply);
    const [row] = await sql<SummaryRow[]>`
      ${SUMMARY}
      where s.id = ${req.params.id} and s.user_id = ${req.user.id} and s.deleted_at is null`;
    if (!row) return notFound(reply);
    const [extra] = await sql<{ summary: SessionDebrief | null }[]>`select summary from public.live_sessions where id = ${row.id}`;
    const turns = await sql<{ id: string; question: string; answer: string; status: HistoryTurn['status']; image_count: number; created_at: Date }[]>`
      select id, question, answer, status, image_count, created_at from public.live_turns
      where live_session_id = ${row.id} and status <> 'blocked' order by created_at`;
    return {
      session: {
        ...toSummary(row),
        summary: extra?.summary ?? null,
        turns: turns.map((t) => ({
          id: t.id, question: t.question, answer: t.answer, status: t.status, imageCount: t.image_count, createdAt: t.created_at.toISOString(),
        })),
      },
    };
  });

  // Post-interview summary (G2): needs the session's text, so not available once it's been cleared.
  app.post<{ Params: { id: string } }>('/v1/history/:id/summary', async (req, reply) => {
    if (!uuid.safeParse(req.params.id).success) return notFound(reply);
    const [row] = await sql<{ id: string; summary_status: string | null; with_text: number }[]>`
      select s.id, s.summary_status,
             (select count(*)::int from public.live_turns t where t.live_session_id = s.id and t.question <> '') as with_text
      from public.live_sessions s
      where s.id = ${req.params.id} and s.user_id = ${req.user.id} and s.deleted_at is null`;
    if (!row) return notFound(reply);
    if (!row.with_text) {
      return reply.code(409).send({ error: 'no_text', message: 'This session has no saved questions to summarise.' });
    }
    if (row.summary_status === 'pending') return { status: 'pending' };
    await sql`update public.live_sessions set summary_status = 'pending' where id = ${row.id}`;
    try {
      await historyQueue.add('history.summary', { sessionId: row.id }, { jobId: `history-summary-${row.id}-${Date.now()}` });
    } catch (err) {
      req.log.error({ err }, 'failed to enqueue session summary');
      await sql`update public.live_sessions set summary_status = 'failed' where id = ${row.id}`;
      return reply.code(503).send({ error: 'unavailable', message: 'Summaries are unavailable right now.' });
    }
    return { status: 'pending' };
  });

  app.delete<{ Params: { id: string } }>('/v1/history/:id', async (req, reply) => {
    if (!uuid.safeParse(req.params.id).success) return notFound(reply);
    const ids = await sql.begin(async (tx) => {
      const rows = await tx<{ id: string }[]>`
        update public.live_sessions set deleted_at = now(), summary = null, summary_status = null
        where id = ${req.params.id} and user_id = ${req.user.id} and deleted_at is null returning id`;
      if (rows.length) await tx`update public.live_turns set question = '', answer = '' where live_session_id = ${req.params.id}`;
      return rows;
    });
    if (!ids.length) return notFound(reply);
    return { ok: true };
  });

  // Clears every saved question and answer. Usage figures stay.
  app.delete('/v1/history', async (req) => {
    await sql.begin(async (tx) => {
      await tx`update public.live_sessions set deleted_at = coalesce(deleted_at, now()), summary = null, summary_status = null where user_id = ${req.user.id}`;
      await tx`update public.live_turns set question = '', answer = '' where user_id = ${req.user.id} and (question <> '' or answer <> '')`;
    });
    return { ok: true };
  });
}
