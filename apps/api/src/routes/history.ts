import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import {
  SEARCH_MARK, type HistoryPage, type HistoryRetention, type HistorySearchHit, type HistorySession,
  type HistorySessionSummary, type HistoryTurn, type SessionDebrief, reportFileName,
} from '@parakeet/shared';
import { requireAuth } from '../lib/auth.js';
import { sql } from '../lib/db.js';
import { requestDebrief } from '../lib/debrief.js';
import { interviewReportPdf } from '../lib/interviewReport.js';
import { resumeName } from '../lib/resumeName.js';

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
/** The browser names the download in the user's own time zone; this is the server's fallback (most users are in India). */
const REPORT_TIME_ZONE = 'Asia/Kolkata';
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

  // Post-interview feedback (G2), on request (it's also written by itself when an interview ends, see
  // lib/debrief.ts). Needs the session's text, so not available once it's been cleared.
  app.post<{ Params: { id: string } }>('/v1/history/:id/summary', async (req, reply) => {
    if (!uuid.safeParse(req.params.id).success) return notFound(reply);
    const r = await requestDebrief(req.params.id, req.user.id);
    if ('status' in r) return r;
    if (r.error === 'not_found') return notFound(reply);
    if (r.error === 'no_text') return reply.code(409).send({ error: 'no_text', message: 'This session has no saved questions to review.' });
    return reply.code(503).send({ error: 'unavailable', message: 'Feedback is unavailable right now.' });
  });

  // The feedback as a PDF, named by the interview's date (e.g. 12_oct_interview.pdf).
  app.get<{ Params: { id: string } }>('/v1/history/:id/report.pdf', async (req, reply) => {
    if (!uuid.safeParse(req.params.id).success) return notFound(reply);
    const [row] = await sql<SummaryRow[]>`
      ${SUMMARY}
      where s.id = ${req.params.id} and s.user_id = ${req.user.id} and s.deleted_at is null`;
    if (!row) return notFound(reply);
    const [extra] = await sql<{ summary: SessionDebrief | null; name: string | null; resume_text: string | null }[]>`
      select s.summary, r.parsed_json ->> 'name' as name, r.text as resume_text
      from public.live_sessions s
      left join lateral (select parsed_json, text from public.resumes where user_id = s.user_id order by created_at desc limit 1) r on true
      where s.id = ${row.id}`;
    if (!extra?.summary) {
      return reply.code(409).send({ error: 'conflict', message: 'The feedback report is ready once your interview has been reviewed.' });
    }
    const turns = await sql<{ question: string; answer: string }[]>`
      select question, answer from public.live_turns
      where live_session_id = ${row.id} and status <> 'blocked' and question <> '' order by created_at`;
    const name = resumeName(extra.name, extra.resume_text ?? '') || req.user.name || '';
    const pdf = await interviewReportPdf({ session: toSummary(row), summary: extra.summary, turns, candidateName: name });
    return reply
      .header('content-type', 'application/pdf')
      .header('content-disposition', `attachment; filename="${reportFileName(row.connected_at, 'interview', REPORT_TIME_ZONE)}"`)
      .header('cache-control', 'private, no-store')
      .send(pdf);
  });

  app.delete<{ Params: { id: string } }>('/v1/history/:id', async (req, reply) => {
    if (!uuid.safeParse(req.params.id).success) return notFound(reply);
    const ids = await sql.begin(async (tx) => {
      const rows = await tx<{ id: string }[]>`
        update public.live_sessions set deleted_at = now(), summary = null, summary_status = null, transcript = '[]'::jsonb
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
      await tx`update public.live_sessions set deleted_at = coalesce(deleted_at, now()), summary = null, summary_status = null, transcript = '[]'::jsonb where user_id = ${req.user.id}`;
      await tx`update public.live_turns set question = '', answer = '' where user_id = ${req.user.id} and (question <> '' or answer <> '')`;
    });
    return { ok: true };
  });
}
