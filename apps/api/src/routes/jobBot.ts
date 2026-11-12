import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import {
  BOT_LIMITS, BOT_PLATFORMS, DEFAULT_JOB_BOT_SETTINGS, EMPTY_APPLICATION_PROFILE, TAILOR_LIMITS, resumeRoles,
  type ApplicationProfile, type BotApplication, type BotApplicationPage, type BotPlatform, type BotPlatformStatus,
  type BotSearch, type BotSessionStatus, type JobBotSettings, type JobBotState, type ResumeProfile,
} from '@parakeet/shared';
import { requireAuth } from '../lib/auth.js';
import { sql } from '../lib/db.js';
import { jobBotQueue, tailorQueue } from '../lib/queues.js';
import { ensureUser } from '../lib/users.js';
import { env } from '../env.js';

// Friday Jobs platform bot (packages/shared/src/jobBot.ts): settings, sign-in status per platform, the
// applications it sent, and the questions it needs answered. The applying itself is the worker's
// (queues/jobBot.ts). Only for accounts in JOB_BOT_USER_EMAILS.

const platformSchema = z.enum(BOT_PLATFORMS);
const settingsSchema = z.object({
  enabled: z.boolean(),
  platforms: z.object(
    Object.fromEntries(BOT_PLATFORMS.map((p) => [p, z.object({ enabled: z.boolean(), dailyLimit: z.number().int().min(0).max(BOT_LIMITS.maxPerDay) })])) as Record<
      BotPlatform,
      z.ZodObject<{ enabled: z.ZodBoolean; dailyLimit: z.ZodNumber }>
    >,
  ),
  searches: z.array(z.object({ keywords: z.string().trim().min(2).max(80), location: z.string().trim().min(2).max(60) })).max(BOT_LIMITS.maxSearches),
  postedWithinDays: z.union([z.literal(1), z.literal(3), z.literal(7)]),
  skipTitles: z.array(z.string().trim().min(1).max(60)).max(30),
  skipCompanies: z.array(z.string().trim().min(1).max(80)).max(50),
});
const assistedSchema = z.object({
  platform: platformSchema,
  url: z.url().max(2000).refine((u) => /^https:\/\//.test(u), 'https link'),
  title: z.string().trim().min(2).max(200),
  company: z.string().trim().min(1).max(200),
  description: z.string().trim().min(150).max(30_000),
});
const answerSchema = z.object({ question: z.string().trim().min(1).max(500), answer: z.string().trim().min(1).max(2000) });
const listQuery = z.object({
  q: z.string().max(100).optional(),
  platform: platformSchema.optional(),
  outcome: z.enum(['applied', 'assisted', 'skipped', 'all']).default('applied'),
  page: z.coerce.number().int().min(1).max(500).default(1),
});

const allowed = (req: FastifyRequest) =>
  env.JOB_BOT_USER_EMAILS.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean).includes((req.user.email ?? '').toLowerCase());

/** "Question? (options: a / b)" → the question alone; null for notes that aren't a question to answer. */
export function questionOf(detail: string): string | null {
  if (/^(LinkedIn says|Indeed didn.t move on)/.test(detail)) return null;
  return detail.replace(/\s*\((options:|your answer|needs a number)[^)]*\)?\s*$/, '').trim() || null;
}

async function loadSettings(userId: string): Promise<JobBotSettings> {
  const [row] = await sql<{ settings: Partial<JobBotSettings> }[]>`select settings from public.job_bot_settings where user_id = ${userId}`;
  const s = row?.settings ?? {};
  return { ...DEFAULT_JOB_BOT_SETTINGS, ...s, platforms: { ...DEFAULT_JOB_BOT_SETTINGS.platforms, ...(s.platforms ?? {}) } };
}

async function effectiveSearches(userId: string, settings: JobBotSettings): Promise<BotSearch[]> {
  if (settings.searches.length) return settings.searches;
  const [prefs] = await sql<{ roles: string[]; locations: string[] }[]>`select roles, locations from public.job_preferences where user_id = ${userId}`;
  const [resume] = await sql<{ parsed_json: ResumeProfile | null }[]>`
    select parsed_json from public.resumes where user_id = ${userId} order by created_at desc limit 1`;
  const roles = prefs?.roles.length ? prefs.roles : resumeRoles(resume?.parsed_json ?? null);
  const cities = (prefs?.locations ?? []).filter((l) => !/^(remote|anywhere)$/i.test(l.trim()));
  const where = cities.length ? cities : ['India'];
  return roles.slice(0, 4).flatMap((r) => where.slice(0, 2).map((location) => ({ keywords: r, location })));
}

export default async function jobBotRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  app.get('/v1/job-bot', async (req): Promise<JobBotState> => {
    const userId = req.user.id;
    const settings = await loadSettings(userId);
    const [sessions, stats, needs, [profileRow], [resume], waiting] = await Promise.all([
      sql<{ platform: BotPlatform; status: BotSessionStatus; message: string | null; last_run_at: Date | null; retry_after: Date | null }[]>`
        select platform, status, message, last_run_at, retry_after from public.job_bot_sessions where user_id = ${userId}`,
      sql<{ platform: BotPlatform; today: number; total: number }[]>`
        select platform,
          count(*) filter (where (updated_at at time zone 'Asia/Kolkata')::date = (now() at time zone 'Asia/Kolkata')::date)::int as today,
          count(*)::int as total
        from public.job_bot_applications where user_id = ${userId} and outcome = 'applied' group by platform`,
      sql<{ detail: string }[]>`
        select detail from public.job_bot_applications
        where user_id = ${userId} and outcome = 'needs_answer' and detail is not null and updated_at > now() - interval '30 days'`,
      sql<{ data: Partial<ApplicationProfile> }[]>`select data from public.application_profiles where user_id = ${userId}`,
      sql<{ has_file: boolean }[]>`select file is not null as has_file from public.resumes where user_id = ${userId} order by created_at desc limit 1`,
      jobBotQueue.getJobs(['waiting', 'active', 'delayed']),
    ]);
    const profile = { ...EMPTY_APPLICATION_PROFILE, ...(profileRow?.data ?? {}) };
    const saved = new Set(profile.savedAnswers.map((a) => a.question.trim().toLowerCase()));
    const counts = new Map<string, number>();
    for (const n of needs) {
      for (const part of n.detail.split(' | ')) {
        const q = questionOf(part);
        if (q && !saved.has(q.toLowerCase())) counts.set(q, (counts.get(q) ?? 0) + 1);
      }
    }
    const bySession = new Map(sessions.map((s) => [s.platform, s]));
    const byStats = new Map(stats.map((s) => [s.platform, s]));
    const platforms: BotPlatformStatus[] = BOT_PLATFORMS.map((p) => ({
      platform: p,
      status: bySession.get(p)?.status ?? 'disconnected',
      message: bySession.get(p)?.message ?? null,
      retryAfter: bySession.get(p)?.retry_after?.toISOString() ?? null,
      appliedToday: byStats.get(p)?.today ?? 0,
      appliedTotal: byStats.get(p)?.total ?? 0,
      lastRunAt: bySession.get(p)?.last_run_at?.toISOString() ?? null,
    }));
    return {
      available: allowed(req),
      settings,
      platforms,
      running: waiting.some((j) => j?.data?.userId === userId && j.name === 'jobbot.run'),
      effectiveSearches: await effectiveSearches(userId, settings),
      questions: [...counts].sort((a, b) => b[1] - a[1]).slice(0, 50).map(([question, jobs]) => ({ question, jobs })),
      missing: [
        !resume?.has_file && 'Upload your resume (the bot attaches the file)',
        !profile.phone.trim() && 'Add your phone number in the Application Profile',
        !profile.firstName.trim() && 'Add your name in the Application Profile',
      ].filter((m): m is string => Boolean(m)),
    };
  });

  app.put('/v1/job-bot/settings', async (req, reply) => {
    if (!allowed(req)) return reply.code(403).send({ error: 'unavailable', message: 'The platform bot isn’t enabled for this account.' });
    const parsed = settingsSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'bad_request', message: 'Invalid settings.' });
    await ensureUser(req);
    await sql`
      insert into public.job_bot_settings (user_id, settings) values (${req.user.id}, ${sql.json(parsed.data)})
      on conflict (user_id) do update set settings = excluded.settings, updated_at = now()`;
    return { ok: true };
  });

  // Opens a Chrome window on the computer running the worker, on the site's own sign-in page.
  app.post('/v1/job-bot/connect/:platform', async (req, reply) => {
    if (!allowed(req)) return reply.code(403).send({ error: 'unavailable', message: 'The platform bot isn’t enabled for this account.' });
    const platform = platformSchema.safeParse((req.params as { platform: string }).platform);
    if (!platform.success) return reply.code(400).send({ error: 'bad_request', message: 'Unknown platform.' });
    await ensureUser(req);
    await sql`
      insert into public.job_bot_sessions (user_id, platform, status, message)
      values (${req.user.id}, ${platform.data}, 'connecting', 'Opening a Chrome window…')
      on conflict (user_id, platform) do update set status = 'connecting', message = excluded.message, updated_at = now()`;
    await jobBotQueue.add('jobbot.connect', { userId: req.user.id, platform: platform.data });
    return { ok: true };
  });

  app.delete('/v1/job-bot/connect/:platform', async (req, reply) => {
    const platform = platformSchema.safeParse((req.params as { platform: string }).platform);
    if (!platform.success) return reply.code(400).send({ error: 'bad_request', message: 'Unknown platform.' });
    await sql`
      update public.job_bot_sessions set status = 'disconnected', message = 'Paused. Connect again to resume.', updated_at = now()
      where user_id = ${req.user.id} and platform = ${platform.data}`;
    return { ok: true };
  });

  app.post('/v1/job-bot/run', async (req, reply) => {
    if (!allowed(req)) return reply.code(403).send({ error: 'unavailable', message: 'The platform bot isn’t enabled for this account.' });
    await jobBotQueue.add('jobbot.run', { userId: req.user.id }, { jobId: `run-${req.user.id}-${Date.now() - (Date.now() % 600_000)}` });
    return { ok: true };
  });

  // An answer to a question the bot couldn't answer: saved with the Application Profile's answers, so
  // Auto Apply uses it too, and the jobs it held back are tried again on the next run.
  app.post('/v1/job-bot/answers', async (req, reply) => {
    const parsed = answerSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'bad_request', message: 'Write an answer.' });
    await ensureUser(req);
    const [row] = await sql<{ data: Partial<ApplicationProfile> }[]>`select data from public.application_profiles where user_id = ${req.user.id}`;
    const profile = { ...EMPTY_APPLICATION_PROFILE, ...(row?.data ?? {}) };
    const q = parsed.data.question.toLowerCase();
    profile.savedAnswers = [...profile.savedAnswers.filter((a) => a.question.trim().toLowerCase() !== q), parsed.data].slice(-300);
    await sql`
      insert into public.application_profiles (user_id, data) values (${req.user.id}, ${sql.json(profile as never)})
      on conflict (user_id) do update set data = excluded.data, updated_at = now()`;
    return { ok: true };
  });

  // Assisted Apply: a job the candidate found (Naukri, or any site the bot can't apply on). Friday tailors
  // their resume for it from the pasted description; they submit on the site and confirm.
  app.post('/v1/job-bot/assisted', async (req, reply) => {
    const parsed = assistedSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'bad_request', message: 'Add the job link, title, company and the full job description (at least a few lines).' });
    }
    await ensureUser(req);
    const userId = req.user.id;
    const { platform, url, title, company, description } = parsed.data;
    const [{ today }] = await sql<{ today: number }[]>`
      select count(*)::int as today from public.tailored_resumes where user_id = ${userId} and created_at > now() - interval '1 day'`;
    if (today >= TAILOR_LIMITS.perDay) {
      return reply.code(429).send({ error: 'limit', message: `You've tailored ${TAILOR_LIMITS.perDay} resumes in the last day. Try again tomorrow.` });
    }
    const [resume] = await sql<{ id: string }[]>`
      select id from public.resumes where user_id = ${userId} and file is not null order by created_at desc limit 1`;
    if (!resume) return reply.code(409).send({ error: 'no_resume', message: 'Upload your resume first (as a PDF or Word file).' });
    const jobId = `manual:${createHash('sha256').update(url.trim()).digest('hex').slice(0, 24)}`;
    const id = await sql.begin(async (tx) => {
      const [t] = await tx<{ id: string }[]>`
        insert into public.tailored_resumes (user_id, listing_id, resume_id, title, company, description)
        values (${userId}, null, ${resume.id}, ${title}, ${company}, ${description}) returning id`;
      const [a] = await tx<{ id: string }[]>`
        insert into public.job_bot_applications (user_id, platform, job_id, title, company, url, outcome, detail, tailored_resume_id)
        values (${userId}, ${platform}, ${jobId}, ${title}, ${company}, ${url}, 'assisted', 'Added by you: tailoring your resume', ${t.id})
        on conflict (user_id, platform, job_id) do update set
          title = excluded.title, company = excluded.company, tailored_resume_id = excluded.tailored_resume_id, updated_at = now()
        where job_bot_applications.outcome <> 'applied'
        returning id`;
      if (!a) throw Object.assign(new Error('already applied'), { statusCode: 409 });
      return { applicationId: a.id, tailoredId: t.id };
    }).catch((err) => (err.statusCode === 409 ? null : Promise.reject(err)));
    if (!id) return reply.code(409).send({ error: 'already_applied', message: 'You already applied to this job.' });
    await tailorQueue.add('resume.tailor', { tailoredId: id.tailoredId }, { jobId: `tailor-${id.tailoredId}-${Date.now()}` });
    return { id: id.applicationId };
  });

  // The candidate submitted an assisted application on the site: recorded as user-reported, never verified.
  app.post<{ Params: { id: string } }>('/v1/job-bot/applications/:id/submitted', async (req, reply) => {
    if (!z.uuid().safeParse(req.params.id).success) return reply.notFound('No such job.');
    const done = await sql`
      update public.job_bot_applications set outcome = 'applied', evidence = 'user_reported', detail = 'You confirmed you applied', updated_at = now()
      where id = ${req.params.id} and user_id = ${req.user.id} and outcome <> 'applied'`;
    if (!done.count) return reply.notFound('No such job, or already marked applied.');
    return { ok: true };
  });

  app.get<{ Params: { id: string } }>('/v1/job-bot/applications/:id/resume', async (req, reply) => {
    if (!z.uuid().safeParse(req.params.id).success) return reply.notFound('No such job.');
    const [row] = await sql<{ file: Buffer | null; file_name: string | null; format: 'pdf' | 'docx' | null }[]>`
      select t.file, t.file_name, t.content->>'format' as format
      from public.job_bot_applications a join public.tailored_resumes t on t.id = a.tailored_resume_id
      where a.id = ${req.params.id} and a.user_id = ${req.user.id} and t.status = 'ready'`;
    if (!row?.file) return reply.notFound('No tailored resume for this job yet.');
    const type = row.format === 'docx' ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : 'application/pdf';
    const name = row.file_name ?? `Resume.${row.format ?? 'pdf'}`;
    return reply
      .type(type)
      .header('cache-control', 'private, no-store')
      .header('content-disposition', `attachment; filename="${name.replace(/[^\w\- .]/g, '')}"; filename*=UTF-8''${encodeURIComponent(name)}`)
      .send(row.file);
  });

  app.get('/v1/job-bot/applications', async (req, reply): Promise<BotApplicationPage | void> => {
    const parsed = listQuery.safeParse(req.query);
    if (!parsed.success) return reply.code(400).send({ error: 'bad_request', message: 'Invalid query.' });
    const { q, platform, outcome, page } = parsed.data;
    const like = q?.trim() ? `%${q.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
    const where = sql`
      a.user_id = ${req.user.id}
      ${platform ? sql`and a.platform = ${platform}` : sql``}
      ${outcome === 'applied' ? sql`and a.outcome = 'applied'` : outcome === 'assisted' ? sql`and a.outcome = 'assisted'` : outcome === 'skipped' ? sql`and a.outcome not in ('applied', 'assisted')` : sql``}
      ${like ? sql`and (a.title ilike ${like} or a.company ilike ${like})` : sql``}`;
    const [rows, [{ total }]] = await Promise.all([
      sql<{
        id: string; platform: BotPlatform; title: string; company: string; location: string; url: string; outcome: BotApplication['outcome'];
        detail: string | null; evidence: BotApplication['evidence']; tailored_resume_id: string | null; tailor_status: BotApplication['tailorStatus']; updated_at: Date;
      }[]>`
        select a.id, a.platform, a.title, a.company, a.location, a.url, a.outcome, a.detail, a.evidence, a.tailored_resume_id,
          t.status as tailor_status, a.updated_at
        from public.job_bot_applications a left join public.tailored_resumes t on t.id = a.tailored_resume_id
        where ${where} order by a.updated_at desc limit ${BOT_LIMITS.pageSize} offset ${(page - 1) * BOT_LIMITS.pageSize}`,
      sql<{ total: number }[]>`select count(*)::int as total from public.job_bot_applications a where ${where}`,
    ]);
    return {
      items: rows.map((r) => ({
        id: r.id, platform: r.platform, title: r.title, company: r.company, location: r.location, url: r.url, outcome: r.outcome, detail: r.detail,
        evidence: r.evidence, tailoredResumeId: r.tailored_resume_id, tailorStatus: r.tailor_status ?? null, at: r.updated_at.toISOString(),
      })),
      total,
      page,
      pageSize: BOT_LIMITS.pageSize,
    };
  });
}
