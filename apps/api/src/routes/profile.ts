import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { PROFILE_LIMITS, type Resume, type ResumeProfile } from '@parakeet/shared';
import { requireAuth } from '../lib/auth.js';
import { sql } from '../lib/db.js';
import { profileQueue } from '../lib/queues.js';
import { ensureUser } from '../lib/users.js';
import { extractResumeText, resumeKind, ResumeTextError } from '../lib/resumeText.js';

// The user's resume (spec A2). The latest one is attached to every live answer (see lib/context.ts);
// interviews live in routes/interviews.ts.

interface ResumeRow {
  id: string;
  file_name: string;
  status: Resume['status'];
  error: string | null;
  char_count: number;
  parsed_json: ResumeProfile | null;
  profile_edited_at: Date | null;
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
  profileEditedAt: r.profile_edited_at?.toISOString() ?? null,
  createdAt: r.created_at.toISOString(),
  updatedAt: r.updated_at.toISOString(),
});

const uploadBody = z.object({
  fileName: z.string().min(1).max(255),
  mimeType: z.string().max(255),
  data: z.string().min(1),
});

const line = (max = 2_000) => z.string().trim().max(max);
const list = <T extends z.ZodType>(item: T, max = 60) => z.array(item).max(max);

// Mirrors ResumeProfile; what the worker writes, as corrected by the candidate.
const profileBody = z.object({
  name: line(200).nullable(),
  headline: line(300).nullable(),
  summary: line(),
  totalYearsExperience: z.number().min(0).max(70).nullable(),
  skills: list(z.object({ name: line(100).min(1), years: z.number().min(0).max(70).nullable() }), 150),
  experience: list(
    z.object({ company: line(200), title: line(200), period: line(100).nullable(), highlights: list(line(), 30) }),
  ),
  projects: list(z.object({ name: line(200), summary: line(), tech: list(line(100), 40), impact: line().nullable() })),
  education: list(z.object({ school: line(200), degree: line(200).nullable(), year: line(50).nullable() })),
  certifications: list(line(200), 60),
  stories: list(z.object({ title: line(200).min(1), situation: line(), action: line(), result: line() }), 30),
});

/** Re-analysis costs a model call; don't start another one right after the last. */
const REANALYZE_COOLDOWN_S = 30;

const RESUME_COLUMNS = sql`id, file_name, status, error, length(text) as char_count, parsed_json, profile_edited_at, created_at, updated_at`;

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

  // Exactly what Friday reads, so candidates can check a PDF was read correctly.
  app.get('/v1/resume/text', async (req, reply): Promise<{ text: string } | void> => {
    const [row] = await sql<{ text: string }[]>`
      select text from public.resumes where user_id = ${req.user.id} order by created_at desc limit 1`;
    if (!row) return reply.code(404).send({ error: 'not_found', message: 'No resume' });
    return { text: row.text };
  });

  app.put('/v1/resume/profile', { bodyLimit: PROFILE_LIMITS.maxProfileChars * 2 }, async (req, reply): Promise<{ resume: Resume } | void> => {
    const body = profileBody.safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'bad_request', message: body.error.issues[0]?.message ?? 'Invalid profile' });
    }
    if (JSON.stringify(body.data).length > PROFILE_LIMITS.maxProfileChars) {
      return reply.code(413).send({ error: 'too_large', message: 'The profile is too long.' });
    }
    const [row] = await sql<ResumeRow[]>`
      update public.resumes
      set parsed_json = ${sql.json(body.data as never)}, profile_edited_at = now(), updated_at = now()
      where id = (select id from public.resumes where user_id = ${req.user.id} order by created_at desc limit 1)
        and status <> 'parsing'
      returning ${RESUME_COLUMNS}`;
    if (!row) return reply.code(409).send({ error: 'conflict', message: 'Your resume is being analysed. Try again in a moment.' });
    return { resume: toResume(row) };
  });

  app.post('/v1/resume/reanalyze', async (req, reply): Promise<{ resume: Resume } | void> => {
    const [current] = await sql<{ id: string; status: Resume['status']; age_s: number }[]>`
      select id, status, extract(epoch from now() - updated_at)::int as age_s from public.resumes
      where user_id = ${req.user.id} order by created_at desc limit 1`;
    if (!current) return reply.code(404).send({ error: 'not_found', message: 'No resume' });
    if (current.status === 'parsing') return reply.code(409).send({ error: 'conflict', message: 'Already analysing.' });
    if (current.age_s < REANALYZE_COOLDOWN_S) {
      return reply.code(429).send({ error: 'too_soon', message: 'Please wait a few seconds before analysing again.' });
    }
    const [row] = await sql<ResumeRow[]>`
      update public.resumes set status = 'parsing', error = null, updated_at = now()
      where id = ${current.id} returning ${RESUME_COLUMNS}`;
    try {
      await profileQueue.add('resume.parse', { resumeId: row.id }, { jobId: `resume-${row.id}-${Date.now()}` });
    } catch (err) {
      req.log.error({ err }, 'failed to enqueue resume analysis');
      const [failed] = await sql<ResumeRow[]>`
        update public.resumes set status = 'failed', error = 'Detailed analysis is unavailable right now.', updated_at = now()
        where id = ${row.id} returning ${RESUME_COLUMNS}`;
      return { resume: toResume(failed) };
    }
    return { resume: toResume(row) };
  });

  app.delete('/v1/resume', async (req) => {
    await sql`delete from public.resumes where user_id = ${req.user.id}`;
    return { ok: true };
  });
}
