import { randomUUID, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  AUTO_APPLY_CLOUD_PROVIDERS, type AutoApplyProvider, type AutoApplyTask, type FormQuestion, type PreparedAnswer,
} from '@parakeet/shared';
import { env } from '../env.js';
import { hashDeviceToken } from '../lib/auth.js';
import { applyReport, event } from '../lib/autoApplyReports.js';
import { sql } from '../lib/db.js';

// Auto Apply from Friday's servers (apps/worker/src/applier.ts). The applier holds one token
// (APPLIER_TOKEN_SHA256) and no database or Redis access: it claims an application here, fetches that
// application's files while it holds the claim, and reports what the job board said, like the extension
// does. Only reachable inside the server's network: requests through Caddy are refused.
//
//   POST /v1/applier/claim                         the next application for the servers, or null
//   GET  /v1/applier/applications/:id/resume       } with the x-applier-claim header,
//   GET  /v1/applier/applications/:id/cover-letter } only while the claim holds
//   POST /v1/applier/applications/:id/submitting   before pressing submit; 409 means don't
//   POST /v1/applier/applications/:id/report

export const APPLIER_CLAIM_PREFIX = 'cloud:';
/** Minutes the applier has to report (matches the worker's sweeper, as for the extension). */
const CLAIM_LEASE_MIN = 15;

const claimHeader = z.string().regex(/^cloud:[0-9a-f-]{36}$/);
/** userId: one user's applications only (the tests, which share a database with real local data). */
const claimBody = z.object({ userId: z.uuid().optional() }).default({});

const reportBody = z.object({
  outcome: z.enum(['submitted', 'captcha', 'login_required', 'needs_answers', 'failed']),
  evidence: z.object({ url: z.string().max(2000), text: z.string().max(5000) }).optional(),
  unanswered: z.array(z.string().max(500)).max(50).optional(),
  message: z.string().max(1000).optional(),
  /** The job board's submit button had been pressed. */
  clicked: z.boolean(),
});

async function requireApplier(req: FastifyRequest, reply: FastifyReply) {
  const want = env.APPLIER_TOKEN_SHA256;
  const header = req.headers.authorization ?? '';
  const ok =
    want &&
    header.startsWith('Bearer ') &&
    timingSafeEqual(Buffer.from(hashDeviceToken(header.slice(7)), 'hex'), Buffer.from(want, 'hex'));
  // Caddy adds X-Forwarded-For: the applier talks to the API directly, never from the internet.
  if (!ok || req.headers['x-forwarded-for']) return reply.code(401).send({ error: 'unauthorized', message: 'Not the applier.' });
}

interface ClaimedRow {
  id: string;
  user_id: string;
  listing_id: string | null;
  provider: AutoApplyProvider;
  apply_url: string;
  title: string;
  company: string;
  form: FormQuestion[] | null;
  answers: PreparedAnswer[] | null;
  file_name: string | null;
  format: string | null;
  has_cover: boolean;
}

export default async function applierRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireApplier);

  /** The application, when the claim in the header still holds it. */
  async function held(req: FastifyRequest<{ Params: { id: string } }>) {
    const claim = claimHeader.safeParse(req.headers['x-applier-claim']);
    if (!claim.success || !z.uuid().safeParse(req.params.id).success) return null;
    const [row] = await sql<{ id: string; user_id: string; provider: AutoApplyProvider; listing_id: string | null; form: FormQuestion[] | null; tailored_resume_id: string | null }[]>`
      select id, user_id, provider, listing_id, form, tailored_resume_id from public.auto_applications
      where id = ${req.params.id} and claimed_by = ${claim.data} and status = 'pending' and reason_code = 'submitting'`;
    return row ? { ...row, claim: claim.data } : null;
  }

  // Each user's best prepared application, users in random order so no one waits behind a 500-a-day
  // plan, and never two at once for one user.
  app.post('/v1/applier/claim', async (req, reply): Promise<{ task: (AutoApplyTask & { claim: string }) | null } | void> => {
    const body = claimBody.safeParse(req.body ?? {});
    if (!body.success) return reply.code(400).send({ error: 'bad_request', message: 'Invalid claim.' });
    const only = body.data.userId;
    const claim = `${APPLIER_CLAIM_PREFIX}${randomUUID()}`;
    const [row] = await sql<ClaimedRow[]>`
      with pick as (
        select id from (
          select distinct on (a.user_id) a.id
          from public.auto_applications a
          join public.auto_apply_settings s on s.user_id = a.user_id
          where a.status = 'prepared' and not a.needs_browser and (a.retry_at is null or a.retry_at <= now())
            and a.tailored_resume_id is not null
            and a.provider in ${sql(AUTO_APPLY_CLOUD_PROVIDERS as unknown as string[])}
            and s.enabled and s.cloud_submit and s.consented_at is not null
            ${only ? sql`and a.user_id = ${only}` : sql``}
            and not exists (
              select 1 from public.auto_applications b
              where b.user_id = a.user_id and b.status = 'pending' and b.reason_code = 'submitting')
          order by a.user_id, a.score desc nulls last, a.created_at
        ) best
        order by random()
        limit 1
      )
      update public.auto_applications a
      set status = 'pending', reason_code = 'submitting', reason = 'Being submitted by Friday',
          claimed_by = ${claim}, claimed_at = now(), submit_clicked_at = null, updated_at = now()
      from pick
      -- The extension may have taken it meanwhile.
      where a.id = pick.id and a.status = 'prepared' and not a.needs_browser
      returning a.id, a.user_id, a.listing_id, a.provider, a.apply_url, a.title, a.company, a.form, a.answers,
                (select t.file_name from public.tailored_resumes t where t.id = a.tailored_resume_id) as file_name,
                (select t.content->>'format' from public.tailored_resumes t where t.id = a.tailored_resume_id) as format,
                exists (select 1 from public.tailored_resumes t where t.id = a.tailored_resume_id and t.cover_letter_file is not null) as has_cover`;
    if (!row) return { task: null };
    await event(row.id, row.user_id, 'claimed', 'Friday’s servers started submitting it', { device: 'cloud' });
    const fileName = row.file_name ?? `Resume.${row.format ?? 'pdf'}`;
    return {
      task: {
        id: row.id,
        claim,
        provider: row.provider,
        applyUrl: row.apply_url,
        title: row.title,
        company: row.company,
        answers: row.answers ?? [],
        form: row.form ?? [],
        resumePath: `/v1/applier/applications/${row.id}/resume`,
        resumeFileName: fileName,
        coverLetterPath: row.has_cover ? `/v1/applier/applications/${row.id}/cover-letter` : null,
        coverLetterFileName: row.has_cover ? fileName.replace(/Resume/, 'Cover Letter').replace(/\.docx$/i, '.pdf') : null,
        leaseUntil: new Date(Date.now() + CLAIM_LEASE_MIN * 60_000).toISOString(),
      },
    };
  });

  app.get<{ Params: { id: string } }>('/v1/applier/applications/:id/resume', async (req, reply) => {
    const a = await held(req);
    if (!a) return reply.code(409).send({ error: 'not_held', message: 'This application isn’t claimed by you.' });
    const [t] = await sql<{ file: Buffer | null; format: string | null }[]>`
      select file, content->>'format' as format from public.tailored_resumes where id = ${a.tailored_resume_id} and status = 'ready'`;
    if (!t?.file) return reply.notFound('No tailored resume for this application.');
    return reply
      .type(t.format === 'docx' ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : 'application/pdf')
      .header('cache-control', 'private, no-store')
      .send(t.file);
  });

  app.get<{ Params: { id: string } }>('/v1/applier/applications/:id/cover-letter', async (req, reply) => {
    const a = await held(req);
    if (!a) return reply.code(409).send({ error: 'not_held', message: 'This application isn’t claimed by you.' });
    const [t] = await sql<{ file: Buffer | null }[]>`select cover_letter_file as file from public.tailored_resumes where id = ${a.tailored_resume_id}`;
    if (!t?.file) return reply.notFound('No cover letter for this application.');
    return reply.type('application/pdf').header('cache-control', 'private, no-store').send(t.file);
  });

  // Recorded before the click: from here on this application is never sent again (the sweeper turns a
  // lost claim into "unverified", and a failure into "unverified" too).
  app.post<{ Params: { id: string } }>('/v1/applier/applications/:id/submitting', async (req, reply) => {
    const a = await held(req);
    if (!a) return reply.code(409).send({ error: 'not_held', message: 'This application isn’t claimed by you.' });
    await sql`update public.auto_applications set submit_clicked_at = now(), updated_at = now() where id = ${a.id} and claimed_by = ${a.claim}`;
    await event(a.id, a.user_id, 'submitting', 'Friday’s servers pressed submit');
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/v1/applier/applications/:id/report', async (req, reply) => {
    const body = reportBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'bad_request', message: 'Invalid report.' });
    const a = await held(req);
    if (!a) return reply.code(409).send({ error: 'not_held', message: 'This application isn’t claimed by you.' });
    const { clicked, ...report } = body.data;
    // What the database says wins over what the applier remembers: a click it recorded counts.
    const [{ recorded }] = await sql<{ recorded: boolean }[]>`select submit_clicked_at is not null as recorded from public.auto_applications where id = ${a.id}`;
    const status = await applyReport(a, report, { via: 'cloud', clicked: clicked || recorded, claim: a.claim }, req.log);
    if (!status) return reply.code(409).send({ error: 'not_held', message: 'The claim lapsed before the report.' });
    return { status };
  });
}
