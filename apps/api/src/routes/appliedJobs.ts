import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  APPLY_CHANNELS, redactSensitive,
  type AppliedJob, type AppliedJobStatus, type AppliedJobsPage, type AppliedJobsStats, type ApplicationEvidence,
} from '@parakeet/shared';
import { requireAuth } from '../lib/auth.js';
import { audit } from '../lib/audit.js';
import { sql } from '../lib/db.js';
import { signDownload, verifyDownload } from '../lib/signedUrl.js';
import { env } from '../env.js';

// The Applied Jobs dashboard (GET /v1/applied-jobs): every application the candidate has, from Auto Apply
// (auto_applications), the platform bot and Assisted Apply (job_bot_applications) and their own records
// (job_applications), as one list with one row per job.
//
// Counting rule: only applications with evidence count as applied. Evidence is either "verified" (the
// ATS confirmed it: an API response with an application id, or its confirmation page) or
// "user_confirmed" (the candidate said they submitted it). Queued, preparing, prepared, submitting,
// unverified and failed applications have no evidence and never count, whatever channel they are on.

const STATUSES = ['submitted', 'needs_action', 'in_progress', 'failed', 'skipped'] as const satisfies readonly AppliedJobStatus[];
const CHANNEL_FILTERS = [...APPLY_CHANNELS, 'manual', 'bot'] as const;

const listQuery = z.object({
  q: z.string().max(200).optional(),
  status: z.enum([...STATUSES, 'all']).optional(),
  platform: z.string().regex(/^[a-z0-9_-]{1,40}$/).optional(),
  channel: z.enum(CHANNEL_FILTERS).optional(),
  evidence: z.enum(['verified', 'user_confirmed']).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

const ID = /^(auto|bot):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;
const resource = (id: string) => `applied-resume:${id}`;

interface Row {
  kind: 'auto' | 'bot' | 'manual';
  rid: string;
  title: string;
  company: string;
  location: string;
  platform: string;
  channel: AppliedJob['channel'];
  status: AppliedJobStatus;
  evidence: ApplicationEvidence | null;
  evidence_detail: string | null;
  applied_at: Date | null;
  created_at: Date;
  job_url: string;
  score: number | null;
  has_resume: boolean;
  failure_code: string | null;
  failure_message: string | null;
  failure_at: Date | null;
  action: string | null;
  questions: { key: string; label: string }[] | null;
  bot_detail: string | null;
}

/** The bot's needs_answer detail: questions joined with " | ", each maybe with "(options: …)". Same parsing as routes/jobBot.ts. */
function botQuestions(detail: string | null): { key: string; label: string }[] {
  if (!detail) return [];
  return detail
    .split(' | ')
    .filter((d) => !/^(LinkedIn says|Indeed didn.t move on)/.test(d))
    .map((d) => d.replace(/\s*\((options:|your answer|needs a number)[^)]*\)?\s*$/, '').trim())
    .filter(Boolean)
    .map((q) => ({ key: q, label: q }));
}

/**
 * Every application of one user, normalised and deduplicated: the same job (company + title) in two
 * tables is one row, preferring the one with evidence, then Auto Apply, the bot, the user's own record.
 */
function appliedRows(userId: string) {
  return sql`
    with raw as (
      select 'auto'::text as kind, 1 as prio, a.id::text as rid, a.title, a.company, coalesce(l.location, '') as location,
        a.provider as platform,
        coalesce(a.channel, case a.submitted_via when 'api' then 'api' when 'cloud' then 'cloud_form' else 'extension' end) as channel,
        case
          when a.status = 'submitted' then 'submitted'
          when a.status = 'pending' and a.reason_code = 'submitting' then 'in_progress'
          when a.status = 'pending' then 'needs_action'
          when a.status = 'prepared' and a.channel = 'assisted' then 'needs_action'
          when a.status in ('preparing', 'prepared') then 'in_progress'
          when a.status = 'failed' then 'failed'
          else 'skipped'
        end as status,
        case when a.status = 'submitted' then case when a.submitted_via = 'user' then 'user_confirmed' else 'verified' end end as evidence,
        case when a.status = 'submitted' then
          case when a.submitted_via = 'user' then 'You confirmed the job board received it'
               when a.external_application_id is not null then 'ATS application id ' || a.external_application_id
               else coalesce(nullif(left(a.evidence->>'text', 240), ''), a.evidence->>'url', 'Confirmed by the job board') end
        end as evidence_detail,
        case when a.status = 'submitted' then coalesce(a.submitted_at, a.updated_at) end as applied_at,
        a.created_at, a.updated_at,
        coalesce(l.apply_url, a.apply_url) as job_url,
        a.score::int as score,
        coalesce(t.status = 'ready' and t.file is not null, false) as has_resume,
        case when a.status = 'failed' or a.failure is not null then coalesce(a.failure->>'code', a.reason_code, 'failed') end as failure_code,
        case when a.status = 'failed' or a.failure is not null then coalesce(a.failure->>'message', a.reason) end as failure_message,
        case when a.status = 'failed' or a.failure is not null then coalesce((a.failure->>'at')::timestamptz, a.updated_at) end as failure_at,
        case
          when a.status = 'pending' and a.reason_code = 'needs_answers' then coalesce(a.reason, 'Answer the questions below once; Friday reuses your answers.')
          when a.status = 'pending' and a.reason_code = 'captcha' then 'The job board asked for a CAPTCHA. Open the job, finish it, then confirm.'
          when a.status = 'pending' and a.reason_code = 'login_required' then 'The job board wants you to sign in. Apply there, then confirm.'
          when a.status = 'pending' and a.reason_code = 'unverified' then 'Sent, but no confirmation was seen. Check your email, then confirm.'
          when a.status in ('pending', 'prepared') and a.channel = 'assisted' then 'Apply on the employer’s site with your tailored resume, then confirm.'
          when a.status = 'pending' then a.reason
        end as action,
        case when a.status = 'pending' and a.reason_code = 'needs_answers' then (
          select coalesce(jsonb_agg(jsonb_build_object('key', q->>'key', 'label', q->>'label')), '[]'::jsonb)
          from jsonb_array_elements(coalesce(a.form, '[]'::jsonb)) q where q->>'key' = any(a.missing)
        ) end as questions,
        null::text as bot_detail
      from public.auto_applications a
      left join public.job_listings l on l.id = a.listing_id
      left join public.tailored_resumes t on t.id = a.tailored_resume_id
      where a.user_id = ${userId}

      union all

      select 'bot', 2, b.id::text, b.title, b.company, b.location, b.platform,
        case when b.outcome = 'assisted' or b.evidence = 'user_reported' then 'assisted' else 'bot' end,
        case b.outcome
          when 'applied' then 'submitted'
          when 'needs_answer' then 'needs_action'
          when 'assisted' then 'needs_action'
          when 'failed' then 'failed'
          else 'skipped'
        end,
        case when b.outcome = 'applied' then case when b.evidence = 'verified' then 'verified' else 'user_confirmed' end end,
        case when b.outcome = 'applied' then coalesce(b.detail, case when b.evidence = 'verified' then 'Site confirmation seen' else 'You confirmed you applied' end) end,
        case when b.outcome = 'applied' then b.updated_at end,
        b.created_at, b.updated_at, b.url, null::int,
        coalesce(t.status = 'ready' and t.file is not null, false),
        case when b.outcome = 'failed' then 'failed' end,
        case when b.outcome = 'failed' then b.detail end,
        case when b.outcome = 'failed' then b.updated_at end,
        case b.outcome
          when 'assisted' then 'Apply on ' || initcap(b.platform) || ' with your tailored resume, then tell us you applied.'
          when 'needs_answer' then 'Answer these once; they are saved for every future application.'
        end,
        null::jsonb,
        case when b.outcome = 'needs_answer' then b.detail end
      from public.job_bot_applications b
      left join public.tailored_resumes t on t.id = b.tailored_resume_id
      where b.user_id = ${userId}

      union all

      select 'manual', 3, j.id::text, j.title, j.company, j.location, coalesce(s.provider, 'other'), 'manual', 'submitted',
        'user_confirmed', 'You marked it applied', coalesce(j.applied_at, j.updated_at), j.created_at, j.updated_at, j.apply_url,
        null::int, false, null, null, null::timestamptz, null, null::jsonb, null
      from public.job_applications j
      left join public.job_listings l on l.id = j.listing_id
      left join public.job_sources s on s.id = l.source_id
      where j.user_id = ${userId} and j.status in ('applied', 'interviewing', 'offer', 'rejected')
    ),
    ranked as (
      select raw.*, coalesce(applied_at, updated_at) as sort_at,
        row_number() over (
          partition by lower(btrim(company)) || '|' || lower(btrim(title))
          order by (status = 'submitted') desc, prio, coalesce(applied_at, updated_at) desc
        ) as n
      from raw
    )
    select * from ranked where n = 1`;
}

export default async function appliedJobsRoutes(app: FastifyInstance) {
  // The resume download is a plain link (no bearer header): authorized by its signature, which names the
  // user, and by that user owning the application.
  app.get<{ Params: { id: string }; Querystring: { u?: string; exp?: string; sig?: string } }>(
    '/v1/applied-jobs/:id/resume',
    async (req, reply) => {
      const m = ID.exec(req.params.id);
      const userId = req.query.u ?? '';
      if (!m || !z.uuid().safeParse(userId).success) return reply.notFound('No such resume.');
      if (!verifyDownload(userId, resource(req.params.id), req.query.exp, req.query.sig)) {
        return reply.code(403).send({ error: 'forbidden', message: 'This download link is invalid or has expired. Open the dashboard again.' });
      }
      const [kind, id] = [m[1], m[2]];
      const [row] = kind === 'auto'
        ? await sql<{ file: Buffer | null; file_name: string | null; format: string | null }[]>`
            select t.file, t.file_name, t.content->>'format' as format
            from public.auto_applications a join public.tailored_resumes t on t.id = a.tailored_resume_id and t.user_id = a.user_id
            where a.id = ${id} and a.user_id = ${userId} and t.status = 'ready'`
        : await sql<{ file: Buffer | null; file_name: string | null; format: string | null }[]>`
            select t.file, t.file_name, t.content->>'format' as format
            from public.job_bot_applications b join public.tailored_resumes t on t.id = b.tailored_resume_id and t.user_id = b.user_id
            where b.id = ${id} and b.user_id = ${userId} and t.status = 'ready'`;
      if (!row?.file) return reply.notFound('No such resume.');
      await audit({ userId, actor: 'user', action: 'resume.download', targetType: `${kind}_application`, targetId: id, ip: req.ip });
      const docx = row.format === 'docx';
      const name = row.file_name ?? `Resume.${docx ? 'docx' : 'pdf'}`;
      return reply
        .type(docx ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : 'application/pdf')
        .header('cache-control', 'private, no-store')
        .header('referrer-policy', 'no-referrer')
        .header('content-disposition', `attachment; filename="${name.replace(/[^\w\- .]/g, '')}"; filename*=UTF-8''${encodeURIComponent(name)}`)
        .send(row.file);
    },
  );

  await app.register(async (authed) => {
    authed.addHook('preHandler', requireAuth);

    authed.get('/v1/applied-jobs', async (req, reply): Promise<AppliedJobsPage | void> => {
      const parsed = listQuery.safeParse(req.query);
      if (!parsed.success) return reply.code(400).send({ error: 'bad_request', message: 'Invalid filters.' });
      const { q, status, platform, channel, evidence, page, pageSize } = parsed.data;
      const userId = req.user.id;
      const like = q?.trim() ? `%${q.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;

      const [statsRows, platformRows, items] = await Promise.all([
        sql<{
          total: number; today: number; this_month: number; verified: number; user_confirmed: number;
          needs_action: number; failed: number; in_progress: number;
        }[]>`
          with tz as (select coalesce((select timezone from public.auto_apply_settings where user_id = ${userId}), 'Asia/Kolkata') as tz),
          r as (${appliedRows(userId)})
          select
            count(*) filter (where status = 'submitted')::int as total,
            count(*) filter (where status = 'submitted'
              and (applied_at at time zone tz.tz)::date = (now() at time zone tz.tz)::date)::int as today,
            count(*) filter (where status = 'submitted'
              and date_trunc('month', applied_at at time zone tz.tz) = date_trunc('month', now() at time zone tz.tz))::int as this_month,
            count(*) filter (where status = 'submitted' and evidence = 'verified')::int as verified,
            count(*) filter (where status = 'submitted' and evidence = 'user_confirmed')::int as user_confirmed,
            count(*) filter (where status = 'needs_action')::int as needs_action,
            count(*) filter (where status = 'failed')::int as failed,
            count(*) filter (where status = 'in_progress')::int as in_progress
          from r, tz group by tz.tz`,
        sql<{ platform: string; submitted: number }[]>`
          with r as (${appliedRows(userId)})
          select platform, count(*)::int as submitted from r where status = 'submitted' group by platform order by 2 desc, 1`,
        sql<(Row & { full_count: number })[]>`
          with r as (${appliedRows(userId)})
          select *, count(*) over ()::int as full_count from r
          where true
            ${status && status !== 'all' ? sql`and status = ${status}` : status === 'all' ? sql`` : sql`and status <> 'skipped'`}
            ${platform ? sql`and platform = ${platform}` : sql``}
            ${channel ? sql`and channel = ${channel}` : sql``}
            ${evidence ? sql`and evidence = ${evidence}` : sql``}
            ${like ? sql`and (title ilike ${like} or company ilike ${like})` : sql``}
          order by (status = 'needs_action') desc, sort_at desc, kind, rid
          limit ${pageSize} offset ${(page - 1) * pageSize}`,
      ]);
      const s = statsRows[0];
      const stats: AppliedJobsStats = {
        total: s?.total ?? 0,
        today: s?.today ?? 0,
        thisMonth: s?.this_month ?? 0,
        verified: s?.verified ?? 0,
        userConfirmed: s?.user_confirmed ?? 0,
        needsAction: s?.needs_action ?? 0,
        failed: s?.failed ?? 0,
        inProgress: s?.in_progress ?? 0,
        byPlatform: platformRows.map((p) => ({ platform: p.platform, submitted: p.submitted })),
      };

      const base = env.API_PUBLIC_URL.replace(/\/$/, '');
      return {
        stats,
        page,
        pageSize,
        total: items[0]?.full_count ?? 0,
        items: items.map((r): AppliedJob => {
          const id = `${r.kind}:${r.rid}`;
          let resumeUrl: string | null = null;
          if (r.has_resume && r.kind !== 'manual') {
            const { exp, sig } = signDownload(userId, resource(id));
            resumeUrl = `${base}/v1/applied-jobs/${encodeURIComponent(id)}/resume?u=${userId}&exp=${exp}&sig=${sig}`;
          }
          return {
            id,
            title: r.title,
            company: r.company,
            location: r.location,
            platform: r.platform,
            channel: r.channel,
            status: r.status,
            evidence: r.status === 'submitted' ? r.evidence : null,
            evidenceDetail: r.evidence_detail ? redactSensitive(r.evidence_detail).slice(0, 300) : null,
            appliedAt: r.status === 'submitted' ? (r.applied_at?.toISOString() ?? null) : null,
            createdAt: r.created_at.toISOString(),
            jobUrl: r.job_url,
            score: r.score,
            resumeUrl,
            failure: r.failure_code
              ? { code: r.failure_code, message: redactSensitive(r.failure_message ?? 'Failed').slice(0, 500), at: r.failure_at?.toISOString() ?? null }
              : null,
            action: r.status === 'needs_action' ? r.action : null,
            questions: r.status !== 'needs_action' ? [] : r.kind === 'bot' ? botQuestions(r.bot_detail) : (r.questions ?? []),
          };
        }),
      };
    });
  });
}
