import { Queue, UnrecoverableError, Worker, type Job } from 'bullmq';
import {
  EMPTY_APPLICATION_PROFILE, REQUIREMENTS_VERSION, resolveMatchConfig, resumeRoles,
  type ApplicationProfile, type JobRequirements, type MatchCandidateProfile, type ResumeProfile, type Workplace,
} from '@parakeet/shared';
import { sql } from '../db.js';
import { env } from '../env.js';
import { matchListing, requirementsOf, type ListingForMatch } from '../listings/match.js';

// Friday Jobs matches. "matches.refresh" { userId } scores open listings against the user's latest
// resume, Application Profile and job preferences and keeps their best matches, each with an
// explanation and whether it passes the job's mandatory requirements (job_matches.eligible: only
// eligible matches are auto-applied to). "matches.refresh-all" (scheduled shortly after each listings
// sync) does that for everyone who uses the jobs site. The API also queues a refresh when the user
// changes their preferences or resume.

export const MATCHES_QUEUE = 'matches';

/** Listings pulled per user by full-text search before scoring. */
const CANDIDATES = 1500;
/** Matches kept per user. */
const KEEP = 600;

const connection = { url: env.REDIS_URL };
const queue = new Queue<{ userId?: string }>(MATCHES_QUEUE, { connection });

interface PreferencesRow {
  roles: string[];
  locations: string[];
  workplaces: Workplace[];
  match_config: unknown;
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

/**
 * Requirements for these listings: cached ones of the current extractor version, the rest extracted
 * now and cached. Extraction is deterministic, so a listing is parsed once, not once per user.
 */
export async function requirementsFor(listings: ListingForMatch[]): Promise<Map<string, JobRequirements>> {
  const out = new Map<string, JobRequirements>();
  if (!listings.length) return out;
  const cached = await sql<{ listing_id: string; data: JobRequirements }[]>`
    select listing_id, data from public.job_requirements
    where listing_id = any(${listings.map((l) => l.id)}::uuid[]) and version = ${REQUIREMENTS_VERSION}`;
  for (const r of cached) out.set(r.listing_id, r.data);
  const fresh = listings.filter((l) => !out.has(l.id)).map((l) => ({ listing_id: l.id, version: REQUIREMENTS_VERSION, data: requirementsOf(l) }));
  for (const f of fresh) out.set(f.listing_id, f.data);
  for (let i = 0; i < fresh.length; i += 500) {
    const chunk = fresh.slice(i, i + 500).map((f) => ({ ...f, data: sql.json(f.data as never) }));
    await sql`
      insert into public.job_requirements ${sql(chunk)}
      on conflict (listing_id) do update set version = excluded.version, data = excluded.data, extracted_at = now()`;
  }
  return out;
}

export async function refresh(job: Pick<Job<{ userId?: string }>, 'data'>) {
  const userId = job.data.userId!;
  const [prefs] = await sql<PreferencesRow[]>`
    select roles, locations, workplaces, match_config from public.job_preferences where user_id = ${userId}`;
  if (!prefs) return { skipped: 'no preferences' };
  const config = resolveMatchConfig(prefs.match_config);
  const [resume] = await sql<{ parsed_json: ResumeProfile | null }[]>`
    select parsed_json from public.resumes where user_id = ${userId} order by created_at desc limit 1`;
  const parsed = resume?.parsed_json ?? null;
  const [profileRow] = await sql<{ data: Partial<ApplicationProfile> }[]>`
    select data from public.application_profiles where user_id = ${userId}`;
  const profile: ApplicationProfile = { ...EMPTY_APPLICATION_PROFILE, ...profileRow?.data };

  // Role-specific resumes widen the search to their target roles and skills (still the candidate's own).
  const extra = await sql<{ target_roles: string[]; parsed_json: ResumeProfile | null }[]>`
    select target_roles, parsed_json from public.job_resumes where user_id = ${userId} and status = 'ready'`;
  const candidate: MatchCandidateProfile = {
    roles: [...new Set([...(prefs.roles.length ? prefs.roles : resumeRoles(parsed)), ...extra.flatMap((r) => r.target_roles)])],
    skills: [...new Set([...(parsed?.skills ?? []), ...extra.flatMap((r) => r.parsed_json?.skills ?? [])].map((s) => s.name))],
    years: parsed?.totalYearsExperience ?? null,
    locations: prefs.locations,
    workplaces: prefs.workplaces,
    workAuthorization: profile.workAuthorization,
    otherCountries: profile.otherCountries,
    country: profile.country,
    degrees: (parsed?.education ?? []).map((e) => e.degree ?? '').filter(Boolean),
  };

  // Nothing to match on yet: no resume analysis and no chosen roles.
  if (!candidate.roles.length && !candidate.skills.length) {
    await sql.begin(async (tx) => {
      await tx`delete from public.job_matches where user_id = ${userId}`;
      await tx`update public.job_preferences set matched_at = now() where user_id = ${userId}`;
    });
    return { matches: 0, reason: 'no resume profile or roles' };
  }

  const locations = prefs.locations.map((l) => `%${l.replace(/[\\%_]/g, '\\$&')}%`);
  const candidates = await sql<ListingForMatch[]>`
    with q as (
      select
        (select string_agg('(' || t::text || ')', ' | ')
           from (select plainto_tsquery('english', r) t from unnest(${candidate.roles}::text[]) r) x
          where t::text <> '')::tsquery as roles,
        (select string_agg('(' || t::text || ')', ' | ')
           from (select phraseto_tsquery('english', s) t from unnest(${candidate.skills.slice(0, 30)}::text[]) s) x
          where t::text <> '')::tsquery as skills
    )
    select l.id, l.title, l.level, l.agency, l.location, l.workplace, l.salary, l.employment_type, l.posted_at, l.eligibility,
           left(l.description_text, 20000) as description
    from public.job_listings l, q
    where l.closed_at is null and l.duplicate_of is null
      and (l.search @@ q.roles or l.search @@ q.skills)
      ${locations.length
        ? sql`and (l.location ilike any(${locations}::text[]) or l.location ~* '^\\s*(remote|anywhere|worldwide|global)\\s*$')`
        : sql``}
      ${prefs.workplaces.length ? sql`and coalesce(l.workplace, 'onsite') = any(${prefs.workplaces}::text[])` : sql``}
    order by coalesce(ts_rank(l.search, q.roles), 0) * 4 + coalesce(ts_rank(l.search, q.skills), 0) desc
    limit ${CANDIDATES}`;

  const reqs = await requirementsFor(candidates);
  const now = new Date();
  const scored = candidates
    .map((c) => ({ c, m: matchListing(candidate, c, reqs.get(c.id)!, config, now) }))
    .filter(({ m }) => m.score >= config.minScore)
    // Eligible first, then score, then the newest posting: what's kept is what can be applied to.
    .sort((a, b) => Number(b.m.eligible) - Number(a.m.eligible) || b.m.score - a.m.score
      || (b.c.posted_at?.getTime() ?? 0) - (a.c.posted_at?.getTime() ?? 0))
    .slice(0, KEEP);
  const rows = scored.map(({ c, m }) => ({
    user_id: userId,
    listing_id: c.id,
    score: m.score,
    title_score: m.components.title,
    skill_score: m.components.skills,
    level_score: m.components.experience,
    matched_skills: [...new Set([...m.mandatoryMatched, ...m.preferredMatched])],
    eligible: m.eligible,
    explanation: sql.json(m as never),
  }));

  await sql.begin(async (tx) => {
    await tx`delete from public.job_matches where user_id = ${userId}`;
    for (let i = 0; i < rows.length; i += 300) await tx`insert into public.job_matches ${tx(rows.slice(i, i + 300))}`;
    await tx`update public.job_preferences set matched_at = now() where user_id = ${userId}`;
  });
  const eligible = scored.filter((s) => s.m.eligible);
  const rejections = new Map<string, number>();
  for (const s of scored) for (const r of s.m.rejections) {
    const k = r.replace(/\d+(\.\d+)?/g, 'N').replace(/in [A-Z][\w ]+\.$/, 'in <country>.');
    rejections.set(k, (rejections.get(k) ?? 0) + 1);
  }
  return {
    candidates: candidates.length,
    matches: rows.length,
    eligible: eligible.length,
    strong: eligible.filter((s) => s.m.score >= config.strongMatch).length,
    ineligible: rows.length - eligible.length,
    topRejections: [...rejections].sort((a, b) => b[1] - a[1]).slice(0, 5),
    top: rows[0]?.score ?? null,
  };
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
