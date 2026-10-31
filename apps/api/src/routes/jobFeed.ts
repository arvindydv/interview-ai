import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  AGGREGATORS, AGGREGATOR_NAMES, AGGREGATOR_SITES, APPLICATION_STATUSES, COMPANY_TYPES, PLATFORMS, FEED_SORTS, FEED_VIEWS, JOB_TYPES,
  LISTING_LIMITS, MATCH_THRESHOLDS, PREFERENCE_LIMITS, SEARCH_PROVIDERS, TAILOR_LIMITS, WORKPLACES, resumeRoles, type ApplicationStatus,
  type CompanyType, type FeedDetail, type FeedFacets, type FeedItem, type FeedPage, type FeedView, type JobPreferences, type Platform,
  type JobType, type JobsSummary, type ListingProvider, type ResumeProfile, type TailoredResume, type TailoredResumeRecord,
  type TailorStatus, type WebJob, type WebJobPage, type Workplace,
  dedupeKey, isAgency,
} from '@parakeet/shared';
import { requireAuth } from '../lib/auth.js';
import { sql } from '../lib/db.js';
import { refreshMatches, tailorQueue } from '../lib/queues.js';
import { careerjetEnabled, searchCareerjet } from '../lib/careerjet.js';
import { ensureUser } from '../lib/users.js';

// Friday Jobs for signed-in users: listings matched to their resume and preferences (scored by
// apps/worker/src/queues/matches.ts), and the jobs they save and apply to.

interface ItemRow {
  id: string;
  title: string;
  company: string;
  department: string | null;
  location: string;
  workplace: Workplace | null;
  employment_type: string | null;
  salary: string | null;
  posted_at: Date | null;
  website: string | null;
  company_logo: string | null;
  posted_on: string | null;
  agency: boolean | null;
  provider: ListingProvider | null;
  startup: boolean | null;
  yc_batch: string | null;
  closed: boolean;
  score: number | null;
  title_score: number | null;
  skill_score: number | null;
  level_score: number | null;
  matched_skills: string[] | null;
  status: ApplicationStatus | null;
}

const toItem = (r: ItemRow): FeedItem => ({
  id: r.id,
  title: r.title,
  company: r.company,
  department: r.department,
  location: r.location,
  workplace: r.workplace,
  employmentType: r.employment_type,
  salary: r.salary,
  postedAt: r.posted_at?.toISOString() ?? null,
  companyWebsite: r.website,
  companyLogo: r.company_logo,
  // A job board's own site isn't the company's.
  via: r.provider ? (AGGREGATOR_NAMES[r.provider] ?? null) : null,
  viaUrl: r.provider ? (AGGREGATOR_SITES[r.provider] ?? null) : null,
  postedOn: r.posted_on,
  agency: Boolean(r.agency),
  startup: Boolean(r.startup),
  ycBatch: r.yc_batch,
  closed: r.closed,
  status: r.status,
  match:
    r.score === null
      ? null
      : {
          score: r.score,
          titleScore: r.title_score!,
          skillScore: r.skill_score!,
          levelScore: r.level_score!,
          matchedSkills: r.matched_skills ?? [],
        },
});

const text = z.string().max(LISTING_LIMITS.maxQueryChars).transform((s) => s.trim()).optional();

/** A comma-separated query parameter, e.g. `workplace=remote,hybrid`. */
const list = <T extends z.ZodType>(item: T, max: number) =>
  z.preprocess(
    (v) => (typeof v === 'string' && v ? [...new Set(v.split(',').map((x) => x.trim()).filter(Boolean))] : undefined),
    z.array(item).max(max).optional(),
  );

const filterQuery = z.object({
  view: z.enum(FEED_VIEWS).default('recommended'),
  q: text,
  location: text,
  workplace: list(z.enum(WORKPLACES), WORKPLACES.length),
  level: list(z.coerce.number().int().min(0).max(5), 6),
  type: list(z.enum(JOB_TYPES), JOB_TYPES.length),
  company: list(z.string().max(100), 50),
  posted: z.coerce.number().int().min(1).max(365).optional(),
  minScore: z.coerce.number().int().min(0).max(100).optional(),
  salary: z.enum(['1', 'true']).optional().transform(Boolean),
  companyType: list(z.enum(COMPANY_TYPES.map((c) => c.id) as [CompanyType, ...CompanyType[]]), COMPANY_TYPES.length),
  platform: list(z.enum(PLATFORMS.map((p) => p.id) as [Platform, ...Platform[]]), PLATFORMS.length),
  sort: z.enum(FEED_SORTS).optional(),
});
type Filters = z.infer<typeof filterQuery>;

const feedQuery = filterQuery.extend({
  page: z.coerce.number().int().min(1).max(LISTING_LIMITS.maxPage).default(1),
});

const preferenceList = z
  .array(z.string().trim().min(1).max(PREFERENCE_LIMITS.maxChars))
  .max(PREFERENCE_LIMITS.maxItems)
  .transform((items) => [...new Map(items.map((i) => [i.toLowerCase(), i])).values()]);

const preferencesBody = z.object({
  roles: preferenceList,
  locations: preferenceList,
  workplaces: z.array(z.enum(WORKPLACES)).max(WORKPLACES.length).transform((w) => [...new Set(w)]),
});

const ENTITIES: Record<string, string> = { amp: '&', quot: '"', '#39': "'", apos: "'", lt: '<', gt: '>', nbsp: ' ' };

const webQuery = z.object({
  q: z.string().trim().min(1).max(LISTING_LIMITS.maxQueryChars),
  location: text,
  page: z.coerce.number().int().min(1).max(10).default(1),
});

const statusBody = z.object({ status: z.enum(APPLICATION_STATUSES).nullable() });

const likeContains = (s: string) => `%${s.replace(/[\\%_]/g, '\\$&')}%`;

/** Which job type a listing is. Postings that don't say are counted as full-time, unless internships. */
const JOB_TYPE_SQL: Record<JobType, ReturnType<typeof sql>> = {
  fulltime: sql`(l.employment_type ~* '^(full|perm)' or (l.employment_type is null and l.level > 0))`,
  parttime: sql`(l.employment_type ~* '^part')`,
  internship: sql`(l.employment_type ~* 'intern' or l.level = 0)`,
  contract: sql`(l.employment_type ~* '(contract|temp|fixed|short)')`,
};

/** Which platform a listing came from (see PLATFORMS), over source `s`. */
const PLATFORM_SQL: Record<Platform, ReturnType<typeof sql>> = {
  careers: sql`(s.provider <> all(${[...AGGREGATORS]}::text[]))`,
  ycombinator: sql`(s.yc_batch is not null)`,
  himalayas: sql`(s.provider = 'himalayas')`,
  remoteok: sql`(s.provider = 'remoteok')`,
  jobicy: sql`(s.provider = 'jobicy')`,
  adzuna: sql`(s.provider = 'adzuna')`,
  jooble: sql`(s.provider = 'jooble')`,
};

/** Who is hiring (see COMPANY_TYPES), over listing `l` and source `s`. */
const COMPANY_TYPE_SQL: Record<CompanyType, ReturnType<typeof sql>> = {
  direct: sql`(not l.agency)`,
  agency: sql`(l.agency)`,
  startup: sql`(s.startup)`,
};

const anyOf = (parts: ReturnType<typeof sql>[]) => parts.reduce((a, b) => sql`${a} or ${b}`);

/** `count(*) filter (where …) as key` for each condition, for a filter menu's counts. */
const countsBy = (conditions: Record<string, ReturnType<typeof sql>>) =>
  Object.entries(conditions)
    .map(([key, cond]) => sql`count(*) filter (where ${cond})::int as ${sql(key)}`)
    .reduce((a, b) => sql`${a}, ${b}`);

/**
 * Filters on listing `l` (and match `m`). `except` leaves one out, so a filter menu's counts show what
 * picking another value would add.
 */
function filterSql(f: Filters, except?: 'workplace' | 'level' | 'type' | 'company' | 'salary' | 'companyType' | 'platform') {
  const query = f.q ? sql`websearch_to_tsquery('english', ${f.q})` : null;
  return sql`
    ${query ? sql`and l.search @@ ${query}` : sql``}
    ${f.location ? sql`and l.location ilike ${likeContains(f.location)}` : sql``}
    ${f.workplace && except !== 'workplace' ? sql`and l.workplace = any(${f.workplace}::text[])` : sql``}
    ${f.level && except !== 'level' ? sql`and l.level = any(${f.level}::smallint[])` : sql``}
    ${f.type && except !== 'type' ? sql`and (${anyOf(f.type.map((t) => JOB_TYPE_SQL[t]))})` : sql``}
    ${f.company && except !== 'company' ? sql`and l.company = any(${f.company}::text[])` : sql``}
    ${f.posted ? sql`and l.posted_at >= now() - make_interval(days => ${f.posted})` : sql``}
    ${f.minScore ? sql`and m.score >= ${f.minScore}` : sql``}
    ${f.salary && except !== 'salary' ? sql`and l.salary is not null` : sql``}
    ${f.companyType && except !== 'companyType' ? sql`and (${anyOf(f.companyType.map((c) => COMPANY_TYPE_SQL[c]))})` : sql``}
    ${f.platform && except !== 'platform' ? sql`and (${anyOf(f.platform.map((p) => PLATFORM_SQL[p]))})` : sql``}`;
}

/**
 * Listings in a browsing view, as `from … where …` over listing `l`, source `s`, match `m` and
 * application `a`. Recommended and Top hold the user's matches above their threshold, leaving out jobs
 * already applied to (those move to Applied); All holds every open listing. Each holds one copy of a
 * job found on several platforms.
 */
function viewSql(view: Exclude<FeedView, 'saved' | 'applied'>, userId: string) {
  if (view === 'all') {
    return sql`
      from public.job_listings l
      join public.job_sources s on s.id = l.source_id
      left join public.job_matches m on m.user_id = ${userId} and m.listing_id = l.id
      left join public.job_applications a on a.user_id = ${userId} and a.listing_id = l.id
      where l.closed_at is null and l.duplicate_of is null`;
  }
  return sql`
    from public.job_matches m
    join public.job_listings l on l.id = m.listing_id
    join public.job_sources s on s.id = l.source_id
    left join public.job_applications a on a.user_id = m.user_id and a.listing_id = l.id
    where m.user_id = ${userId} and l.closed_at is null and l.duplicate_of is null and m.score >= ${MATCH_THRESHOLDS[view]}
      and (a.status is null or a.status = 'saved')`;
}

/** Columns of an item, for listing `l` with optional match `m`, application `a` and source `s`. */
const ITEM_COLUMNS = sql`
  l.id, l.title, l.company, l.department, l.location, l.workplace, l.employment_type, l.salary, l.posted_at,
  case when s.provider = any(${[...AGGREGATORS]}::text[]) then null else s.website end as website,
  l.company_logo, l.posted_on, l.agency, s.provider, s.startup, s.yc_batch, l.closed_at is not null as closed,
  m.score, m.title_score, m.skill_score, m.level_score, m.matched_skills, a.status`;

interface TailoredRow {
  id: string;
  listing_id: string | null;
  title: string;
  company: string;
  status: TailorStatus;
  content: TailoredResume | null;
  file_name: string | null;
  cover_letter: string | null;
  error: string | null;
  updated_at: Date;
}

const TAILORED_COLUMNS = sql`id, listing_id, title, company, status, content, file_name, cover_letter, error, updated_at`;

const toTailored = (r: TailoredRow): TailoredResumeRecord => ({
  id: r.id,
  listingId: r.listing_id,
  title: r.title,
  company: r.company,
  status: r.status,
  content: r.content,
  fileName: r.file_name,
  coverLetter: r.cover_letter,
  error: r.error,
  updatedAt: r.updated_at.toISOString(),
});

export default async function jobFeedRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  app.get('/v1/job-feed/summary', async (req): Promise<JobsSummary> => {
    const userId = req.user.id;
    await ensureUser(req);
    // The first visit creates the preferences row, which opts the user into match refreshes.
    const [prefs] = await sql<(JobPreferences & { matched_at: Date | null; updated_at: Date })[]>`
      insert into public.job_preferences (user_id) values (${userId})
      on conflict (user_id) do update set user_id = excluded.user_id
      returning roles, locations, workplaces, matched_at, updated_at`;
    const [resume] = await sql<{ status: 'parsing' | 'ready' | 'failed'; file_name: string; parsed_json: ResumeProfile | null; updated_at: Date }[]>`
      select status, file_name, parsed_json, updated_at from public.resumes
      where user_id = ${userId} order by created_at desc limit 1`;
    const [counts] = await sql<JobsSummary['counts'][]>`
      select
        (select count(*)::int ${viewSql('recommended', userId)} and l.posted_at >= now() - interval '7 days') as "newThisWeek",
        (select count(*)::int from public.job_matches m join public.job_listings l on l.id = m.listing_id
          where m.user_id = ${userId} and l.closed_at is null and m.score >= ${MATCH_THRESHOLDS.recommended}
            and not exists (select 1 from public.job_applications a where a.user_id = m.user_id and a.listing_id = m.listing_id and a.status <> 'saved')) as recommended,
        (select count(*)::int from public.job_matches m join public.job_listings l on l.id = m.listing_id
          where m.user_id = ${userId} and l.closed_at is null and m.score >= ${MATCH_THRESHOLDS.top}
            and not exists (select 1 from public.job_applications a where a.user_id = m.user_id and a.listing_id = m.listing_id and a.status <> 'saved')) as top,
        (select count(*)::int from public.job_applications where user_id = ${userId} and status = 'saved') as saved,
        (select count(*)::int from public.job_applications where user_id = ${userId} and status <> 'saved') as applied`;
    const [stats] = await sql<{ open: number; companies: number; last_sync: Date | null }[]>`
      select (select count(*)::int from public.job_listings where closed_at is null and duplicate_of is null) as open,
             (select count(distinct company)::int from public.job_listings where closed_at is null and duplicate_of is null) as companies,
             (select max(last_synced_at) from public.job_sources) as last_sync`;

    // Matches are stale until computed after the latest preferences and resume analysis.
    const inputsAt = Math.max(prefs.updated_at.getTime(), resume?.status === 'parsing' ? 0 : (resume?.updated_at.getTime() ?? 0));
    const matching = resume?.status === 'parsing' || !prefs.matched_at || prefs.matched_at.getTime() < inputsAt;
    if (matching && resume?.status !== 'parsing') await refreshMatches(userId, req.log);

    const profile = resume?.parsed_json ?? null;
    return {
      profile: {
        name: profile?.name ?? null,
        headline: profile?.headline ?? null,
        years: profile?.totalYearsExperience ?? null,
        topSkills: (profile?.skills ?? []).slice(0, 12).map((s) => s.name),
        resumeStatus: resume?.status ?? null,
        resumeFileName: resume?.file_name ?? null,
      },
      preferences: { roles: prefs.roles, locations: prefs.locations, workplaces: prefs.workplaces },
      resumeRoles: resumeRoles(profile),
      counts,
      matching,
      matchedAt: prefs.matched_at?.toISOString() ?? null,
      openListings: stats.open,
      companies: stats.companies,
      lastSyncAt: stats.last_sync?.toISOString() ?? null,
    };
  });

  app.put('/v1/job-feed/preferences', async (req, reply): Promise<JobPreferences | void> => {
    const parsed = preferencesBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'bad_request', message: 'Invalid preferences.' });
    const { roles, locations, workplaces } = parsed.data;
    await ensureUser(req);
    await sql`
      insert into public.job_preferences (user_id, roles, locations, workplaces)
      values (${req.user.id}, ${roles}, ${locations}, ${workplaces})
      on conflict (user_id) do update set
        roles = excluded.roles, locations = excluded.locations, workplaces = excluded.workplaces, updated_at = now()`;
    await refreshMatches(req.user.id, req.log);
    return { roles, locations, workplaces };
  });

  app.get('/v1/job-feed', async (req, reply): Promise<FeedPage | void> => {
    const parsed = feedQuery.safeParse(req.query);
    if (!parsed.success) return reply.code(400).send({ error: 'bad_request', message: 'Invalid search.' });
    const { view, q, page } = parsed.data;
    const userId = req.user.id;
    const pageSize = LISTING_LIMITS.pageSize;
    const offset = (page - 1) * pageSize;

    let rows: (ItemRow & { total: number })[];
    if (view === 'saved' || view === 'applied') {
      // Applications outlive their listing; a deleted listing shows from the copied details, as closed.
      rows = await sql`
        select coalesce(l.id, a.id) as id, coalesce(l.title, a.title) as title, coalesce(l.company, a.company) as company,
               l.department, coalesce(l.location, a.location) as location, l.workplace, l.employment_type, l.salary,
               l.posted_at, case when s.provider = any(${[...AGGREGATORS]}::text[]) then null else s.website end as website,
               l.company_logo, l.posted_on, l.agency, s.provider, s.startup, s.yc_batch, (l.id is null or l.closed_at is not null) as closed,
               m.score, m.title_score, m.skill_score, m.level_score, m.matched_skills, a.status,
               count(*) over ()::int as total
        from public.job_applications a
        left join public.job_listings l on l.id = a.listing_id
        left join public.job_sources s on s.id = l.source_id
        left join public.job_matches m on m.user_id = a.user_id and m.listing_id = a.listing_id
        where a.user_id = ${userId}
          and ${view === 'saved' ? sql`a.status = 'saved'` : sql`a.status <> 'saved'`}
          ${q ? sql`and (coalesce(l.title, a.title) || ' ' || coalesce(l.company, a.company)) ilike ${likeContains(q)}` : sql``}
        order by a.updated_at desc
        limit ${pageSize} offset ${offset}`;
    } else {
      // Defaults: Top by match, Recommended newest first, All by relevance to the search, then newest.
      // Recommendations put employers hiring directly ahead of recruitment agencies.
      const sort = parsed.data.sort ?? (view === 'top' ? 'match' : 'newest');
      const relevance = q && view === 'all' && !parsed.data.sort ? sql`ts_rank(l.search, websearch_to_tsquery('english', ${q})) desc,` : sql``;
      const directFirst = view === 'all' ? sql`` : sql`l.agency,`;
      const order =
        sort === 'match'
          ? sql`${directFirst} m.score desc nulls last, l.posted_at desc nulls last`
          : sql`${directFirst} ${relevance} l.posted_at desc nulls last, m.score desc nulls last`;
      rows = await sql`
        select ${ITEM_COLUMNS}, count(*) over ()::int as total
        ${viewSql(view, userId)} ${filterSql(parsed.data)}
        order by ${order}, l.id
        limit ${pageSize} offset ${offset}`;
    }
    return { items: rows.map(toItem), total: rows[0]?.total ?? 0, page, pageSize };
  });

  app.get('/v1/job-feed/facets', async (req, reply): Promise<FeedFacets | void> => {
    const parsed = filterQuery.safeParse(req.query);
    if (!parsed.success) return reply.code(400).send({ error: 'bad_request', message: 'Invalid search.' });
    const f = parsed.data;
    if (f.view === 'saved' || f.view === 'applied') return reply.code(400).send({ error: 'bad_request', message: 'No filters here.' });
    const from = viewSql(f.view, req.user.id);
    const [workplace, level, [type], company, [salary], [companyType], [platform]] = await Promise.all([
      sql<{ key: string; count: number }[]>`
        select l.workplace as key, count(*)::int as count ${from} ${filterSql(f, 'workplace')}
          and l.workplace is not null group by 1`,
      sql<{ key: number; count: number }[]>`
        select l.level as key, count(*)::int as count ${from} ${filterSql(f, 'level')} group by 1`,
      sql<Record<JobType, number>[]>`
        select count(*) filter (where ${JOB_TYPE_SQL.fulltime})::int as fulltime,
               count(*) filter (where ${JOB_TYPE_SQL.parttime})::int as parttime,
               count(*) filter (where ${JOB_TYPE_SQL.internship})::int as internship,
               count(*) filter (where ${JOB_TYPE_SQL.contract})::int as contract
        ${from} ${filterSql(f, 'type')}`,
      sql<{ company: string; website: string | null; count: number }[]>`
        select l.company, max(case when s.provider = any(${[...AGGREGATORS]}::text[]) then null else s.website end) as website,
               count(*)::int as count ${from} ${filterSql(f, 'company')}
        group by l.company order by count desc, l.company limit 60`,
      sql<{ count: number }[]>`select count(*)::int as count ${from} ${filterSql(f, 'salary')} and l.salary is not null`,
      sql<Record<CompanyType, number>[]>`
        select ${countsBy(COMPANY_TYPE_SQL)} ${from} ${filterSql(f, 'companyType')}`,
      sql<Record<Platform, number>[]>`
        select ${countsBy(PLATFORM_SQL)} ${from} ${filterSql(f, 'platform')}`,
    ]);
    return {
      workplace: Object.fromEntries(workplace.map((r) => [r.key, r.count])),
      level: Object.fromEntries(level.map((r) => [String(r.key), r.count])),
      type,
      company,
      withSalary: salary.count,
      companyType,
      platform,
    };
  });

  // Careerjet's results for a search, beyond the jobs Friday Jobs holds. Jobs already here (the same
  // company, title and city) are left out, so nothing shows twice.
  app.get('/v1/job-feed/web', async (req, reply): Promise<WebJobPage | void> => {
    const parsed = webQuery.safeParse(req.query);
    if (!parsed.success) return reply.code(400).send({ error: 'bad_request', message: 'Invalid search.' });
    const { q, location, page } = parsed.data;
    if (!careerjetEnabled()) return { items: [], total: 0, page, available: false };

    let result;
    try {
      result = await searchCareerjet({
        keywords: q,
        location,
        page,
        pageSize: LISTING_LIMITS.pageSize,
        userIp: req.ip,
        userAgent: req.headers['user-agent'] ?? '',
      });
    } catch (err) {
      req.log.warn({ err }, 'careerjet search failed');
      return reply.code(502).send({ error: 'upstream', message: 'Couldn’t reach Careerjet.' });
    }

    const jobs = result.jobs
      .filter((j) => j.title && j.url)
      .map((j) => ({ job: j, key: dedupeKey({ company: j.company ?? '', title: j.title, location: j.locations ?? '' }) }));
    const keys = jobs.map((j) => j.key).filter((k): k is string => k !== null);
    const held = new Set(
      keys.length
        ? (await sql<{ dedupe_key: string }[]>`
            select distinct dedupe_key from public.job_listings
            where closed_at is null and dedupe_key = any(${keys}::text[])`).map((r) => r.dedupe_key)
        : [],
    );
    const seen = new Set<string>();
    const items = jobs
      .filter(({ key }) => !key || (!held.has(key) && !seen.has(key) && seen.add(key)))
      .map(({ job: j }): WebJob => {
        const posted = j.date ? new Date(j.date) : null;
        return {
          title: j.title.trim(),
          company: j.company?.trim() || 'Company not disclosed',
          location: j.locations?.trim() ?? '',
          salary: j.salary?.trim() || null,
          postedAt: posted && !Number.isNaN(posted.getTime()) ? posted.toISOString() : null,
          snippet: (j.description ?? '')
            .replace(/<[^>]*>/g, '')
            .replace(/&(amp|quot|#39|apos|lt|gt|nbsp);/g, (_, e: string) => ENTITIES[e])
            .replace(/\s+/g, ' ')
            .trim(),
          url: j.url,
          agency: isAgency(j.company ?? '', j.description ?? '', true),
        };
      });
    return { items, total: result.hits, page, available: true };
  });

  app.get<{ Params: { id: string } }>('/v1/job-feed/:id', async (req, reply): Promise<FeedDetail | void> => {
    if (!z.uuid().safeParse(req.params.id).success) return reply.notFound('No such job.');
    const [r] = await sql<(ItemRow & { description_html: string; apply_url: string; provider: ListingProvider })[]>`
      select ${ITEM_COLUMNS}, l.description_html, l.apply_url
      from public.job_listings l
      join public.job_sources s on s.id = l.source_id
      left join public.job_matches m on m.user_id = ${req.user.id} and m.listing_id = l.id
      left join public.job_applications a on a.user_id = ${req.user.id} and a.listing_id = l.id
      where l.id = ${req.params.id}`;
    if (!r) return reply.notFound('This job is no longer available.');
    return {
      ...toItem(r),
      descriptionHtml: r.description_html,
      descriptionPartial: SEARCH_PROVIDERS.has(r.provider),
      applyUrl: r.apply_url,
      provider: r.provider,
    };
  });

  app.put<{ Params: { id: string } }>('/v1/job-feed/:id/status', async (req, reply) => {
    const parsed = statusBody.safeParse(req.body);
    if (!parsed.success || !z.uuid().safeParse(req.params.id).success) {
      return reply.code(400).send({ error: 'bad_request', message: 'Invalid status.' });
    }
    const { status } = parsed.data;
    const userId = req.user.id;
    if (status === null) {
      await sql`delete from public.job_applications where user_id = ${userId} and listing_id = ${req.params.id}`;
      return { status: null };
    }
    await ensureUser(req);
    const [row] = await sql<{ status: ApplicationStatus }[]>`
      insert into public.job_applications (user_id, listing_id, title, company, location, apply_url, status, applied_at)
      select ${userId}, l.id, l.title, l.company, l.location, l.apply_url, ${status},
             ${status === 'saved' ? null : sql`now()`}
      from public.job_listings l where l.id = ${req.params.id}
      on conflict (user_id, listing_id) do update set
        status = excluded.status, updated_at = now(),
        applied_at = coalesce(job_applications.applied_at, excluded.applied_at)
      returning status`;
    if (!row) return reply.notFound('This job is no longer available.');
    return { status: row.status };
  });

  // The candidate's resume tailored to this job, if they've asked for one.
  app.get<{ Params: { id: string } }>('/v1/job-feed/:id/resume', async (req, reply): Promise<{ tailored: TailoredResumeRecord | null } | void> => {
    if (!z.uuid().safeParse(req.params.id).success) return reply.notFound('No such job.');
    const [row] = await sql<TailoredRow[]>`
      select ${TAILORED_COLUMNS} from public.tailored_resumes
      where user_id = ${req.user.id} and listing_id = ${req.params.id}`;
    return { tailored: row ? toTailored(row) : null };
  });

  // The tailored resume file (PDF or DOCX, as the candidate uploaded it).
  app.get<{ Params: { id: string } }>('/v1/job-feed/:id/resume/file', async (req, reply) => {
    if (!z.uuid().safeParse(req.params.id).success) return reply.notFound('No such job.');
    const [row] = await sql<{ file: Buffer | null; file_name: string | null; format: 'pdf' | 'docx' | null }[]>`
      select file, file_name, content->>'format' as format from public.tailored_resumes
      where user_id = ${req.user.id} and listing_id = ${req.params.id} and status = 'ready'`;
    if (!row?.file) return reply.notFound('No tailored resume for this job yet.');
    const type = row.format === 'docx' ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : 'application/pdf';
    const name = row.file_name ?? `Resume.${row.format ?? 'pdf'}`;
    return reply
      .type(type)
      .header('cache-control', 'private, no-store')
      .header('content-disposition', `attachment; filename="${name.replace(/[^\w\- .]/g, '')}"; filename*=UTF-8''${encodeURIComponent(name)}`)
      .send(row.file);
  });

  app.get<{ Params: { id: string } }>('/v1/job-feed/:id/cover-letter', async (req, reply) => {
    if (!z.uuid().safeParse(req.params.id).success) return reply.notFound('No such job.');
    const [row] = await sql<{ file: Buffer | null; file_name: string | null }[]>`
      select cover_letter_file as file, file_name from public.tailored_resumes
      where user_id = ${req.user.id} and listing_id = ${req.params.id} and status = 'ready'`;
    if (!row?.file) return reply.notFound('No cover letter for this job yet.');
    const name = (row.file_name ?? 'Resume.pdf').replace(/Resume/, 'Cover Letter').replace(/\.docx$/i, '.pdf');
    return reply
      .type('application/pdf')
      .header('cache-control', 'private, no-store')
      .header('content-disposition', `attachment; filename="${name.replace(/[^\w\- .]/g, '')}"; filename*=UTF-8''${encodeURIComponent(name)}`)
      .send(row.file);
  });

  // Tailors the candidate's latest resume to this job (apps/worker/src/queues/tailor.ts), replacing
  // any earlier version for the same job. The client polls the GET above until it's ready.
  app.post<{ Params: { id: string } }>('/v1/job-feed/:id/resume', async (req, reply): Promise<{ tailored: TailoredResumeRecord } | void> => {
    if (!z.uuid().safeParse(req.params.id).success) return reply.notFound('No such job.');
    const userId = req.user.id;
    const [resume] = await sql<{ id: string; status: 'parsing' | 'ready' | 'failed'; has_file: boolean }[]>`
      select id, status, file is not null as has_file from public.resumes where user_id = ${userId} order by created_at desc limit 1`;
    if (!resume) return reply.code(409).send({ error: 'no_resume', message: 'Upload your resume first.' });
    // Tailoring edits the candidate's own file, so it keeps their design. Older uploads kept only the text.
    if (!resume.has_file) {
      return reply.code(409).send({
        error: 'no_resume_file',
        message: 'Upload your resume again as a PDF or Word file, so Friday can tailor it and keep its design.',
      });
    }
    if (resume.status === 'parsing') {
      return reply.code(409).send({ error: 'resume_parsing', message: 'Your resume is still being analysed. Try again in a moment.' });
    }
    const [listing] = await sql<{ title: string; company: string; closed: boolean }[]>`
      select title, company, closed_at is not null as closed from public.job_listings where id = ${req.params.id}`;
    if (!listing || listing.closed) return reply.notFound('This job is no longer available.');

    const [prev] = await sql<{ status: TailorStatus; age_s: number }[]>`
      select status, extract(epoch from now() - updated_at)::int as age_s from public.tailored_resumes
      where user_id = ${userId} and listing_id = ${req.params.id}`;
    if (prev?.status === 'tailoring' && prev.age_s < 300) {
      return reply.code(409).send({ error: 'conflict', message: 'Already tailoring your resume for this job.' });
    }
    if (prev && prev.age_s < TAILOR_LIMITS.retrySeconds) {
      return reply.code(429).send({ error: 'too_soon', message: 'Please wait a few seconds before tailoring again.' });
    }
    if (!prev) {
      const [{ count }] = await sql<{ count: number }[]>`
        select count(*)::int as count from public.tailored_resumes
        where user_id = ${userId} and created_at > now() - interval '1 day'`;
      if (count >= TAILOR_LIMITS.perDay) {
        return reply.code(429).send({ error: 'rate_limited', message: `You can tailor your resume for ${TAILOR_LIMITS.perDay} jobs a day. Try again tomorrow.` });
      }
    }

    await ensureUser(req);
    const [row] = await sql<TailoredRow[]>`
      insert into public.tailored_resumes (user_id, listing_id, resume_id, title, company)
      values (${userId}, ${req.params.id}, ${resume.id}, ${listing.title}, ${listing.company})
      on conflict (user_id, listing_id) do update set
        resume_id = excluded.resume_id, title = excluded.title, company = excluded.company,
        status = 'tailoring', error = null, updated_at = now()
      returning ${TAILORED_COLUMNS}`;
    try {
      await tailorQueue.add('resume.tailor', { tailoredId: row.id }, { jobId: `tailor-${row.id}-${Date.now()}` });
    } catch (err) {
      req.log.error({ err }, 'failed to enqueue resume tailoring');
      const [failed] = await sql<TailoredRow[]>`
        update public.tailored_resumes set status = 'failed', error = 'Resume tailoring is unavailable right now.', updated_at = now()
        where id = ${row.id} returning ${TAILORED_COLUMNS}`;
      return { tailored: toTailored(failed) };
    }
    return { tailored: toTailored(row) };
  });
}
