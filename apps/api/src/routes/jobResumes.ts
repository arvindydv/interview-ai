import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { PROFILE_LIMITS, activeJobsPlan, type JobResume, type JobResumeList } from '@parakeet/shared';
import { requireAuth } from '../lib/auth.js';
import { sql } from '../lib/db.js';
import { profileQueue } from '../lib/queues.js';
import { ResumeTextError, extractResumeText, resumeKind } from '../lib/resumeText.js';
import { ensureUser } from '../lib/users.js';

// Friday Jobs role-specific resumes ("Frontend", "Backend"…), besides the main resume (routes/profile.ts)
// that the interview assistant uses. Tailoring picks the one whose target roles fit each job's title
// (apps/worker/src/queues/tailor.ts pickResume). How many a user keeps depends on their plan.

interface Row {
  id: string;
  name: string;
  target_roles: string[];
  file_name: string;
  status: JobResume['status'];
  error: string | null;
  created_at: Date;
}

const COLUMNS = sql`id, name, target_roles, file_name, status, error, created_at`;

const toResume = (r: Row): JobResume => ({
  id: r.id,
  name: r.name,
  targetRoles: r.target_roles,
  fileName: r.file_name,
  status: r.status,
  error: r.error,
  createdAt: r.created_at.toISOString(),
});

const roles = z.array(z.string().trim().min(1).max(80)).max(10);
const createBody = z.object({
  name: z.string().trim().min(1).max(60),
  targetRoles: roles,
  fileName: z.string().min(1).max(255),
  mimeType: z.string().max(255),
  data: z.string().min(1),
});
const updateBody = z.object({ name: z.string().trim().min(1).max(60), targetRoles: roles });

async function planLimit(userId: string) {
  const [u] = await sql<{ jobs_plan: string | null; jobs_plan_expires_at: Date | null }[]>`
    select jobs_plan, jobs_plan_expires_at from public.users where id = ${userId}`;
  return activeJobsPlan(u?.jobs_plan, u?.jobs_plan_expires_at);
}

export default async function jobResumeRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  app.get('/v1/job-resumes', async (req): Promise<JobResumeList> => {
    const userId = req.user.id;
    const [[main], items, plan] = await Promise.all([
      sql<{ file_name: string; status: JobResume['status']; has_file: boolean }[]>`
        select file_name, status, file is not null as has_file from public.resumes where user_id = ${userId} order by created_at desc limit 1`,
      sql<Row[]>`select ${COLUMNS} from public.job_resumes where user_id = ${userId} order by created_at`,
      planLimit(userId),
    ]);
    return {
      main: main ? { fileName: main.file_name, status: main.status, hasFile: main.has_file } : null,
      items: items.map(toResume),
      limit: plan.resumes,
    };
  });

  app.post(
    '/v1/job-resumes',
    { bodyLimit: Math.ceil((PROFILE_LIMITS.maxResumeBytes * 4) / 3) + 64 * 1024 },
    async (req, reply): Promise<JobResume | void> => {
      const body = createBody.safeParse(req.body);
      if (!body.success) return reply.code(400).send({ error: 'bad_request', message: body.error.issues[0]?.message ?? 'Invalid upload' });
      const userId = req.user.id;
      const plan = await planLimit(userId);
      const [{ n }] = await sql<{ n: number }[]>`select count(*)::int as n from public.job_resumes where user_id = ${userId}`;
      // The main resume takes one of the plan's places.
      if (n + 1 >= plan.resumes) {
        return reply.code(402).send({
          error: 'plan_limit',
          message: plan.resumes === 1
            ? 'Your plan includes one resume. Upgrade to Standard for resumes for different roles.'
            : `Your ${plan.name} plan includes ${plan.resumes} resumes.`,
        });
      }
      const { name, targetRoles, fileName, mimeType, data } = body.data;
      const kind = resumeKind(fileName, mimeType);
      if (kind !== 'pdf' && kind !== 'docx') return reply.code(415).send({ error: 'unsupported_type', message: 'Upload a PDF or Word file.' });
      const file = Buffer.from(data, 'base64');
      if (file.length > PROFILE_LIMITS.maxResumeBytes) return reply.code(413).send({ error: 'too_large', message: 'Resumes can be up to 5 MB.' });
      let text: string;
      try {
        text = await extractResumeText(kind, file);
      } catch (err) {
        if (err instanceof ResumeTextError) return reply.code(422).send({ error: 'unreadable', message: err.message });
        throw err;
      }
      await ensureUser(req);
      const [row] = await sql<Row[]>`
        insert into public.job_resumes (user_id, name, target_roles, file_name, mime_type, text, file)
        values (${userId}, ${name}, ${targetRoles}, ${fileName}, ${mimeType || kind}, ${text}, ${file})
        returning ${COLUMNS}`;
      try {
        await profileQueue.add('job-resume.parse', { resumeId: row.id }, { jobId: `job-resume-${row.id}` });
      } catch (err) {
        req.log.error({ err }, 'failed to enqueue job resume analysis');
        await sql`update public.job_resumes set status = 'ready', error = 'Detailed analysis is unavailable right now.' where id = ${row.id}`;
      }
      return toResume(row);
    },
  );

  app.patch<{ Params: { id: string } }>('/v1/job-resumes/:id', async (req, reply): Promise<JobResume | void> => {
    const body = updateBody.safeParse(req.body);
    if (!body.success || !z.uuid().safeParse(req.params.id).success) return reply.code(400).send({ error: 'bad_request', message: 'Invalid resume.' });
    const [row] = await sql<Row[]>`
      update public.job_resumes set name = ${body.data.name}, target_roles = ${body.data.targetRoles}, updated_at = now()
      where id = ${req.params.id} and user_id = ${req.user.id}
      returning ${COLUMNS}`;
    if (!row) return reply.notFound('No such resume.');
    return toResume(row);
  });

  app.delete<{ Params: { id: string } }>('/v1/job-resumes/:id', async (req, reply) => {
    if (!z.uuid().safeParse(req.params.id).success) return reply.notFound('No such resume.');
    const [row] = await sql`delete from public.job_resumes where id = ${req.params.id} and user_id = ${req.user.id} returning id`;
    if (!row) return reply.notFound('No such resume.');
    return { ok: true };
  });
}
