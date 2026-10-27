import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import {
  PROFILE_LIMITS, ROUND_TYPES, INTERVIEW_STAGES, type Interview, type InterviewDetail, type InterviewStage,
  type InterviewSummary, type RoundType,
} from '@parakeet/shared';
import { requireAuth } from '../lib/auth.js';
import { sql } from '../lib/db.js';
import { ensureUser } from '../lib/users.js';

// Interviews (spec A3): a user keeps any number of them; the most recently activated one is "active"
// and its context is attached to every live answer (see lib/context.ts). The desktop app only knows
// the active one, through GET/PUT /v1/interview.

interface InterviewRow {
  id: string;
  field: string;
  company: string;
  role: string;
  round_type: RoundType;
  jd_text: string;
  instructions: string;
  status: InterviewStage;
  scheduled_at: Date | null;
  notes: string;
  active: boolean;
  created_at: Date;
  updated_at: Date;
}

interface SummaryRow extends InterviewRow {
  questions: number;
  sessions: number;
  last_used_at: Date | null;
}

const toInterview = (r: InterviewRow): Interview => ({
  id: r.id,
  field: r.field,
  company: r.company,
  role: r.role,
  roundType: r.round_type,
  jobDescription: r.jd_text,
  instructions: r.instructions,
  stage: r.status,
  scheduledAt: r.scheduled_at?.toISOString() ?? null,
  notes: r.notes,
  active: r.active,
  createdAt: r.created_at.toISOString(),
  updatedAt: r.updated_at.toISOString(),
});

const toSummary = (r: SummaryRow): InterviewSummary => ({
  ...toInterview(r),
  stats: { questions: r.questions, sessions: r.sessions, lastUsedAt: r.last_used_at?.toISOString() ?? null },
});

/** Columns of `public.interview_sessions i`, plus whether it is the user's active interview. */
const COLUMNS = sql`
  i.id, i.field, i.company, i.role, i.round_type, i.jd_text, i.instructions, i.status, i.scheduled_at, i.notes,
  i.created_at, i.updated_at,
  i.id = (select a.id from public.interview_sessions a where a.user_id = i.user_id order by a.active_at desc limit 1) as active`;

const STATS = sql`
  left join lateral (
    select count(*) filter (where t.status <> 'blocked')::int as questions,
           count(distinct t.live_session_id)::int as sessions,
           max(t.created_at) as last_used_at
    from public.live_turns t where t.interview_id = i.id
  ) s on true`;

const trimmed = (max: number) => z.string().max(max).transform((s) => s.trim());

const fields = {
  field: trimmed(PROFILE_LIMITS.maxFieldChars),
  company: trimmed(PROFILE_LIMITS.maxCompanyChars),
  role: trimmed(PROFILE_LIMITS.maxRoleChars),
  roundType: z.enum(ROUND_TYPES.map((r) => r.id) as [RoundType, ...RoundType[]]),
  jobDescription: trimmed(PROFILE_LIMITS.maxJobDescriptionChars),
  instructions: trimmed(PROFILE_LIMITS.maxInstructionsChars),
};

const extra = {
  stage: z.enum(INTERVIEW_STAGES.map((s) => s.id) as [InterviewStage, ...InterviewStage[]]),
  scheduledAt: z.iso.datetime({ offset: true }).nullable(),
  notes: z.string().max(PROFILE_LIMITS.maxNotesChars).transform((s) => s.trimEnd()),
};

const createBody = z.object({
  field: fields.field.default(''),
  company: fields.company.default(''),
  role: fields.role.default(''),
  roundType: fields.roundType.default('general'),
  jobDescription: fields.jobDescription.default(''),
  instructions: fields.instructions.default(''),
  stage: extra.stage.default('preparing'),
  scheduledAt: extra.scheduledAt.default(null),
  notes: extra.notes.default(''),
});

const patchBody = z.object({ ...fields, ...extra }).partial();

// The desktop app's save: the active interview's context only. Older builds don't send a field or
// instructions.
const legacyBody = z.object({
  ...fields,
  field: fields.field.default(''),
  instructions: fields.instructions.default(''),
});

const COLUMN_OF = {
  field: 'field',
  company: 'company',
  role: 'role',
  roundType: 'round_type',
  jobDescription: 'jd_text',
  instructions: 'instructions',
  stage: 'status',
  scheduledAt: 'scheduled_at',
  notes: 'notes',
} as const satisfies Record<keyof z.infer<typeof patchBody>, string>;

const uuid = z.uuid();

const badRequest = (reply: FastifyReply, error: z.ZodError) =>
  reply.code(400).send({ error: 'bad_request', message: error.issues[0]?.message ?? 'Invalid interview' });
const limitReached = (reply: FastifyReply) =>
  reply.code(409).send({
    error: 'limit', message: `You can keep up to ${PROFILE_LIMITS.maxInterviews} interviews. Delete an old one first.`,
  });
const notFound = (reply: FastifyReply) => reply.code(404).send({ error: 'not_found', message: 'No such interview' });

export default async function interviewRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  async function findOne(userId: string, id: string) {
    const [row] = await sql<InterviewRow[]>`
      select ${COLUMNS} from public.interview_sessions i where i.id = ${id} and i.user_id = ${userId}`;
    return row ? toInterview(row) : null;
  }

  async function atLimit(userId: string) {
    const [{ n }] = await sql<{ n: number }[]>`
      select count(*)::int as n from public.interview_sessions where user_id = ${userId}`;
    return n >= PROFILE_LIMITS.maxInterviews;
  }

  // ---- website ---------------------------------------------------------------------------------

  app.get('/v1/interviews', async (req): Promise<{ interviews: InterviewSummary[] }> => {
    const rows = await sql<SummaryRow[]>`
      select ${COLUMNS}, s.questions, s.sessions, s.last_used_at
      from public.interview_sessions i ${STATS}
      where i.user_id = ${req.user.id}
      order by i.updated_at desc`;
    return { interviews: rows.map(toSummary) };
  });

  app.get<{ Params: { id: string } }>('/v1/interviews/:id', async (req, reply): Promise<{ interview: InterviewDetail } | void> => {
    if (!uuid.safeParse(req.params.id).success) return notFound(reply);
    const [row] = await sql<SummaryRow[]>`
      select ${COLUMNS}, s.questions, s.sessions, s.last_used_at
      from public.interview_sessions i ${STATS}
      where i.id = ${req.params.id} and i.user_id = ${req.user.id}`;
    if (!row) return notFound(reply);
    const recent = await sql<{ question: string; created_at: Date }[]>`
      select question, created_at from public.live_turns
      where interview_id = ${row.id} and status <> 'blocked' and question <> ''
      order by created_at desc limit 20`;
    return {
      interview: {
        ...toSummary(row),
        recentQuestions: recent.map((q) => ({ question: q.question, createdAt: q.created_at.toISOString() })),
      },
    };
  });

  // A new interview becomes the active one: it's what the user is preparing for now.
  app.post('/v1/interviews', async (req, reply): Promise<{ interview: Interview } | void> => {
    const body = createBody.safeParse(req.body ?? {});
    if (!body.success) return badRequest(reply, body.error);
    const b = body.data;
    await ensureUser(req);
    if (await atLimit(req.user.id)) return limitReached(reply);
    const [created] = await sql<{ id: string }[]>`
      insert into public.interview_sessions
        (user_id, field, company, role, round_type, jd_text, instructions, status, scheduled_at, notes)
      values (${req.user.id}, ${b.field}, ${b.company}, ${b.role}, ${b.roundType}, ${b.jobDescription},
              ${b.instructions}, ${b.stage}, ${b.scheduledAt}, ${b.notes})
      returning id`;
    return reply.code(201).send({ interview: await findOne(req.user.id, created.id) });
  });

  // Editing doesn't change which interview is active.
  app.patch<{ Params: { id: string } }>('/v1/interviews/:id', async (req, reply): Promise<{ interview: Interview } | void> => {
    if (!uuid.safeParse(req.params.id).success) return notFound(reply);
    const body = patchBody.safeParse(req.body ?? {});
    if (!body.success) return badRequest(reply, body.error);
    const changes = Object.fromEntries(
      Object.entries(body.data)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [COLUMN_OF[k as keyof typeof COLUMN_OF], v]),
    );
    if (Object.keys(changes).length) {
      const res = await sql`
        update public.interview_sessions set ${sql(changes)}, updated_at = now()
        where id = ${req.params.id} and user_id = ${req.user.id}`;
      if (!res.count) return notFound(reply);
    }
    const interview = await findOne(req.user.id, req.params.id);
    return interview ? { interview } : notFound(reply);
  });

  app.post<{ Params: { id: string } }>('/v1/interviews/:id/activate', async (req, reply): Promise<{ interview: Interview } | void> => {
    if (!uuid.safeParse(req.params.id).success) return notFound(reply);
    const res = await sql`
      update public.interview_sessions set active_at = now()
      where id = ${req.params.id} and user_id = ${req.user.id}`;
    if (!res.count) return notFound(reply);
    return { interview: (await findOne(req.user.id, req.params.id))! };
  });

  // For the next round at the same organisation: same context, fresh stage and date.
  app.post<{ Params: { id: string } }>('/v1/interviews/:id/duplicate', async (req, reply): Promise<{ interview: Interview } | void> => {
    if (!uuid.safeParse(req.params.id).success) return notFound(reply);
    if (await atLimit(req.user.id)) return limitReached(reply);
    const [copy] = await sql<{ id: string }[]>`
      insert into public.interview_sessions (user_id, field, company, role, round_type, jd_text, instructions, notes)
      select user_id, field, company, role, round_type, jd_text, instructions, notes
      from public.interview_sessions where id = ${req.params.id} and user_id = ${req.user.id}
      returning id`;
    if (!copy) return notFound(reply);
    return reply.code(201).send({ interview: await findOne(req.user.id, copy.id) });
  });

  app.delete<{ Params: { id: string } }>('/v1/interviews/:id', async (req, reply) => {
    if (!uuid.safeParse(req.params.id).success) return notFound(reply);
    const res = await sql`delete from public.interview_sessions where id = ${req.params.id} and user_id = ${req.user.id}`;
    if (!res.count) return notFound(reply);
    return { ok: true };
  });

  // ---- desktop app -----------------------------------------------------------------------------

  app.get('/v1/interview', async (req): Promise<{ interview: Interview | null }> => {
    const [row] = await sql<InterviewRow[]>`
      select ${COLUMNS} from public.interview_sessions i
      where i.user_id = ${req.user.id} order by i.active_at desc limit 1`;
    return { interview: row ? toInterview(row) : null };
  });

  // Saves the active interview's context, or creates the first interview.
  app.put('/v1/interview', async (req, reply): Promise<{ interview: Interview } | void> => {
    const body = legacyBody.safeParse(req.body);
    if (!body.success) return badRequest(reply, body.error);
    const { field, company, role, roundType, jobDescription, instructions } = body.data;
    await ensureUser(req);
    const [updated] = await sql<{ id: string }[]>`
      update public.interview_sessions
      set field = ${field}, company = ${company}, role = ${role}, round_type = ${roundType},
          jd_text = ${jobDescription}, instructions = ${instructions}, updated_at = now()
      where id = (
        select id from public.interview_sessions where user_id = ${req.user.id} order by active_at desc limit 1
      )
      returning id`;
    const id =
      updated?.id ??
      (
        await sql<{ id: string }[]>`
          insert into public.interview_sessions (user_id, field, company, role, round_type, jd_text, instructions)
          values (${req.user.id}, ${field}, ${company}, ${role}, ${roundType}, ${jobDescription}, ${instructions})
          returning id`
      )[0].id;
    return { interview: (await findOne(req.user.id, id))! };
  });
}
