import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  AUTO_APPLY_LIMITS, AUTO_APPLY_PROVIDERS, AUTO_APPLY_STATUSES, EMPTY_APPLICATION_PROFILE, JOBS_PLANS, activeJobsPlan, autoApplyUrl,
  missingProfileFields, type ApplicationProfile, type JobsAnalytics, type JobsPlan, type JobsPlanStatus, type SwipeCard, type SwipeResult,
  type AutoApplication, type AutoApplicationDetail, type AutoApplyOverview, type AutoApplyProvider, type AutoApplyReason,
  type AutoApplySettings, type AutoApplyStatus, type AutoApplyTask, type FormQuestion, type PreparedAnswer,
} from '@parakeet/shared';
import { requireAuth } from '../lib/auth.js';
import { sql } from '../lib/db.js';
import { queueAutoApply } from '../lib/queues.js';
import { ensureUser } from '../lib/users.js';

// Friday Jobs Auto Apply (packages/shared/src/autoApply.ts). The worker prepares applications
// (apps/worker/src/queues/autoApply.ts); the user manages them here, and the Friday extension claims
// prepared ones, submits them from the user's browser and reports what the job board said.

/** Minutes the extension has to report on an application it claimed (matches the worker's sweeper). */
const CLAIM_LEASE_MIN = 15;
/** Submission attempts before an application is marked Failed. */
const MAX_SUBMIT_ATTEMPTS = 3;

interface SettingsRow {
  enabled: boolean;
  mode: 'auto' | 'review';
  min_score: number;
  daily_limit: number;
  timezone: string;
  consented_at: Date | null;
}

const SETTINGS_COLUMNS = sql`enabled, mode, min_score, daily_limit, timezone, consented_at`;

const toSettings = (r: SettingsRow | undefined, plan: JobsPlan): AutoApplySettings => ({
  enabled: r?.enabled ?? false,
  mode: r?.mode ?? 'auto',
  minScore: r?.min_score ?? AUTO_APPLY_LIMITS.defaultScore,
  // Never more than the plan allows, also after a plan runs out.
  dailyLimit: Math.min(r?.daily_limit ?? plan.dailyApplications, plan.dailyApplications),
  timezone: r?.timezone ?? 'Asia/Kolkata',
  consentedAt: r?.consented_at?.toISOString() ?? null,
});

interface AppRow {
  id: string;
  listing_id: string | null;
  title: string;
  company: string;
  provider: AutoApplyProvider;
  apply_url: string;
  score: number | null;
  status: AutoApplyStatus;
  reason_code: AutoApplyReason | null;
  reason: string | null;
  form: FormQuestion[] | null;
  missing: string[];
  attempts: number;
  submitted_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

const APP_COLUMNS = sql`id, listing_id, title, company, provider, apply_url, score, status, reason_code, reason, form, missing,
  attempts, submitted_at, created_at, updated_at`;

const toApp = (r: AppRow): AutoApplication => ({
  id: r.id,
  listingId: r.listing_id,
  title: r.title,
  company: r.company,
  provider: r.provider,
  applyUrl: r.apply_url,
  score: r.score,
  status: r.status,
  reasonCode: r.reason_code,
  reason: r.reason,
  missing: (r.form ?? []).filter((q) => r.missing.includes(q.key)),
  attempts: r.attempts,
  submittedAt: r.submitted_at?.toISOString() ?? null,
  createdAt: r.created_at.toISOString(),
  updatedAt: r.updated_at.toISOString(),
});

const text = (max: number) => z.string().trim().max(max);

const settingsBody = z.object({
  enabled: z.boolean().optional(),
  mode: z.enum(['auto', 'review']).optional(),
  minScore: z.number().int().min(AUTO_APPLY_LIMITS.minScore).max(AUTO_APPLY_LIMITS.maxScore).optional(),
  dailyLimit: z.number().int().min(1).max(AUTO_APPLY_LIMITS.maxPerDay).optional(),
  timezone: z
    .string()
    .max(64)
    .refine((tz) => {
      try {
        new Intl.DateTimeFormat('en', { timeZone: tz });
        return true;
      } catch {
        return false;
      }
    }, 'Unknown time zone')
    .optional(),
  /** The user agrees to applications being sent in their name. */
  consent: z.literal(true).optional(),
});

const profileBody = z.object({
  firstName: text(80),
  lastName: text(80),
  email: text(200),
  phone: text(40),
  city: text(100),
  country: text(100),
  linkedin: text(300),
  github: text(300),
  portfolio: text(300),
  website: text(300),
  workAuthorization: z
    .array(z.object({ country: text(100).min(1), authorized: z.boolean(), needsSponsorship: z.boolean() }))
    .max(20),
  noticePeriodDays: z.number().int().min(0).max(365).nullable(),
  currentSalary: text(80),
  expectedSalary: text(80),
  willingToRelocate: z.boolean().nullable(),
  earliestStart: text(80),
  gender: text(60),
  savedAnswers: z.array(z.object({ question: text(500).min(1), answer: text(2000) })).max(300),
}) satisfies z.ZodType<ApplicationProfile>;

const answersBody = z.object({
  answers: z.record(z.string().max(300), z.union([text(4000), z.array(text(300)).max(50)])),
});

const reportBody = z.object({
  outcome: z.enum(['submitted', 'captcha', 'login_required', 'needs_answers', 'failed']),
  evidence: z.object({ url: z.string().max(2000), text: z.string().max(5000) }).optional(),
  unanswered: z.array(z.string().max(500)).max(50).optional(),
  message: z.string().max(1000).optional(),
});

const claimBody = z.object({ device: z.string().min(1).max(100) });

/**
 * What each job board shows once it has the application. Submissions count only when the page the
 * browser landed on matches, so a form that silently failed is never marked Submitted.
 */
const CONFIRMATION: Record<AutoApplyProvider, { url: RegExp; text: RegExp }> = {
  greenhouse: {
    url: /greenhouse\.io\/.*(confirmation|thank)/i,
    text: /thank you for applying|application (has been )?(received|submitted)|we('ve| have) received your application/i,
  },
  lever: {
    url: /lever\.co\/[^/]+\/[^/]+\/thanks/i,
    text: /application submitted|thank(s| you) for applying|we('ve| have) received your application/i,
  },
  ashby: {
    url: /ashbyhq\.com\/.*(submitted|confirmation)/i,
    text: /application (was )?(successfully )?submitted|thank(s| you) for (applying|submitting)|we('ve| have) received your application/i,
  },
  // Not yet seen live on these three; a miss only means the user is asked to confirm.
  workable: {
    url: /workable\.com\/.*(success|thank|submitted)/i,
    text: /thank(s| you) for (applying|your application)|application (has been |was )?(successfully )?(submitted|received)/i,
  },
  smartrecruiters: {
    url: /smartrecruiters\.com\/.*(success|thank|confirmation)/i,
    text: /thank(s| you) for (applying|your application)|application (has been |was )?(successfully )?(submitted|received)/i,
  },
  workday: {
    url: /myworkdayjobs\.com\/.*(applicationSubmitted|submitted)/i,
    text: /application submitted|thank(s| you) for applying|your application (has been|was) (submitted|received)/i,
  },
};

export function verifySubmission(provider: AutoApplyProvider, evidence: { url: string; text: string } | undefined) {
  if (!evidence) return false;
  const c = CONFIRMATION[provider];
  return c.url.test(evidence.url) || c.text.test(evidence.text);
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

async function event(applicationId: string, userId: string, kind: string, message: string, detail?: unknown) {
  await sql`
    insert into public.auto_apply_events (application_id, user_id, kind, message, detail)
    values (${applicationId}, ${userId}, ${kind}, ${message}, ${detail === undefined ? null : sql.json(detail as never)})`;
}

/** The user's Friday Jobs plan (free once a paid one runs out). */
async function userPlan(userId: string): Promise<{ plan: JobsPlan; expiresAt: Date | null }> {
  const [u] = await sql<{ jobs_plan: string | null; jobs_plan_expires_at: Date | null }[]>`
    select jobs_plan, jobs_plan_expires_at from public.users where id = ${userId}`;
  const plan = activeJobsPlan(u?.jobs_plan, u?.jobs_plan_expires_at);
  return { plan, expiresAt: plan.id === 'free' ? null : (u?.jobs_plan_expires_at ?? null) };
}

/** Applications counted against the user's day so far (skipped ones don't count). */
async function usedToday(userId: string) {
  const [{ n }] = await sql<{ n: number }[]>`
    select count(*)::int as n from public.auto_applications a
    left join public.auto_apply_settings s on s.user_id = a.user_id
    where a.user_id = ${userId} and a.status <> 'skipped'
      and a.plan_day = (now() at time zone coalesce(s.timezone, 'Asia/Kolkata'))::date`;
  return n;
}

async function loadProfile(userId: string): Promise<ApplicationProfile> {
  const [row] = await sql<{ data: Partial<ApplicationProfile> }[]>`select data from public.application_profiles where user_id = ${userId}`;
  return { ...EMPTY_APPLICATION_PROFILE, ...row?.data };
}

/** What's needed before Auto Apply can run. */
async function blockers(userId: string, profile: ApplicationProfile, settings: AutoApplySettings) {
  const out: string[] = [];
  const [resume] = await sql<{ has_file: boolean; status: string }[]>`
    select file is not null as has_file, status from public.resumes where user_id = ${userId} order by created_at desc limit 1`;
  if (!resume) out.push('Upload your resume');
  else if (!resume.has_file) out.push('Upload your resume again as a PDF or Word file');
  else if (resume.status !== 'ready') out.push('Wait for your resume to finish analysing');
  const missing = missingProfileFields(profile);
  if (missing.length) out.push(`Complete your application profile: ${missing.join(', ')}`);
  if (!settings.consentedAt) out.push('Agree to Friday applying in your name');
  return out;
}

export default async function autoApplyRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  app.get('/v1/auto-apply', async (req): Promise<AutoApplyOverview> => {
    const userId = req.user.id;
    const [[settingsRow], profile, counts, { plan, expiresAt }] = await Promise.all([
      sql<SettingsRow[]>`select ${SETTINGS_COLUMNS} from public.auto_apply_settings where user_id = ${userId}`,
      loadProfile(userId),
      sql<{ status: AutoApplyStatus; n: number; today: number; needs: number }[]>`
        select a.status, count(*)::int as n,
               count(*) filter (where a.plan_day = (now() at time zone coalesce(s.timezone, 'Asia/Kolkata'))::date)::int as today,
               count(*) filter (where a.status = 'pending' and a.reason_code <> 'submitting')::int as needs
        from public.auto_applications a
        left join public.auto_apply_settings s on s.user_id = a.user_id
        where a.user_id = ${userId} group by a.status`,
      userPlan(userId),
    ]);
    const settings = toSettings(settingsRow, plan);
    // Prefill the profile from the account and resume the first time.
    if (!profile.email && req.user.email) profile.email = req.user.email;
    return {
      settings,
      plan,
      planExpiresAt: expiresAt?.toISOString() ?? null,
      profile,
      blockers: await blockers(userId, profile, settings),
      today: counts.filter((c) => c.status !== 'skipped').reduce((n, c) => n + c.today, 0),
      counts: Object.fromEntries(AUTO_APPLY_STATUSES.map((s) => [s, counts.find((c) => c.status === s)?.n ?? 0])) as Record<AutoApplyStatus, number>,
      needsYou: counts.reduce((n, c) => n + c.needs, 0),
    };
  });

  app.put('/v1/auto-apply/settings', async (req, reply): Promise<AutoApplySettings | void> => {
    const body = settingsBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'bad_request', message: body.error.issues[0]?.message ?? 'Invalid settings' });
    const userId = req.user.id;
    await ensureUser(req);
    const { enabled, mode, minScore, dailyLimit, timezone, consent } = body.data;
    const { plan } = await userPlan(userId);
    if (dailyLimit !== undefined && dailyLimit > plan.dailyApplications) {
      return reply.code(402).send({
        error: 'plan_limit',
        message: `Your ${plan.name} plan allows ${plan.dailyApplications} applications a day. Upgrade for more.`,
      });
    }
    const [row] = await sql<SettingsRow[]>`
      insert into public.auto_apply_settings (user_id, mode, min_score, daily_limit, timezone, consented_at)
      values (${userId}, ${mode ?? 'auto'}, ${minScore ?? AUTO_APPLY_LIMITS.defaultScore}, ${dailyLimit ?? plan.dailyApplications},
              ${timezone ?? 'Asia/Kolkata'}, ${consent ? sql`now()` : null})
      on conflict (user_id) do update set
        mode = coalesce(${mode ?? null}, auto_apply_settings.mode),
        min_score = coalesce(${minScore ?? null}, auto_apply_settings.min_score),
        daily_limit = coalesce(${dailyLimit ?? null}, auto_apply_settings.daily_limit),
        timezone = coalesce(${timezone ?? null}, auto_apply_settings.timezone),
        consented_at = coalesce(auto_apply_settings.consented_at, ${consent ? sql`now()` : null}),
        updated_at = now()
      returning ${SETTINGS_COLUMNS}`;
    if (enabled !== undefined && enabled !== row.enabled) {
      if (enabled) {
        const missing = await blockers(userId, await loadProfile(userId), toSettings(row, plan));
        if (missing.length) return reply.code(409).send({ error: 'not_ready', message: missing.join('. ') });
      }
      const [updated] = await sql<SettingsRow[]>`
        update public.auto_apply_settings set enabled = ${enabled}, updated_at = now() where user_id = ${userId}
        returning ${SETTINGS_COLUMNS}`;
      if (enabled) await queueAutoApply('autoapply.plan', { userId }, req.log);
      return toSettings(updated, plan);
    }
    // A higher limit, lower score or switch to auto may make room for more today.
    if (row.enabled && (minScore !== undefined || dailyLimit !== undefined || mode === 'auto')) {
      await queueAutoApply('autoapply.plan', { userId }, req.log);
    }
    return toSettings(row, plan);
  });

  app.put('/v1/auto-apply/profile', async (req, reply): Promise<ApplicationProfile | void> => {
    const body = profileBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'bad_request', message: body.error.issues[0]?.message ?? 'Invalid profile' });
    await ensureUser(req);
    await sql`
      insert into public.application_profiles (user_id, data) values (${req.user.id}, ${sql.json(body.data as never)})
      on conflict (user_id) do update set data = excluded.data, updated_at = now()`;
    // Applications waiting on answers the new profile may now give: prepare them again.
    const waiting = await sql<{ id: string }[]>`
      update public.auto_applications set status = 'preparing', reason_code = null, reason = null, updated_at = now()
      where user_id = ${req.user.id} and status = 'pending' and reason_code = 'needs_answers'
      returning id`;
    for (const a of waiting) {
      await event(a.id, req.user.id, 'profile_updated', 'Profile updated; answering the form again');
      await queueAutoApply('autoapply.prepare', { applicationId: a.id }, req.log);
    }
    return body.data;
  });

  app.get<{ Querystring: { status?: string; page?: string } }>('/v1/auto-apply/applications', async (req) => {
    const status = AUTO_APPLY_STATUSES.includes(req.query.status as AutoApplyStatus) ? (req.query.status as AutoApplyStatus) : null;
    const page = Math.max(1, Math.min(500, Number(req.query.page) || 1));
    const pageSize = 30;
    const rows = await sql<(AppRow & { total: number })[]>`
      select ${APP_COLUMNS}, count(*) over ()::int as total from public.auto_applications
      where user_id = ${req.user.id} ${status ? sql`and status = ${status}` : sql``}
      order by updated_at desc limit ${pageSize} offset ${(page - 1) * pageSize}`;
    return { items: rows.map(toApp), total: rows[0]?.total ?? 0, page, pageSize };
  });

  app.get<{ Params: { id: string } }>('/v1/auto-apply/applications/:id', async (req, reply): Promise<AutoApplicationDetail | void> => {
    if (!z.uuid().safeParse(req.params.id).success) return reply.notFound('No such application.');
    const [row] = await sql<(AppRow & { answers: PreparedAnswer[] | null; tailored_ready: boolean })[]>`
      select ${APP_COLUMNS}, answers,
             exists (select 1 from public.tailored_resumes t where t.id = tailored_resume_id and t.status = 'ready') as tailored_ready
      from public.auto_applications where id = ${req.params.id} and user_id = ${req.user.id}`;
    if (!row) return reply.notFound('No such application.');
    const events = await sql<{ created_at: Date; kind: string; message: string }[]>`
      select created_at, kind, message from public.auto_apply_events where application_id = ${row.id} order by id`;
    return {
      ...toApp(row),
      form: row.form ?? [],
      answers: row.answers ?? [],
      tailoredResumeReady: row.tailored_ready,
      events: events.map((e) => ({ at: e.created_at.toISOString(), kind: e.kind, message: e.message })),
    };
  });

  // The user answers the questions Auto Apply couldn't. Answers are remembered for the same question
  // on other forms.
  app.post<{ Params: { id: string } }>('/v1/auto-apply/applications/:id/answers', async (req, reply) => {
    const body = answersBody.safeParse(req.body);
    if (!body.success || !z.uuid().safeParse(req.params.id).success) return reply.code(400).send({ error: 'bad_request', message: 'Invalid answers.' });
    const userId = req.user.id;
    const [row] = await sql<{ form: FormQuestion[] | null; answers: PreparedAnswer[] | null; status: AutoApplyStatus; reason_code: string | null }[]>`
      select form, answers, status, reason_code from public.auto_applications where id = ${req.params.id} and user_id = ${userId}`;
    if (!row?.form) return reply.notFound('No such application.');
    if (row.status !== 'pending' || row.reason_code !== 'needs_answers') {
      return reply.code(409).send({ error: 'conflict', message: 'This application isn’t waiting for answers.' });
    }
    const byKey = new Map(row.form.map((q) => [q.key, q]));
    const answers = new Map((row.answers ?? []).map((a) => [a.key, a]));
    const remembered: { question: string; answer: string }[] = [];
    for (const [key, raw] of Object.entries(body.data.answers)) {
      const q = byKey.get(key);
      if (!q) continue;
      const list = Array.isArray(raw) ? raw : [raw];
      let value: string | string[] | null;
      if (q.options.length) {
        const picked = list.map((v) => q.options.find((o) => norm(o) === norm(v))).filter((v): v is string => Boolean(v));
        if (picked.length !== list.length) return reply.code(400).send({ error: 'bad_request', message: `Pick one of the options for “${q.label}”.` });
        value = q.type === 'multiselect' ? picked : picked[0];
      } else {
        value = list.join(', ').trim() || null;
      }
      answers.set(key, { key, label: q.label, value, source: 'user' });
      if (typeof value === 'string' && value) remembered.push({ question: q.label, answer: value });
    }
    const merged = row.form.filter((q) => answers.has(q.key)).map((q) => answers.get(q.key)!);
    const missing = row.form
      .filter((q) => q.required && q.type !== 'hidden')
      .filter((q) => {
        const v = answers.get(q.key)?.value;
        return v === null || v === undefined || (Array.isArray(v) ? !v.length : !v.trim());
      })
      .map((q) => q.key);
    const done = missing.length === 0;
    await sql`
      update public.auto_applications
      set answers = ${sql.json(merged as never)}, missing = ${missing},
          status = ${done ? 'prepared' : 'pending'}, reason_code = ${done ? null : 'needs_answers'},
          reason = ${done ? null : 'Needs a few more answers'}, updated_at = now()
      where id = ${req.params.id}`;
    await event(req.params.id, userId, done ? 'prepared' : 'answered', done ? 'Your answers were added; ready to submit' : 'Some answers added');
    if (remembered.length) {
      const profile = await loadProfile(userId);
      const keep = profile.savedAnswers.filter((a) => !remembered.some((r) => norm(r.question) === norm(a.question)));
      profile.savedAnswers = [...keep, ...remembered].slice(-300);
      await sql`
        insert into public.application_profiles (user_id, data) values (${userId}, ${sql.json(profile as never)})
        on conflict (user_id) do update set data = excluded.data, updated_at = now()`;
      await applySavedAnswers(userId, profile, req.params.id);
    }
    return { status: done ? 'prepared' : 'pending', missing };
  });

  app.post<{ Params: { id: string } }>('/v1/auto-apply/applications/:id/skip', async (req, reply) => {
    if (!z.uuid().safeParse(req.params.id).success) return reply.notFound('No such application.');
    const [row] = await sql<{ id: string }[]>`
      update public.auto_applications
      set status = 'skipped', reason_code = 'removed_by_user', reason = 'You removed it.', updated_at = now()
      where id = ${req.params.id} and user_id = ${req.user.id}
        and (status in ('preparing', 'prepared', 'failed') or (status = 'pending' and reason_code <> 'submitting'))
      returning id`;
    if (!row) return reply.code(409).send({ error: 'conflict', message: 'This application can’t be removed now.' });
    await event(row.id, req.user.id, 'skipped', 'You removed it');
    return { status: 'skipped' };
  });

  // Try again: a failed or expired application is prepared again; one stopped at the job board (CAPTCHA,
  // sign-in) goes back to Prepared for the extension.
  app.post<{ Params: { id: string } }>('/v1/auto-apply/applications/:id/retry', async (req, reply) => {
    if (!z.uuid().safeParse(req.params.id).success) return reply.notFound('No such application.');
    const userId = req.user.id;
    const [row] = await sql<{ status: AutoApplyStatus; reason_code: AutoApplyReason | null; listing_open: boolean }[]>`
      select a.status, a.reason_code, exists (select 1 from public.job_listings l where l.id = a.listing_id and l.closed_at is null) as listing_open
      from public.auto_applications a where a.id = ${req.params.id} and a.user_id = ${userId}`;
    if (!row) return reply.notFound('No such application.');
    if (!row.listing_open) return reply.code(409).send({ error: 'closed', message: 'The job is no longer listed.' });
    if (row.status === 'pending' && ['captcha', 'login_required'].includes(row.reason_code ?? '')) {
      await sql`
        update public.auto_applications set status = 'prepared', reason_code = null, reason = null, retry_at = null, updated_at = now()
        where id = ${req.params.id}`;
      await event(req.params.id, userId, 'retry', 'Ready to submit again');
      return { status: 'prepared' };
    }
    if (row.status === 'failed' || (row.status === 'skipped' && ['expired', 'removed_by_user'].includes(row.reason_code ?? ''))) {
      await sql`
        update public.auto_applications
        set status = 'preparing', reason_code = null, reason = null, retry_at = null,
            form = case when status = 'failed' then null else form end, updated_at = now()
        where id = ${req.params.id}`;
      await event(req.params.id, userId, 'retry', 'Preparing again');
      await queueAutoApply('autoapply.prepare', { applicationId: req.params.id }, req.log);
      return { status: 'preparing' };
    }
    return reply.code(409).send({ error: 'conflict', message: 'This application can’t be retried.' });
  });

  // The user saw the job board's confirmation (or its email) for an application we couldn't verify.
  app.post<{ Params: { id: string } }>('/v1/auto-apply/applications/:id/confirm', async (req, reply) => {
    if (!z.uuid().safeParse(req.params.id).success) return reply.notFound('No such application.');
    const [row] = await sql<{ id: string; listing_id: string | null }[]>`
      update public.auto_applications
      set status = 'submitted', reason_code = null, reason = null, submitted_at = coalesce(submitted_at, now()),
          evidence = coalesce(evidence, '{}'::jsonb) || '{"confirmedByUser": true}'::jsonb, updated_at = now()
      where id = ${req.params.id} and user_id = ${req.user.id} and status = 'pending' and reason_code = 'unverified'
      returning id, listing_id`;
    if (!row) return reply.code(409).send({ error: 'conflict', message: 'This application isn’t waiting for confirmation.' });
    await event(row.id, req.user.id, 'submitted', 'You confirmed the job board received it');
    await markApplied(req.user.id, row.listing_id);
    return { status: 'submitted' };
  });


  // ---- Plans and swipe review --------------------------------------------------------------------

  app.get('/v1/jobs-plan', async (req): Promise<JobsPlanStatus> => {
    const { plan, expiresAt } = await userPlan(req.user.id);
    return { plan, expiresAt: expiresAt?.toISOString() ?? null, plans: Object.values(JOBS_PLANS) };
  });

  // Matched jobs Auto Apply can apply to that the user hasn't decided on, best first.
  app.get<{ Querystring: { limit?: string } }>('/v1/swipe', async (req): Promise<{ cards: SwipeCard[] }> => {
    const userId = req.user.id;
    const limit = Math.max(1, Math.min(30, Number(req.query.limit) || 15));
    const rows = await sql<(Omit<SwipeCard, 'postedAt' | 'summary'> & { posted_at: Date | null; summary: string })[]>`
      select l.id as "listingId", l.title, l.company, s.website as "companyWebsite", l.company_logo as "companyLogo",
             l.location, l.workplace, l.salary, l.posted_at, m.score, m.matched_skills as "matchedSkills",
             left(l.description_text, 600) as summary, s.provider
      from public.job_matches m
      join public.job_listings l on l.id = m.listing_id
      join public.job_sources s on s.id = l.source_id
      where m.user_id = ${userId} and m.score >= ${AUTO_APPLY_LIMITS.minScore}
        and l.closed_at is null and l.duplicate_of is null
        and s.provider in ${sql(AUTO_APPLY_PROVIDERS as unknown as string[])}
        and not exists (select 1 from public.job_swipes w where w.user_id = ${userId} and w.listing_id = l.id)
        and not exists (select 1 from public.auto_applications a where a.user_id = ${userId} and a.listing_id = l.id)
        and not exists (select 1 from public.job_applications j where j.user_id = ${userId} and j.listing_id = l.id and j.status <> 'saved')
      order by m.score desc, l.posted_at desc nulls last
      limit ${limit}`;
    return { cards: rows.map(({ posted_at, ...r }) => ({ ...r, postedAt: posted_at?.toISOString() ?? null })) };
  });

  const swipeBody = z.object({ listingId: z.uuid(), decision: z.enum(['apply', 'skip']) });

  // Right swipe: applied to through Auto Apply now (counts against today's limit). Left: never applied to.
  app.post('/v1/swipe', async (req, reply): Promise<SwipeResult | void> => {
    const body = swipeBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'bad_request', message: 'Invalid swipe.' });
    const userId = req.user.id;
    const { listingId, decision } = body.data;
    await ensureUser(req);
    const { plan } = await userPlan(userId);
    const [settingsRow] = await sql<SettingsRow[]>`select ${SETTINGS_COLUMNS} from public.auto_apply_settings where user_id = ${userId}`;
    const settings = toSettings(settingsRow, plan);

    if (decision === 'skip') {
      await sql`
        insert into public.job_swipes (user_id, listing_id, decision) values (${userId}, ${listingId}, 'skip')
        on conflict (user_id, listing_id) do update set decision = 'skip', created_at = now()`;
      return { decision, today: await usedToday(userId), limit: settings.dailyLimit };
    }

    const missing = await blockers(userId, await loadProfile(userId), settings);
    if (!settings.enabled) missing.push('Turn on Auto Apply');
    if (missing.length) return reply.code(409).send({ error: 'not_ready', message: missing.join('. ') });
    const today = await usedToday(userId);
    if (today >= settings.dailyLimit) {
      return reply.code(429).send({
        error: 'daily_limit',
        message: `You’ve used today’s ${settings.dailyLimit} applications. ${plan.id === 'premium' ? 'More tomorrow.' : 'Upgrade for more, or swipe again tomorrow.'}`,
      });
    }
    const [job] = await sql<{ id: string; title: string; company: string; provider: AutoApplyProvider; board: string; external_id: string; apply_url: string; score: number | null }[]>`
      select l.id, l.title, l.company, s.provider, s.board, l.external_id, l.apply_url, m.score
      from public.job_listings l join public.job_sources s on s.id = l.source_id
      left join public.job_matches m on m.user_id = ${userId} and m.listing_id = l.id
      where l.id = ${listingId} and l.closed_at is null`;
    if (!job) return reply.notFound('This job is no longer available.');
    if (!(AUTO_APPLY_PROVIDERS as readonly string[]).includes(job.provider)) {
      return reply.code(409).send({ error: 'unsupported', message: 'Auto Apply can’t apply on this job board yet.' });
    }
    await sql`
      insert into public.job_swipes (user_id, listing_id, decision) values (${userId}, ${listingId}, 'apply')
      on conflict (user_id, listing_id) do update set decision = 'apply', created_at = now()`;
    const [created] = await sql<{ id: string }[]>`
      insert into public.auto_applications (user_id, listing_id, provider, apply_url, title, company, score, plan_day)
      values (${userId}, ${job.id}, ${job.provider}, ${autoApplyUrl(job.provider, job.board, job.external_id, job.apply_url)},
              ${job.title}, ${job.company}, ${job.score},
              (now() at time zone ${settings.timezone})::date)
      on conflict (user_id, listing_id) do nothing
      returning id`;
    if (created) {
      await event(created.id, userId, 'planned', `You swiped right: ${job.title} at ${job.company}`);
      await queueAutoApply('autoapply.prepare', { applicationId: created.id }, req.log);
    }
    return { decision, applicationId: created?.id, today: today + (created ? 1 : 0), limit: settings.dailyLimit };
  });

  // Undo the last swipe: forgets it, and drops the application if it hasn't been sent.
  app.delete<{ Params: { listingId: string } }>('/v1/swipe/:listingId', async (req, reply) => {
    if (!z.uuid().safeParse(req.params.listingId).success) return reply.notFound('No such job.');
    const userId = req.user.id;
    await sql`delete from public.job_swipes where user_id = ${userId} and listing_id = ${req.params.listingId}`;
    await sql`
      delete from public.auto_applications
      where user_id = ${userId} and listing_id = ${req.params.listingId} and status in ('preparing', 'prepared')`;
    return { ok: true };
  });


  // ---- Analytics ---------------------------------------------------------------------------------

  const PROVIDER_LABELS: Record<string, string> = {
    greenhouse: 'Greenhouse', lever: 'Lever', ashby: 'Ashby', workable: 'Workable', smartrecruiters: 'SmartRecruiters',
    workday: 'Workday', keka: 'Keka', freshteam: 'Freshteam', zohorecruit: 'Zoho Recruit', himalayas: 'Himalayas',
    remoteok: 'Remote OK', jobicy: 'Jobicy', adzuna: 'Adzuna', jooble: 'Jooble', unknown: 'Closed listings',
  };

  app.get<{ Querystring: { days?: string } }>('/v1/jobs-analytics', async (req): Promise<JobsAnalytics> => {
    const userId = req.user.id;
    const days = [7, 30, 90].includes(Number(req.query.days)) ? Number(req.query.days) : 30;
    // Every application in the period (the tracker), with its source, channel and match score.
    const rows = await sql<{ day: string; status: string; source: string; auto: boolean; score: number | null }[]>`
      select to_char(coalesce(j.applied_at, j.created_at)::date, 'YYYY-MM-DD') as day, j.status,
             coalesce(src.provider, 'unknown') as source,
             exists (select 1 from public.auto_applications a where a.user_id = j.user_id and a.listing_id = j.listing_id and a.status = 'submitted') as auto,
             coalesce((select a.score from public.auto_applications a where a.user_id = j.user_id and a.listing_id = j.listing_id),
                      (select m.score from public.job_matches m where m.user_id = j.user_id and m.listing_id = j.listing_id)) as score
      from public.job_applications j
      left join public.job_listings l on l.id = j.listing_id
      left join public.job_sources src on src.id = l.source_id
      where j.user_id = ${userId} and j.status <> 'saved'
        and coalesce(j.applied_at, j.created_at) >= now() - make_interval(days => ${days})`;
    const statusRows = await sql<{ status: AutoApplyStatus; n: number }[]>`
      select status, count(*)::int as n from public.auto_applications
      where user_id = ${userId} and created_at >= now() - make_interval(days => ${days}) group by status`;

    const responded = (s: string) => s === 'interviewing' || s === 'offer' || s === 'rejected';
    const rate = (r: number, a: number) => (a ? Math.round((r / a) * 1000) / 1000 : 0);
    const applied = rows.length;
    const responses = rows.filter((r) => responded(r.status)).length;

    const dayMap = new Map<string, { applied: number; responses: number }>();
    for (let i = days - 1; i >= 0; i--) dayMap.set(new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10), { applied: 0, responses: 0 });
    for (const r of rows) {
      const d = dayMap.get(r.day);
      if (!d) continue;
      d.applied++;
      if (responded(r.status)) d.responses++;
    }

    const sources = new Map<string, { applied: number; responses: number; interviews: number }>();
    for (const r of rows) {
      const s = sources.get(r.source) ?? { applied: 0, responses: 0, interviews: 0 };
      s.applied++;
      if (responded(r.status)) s.responses++;
      if (r.status === 'interviewing' || r.status === 'offer') s.interviews++;
      sources.set(r.source, s);
    }

    const bands = [
      { band: '90–100', min: 90, max: 101 },
      { band: '80–89', min: 80, max: 90 },
      { band: '70–79', min: 70, max: 80 },
      { band: 'Under 70', min: -1, max: 70 },
    ];
    return {
      days,
      totals: {
        applied,
        auto: rows.filter((r) => r.auto).length,
        manual: rows.filter((r) => !r.auto).length,
        responses,
        interviews: rows.filter((r) => r.status === 'interviewing').length,
        offers: rows.filter((r) => r.status === 'offer').length,
        rejected: rows.filter((r) => r.status === 'rejected').length,
        responseRate: rate(responses, applied),
      },
      daily: [...dayMap].map(([day, v]) => ({ day, ...v })),
      bySource: [...sources]
        .map(([source, v]) => ({ source, label: PROVIDER_LABELS[source] ?? source, ...v, rate: rate(v.responses, v.applied) }))
        .sort((a, b) => b.rate - a.rate || b.applied - a.applied),
      byScore: bands.map(({ band, min, max }) => {
        const inBand = rows.filter((r) => (r.score ?? -1) >= min && (r.score ?? -1) < max);
        const resp = inBand.filter((r) => responded(r.status)).length;
        return { band, applied: inBand.length, responses: resp, rate: rate(resp, inBand.length) };
      }),
      autoApply: Object.fromEntries(AUTO_APPLY_STATUSES.map((s) => [s, statusRows.find((r) => r.status === s)?.n ?? 0])) as Record<AutoApplyStatus, number>,
    };
  });

  // ---- The Friday extension ----------------------------------------------------------------------

  // Hands the extension the next prepared application, leased to it for CLAIM_LEASE_MIN minutes.
  app.post('/v1/auto-apply/claim', async (req, reply): Promise<{ task: AutoApplyTask | null } | void> => {
    const body = claimBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'bad_request', message: 'Invalid device.' });
    const userId = req.user.id;
    const [settings] = await sql<{ enabled: boolean }[]>`select enabled from public.auto_apply_settings where user_id = ${userId}`;
    if (!settings?.enabled) return { task: null };
    const [row] = await sql<(AppRow & { answers: PreparedAnswer[]; file_name: string | null; has_cover: boolean })[]>`
      update public.auto_applications a
      set status = 'pending', reason_code = 'submitting', reason = 'Being submitted from your browser',
          claimed_by = ${body.data.device}, claimed_at = now(), updated_at = now()
      from (
        select id from public.auto_applications
        where user_id = ${userId} and status = 'prepared' and (retry_at is null or retry_at <= now())
        order by score desc nulls last, created_at
        limit 1 for update skip locked
      ) next
      where a.id = next.id
      returning a.id, a.listing_id, a.title, a.company, a.provider, a.apply_url, a.score, a.status, a.reason_code, a.reason,
                a.form, a.missing, a.attempts, a.submitted_at, a.created_at, a.updated_at, a.answers,
                (select t.file_name from public.tailored_resumes t where t.id = a.tailored_resume_id) as file_name,
                exists (select 1 from public.tailored_resumes t where t.id = a.tailored_resume_id and t.cover_letter_file is not null) as has_cover`;
    if (!row) return { task: null };
    await event(row.id, userId, 'claimed', 'Your browser started submitting it', { device: body.data.device });
    return {
      task: {
        id: row.id,
        provider: row.provider,
        applyUrl: row.apply_url,
        title: row.title,
        company: row.company,
        answers: row.answers ?? [],
        form: row.form ?? [],
        resumePath: `/v1/auto-apply/applications/${row.id}/resume`,
        resumeFileName: row.file_name ?? 'Resume.pdf',
        coverLetterPath: row.has_cover ? `/v1/auto-apply/applications/${row.id}/cover-letter` : null,
        coverLetterFileName: row.has_cover ? (row.file_name ?? 'Resume.pdf').replace(/Resume/, 'Cover Letter').replace(/\.docx$/i, '.pdf') : null,
        leaseUntil: new Date(Date.now() + CLAIM_LEASE_MIN * 60_000).toISOString(),
      },
    };
  });

  app.get<{ Params: { id: string } }>('/v1/auto-apply/applications/:id/resume', async (req, reply) => {
    if (!z.uuid().safeParse(req.params.id).success) return reply.notFound('No such application.');
    const [row] = await sql<{ file: Buffer | null; file_name: string | null; format: string | null }[]>`
      select t.file, t.file_name, t.content->>'format' as format
      from public.auto_applications a join public.tailored_resumes t on t.id = a.tailored_resume_id
      where a.id = ${req.params.id} and a.user_id = ${req.user.id} and t.status = 'ready'`;
    if (!row?.file) return reply.notFound('No tailored resume for this application.');
    const name = row.file_name ?? `Resume.${row.format ?? 'pdf'}`;
    return reply
      .type(row.format === 'docx' ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : 'application/pdf')
      .header('cache-control', 'private, no-store')
      .header('content-disposition', `attachment; filename="${name.replace(/[^\w\- .]/g, '')}"; filename*=UTF-8''${encodeURIComponent(name)}`)
      .send(row.file);
  });

  app.get<{ Params: { id: string } }>('/v1/auto-apply/applications/:id/cover-letter', async (req, reply) => {
    if (!z.uuid().safeParse(req.params.id).success) return reply.notFound('No such application.');
    const [row] = await sql<{ file: Buffer | null }[]>`
      select t.cover_letter_file as file
      from public.auto_applications a join public.tailored_resumes t on t.id = a.tailored_resume_id
      where a.id = ${req.params.id} and a.user_id = ${req.user.id}`;
    if (!row?.file) return reply.notFound('No cover letter for this application.');
    return reply.type('application/pdf').header('cache-control', 'private, no-store').send(row.file);
  });

  // The extension reports what happened. Submitted only counts when the job board's confirmation is seen.
  app.post<{ Params: { id: string } }>('/v1/auto-apply/applications/:id/report', async (req, reply) => {
    const body = reportBody.safeParse(req.body);
    if (!body.success || !z.uuid().safeParse(req.params.id).success) return reply.code(400).send({ error: 'bad_request', message: 'Invalid report.' });
    const userId = req.user.id;
    const [app] = await sql<{ id: string; provider: AutoApplyProvider; listing_id: string | null; form: FormQuestion[] | null; status: AutoApplyStatus; reason_code: string | null }[]>`
      select id, provider, listing_id, form, status, reason_code from public.auto_applications
      where id = ${req.params.id} and user_id = ${userId}`;
    if (!app) return reply.notFound('No such application.');
    if (app.status !== 'pending' || app.reason_code !== 'submitting') {
      return reply.code(409).send({ error: 'conflict', message: 'This application isn’t being submitted.' });
    }
    const { outcome, evidence, unanswered, message } = body.data;
    const set = async (status: AutoApplyStatus, code: AutoApplyReason | null, reason: string | null, extra = sql``) => {
      await sql`
        update public.auto_applications
        set status = ${status}, reason_code = ${code}, reason = ${reason}, claimed_by = null, claimed_at = null,
            evidence = ${evidence ? sql.json(evidence as never) : null}, updated_at = now() ${extra}
        where id = ${app.id}`;
    };

    if (outcome === 'submitted') {
      if (verifySubmission(app.provider, evidence)) {
        await set('submitted', null, null, sql`, submitted_at = now()`);
        await event(app.id, userId, 'submitted', 'Submitted; the job board confirmed it', { url: evidence!.url });
        await markApplied(userId, app.listing_id);
        return { status: 'submitted' };
      }
      await set('pending', 'unverified', 'Sent, but we couldn’t see the job board’s confirmation. Check your email for one, then confirm it here.');
      await event(app.id, userId, 'unverified', 'No confirmation seen after submitting', { url: evidence?.url });
      await queueAutoApply('autoapply.notify', { userId }, req.log);
      return { status: 'pending' };
    }
    if (outcome === 'captcha' || outcome === 'login_required') {
      const reason =
        outcome === 'captcha'
          ? 'The job board asked for a CAPTCHA check. Open it in your browser to finish, or try again later.'
          : 'The job board wants you to sign in before applying.';
      await set('pending', outcome, reason);
      await event(app.id, userId, outcome, message ?? reason);
      await queueAutoApply('autoapply.notify', { userId }, req.log);
      return { status: 'pending' };
    }
    if (outcome === 'needs_answers') {
      // Questions on the live form that the prepared answers didn't cover. Ones the form we read didn't
      // list are added to it, so the user can answer them and the extension fills them by label.
      const form = [...(app.form ?? [])];
      const keys: string[] = [];
      for (const label of (unanswered ?? []).map((l) => l.replace(/[*✱]\s*$/, '').trim()).filter(Boolean)) {
        const known = form.find((q) => norm(q.label) === norm(label));
        if (known) keys.push(known.key);
        else {
          const q: FormQuestion = { key: `extra:${norm(label).slice(0, 80)}`, label, type: 'text', required: true, options: [], kind: 'custom' };
          form.push(q);
          keys.push(q.key);
        }
      }
      await set('pending', 'needs_answers', `Needs your answer: ${(unanswered ?? []).slice(0, 3).join('; ') || 'a question on the form'}`, sql`, missing = ${keys}, form = ${sql.json(form as never)}`);
      await event(app.id, userId, 'needs_answers', 'The form had questions we couldn’t answer', { unanswered });
      await queueAutoApply('autoapply.notify', { userId }, req.log);
      return { status: 'pending' };
    }
    // failed: back to Prepared for another try, until MAX_SUBMIT_ATTEMPTS.
    const [{ n }] = await sql<{ n: number }[]>`
      select count(*)::int as n from public.auto_apply_events
      where application_id = ${app.id} and kind = 'submit_failed'
        -- Failures before the user's last Retry don't count.
        and id > coalesce((select max(id) from public.auto_apply_events where application_id = ${app.id} and kind = 'retry'), 0)`;
    await event(app.id, userId, 'submit_failed', message ?? 'Submitting failed', { url: evidence?.url });
    if (n + 1 >= MAX_SUBMIT_ATTEMPTS) {
      await set('failed', 'submit_failed', `Couldn’t submit after ${MAX_SUBMIT_ATTEMPTS} tries${message ? `: ${message}` : ''}.`);
      return { status: 'failed' };
    }
    // Try others first: 30 minutes after the first failure, an hour after the second.
    await set('prepared', null, null, sql`, retry_at = now() + make_interval(mins => ${30 * (n + 1)})`);
    return { status: 'prepared' };
  });
}

/**
 * Other applications waiting on the same questions get the user's saved answers straight away (same
 * wording, and a listed option for selects), and become Prepared once nothing required is missing.
 */
async function applySavedAnswers(userId: string, profile: ApplicationProfile, exceptId: string) {
  const saved = new Map(profile.savedAnswers.map((a) => [norm(a.question), a.answer]));
  const waiting = await sql<{ id: string; form: FormQuestion[]; answers: PreparedAnswer[] | null; missing: string[] }[]>`
    select id, form, answers, missing from public.auto_applications
    where user_id = ${userId} and status = 'pending' and reason_code = 'needs_answers' and id <> ${exceptId} and form is not null`;
  for (const app of waiting) {
    const answers = new Map((app.answers ?? []).map((a) => [a.key, a]));
    const still: string[] = [];
    for (const key of app.missing) {
      const q = app.form.find((f) => f.key === key);
      const value = q ? saved.get(norm(q.label)) : undefined;
      const option = q && value !== undefined && q.options.length ? q.options.find((o) => norm(o) === norm(value)) : value;
      if (q && option && q.type !== 'multiselect') answers.set(key, { key, label: q.label, value: option, source: 'user' });
      else still.push(key);
    }
    if (still.length === app.missing.length) continue;
    const done = still.length === 0;
    await sql`
      update public.auto_applications
      set answers = ${sql.json(app.form.filter((q) => answers.has(q.key)).map((q) => answers.get(q.key)!) as never)},
          missing = ${still}, status = ${done ? 'prepared' : 'pending'}, reason_code = ${done ? null : 'needs_answers'},
          reason = ${done ? null : 'Needs a few more answers'}, updated_at = now()
      where id = ${app.id}`;
    await event(app.id, userId, done ? 'prepared' : 'answered', 'Filled in from your earlier answers');
  }
}

/** A submitted application shows in the user's Applied list. */
async function markApplied(userId: string, listingId: string | null) {
  if (!listingId) return;
  await sql`
    insert into public.job_applications (user_id, listing_id, title, company, location, apply_url, status, applied_at)
    select ${userId}, l.id, l.title, l.company, l.location, l.apply_url, 'applied', now()
    from public.job_listings l where l.id = ${listingId}
    on conflict (user_id, listing_id) do update set
      status = case when job_applications.status = 'saved' then 'applied' else job_applications.status end,
      applied_at = coalesce(job_applications.applied_at, now()), updated_at = now()`;
}
