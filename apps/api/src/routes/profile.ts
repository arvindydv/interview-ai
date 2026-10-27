import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { PROFILE_LIMITS, type Interview, type Resume, type ResumeProfile, type RoundType } from '@parakeet/shared';
import { requireAuth } from '../lib/auth.js';
import { sql } from '../lib/db.js';
import { profileQueue } from '../lib/queues.js';
import { extractResumeText, resumeKind, ResumeTextError } from '../lib/resumeText.js';

// Interview context (spec A2/A3): the user's resume and the interview they're preparing for. The
// latest of each is attached to every live answer (see lib/context.ts).

interface ResumeRow {
  id: string;
  file_name: string;
  status: Resume['status'];
  error: string | null;
  char_count: number;
  parsed_json: ResumeProfile | null;
  created_at: Date;
  updated_at: Date;
}

const toResume = (r: ResumeRow): Resume => ({
  id: r.id,
  fileName: r.file_name,
  status: r.status,
  error: r.error,
  charCount: r.char_count,
  profile: r.parsed_json,
  createdAt: r.created_at.toISOString(),
  updatedAt: r.updated_at.toISOString(),
});

interface InterviewRow {
  id: string;
  field: string;
  company: string;
  role: string;
  round_type: RoundType;
  jd_text: string;
  instructions: string;
  updated_at: Date;
}

const toInterview = (r: InterviewRow): Interview => ({
  id: r.id,
  field: r.field,
  company: r.company,
  role: r.role,
  roundType: r.round_type,
  jobDescription: r.jd_text,
  instructions: r.instructions,
  updatedAt: r.updated_at.toISOString(),
});

const uploadBody = z.object({
  fileName: z.string().min(1).max(255),
  mimeType: z.string().max(255),
  data: z.string().min(1),
});

const interviewBody = z.object({
  // Older desktop builds don't send a field.
  field: z.string().max(PROFILE_LIMITS.maxFieldChars).default('').transform((s) => s.trim()),
  company: z.string().max(PROFILE_LIMITS.maxCompanyChars).transform((s) => s.trim()),
  role: z.string().max(PROFILE_LIMITS.maxRoleChars).transform((s) => s.trim()),
  roundType: z.enum(['general', 'behavioral', 'technical', 'case_study', 'presentation', 'coding', 'system_design']),
  jobDescription: z.string().max(PROFILE_LIMITS.maxJobDescriptionChars).transform((s) => s.trim()),
  // Older desktop builds don't send instructions.
  instructions: z.string().max(PROFILE_LIMITS.maxInstructionsChars).default('').transform((s) => s.trim()),
});

/** Profile rows reference public.users, which is normally created by GET /v1/me. */
async function ensureUser(req: FastifyRequest) {
  await sql`
    insert into public.users (id, email, auth_provider)
    values (${req.user.id}, ${req.user.email}, ${req.user.provider})
    on conflict (id) do nothing`;
}

const RESUME_COLUMNS = sql`id, file_name, status, error, length(text) as char_count, parsed_json, created_at, updated_at`;

export default async function profileRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  app.get('/v1/resume', async (req): Promise<{ resume: Resume | null }> => {
    const [row] = await sql<ResumeRow[]>`
      select ${RESUME_COLUMNS} from public.resumes
      where user_id = ${req.user.id} order by created_at desc limit 1`;
    return { resume: row ? toResume(row) : null };
  });

  // Upload replaces the previous resume. Text is extracted here so unreadable files fail immediately;
  // the structured analysis runs in apps/worker.
  app.post(
    '/v1/resume',
    // Base64 inflates by 4/3; leave room for the JSON wrapper.
    { bodyLimit: Math.ceil((PROFILE_LIMITS.maxResumeBytes * 4) / 3) + 64 * 1024 },
    async (req, reply) => {
      const body = uploadBody.safeParse(req.body);
      if (!body.success) return reply.code(400).send({ error: 'bad_request', message: 'Invalid upload' });
      const { fileName, mimeType, data } = body.data;

      const kind = resumeKind(fileName, mimeType);
      if (!kind) return reply.code(415).send({ error: 'unsupported_type', message: 'Upload a PDF, DOCX or TXT file.' });
      const file = Buffer.from(data, 'base64');
      if (file.length > PROFILE_LIMITS.maxResumeBytes) {
        return reply.code(413).send({ error: 'too_large', message: 'Resumes can be up to 5 MB.' });
      }

      let text: string;
      try {
        text = await extractResumeText(kind, file);
      } catch (err) {
        if (err instanceof ResumeTextError) return reply.code(422).send({ error: 'unreadable', message: err.message });
        throw err;
      }

      await ensureUser(req);
      const row = await sql.begin(async (tx) => {
        await tx`delete from public.resumes where user_id = ${req.user.id}`;
        const [r] = await tx<ResumeRow[]>`
          insert into public.resumes (user_id, file_name, mime_type, text)
          values (${req.user.id}, ${fileName}, ${mimeType || kind}, ${text})
          returning ${RESUME_COLUMNS}`;
        return r;
      });

      try {
        await profileQueue.add('resume.parse', { resumeId: row.id }, { jobId: `resume-${row.id}` });
      } catch (err) {
        req.log.error({ err }, 'failed to enqueue resume analysis');
        const [failed] = await sql<ResumeRow[]>`
          update public.resumes
          set status = 'failed', error = 'Detailed analysis is unavailable right now.', updated_at = now()
          where id = ${row.id} returning ${RESUME_COLUMNS}`;
        return { resume: toResume(failed) };
      }
      return { resume: toResume(row) };
    },
  );

  app.delete('/v1/resume', async (req) => {
    await sql`delete from public.resumes where user_id = ${req.user.id}`;
    return { ok: true };
  });

  app.get('/v1/interview', async (req): Promise<{ interview: Interview | null }> => {
    const [row] = await sql<InterviewRow[]>`
      select id, field, company, role, round_type, jd_text, instructions, updated_at from public.interview_sessions
      where user_id = ${req.user.id} order by updated_at desc limit 1`;
    return { interview: row ? toInterview(row) : null };
  });

  // Saves the current interview (updates the latest one, or creates the first).
  app.put('/v1/interview', async (req, reply): Promise<{ interview: Interview } | void> => {
    const body = interviewBody.safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'bad_request', message: body.error.issues[0]?.message ?? 'Invalid interview' });
    }
    const { field, company, role, roundType, jobDescription, instructions } = body.data;
    await ensureUser(req);
    const [updated] = await sql<InterviewRow[]>`
      update public.interview_sessions
      set field = ${field}, company = ${company}, role = ${role}, round_type = ${roundType},
          jd_text = ${jobDescription}, instructions = ${instructions}, updated_at = now()
      where id = (
        select id from public.interview_sessions where user_id = ${req.user.id} order by updated_at desc limit 1
      )
      returning id, field, company, role, round_type, jd_text, instructions, updated_at`;
    if (updated) return { interview: toInterview(updated) };
    const [created] = await sql<InterviewRow[]>`
      insert into public.interview_sessions (user_id, field, company, role, round_type, jd_text, instructions)
      values (${req.user.id}, ${field}, ${company}, ${role}, ${roundType}, ${jobDescription}, ${instructions})
      returning id, field, company, role, round_type, jd_text, instructions, updated_at`;
    return { interview: toInterview(created) };
  });
}
