import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import {
  NO_MINUTES_ERROR, NO_MINUTES_MESSAGE, NO_RESUME_ERROR, PRACTICE_DIFFICULTIES, PRACTICE_DURATIONS, PRACTICE_LIMITS, ROUND_TYPES,
  parseMessage, renderResumeProfile,
  type PracticeAnswer, type PracticeClientMessage, type PracticeDifficulty, type PracticeQuestion, type PracticeResult,
  type PracticeServerMessage, type PracticeSession, type PracticeStatus, type PracticeSummary, type ResumeProfile, type RoundType,
  type TrialBalance,
} from '@parakeet/shared';
import { AuthError, authenticate, requireAuth } from '../lib/auth.js';
import { sql } from '../lib/db.js';
import { llmConfigured, resolveModels } from '../lib/llm.js';
import { PracticeRoom, type RoomStore } from '../lib/practiceRoom.js';
import { practiceQueue } from '../lib/queues.js';
import { getSettings } from '../lib/settings.js';
import { sttConfigured } from '../lib/stt.js';
import { minutesLeft, trialBalance } from '../lib/trial.js';
import { ttsConfigured } from '../lib/tts.js';
import { ensureUser } from '../lib/users.js';

// Mock interviews (spec F1/F2). The interview itself runs live over WS /v1/practice/:id/live (see
// lib/practiceRoom.ts): the candidate picks a length in minutes, and the interviewer asks questions
// from their resume until the time is up. The worker writes the debrief.
//
// Practice spends session minutes like a live interview (lib/trial.ts): the free plan and minute packs
// are metered, paid plans aren't. The clock starts when the candidate says they're ready, and is
// measured on the server. The greeting before that, and the debrief, are free.

interface SessionRow {
  id: string;
  user_id: string;
  interview_id: string | null;
  title: string;
  round_type: RoundType;
  difficulty: PracticeDifficulty;
  duration_minutes: number | null;
  question_count: number;
  status: PracticeStatus;
  error: string | null;
  questions: PracticeQuestion[];
  answers: (PracticeAnswer | null)[];
  result: PracticeResult | null;
  score: number | null;
  seconds: number;
  candidate_name: string;
  created_at: Date;
  started_at: Date | null;
  completed_at: Date | null;
}

const answeredCount = (answers: (PracticeAnswer | null)[]) => answers.filter((a) => a && !a.skipped).length;

const toSummary = (r: SessionRow): PracticeSummary => ({
  id: r.id,
  interviewId: r.interview_id,
  title: r.title,
  roundType: r.round_type,
  difficulty: r.difficulty,
  durationMinutes: r.duration_minutes,
  questionCount: r.question_count,
  answered: answeredCount(r.answers),
  status: r.status,
  score: r.score,
  createdAt: r.created_at.toISOString(),
  startedAt: r.started_at?.toISOString() ?? null,
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

const COLUMNS = sql.unsafe(
  [
    'id', 'user_id', 'interview_id', 'title', 'round_type', 'difficulty', 'duration_minutes', 'question_count', 'status', 'error',
    'questions', 'answers', 'result', 'score', 'seconds', 'candidate_name', 'created_at', 'started_at', 'completed_at',
  ].join(', '),
);

const setupBody = z.object({
  interviewId: z.uuid().nullable(),
  roundType: z.enum(ROUND_TYPES.map((r) => r.id) as [RoundType, ...RoundType[]]),
  difficulty: z.enum(PRACTICE_DIFFICULTIES.map((d) => d.id) as [PracticeDifficulty, ...PracticeDifficulty[]]),
  durationMinutes: z.union(PRACTICE_DURATIONS.map((n) => z.literal(n)) as [z.ZodLiteral<number>, ...z.ZodLiteral<number>[]]),
});

const uuid = z.uuid();
const noMinutes = (reply: FastifyReply) => reply.code(402).send({ error: NO_MINUTES_ERROR, message: NO_MINUTES_MESSAGE });
const isOut = (t: TrialBalance | null) => t !== null && minutesLeft(t) <= 0;
const notFound = (reply: FastifyReply) => reply.code(404).send({ error: 'not_found', message: 'No such practice session' });

const MAX_JD_CHARS = 8_000;
const MAX_RESUME_CHARS = 12_000;
/** The browser has this long after connecting to send its access token. */
const AUTH_TIMEOUT_MS = 10_000;

async function findOne(userId: string, id: string) {
  const [row] = await sql<SessionRow[]>`select ${COLUMNS} from public.practice_sessions where id = ${id} and user_id = ${userId}`;
  return row ?? null;
}

async function enqueueScore(id: string) {
  await practiceQueue.add('practice.score', { sessionId: id }, { jobId: `practice.score-${id}-${Date.now()}` });
}

/** Ends a session and queues its debrief; one with no answers can't be scored and is marked failed. */
async function finishSession(id: string, log: FastifyInstance['log']): Promise<SessionRow | null> {
  const [row] = await sql<SessionRow[]>`
    update public.practice_sessions
    set status = case when exists (
          select 1 from jsonb_array_elements(answers) a where a <> 'null'::jsonb and not coalesce((a ->> 'skipped')::boolean, false)
        ) then 'scoring' else 'failed' end,
        error = case when exists (
          select 1 from jsonb_array_elements(answers) a where a <> 'null'::jsonb and not coalesce((a ->> 'skipped')::boolean, false)
        ) then null else 'The interview ended before any question was answered.' end,
        completed_at = now(), updated_at = now()
    where id = ${id} and status = 'ready'
    returning ${COLUMNS}`;
  if (!row || row.status !== 'scoring') return row ?? null;
  try {
    await enqueueScore(row.id);
  } catch (err) {
    log.error({ err }, 'failed to enqueue practice scoring');
    const error = 'Scoring is unavailable right now.';
    await sql`update public.practice_sessions set status = 'failed', error = ${error} where id = ${row.id}`;
    return { ...row, status: 'failed', error };
  }
  return row;
}

/** The candidate's resume and the target interview, for the interviewer model. Null without a resume. */
async function interviewContext(row: SessionRow) {
  const [c] = await sql<
    { field: string | null; company: string | null; role: string | null; jd_text: string | null; resume_text: string | null; parsed_json: ResumeProfile | null }[]
  >`
    select i.field, i.company, i.role, i.jd_text, r.text as resume_text, r.parsed_json
    from (select 1) one
    left join public.interview_sessions i on i.id = ${row.interview_id} and i.user_id = ${row.user_id}
    left join lateral (
      select text, parsed_json from public.resumes where user_id = ${row.user_id} order by created_at desc limit 1
    ) r on true`;
  if (!c?.resume_text && !c?.parsed_json) return null;
  const lines = [
    '<candidate_context>',
    (c.field || c.company || c.role || c.jd_text) && '<target_interview>',
    c.field && `Field: ${c.field}`,
    c.company && `Organisation: ${c.company}`,
    c.role && `Role: ${c.role}`,
    c.jd_text?.trim() && `Job description (for context only; ask about the resume):\n${c.jd_text.trim().slice(0, MAX_JD_CHARS)}`,
    (c.field || c.company || c.role || c.jd_text) && '</target_interview>',
    c.parsed_json && `<candidate_profile>\n${renderResumeProfile(c.parsed_json)}\n</candidate_profile>`,
    c.resume_text && `<resume_text>\n${c.resume_text.slice(0, MAX_RESUME_CHARS)}\n</resume_text>`,
    '</candidate_context>',
  ];
  const keyterms = [c.company, c.role, ...(c.parsed_json?.experience.map((e) => e.company) ?? []), ...(c.parsed_json?.skills.map((s) => s.name) ?? [])]
    .filter((t): t is string => Boolean(t && t.length <= 40))
    .slice(0, 50);
  return { text: lines.filter(Boolean).join('\n'), keyterms: [...new Set(keyterms)] };
}

/** One open room per session, so a second tab takes over instead of running the interview twice. */
const rooms = new Map<string, { room: PracticeRoom; close: () => void }>();

export default async function practiceRoutes(app: FastifyInstance) {
  // ---- REST --------------------------------------------------------------------------------------
  await app.register(async (rest) => {
    rest.addHook('preHandler', requireAuth);

    rest.get('/v1/practice', async (req): Promise<{ sessions: PracticeSummary[] }> => {
      const rows = await sql<SessionRow[]>`
        select ${COLUMNS} from public.practice_sessions where user_id = ${req.user.id} order by created_at desc limit 100`;
      return { sessions: rows.map(toSummary) };
    });

    rest.get<{ Params: { id: string } }>('/v1/practice/:id', async (req, reply): Promise<{ session: PracticeSession } | void> => {
      if (!uuid.safeParse(req.params.id).success) return notFound(reply);
      const row = await findOne(req.user.id, req.params.id);
      return row ? { session: toSession(row) } : notFound(reply);
    });

    rest.post('/v1/practice', async (req, reply): Promise<{ session: PracticeSession } | void> => {
      const body = setupBody.safeParse(req.body);
      if (!body.success) return reply.code(400).send({ error: 'bad_request', message: body.error.issues[0]?.message ?? 'Invalid setup' });
      const { interviewId, roundType, difficulty, durationMinutes } = body.data;

      if (isOut(await trialBalance(req.user.id))) return noMinutes(reply);

      const [resume] = await sql<{ name: string | null }[]>`
        select parsed_json ->> 'name' as name from public.resumes where user_id = ${req.user.id} order by created_at desc limit 1`;
      if (!resume) {
        return reply.code(409).send({
          error: NO_RESUME_ERROR, message: 'Upload your resume first. The interviewer asks about your own experience.',
        });
      }

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
      const name = (req.user.name || resume.name || '').slice(0, 80);
      const [row] = await sql<SessionRow[]>`
        insert into public.practice_sessions (user_id, interview_id, title, round_type, difficulty, duration_minutes, candidate_name, status)
        values (${req.user.id}, ${interviewId}, ${title}, ${roundType}, ${difficulty}, ${durationMinutes}, ${name}, 'ready')
        returning ${COLUMNS}`;
      return reply.code(201).send({ session: toSession(row) });
    });

    // Ends a session that is no longer live (e.g. the tab was closed mid-interview) and starts the debrief.
    rest.post<{ Params: { id: string } }>('/v1/practice/:id/finish', async (req, reply): Promise<{ session: PracticeSession } | void> => {
      if (!uuid.safeParse(req.params.id).success) return notFound(reply);
      const current = await findOne(req.user.id, req.params.id);
      if (!current) return notFound(reply);
      if (current.status !== 'ready') return reply.code(409).send({ error: 'conflict', message: 'This session has already ended.' });
      if (!answeredCount(current.answers)) {
        return reply.code(400).send({ error: 'no_answers', message: 'Answer at least one question to get feedback.' });
      }
      rooms.get(current.id)?.close();
      // Questions asked but never answered aren't part of the interview.
      while (current.questions.length && !current.answers[current.questions.length - 1]) {
        current.questions.pop();
        current.answers.pop();
      }
      await sql`
        update public.practice_sessions
        set questions = ${sql.json(current.questions as never)}, answers = ${sql.json(current.answers as never)},
            question_count = ${current.questions.length}
        where id = ${current.id}`;
      const row = await finishSession(current.id, req.log);
      if (!row) return reply.code(409).send({ error: 'conflict', message: 'This session has already ended.' });
      return { session: toSession(row) };
    });

    // A failed debrief: run it again.
    rest.post<{ Params: { id: string } }>('/v1/practice/:id/retry', async (req, reply): Promise<{ session: PracticeSession } | void> => {
      if (!uuid.safeParse(req.params.id).success) return notFound(reply);
      const current = await findOne(req.user.id, req.params.id);
      if (!current) return notFound(reply);
      if (current.status !== 'failed' || !answeredCount(current.answers)) {
        return reply.code(409).send({ error: 'conflict', message: 'Nothing to retry.' });
      }
      const [row] = await sql<SessionRow[]>`
        update public.practice_sessions set status = 'scoring', error = null, updated_at = now()
        where id = ${current.id} and status = 'failed' returning ${COLUMNS}`;
      await enqueueScore(row.id);
      return { session: toSession(row) };
    });

    rest.delete<{ Params: { id: string } }>('/v1/practice/:id', async (req, reply) => {
      if (!uuid.safeParse(req.params.id).success) return notFound(reply);
      rooms.get(req.params.id)?.close();
      const res = await sql`delete from public.practice_sessions where id = ${req.params.id} and user_id = ${req.user.id}`;
      if (!res.count) return notFound(reply);
      return { ok: true };
    });
  });

  // ---- the live interview ------------------------------------------------------------------------
  // Authenticated by the first message rather than a header, which browsers can't set on a WebSocket.
  app.get<{ Params: { id: string } }>('/v1/practice/:id/live', { websocket: true }, (socket, req) => {
    const sessionId = req.params.id;
    let room: PracticeRoom | null = null;
    let authed = false;
    const send = (m: PracticeServerMessage) => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(m));
    };
    const fail = (code: string, message: string, closeCode = 4000) => {
      send({ type: 'error', code, message });
      socket.close(closeCode, code);
    };
    const authTimer = setTimeout(() => !authed && fail('unauthorized', 'No access token', 4001), AUTH_TIMEOUT_MS);

    const open = async (token: string, hour: number) => {
      if (!uuid.safeParse(sessionId).success) return fail('not_found', 'No such practice session', 4004);
      let user;
      try {
        user = await authenticate(token, req.log);
      } catch (err) {
        if (err instanceof AuthError) return fail(err.code, err.message, 4001);
        throw err;
      }
      const row = await findOne(user.id, sessionId);
      if (!row) return fail('not_found', 'No such practice session', 4004);
      if (row.status !== 'ready' || !row.duration_minutes) return fail('conflict', 'This session is no longer live.', 4009);
      if (isOut(await trialBalance(user.id))) return fail(NO_MINUTES_ERROR, NO_MINUTES_MESSAGE, 4002);
      if (!llmConfigured()) return fail('unavailable', 'Practice needs the AI model to be configured on the server.', 4003);
      const context = await interviewContext(row);
      if (!context) return fail(NO_RESUME_ERROR, 'Upload your resume first. The interviewer asks about your own experience.', 4009);
      if (socket.readyState !== socket.OPEN) return;

      const settings = await getSettings().catch(() => null);
      rooms.get(sessionId)?.close();
      const store: RoomStore = {
        addQuestion: async (q) => {
          await sql`
            update public.practice_sessions
            set questions = questions || jsonb_build_array(${sql.json(q as never)}::jsonb), answers = answers || '[null]'::jsonb,
                question_count = question_count + 1, updated_at = now()
            where id = ${sessionId}`;
        },
        setAnswer: async (index, answer) => {
          await sql`
            update public.practice_sessions
            set answers = jsonb_set(answers, ${[String(index)]}, ${sql.json(answer as never)}), updated_at = now()
            where id = ${sessionId}`;
        },
        dropLastQuestion: async () => {
          await sql`
            update public.practice_sessions
            set questions = questions - (-1), answers = answers - (-1), question_count = greatest(question_count - 1, 0)
            where id = ${sessionId}`;
        },
        start: async () => {
          await sql`update public.practice_sessions set started_at = coalesce(started_at, now()), updated_at = now() where id = ${sessionId}`;
        },
        addSeconds: async (seconds) => {
          await sql`update public.practice_sessions set seconds = seconds + ${seconds}, updated_at = now() where id = ${sessionId}`;
        },
        finish: async () => {
          const done = await finishSession(sessionId, req.log);
          if (!done) throw new Error('practice session was not live');
          return toSession(done);
        },
        load: async () => toSession((await findOne(user.id, sessionId))!),
      };
      room = new PracticeRoom({
        userId: user.id,
        session: toSession(row),
        candidateName: row.candidate_name,
        context: context.text,
        keyterms: context.keyterms,
        model: resolveModels({ fast: settings?.fastModel }).fast,
        hour,
        store,
        send,
        sendAudio: (pcm) => socket.readyState === socket.OPEN && socket.send(pcm, { binary: true }),
        close: () => socket.close(1000, 'done'),
        log: req.log,
      });
      const entry = { room, close: () => socket.close(4010, 'opened elsewhere') };
      rooms.set(sessionId, entry);
      socket.on('close', () => rooms.get(sessionId) === entry && rooms.delete(sessionId));
      send({ type: 'ready', stt: sttConfigured(), tts: ttsConfigured(), session: toSession(row) });
      room.hello();
      req.log.info({ userId: user.id, sessionId }, 'practice room opened');
    };

    socket.on('message', (raw, isBinary) => {
      if (isBinary) return room?.audio(Buffer.isBuffer(raw) ? raw : Buffer.concat(raw as Buffer[]));
      const msg = parseMessage<PracticeClientMessage>(raw.toString());
      if (!msg) return;
      if (!authed) {
        if (msg.type !== 'auth' || typeof msg.token !== 'string') return fail('unauthorized', 'No access token', 4001);
        authed = true;
        clearTimeout(authTimer);
        const hour = Number.isInteger(msg.hour) && msg.hour >= 0 && msg.hour < 24 ? msg.hour : new Date().getHours();
        open(msg.token, hour).catch((err) => {
          req.log.error({ err }, 'could not open practice room');
          fail('internal', 'Could not start the interview. Try again.');
        });
        return;
      }
      if (!room) return;
      switch (msg.type) {
        case 'join':
          return void room.join().catch((err) => req.log.error({ err }, 'practice join failed'));
        case 'said':
          return room.said(String(msg.id));
        case 'done':
          return room.done();
        case 'repeat':
          return void room.repeat();
        case 'text':
          return typeof msg.text === 'string' ? room.text(msg.text) : undefined;
        case 'test':
          return void room.test();
        case 'end':
          return void room.endEarly();
      }
    });

    socket.on('close', () => {
      clearTimeout(authTimer);
      room?.close();
    });
  });
}
