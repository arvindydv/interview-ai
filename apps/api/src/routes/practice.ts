import { Readable } from 'node:stream';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import {
  NO_MINUTES_ERROR, NO_MINUTES_MESSAGE, PRACTICE_DIFFICULTIES, PRACTICE_LENGTHS, PRACTICE_LIMITS, ROUND_TYPES, speechStats,
  type PracticeAnswer, type TrialBalance,
  type PracticeDifficulty, type PracticeQuestion, type PracticeResult, type PracticeSession, type PracticeStatus,
  type PracticeSummary, type RoundType,
} from '@parakeet/shared';
import { env } from '../env.js';
import { requireAuth } from '../lib/auth.js';
import { sql } from '../lib/db.js';
import { practiceQueue } from '../lib/queues.js';
import { chargeMinutes, minutesLeft, trialBalance } from '../lib/trial.js';
import { ensureUser } from '../lib/users.js';

// Mock interviews (spec F1/F2). The worker writes the question plan and the debrief; the candidate's
// answers are saved here one at a time, so a closed tab loses nothing.
//
// Practice spends session minutes like a live interview (lib/trial.ts): the free plan and minute packs
// are metered, paid plans aren't. The clock runs on the server from when the candidate opens the
// session (POST …/start) to each saved answer, so it can't be faked by the client. Planning and scoring
// are free.

interface SessionRow {
  id: string;
  interview_id: string | null;
  title: string;
  round_type: RoundType;
  difficulty: PracticeDifficulty;
  question_count: number;
  status: PracticeStatus;
  error: string | null;
  questions: PracticeQuestion[];
  answers: (PracticeAnswer | null)[];
  result: PracticeResult | null;
  score: number | null;
  seconds: number;
  created_at: Date;
  completed_at: Date | null;
}

const answeredCount = (answers: (PracticeAnswer | null)[]) => answers.filter((a) => a && !a.skipped).length;

const toSummary = (r: SessionRow): PracticeSummary => ({
  id: r.id,
  interviewId: r.interview_id,
  title: r.title,
  roundType: r.round_type,
  difficulty: r.difficulty,
  questionCount: r.question_count,
  answered: answeredCount(r.answers),
  status: r.status,
  score: r.score,
  createdAt: r.created_at.toISOString(),
  completedAt: r.completed_at?.toISOString() ?? null,
});

const toSession = (r: SessionRow): PracticeSession => ({
  ...toSummary(r),
  seconds: r.seconds,
  error: r.error,
  questions: r.questions,
  answers: r.answers,
  result: r.result,
});

const COLUMN_LIST = [
  'id', 'interview_id', 'title', 'round_type', 'difficulty', 'question_count', 'status', 'error', 'questions', 'answers',
  'result', 'score', 'seconds', 'created_at', 'completed_at',
];
const COLUMNS = sql.unsafe(COLUMN_LIST.join(', '));

/** Time on one question that counts, at most: an answer left open while the candidate walks away isn't charged beyond this. */
const MAX_METERED_S = PRACTICE_LIMITS.maxAnswerMs / 1000;

const setupBody = z.object({
  interviewId: z.uuid().nullable(),
  roundType: z.enum(ROUND_TYPES.map((r) => r.id) as [RoundType, ...RoundType[]]),
  difficulty: z.enum(PRACTICE_DIFFICULTIES.map((d) => d.id) as [PracticeDifficulty, ...PracticeDifficulty[]]),
  questionCount: z.union(PRACTICE_LENGTHS.map((n) => z.literal(n)) as [z.ZodLiteral<number>, ...z.ZodLiteral<number>[]]),
});

const answerBody = z.object({
  text: z.string().max(PRACTICE_LIMITS.maxAnswerChars).transform((s) => s.trim()),
  mode: z.enum(['voice', 'text']),
  durationMs: z.number().int().min(0).max(PRACTICE_LIMITS.maxAnswerMs),
  skipped: z.boolean(),
});

const uuid = z.uuid();
const noMinutes = (reply: FastifyReply) => reply.code(402).send({ error: NO_MINUTES_ERROR, message: NO_MINUTES_MESSAGE });
const isOut = (t: TrialBalance | null) => t !== null && minutesLeft(t) <= 0;
const notFound = (reply: FastifyReply) => reply.code(404).send({ error: 'not_found', message: 'No such practice session' });

export default async function practiceRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  async function findOne(userId: string, id: string) {
    const [row] = await sql<SessionRow[]>`select ${COLUMNS} from public.practice_sessions where id = ${id} and user_id = ${userId}`;
    return row ?? null;
  }

  async function enqueue(id: string, job: 'practice.plan' | 'practice.score') {
    await practiceQueue.add(job, { sessionId: id }, { jobId: `${job}-${id}-${Date.now()}` });
  }

  app.get('/v1/practice', async (req): Promise<{ sessions: PracticeSummary[] }> => {
    const rows = await sql<SessionRow[]>`
      select ${COLUMNS} from public.practice_sessions where user_id = ${req.user.id} order by created_at desc limit 100`;
    return { sessions: rows.map(toSummary) };
  });

  app.get<{ Params: { id: string } }>('/v1/practice/:id', async (req, reply): Promise<{ session: PracticeSession } | void> => {
    if (!uuid.safeParse(req.params.id).success) return notFound(reply);
    const row = await findOne(req.user.id, req.params.id);
    return row ? { session: toSession(row) } : notFound(reply);
  });

  app.post('/v1/practice', async (req, reply): Promise<{ session: PracticeSession } | void> => {
    const body = setupBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'bad_request', message: body.error.issues[0]?.message ?? 'Invalid setup' });
    const { interviewId, roundType, difficulty, questionCount } = body.data;

    if (isOut(await trialBalance(req.user.id))) return noMinutes(reply);

    const [{ n }] = await sql<{ n: number }[]>`
      select count(*)::int as n from public.practice_sessions
      where user_id = ${req.user.id} and created_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc'`;
    if (n >= PRACTICE_LIMITS.perDay) {
      return reply.code(429).send({
        error: 'daily_limit', message: `You've started ${PRACTICE_LIMITS.perDay} practice sessions today. More tomorrow (00:00 UTC).`,
      });
    }

    let title = 'General practice';
    if (interviewId) {
      const [i] = await sql<{ role: string; company: string; field: string }[]>`
        select role, company, field from public.interview_sessions where id = ${interviewId} and user_id = ${req.user.id}`;
      if (!i) return reply.code(404).send({ error: 'not_found', message: 'No such interview' });
      title = [i.role, i.company].filter(Boolean).join(' · ') || i.field || title;
    }

    await ensureUser(req);
    const [row] = await sql<SessionRow[]>`
      insert into public.practice_sessions (user_id, interview_id, title, round_type, difficulty, question_count)
      values (${req.user.id}, ${interviewId}, ${title}, ${roundType}, ${difficulty}, ${questionCount})
      returning ${COLUMNS}`;
    try {
      await enqueue(row.id, 'practice.plan');
    } catch (err) {
      req.log.error({ err }, 'failed to enqueue practice plan');
      await sql`delete from public.practice_sessions where id = ${row.id}`;
      return reply.code(503).send({ error: 'unavailable', message: 'Practice is unavailable right now. Try again in a minute.' });
    }
    return reply.code(201).send({ session: toSession(row) });
  });

  // Opening the session starts the clock. Reopening it keeps a running clock, unless it was left
  // idle for longer than one answer can count.
  app.post<{ Params: { id: string } }>(
    '/v1/practice/:id/start',
    async (req, reply): Promise<{ session: PracticeSession; trial: TrialBalance | null } | void> => {
      if (!uuid.safeParse(req.params.id).success) return notFound(reply);
      const trial = await trialBalance(req.user.id);
      if (isOut(trial)) return noMinutes(reply);
      const [row] = await sql<SessionRow[]>`
        update public.practice_sessions
        set metered_at = case
          when metered_at is null or metered_at < now() - make_interval(secs => ${MAX_METERED_S}) then now() else metered_at end
        where id = ${req.params.id} and user_id = ${req.user.id} and status = 'ready'
        returning ${COLUMNS}`;
      if (!row) {
        const current = await findOne(req.user.id, req.params.id);
        if (!current) return notFound(reply);
        return reply.code(409).send({ error: 'conflict', message: 'This session is no longer taking answers.' });
      }
      return { session: toSession(row), trial };
    },
  );

  app.put<{ Params: { id: string; index: string } }>(
    '/v1/practice/:id/answers/:index',
    { bodyLimit: PRACTICE_LIMITS.maxAnswerChars * 4 + 1024 },
    async (req, reply): Promise<{ session: PracticeSession; trial: TrialBalance | null } | void> => {
      if (!uuid.safeParse(req.params.id).success) return notFound(reply);
      const index = Number(req.params.index);
      if (!Number.isInteger(index) || index < 0 || index >= 10) return reply.code(400).send({ error: 'bad_request', message: 'Invalid question' });
      const body = answerBody.safeParse(req.body);
      if (!body.success) return reply.code(400).send({ error: 'bad_request', message: body.error.issues[0]?.message ?? 'Invalid answer' });
      const { text, mode, durationMs } = body.data;
      const skipped = body.data.skipped || !text;
      const answer: PracticeAnswer = { text, mode, durationMs, skipped, ...speechStats(text, durationMs, mode) };

      if (isOut(await trialBalance(req.user.id))) return noMinutes(reply);
      // The time since the clock last moved (start, or the previous answer) is what this answer used.
      const [row] = await sql<(SessionRow & { charged: number })[]>`
        with prev as (
          select id, least(greatest(extract(epoch from now() - coalesce(metered_at, created_at)), 0), ${MAX_METERED_S})::int as charged
          from public.practice_sessions
          where id = ${req.params.id} and user_id = ${req.user.id} and status = 'ready' and ${index} < jsonb_array_length(questions)
          for update
        )
        update public.practice_sessions p
        set answers = jsonb_set(p.answers, ${[String(index)]}, ${sql.json(answer as never)}),
            seconds = p.seconds + prev.charged, metered_at = now(), updated_at = now()
        from prev where p.id = prev.id
        returning ${sql.unsafe(COLUMN_LIST.map((c) => `p.${c}`).join(', '))}, prev.charged`;
      if (!row) {
        const current = await findOne(req.user.id, req.params.id);
        if (!current) return notFound(reply);
        return reply.code(409).send({ error: 'conflict', message: 'This session is no longer taking answers.' });
      }
      // The answer is saved either way; if the charge can't be recorded, don't fail the candidate.
      const trial = await chargeMinutes(req.user.id, row.charged).catch((err) => {
        req.log.warn({ err, sessionId: row.id }, 'could not charge practice minutes');
        return null;
      });
      return { session: toSession(row), trial };
    },
  );

  // The interviewer's voice: one question read aloud by Deepgram Aura. Browser text-to-speech has no
  // voices at all on many Linux setups and sounds robotic elsewhere, so the site plays this instead
  // (and falls back to the browser only when this returns 503).
  app.get<{ Params: { id: string; index: string } }>('/v1/practice/:id/questions/:index/speech', async (req, reply) => {
    if (!uuid.safeParse(req.params.id).success) return notFound(reply);
    const index = Number(req.params.index);
    if (!Number.isInteger(index) || index < 0 || index >= 10) return reply.code(400).send({ error: 'bad_request', message: 'Invalid question' });
    if (!env.DEEPGRAM_API_KEY) return reply.code(503).send({ error: 'tts_unavailable', message: 'Voice is not set up on the server.' });
    const [row] = await sql<{ question: string | null }[]>`
      select questions -> ${index}::int ->> 'question' as question
      from public.practice_sessions where id = ${req.params.id} and user_id = ${req.user.id}`;
    if (!row) return notFound(reply);
    if (!row.question) return reply.code(404).send({ error: 'not_found', message: 'No such question' });

    const url = `https://api.deepgram.com/v1/speak?${new URLSearchParams({ model: env.DEEPGRAM_TTS_MODEL })}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { authorization: `Token ${env.DEEPGRAM_API_KEY}`, 'content-type': 'application/json' },
      // Aura reads at most 2000 characters per request; questions are far shorter.
      body: JSON.stringify({ text: row.question.slice(0, 2000) }),
      signal: AbortSignal.timeout(15_000),
    }).catch((err: Error) => {
      req.log.warn({ err: err.message }, 'text-to-speech unreachable');
      return null;
    });
    if (!res?.ok || !res.body) {
      if (res) req.log.warn({ status: res.status, body: (await res.text().catch(() => '')).slice(0, 200) }, 'text-to-speech failed');
      return reply.code(502).send({ error: 'tts_failed', message: 'Could not read the question aloud.' });
    }
    // Streamed through as it is synthesised. A question never changes, so the browser may keep it.
    return reply
      .header('content-type', res.headers.get('content-type') ?? 'audio/mpeg')
      .header('cache-control', 'private, max-age=86400')
      .send(Readable.fromWeb(res.body as import('node:stream/web').ReadableStream));
  });

  // Ends the session (unanswered questions count as skipped) and starts the debrief.
  app.post<{ Params: { id: string } }>('/v1/practice/:id/finish', async (req, reply): Promise<{ session: PracticeSession } | void> => {
    if (!uuid.safeParse(req.params.id).success) return notFound(reply);
    const current = await findOne(req.user.id, req.params.id);
    if (!current) return notFound(reply);
    if (current.status !== 'ready') return reply.code(409).send({ error: 'conflict', message: 'This session has already ended.' });
    if (!answeredCount(current.answers)) {
      return reply.code(400).send({ error: 'no_answers', message: 'Answer at least one question to get feedback.' });
    }
    const [row] = await sql<SessionRow[]>`
      update public.practice_sessions set status = 'scoring', completed_at = now(), updated_at = now()
      where id = ${current.id} and status = 'ready' returning ${COLUMNS}`;
    if (!row) return reply.code(409).send({ error: 'conflict', message: 'This session has already ended.' });
    try {
      await enqueue(row.id, 'practice.score');
    } catch (err) {
      req.log.error({ err }, 'failed to enqueue practice scoring');
      await sql`update public.practice_sessions set status = 'failed', error = 'Scoring is unavailable right now.' where id = ${row.id}`;
      return { session: toSession({ ...row, status: 'failed', error: 'Scoring is unavailable right now.' }) };
    }
    return { session: toSession(row) };
  });

  // A failed plan or debrief: run that step again.
  app.post<{ Params: { id: string } }>('/v1/practice/:id/retry', async (req, reply): Promise<{ session: PracticeSession } | void> => {
    if (!uuid.safeParse(req.params.id).success) return notFound(reply);
    const current = await findOne(req.user.id, req.params.id);
    if (!current) return notFound(reply);
    if (current.status !== 'failed') return reply.code(409).send({ error: 'conflict', message: 'Nothing to retry.' });
    const step = current.questions.length ? 'scoring' : 'planning';
    const [row] = await sql<SessionRow[]>`
      update public.practice_sessions set status = ${step}, error = null, updated_at = now()
      where id = ${current.id} and status = 'failed' returning ${COLUMNS}`;
    await enqueue(row.id, step === 'scoring' ? 'practice.score' : 'practice.plan');
    return { session: toSession(row) };
  });

  app.delete<{ Params: { id: string } }>('/v1/practice/:id', async (req, reply) => {
    if (!uuid.safeParse(req.params.id).success) return notFound(reply);
    const res = await sql`delete from public.practice_sessions where id = ${req.params.id} and user_id = ${req.user.id}`;
    if (!res.count) return notFound(reply);
    return { ok: true };
  });
}
