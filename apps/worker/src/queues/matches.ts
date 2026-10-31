import { Queue, UnrecoverableError, Worker, type Job } from 'bullmq';
import { resumeRoles, type ResumeProfile, type Workplace } from '@parakeet/shared';
import { sql } from '../db.js';
import { env } from '../env.js';
import { createMatcher, type MatchProfile } from '../listings/match.js';

// Friday Jobs matches. "matches.refresh" { userId } scores open listings against the user's latest
// resume and job preferences and keeps their best matches; "matches.refresh-all" (scheduled shortly
// after each listings sync) does that for everyone who uses the jobs site. The API also queues a
// refresh when the user changes their preferences or resume.

export const MATCHES_QUEUE = 'matches';

/** Listings pulled per user by full-text search before scoring. */
const CANDIDATES = 1500;
/** Matches kept per user, and the lowest score worth keeping. */
const KEEP = 600;
const MIN_SCORE = 30;
/** Points off for recruitment agencies' postings, so employers hiring directly come first. */
const AGENCY_PENALTY = 10;

const connection = { url: env.REDIS_URL };
const queue = new Queue<{ userId?: string }>(MATCHES_QUEUE, { connection });

interface PreferencesRow {
  roles: string[];
  locations: string[];
  workplaces: Workplace[];
}

async function refreshAll() {
  const users = await sql<{ user_id: string }[]>`select user_id from public.job_preferences`;
  await queue.addBulk(
    users.map((u) => ({
      name: 'matches.refresh',
      data: { userId: u.user_id },
      opts: { jobId: `refresh-${u.user_id}`, removeOnComplete: true, removeOnFail: { age: 24 * 3600 } },
    })),
  );
  return { queued: users.length };
}

async function refresh(job: Job<{ userId?: string }>) {
  const userId = job.data.userId!;
  const [prefs] = await sql<PreferencesRow[]>`
    select roles, locations, workplaces from public.job_preferences where user_id = ${userId}`;
  if (!prefs) return { skipped: 'no preferences' };
  const [resume] = await sql<{ parsed_json: ResumeProfile | null }[]>`
    select parsed_json from public.resumes where user_id = ${userId} order by created_at desc limit 1`;
  const parsed = resume?.parsed_json ?? null;

  // Role-specific resumes widen the search to their target roles and skills.
  const extra = await sql<{ target_roles: string[]; parsed_json: ResumeProfile | null }[]>`
    select target_roles, parsed_json from public.job_resumes where user_id = ${userId} and status = 'ready'`;
  const profile: MatchProfile = {
    roles: [...new Set([...(prefs.roles.length ? prefs.roles : resumeRoles(parsed)), ...extra.flatMap((r) => r.target_roles)])],
    skills: [...new Set([...(parsed?.skills ?? []), ...extra.flatMap((r) => r.parsed_json?.skills ?? [])].map((s) => s.name))],
    years: parsed?.totalYearsExperience ?? null,
  };

  // Nothing to match on yet: no resume analysis and no chosen roles.
  if (!profile.roles.length && !profile.skills.length) {
    await sql.begin(async (tx) => {
      await tx`delete from public.job_matches where user_id = ${userId}`;
      await tx`update public.job_preferences set matched_at = now() where user_id = ${userId}`;
    });
    return { matches: 0, reason: 'no resume profile or roles' };
  }

  const locations = prefs.locations.map((l) => `%${l.replace(/[\\%_]/g, '\\$&')}%`);
  const candidates = await sql<{ id: string; title: string; description: string; level: number; agency: boolean }[]>`
    with q as (
      select
        (select string_agg('(' || t::text || ')', ' | ')
           from (select plainto_tsquery('english', r) t from unnest(${profile.roles}::text[]) r) x
          where t::text <> '')::tsquery as roles,
        (select string_agg('(' || t::text || ')', ' | ')
           from (select phraseto_tsquery('english', s) t from unnest(${profile.skills.slice(0, 30)}::text[]) s) x
          where t::text <> '')::tsquery as skills
    )
    select l.id, l.title, l.level, l.agency, left(l.description_text, 20000) as description
    from public.job_listings l, q
    where l.closed_at is null and l.duplicate_of is null
      and (l.search @@ q.roles or l.search @@ q.skills)
      ${locations.length
        ? sql`and (l.location ilike any(${locations}::text[]) or l.location ~* '^\\s*(remote|anywhere|worldwide|global)\\s*$')`
        : sql``}
      ${prefs.workplaces.length ? sql`and coalesce(l.workplace, 'onsite') = any(${prefs.workplaces}::text[])` : sql``}
    order by coalesce(ts_rank(l.search, q.roles), 0) * 4 + coalesce(ts_rank(l.search, q.skills), 0) desc
    limit ${CANDIDATES}`;

  const match = createMatcher(profile);
  const rows = candidates
    .map((c) => {
      const m = match(c);
      return { listing_id: c.id, ...m, score: c.agency ? Math.max(0, m.score - AGENCY_PENALTY) : m.score };
    })
    .filter((m) => m.score >= MIN_SCORE)
    .sort((a, b) => b.score - a.score)
    .slice(0, KEEP)
    .map((m) => ({
      user_id: userId,
      listing_id: m.listing_id,
      score: m.score,
      title_score: m.titleScore,
      skill_score: m.skillScore,
      level_score: m.levelScore,
      matched_skills: m.matchedSkills,
    }));

  await sql.begin(async (tx) => {
    await tx`delete from public.job_matches where user_id = ${userId}`;
    if (rows.length) await tx`insert into public.job_matches ${tx(rows)}`;
    await tx`update public.job_preferences set matched_at = now() where user_id = ${userId}`;
  });
  return { candidates: candidates.length, matches: rows.length, top: rows[0]?.score ?? null };
}

export function startMatchesWorker() {
  const worker = new Worker<{ userId?: string }>(
    MATCHES_QUEUE,
    async (job) => {
      if (job.name === 'matches.refresh-all') return refreshAll();
      if (job.name === 'matches.refresh') return refresh(job);
      throw new UnrecoverableError(`No processor for job "${job.name}"`);
    },
    { connection, concurrency: 4 },
  );
  worker.on('completed', (job, result) => console.log(`[matches] ${job.name} #${job.id} done`, JSON.stringify(result)));
  worker.on('failed', (job, err) => console.error(`[matches] ${job?.name} #${job?.id} failed:`, err.message));

  // Ten minutes after each listings sync (see queues/listings.ts), when the boards have been fetched.
  queue
    .upsertJobScheduler('matches-refresh', { pattern: '10,40 * * * *' }, { name: 'matches.refresh-all', data: {} })
    .catch((err) => console.error('[matches] could not schedule the refresh:', err.message));
  return worker;
}

export const closeMatchesQueue = () => queue.close();
