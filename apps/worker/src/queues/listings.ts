import { Queue, UnrecoverableError, Worker, type Job } from 'bullmq';
import {
  AGGREGATORS, INDIA_ELIGIBLE, SEARCH_PROVIDERS, canonicalUrl, dedupeKey, eligibility, isAgency, resumeRoles, techCategory,
  type ListingProvider, type ResumeProfile,
} from '@parakeet/shared';
import { sql } from '../db.js';
import { env } from '../env.js';
import { BoardNotFoundError, fetchBoard, jobicyClosed, type Posting } from '../listings/boards.js';
import { metered, requestsSoFar } from '../listings/http.js';
import { configuredSearchProviders, fetchSearch, type SearchQuery } from '../listings/search.js';

// Friday Jobs listings. "listings.sync-all" (scheduled) queues a "listings.sync" { sourceId } for every
// enabled job board; each sync upserts the board's postings and closes the ones no longer on it. Job
// search engines (SEARCH_PROVIDERS) are searched for the roles users want instead, and their jobs close
// once no search has returned them for a while. After every sync, jobs carried by several sources are
// marked so only the best copy is shown (job_listings.duplicate_of): by company, title and city
// (dedupe_key), and by apply link (canonical_url) for aggregator copies of a company's own posting.
// Every sync is logged in job_source_runs (requests made, jobs inserted, how many of those are unique,
// tech, and open to candidates in India), which the admin Jobs analytics read.

export const LISTINGS_QUEUE = 'listings';

/** Closed listings stay viewable (marked closed) for links people saved, then are deleted. */
const KEEP_CLOSED_DAYS = 30;
const UPSERT_CHUNK = 500;
/** A search engine's job no search has returned for this long is taken as closed. */
const SEARCH_STALE_DAYS = 14;

/**
 * Searches run when nobody has chosen roles yet, and alongside theirs: common roles in India, early
 * career ones included.
 */
const DEFAULT_QUERIES = [
  'software engineer', 'frontend developer', 'backend developer', 'full stack developer', 'java developer',
  'python developer', 'android developer', 'data analyst', 'data scientist', 'machine learning engineer',
  'devops engineer', 'qa engineer', 'product manager', 'ui ux designer', 'business analyst', 'digital marketing',
  'sales executive', 'customer support', 'hr executive', 'accountant', 'content writer', 'graphic designer',
  'mechanical engineer', 'civil engineer', 'operations executive', 'fresher', 'internship',
];

const connection = { url: env.REDIS_URL };
const queue = new Queue<{ sourceId?: string }>(LISTINGS_QUEUE, { connection });

interface SourceRow {
  id: string;
  provider: ListingProvider;
  board: string;
  company: string;
  enabled: boolean;
}

const SYNC_OPTS = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 60_000 },
  removeOnComplete: { age: 24 * 3600 },
  removeOnFail: { age: 7 * 24 * 3600 },
};

async function syncAll() {
  // Sources due by their own interval (the two minutes absorb scheduling jitter); search engines only
  // once their key is set.
  const skipped = [...SEARCH_PROVIDERS].filter((p) => !configuredSearchProviders().has(p));
  const sources = await sql<{ id: string }[]>`
    select id from public.job_sources
    where enabled and (last_synced_at is null or last_synced_at < now() - sync_every + interval '2 minutes')
      and provider <> all(${skipped}::text[])`;
  await queue.addBulk(sources.map((s) => ({ name: 'listings.sync', data: { sourceId: s.id }, opts: SYNC_OPTS })));
  await sql`delete from public.job_source_runs where started_at < now() - interval '120 days'`;
  return { queued: sources.length };
}

/** Syncs one source now, e.g. a board discovery just found, instead of waiting for the next round. */
export async function queueSourceSync(sourceId: string) {
  await queue.add('listings.sync', { sourceId }, SYNC_OPTS);
}

/** Places that mean "anywhere in the country" rather than a city to search in. */
const NOT_A_CITY = /^(india|remote|anywhere|work from home|wfh|any)$/i;

/**
 * What to search a search engine for this round, within its call budget: what users want first, the
 * most wanted first: each role (chosen, or read from their resume) in the city those users most want
 * (e.g. "backend engineer" in Bengaluru), then the role across the country. The default roles fill
 * whatever budget is left, a different slice each round.
 */
export async function searchQueries(budget: number): Promise<SearchQuery[]> {
  const prefs = await sql<{ roles: string[]; locations: string[]; parsed_json: ResumeProfile | null }[]>`
    select p.roles, p.locations, r.parsed_json
    from public.job_preferences p
    left join lateral (
      select parsed_json from public.resumes where user_id = p.user_id order by created_at desc limit 1
    ) r on true
    order by p.updated_at desc limit 2000`;
  const wanted = new Map<string, { users: number; cities: Map<string, number> }>();
  for (const p of prefs) {
    for (const role of p.roles.length ? p.roles : resumeRoles(p.parsed_json)) {
      const key = role.toLowerCase().replace(/\s+/g, ' ').trim();
      if (!key) continue;
      const w = wanted.get(key) ?? { users: 0, cities: new Map() };
      w.users++;
      for (const city of p.locations.map((l) => l.trim()).filter((l) => l && !NOT_A_CITY.test(l))) {
        w.cities.set(city, (w.cities.get(city) ?? 0) + 1);
      }
      wanted.set(key, w);
    }
  }
  const out: SearchQuery[] = [];
  const roles = [...wanted].sort((a, b) => b[1].users - a[1].users);
  // First every wanted role in its city, then every wanted role country-wide.
  for (const [what, w] of roles) {
    const city = [...w.cities].sort((a, b) => b[1] - a[1])[0]?.[0];
    if (city) out.push({ what, where: city });
  }
  for (const [what] of roles) out.push({ what, where: null });
  const rest = DEFAULT_QUERIES.filter((q) => !wanted.has(q));
  // A different slice of the defaults each round (rounds are the six-hour sync interval).
  const round = Math.floor(Date.now() / (6 * 3600_000));
  const take = Math.max(0, Math.min(budget - out.length, rest.length));
  const start = rest.length ? (round * take) % rest.length : 0;
  out.push(...Array.from({ length: take }, (_, i) => ({ what: rest[(start + i) % rest.length], where: null })));
  return out.slice(0, budget);
}

const SEARCH_BUDGET: Partial<Record<ListingProvider, number>> = {
  adzuna: env.ADZUNA_CALLS_PER_SYNC,
  jooble: env.JOOBLE_CALLS_PER_SYNC,
  jsearch: env.JSEARCH_CALLS_PER_SYNC,
};

/** A board's open jobs as stored, by apply link, so a sync needn't read each one's page again. */
async function storedPostings(sourceId: string): Promise<Map<string, Posting>> {
  const rows = await sql<{
    external_id: string; title: string; department: string | null; location: string; workplace: Posting['workplace'];
    employment_type: string | null; salary: string | null; description_html: string; description_text: string;
    apply_url: string; posted_at: Date | null;
  }[]>`
    select external_id, title, department, location, workplace, employment_type, salary, description_html,
      description_text, apply_url, posted_at
    from public.job_listings where source_id = ${sourceId} and closed_at is null`;
  return new Map(
    rows.map((r) => [
      r.apply_url,
      {
        externalId: r.external_id, title: r.title, department: r.department, location: r.location, workplace: r.workplace,
        employmentType: r.employment_type, salary: r.salary, descriptionHtml: r.description_html,
        descriptionText: r.description_text, applyUrl: r.apply_url, postedAt: r.posted_at,
      },
    ]),
  );
}

/** Sources whose jobs leave the feed while still open: closed only when the source says so. */
const CLOSE_BY_STATUS = new Set<ListingProvider>(['jobicy']);

async function syncSource(job: Job<{ sourceId?: string }>) {
  const [source] = await sql<SourceRow[]>`
    select id, provider, board, company, enabled from public.job_sources where id = ${job.data.sourceId!}`;
  if (!source?.enabled) return { skipped: 'source removed or disabled' };

  const search = SEARCH_PROVIDERS.has(source.provider);
  if (search && !configuredSearchProviders().has(source.provider)) return { skipped: 'no API key (or not enabled)' };

  // A source with nothing stored yet is being backfilled: its jobs aren't new to the world, only to us.
  const [run] = await sql<{ id: number; initial: boolean }[]>`
    insert into public.job_source_runs (source_id, initial)
    values (${source.id}, not exists (select 1 from public.job_listings where source_id = ${source.id}))
    returning id, initial`;
  try {
    const { result, requests } = await metered(() => syncPostings(source, search));
    await sql`
      update public.job_source_runs set ${sql({ ...result.stats, http_requests: requests })}, ok = true, finished_at = now()
      where id = ${run.id}`;
    return { company: source.company, initial: run.initial, requests, ...result.summary };
  } catch (err) {
    const message = (err as Error).message;
    await sql`
      update public.job_source_runs set ok = false, error = ${message.slice(0, 500)}, finished_at = now(), http_requests = ${requestsSoFar()}
      where id = ${run.id}`;
    const isLastAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
    if (err instanceof BoardNotFoundError || isLastAttempt) {
      await sql`update public.job_sources set last_error = ${message} where id = ${source.id}`;
    }
    if (err instanceof BoardNotFoundError) throw new UnrecoverableError(message);
    throw err;
  }
}

async function syncPostings(source: SourceRow, search: boolean) {
  const postings: Posting[] = search
    ? await fetchSearch(source.provider, source.board, await searchQueries(SEARCH_BUDGET[source.provider] ?? 10))
    : await fetchBoard(source.provider, source.board, { known: source.provider === 'workday' ? await storedPostings(source.id) : undefined });

  const [{ started_at }] = await sql<{ started_at: Date }[]>`select now() as started_at`;
  // Remote-job boards repeat companies whose own boards are synced directly; keep the direct copy.
  const direct = AGGREGATORS.has(source.provider)
    ? new Set(
        (await sql<{ company: string }[]>`
          select lower(company) as company from public.job_sources where provider <> all(${[...AGGREGATORS]}::text[])`).map((r) => r.company),
      )
    : null;
  const aggregator = AGGREGATORS.has(source.provider);
  const seen = new Set<string>();
  const now = Date.now();
  const kept = postings
    .filter((p) => p.title && p.applyUrl && !seen.has(p.externalId) && seen.add(p.externalId))
    .filter((p) => !direct?.has((p.company ?? '').toLowerCase()))
    // Expired by the source's own date (Himalayas asks that expired jobs are removed).
    .filter((p) => !(p.expiresAt && p.expiresAt.getTime() < now));
  // An aggregator's copy of a posting on a company's own board (same apply link) takes that listing's
  // key, so it's marked a duplicate of it even when the title or city is written differently.
  const directKeys = new Map<string, string>();
  if (aggregator) {
    const urls = [...new Set(kept.map((p) => canonicalUrl(p.applyUrl)).filter((u): u is string => Boolean(u)))];
    for (let i = 0; i < urls.length; i += UPSERT_CHUNK) {
      const found = await sql<{ canonical_url: string; dedupe_key: string }[]>`
        select l.canonical_url, l.dedupe_key from public.job_listings l join public.job_sources s on s.id = l.source_id
        where s.rank = 0 and l.closed_at is null and l.dedupe_key is not null
          and l.canonical_url = any(${urls.slice(i, i + UPSERT_CHUNK)}::text[])`;
      for (const f of found) directKeys.set(f.canonical_url, f.dedupe_key);
    }
  }
  const rows = kept
    .map((p) => ({
      source_id: source.id,
      external_id: p.externalId,
      title: p.title,
      company: p.company || source.company,
      company_logo: p.companyLogo ?? null,
      posted_on: p.postedOn ?? null,
      agency: isAgency(p.company || source.company, p.descriptionText, aggregator),
      dedupe_key:
        directKeys.get(canonicalUrl(p.applyUrl) ?? '') ??
        dedupeKey({ company: p.company || source.company, title: p.title, location: p.location, workplace: p.workplace }),
      canonical_url: canonicalUrl(p.applyUrl),
      tech_category: techCategory(p.title),
      eligibility: eligibility(p.location, p.workplace),
      expires_at: p.expiresAt ?? null,
      department: p.department,
      location: p.location,
      workplace: p.workplace,
      employment_type: p.employmentType,
      salary: p.salary,
      description_html: p.descriptionHtml,
      description_text: p.descriptionText,
      apply_url: p.applyUrl,
      posted_at: p.postedAt,
    }));

  const inserted: string[] = [];
  for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
    const upserted = await sql<{ id: string; inserted: boolean }[]>`
      insert into public.job_listings ${sql(rows.slice(i, i + UPSERT_CHUNK))}
      on conflict (source_id, external_id) do update set
        title = excluded.title, company = excluded.company, company_logo = excluded.company_logo,
        posted_on = excluded.posted_on, agency = excluded.agency, dedupe_key = excluded.dedupe_key,
        department = excluded.department,
        location = excluded.location, workplace = excluded.workplace, employment_type = excluded.employment_type,
        salary = excluded.salary, description_html = excluded.description_html,
        description_text = excluded.description_text, apply_url = excluded.apply_url,
        posted_at = coalesce(excluded.posted_at, job_listings.posted_at),
        canonical_url = excluded.canonical_url, tech_category = excluded.tech_category,
        eligibility = excluded.eligibility, expires_at = excluded.expires_at,
        last_seen_at = now(), closed_at = null
      returning id, (xmax = 0) as inserted`;
    inserted.push(...upserted.filter((u) => u.inserted).map((u) => u.id));
  }

  let closedCount = 0;
  if (CLOSE_BY_STATUS.has(source.provider)) {
    // Gone from the feed: ask the source whether it closed (unknown stays open until it's stale).
    const missing = await sql<{ external_id: string }[]>`
      select external_id from public.job_listings
      where source_id = ${source.id} and closed_at is null and last_seen_at < ${started_at}`;
    const closedIds = missing.length ? await jobicyClosed(missing.map((m) => m.external_id)) : [];
    const byStatus = await sql`
      update public.job_listings set closed_at = now()
      where source_id = ${source.id} and closed_at is null
        and (external_id = any(${closedIds}::text[]) or last_seen_at < now() - make_interval(days => ${SEARCH_STALE_DAYS}))`;
    closedCount = byStatus.count;
  } else {
    // A search only returns some of an engine's jobs, so missing from this one doesn't mean closed.
    const byAbsence = await sql`
      update public.job_listings set closed_at = now()
      where source_id = ${source.id} and closed_at is null
        and last_seen_at < ${search ? sql`now() - make_interval(days => ${SEARCH_STALE_DAYS})` : sql`${started_at}`}`;
    closedCount = byAbsence.count;
  }
  const expired = await sql`
    update public.job_listings set closed_at = now()
    where source_id = ${source.id} and closed_at is null and expires_at < now()`;
  closedCount += expired.count;
  const purged = await sql`
    delete from public.job_listings
    where source_id = ${source.id} and closed_at < now() - make_interval(days => ${KEEP_CLOSED_DAYS})`;
  const duplicates = await markDuplicates(source.id);
  await sql`update public.job_sources set last_synced_at = now(), last_error = null where id = ${source.id}`;

  // Of the jobs this sync added: unique across sources, tech, and open to candidates in India.
  const [fresh] = inserted.length
    ? await sql<{ unique: number; tech: number; tech_india: number }[]>`
        select count(*) filter (where duplicate_of is null)::int as unique,
          count(*) filter (where duplicate_of is null and tech_category is not null)::int as tech,
          count(*) filter (where duplicate_of is null and tech_category is not null and eligibility = any(${[...INDIA_ELIGIBLE]}::text[]))::int as tech_india
        from public.job_listings where id = any(${inserted}::uuid[])`
    : [{ unique: 0, tech: 0, tech_india: 0 }];
  return {
    stats: {
      fetched: postings.length, kept: rows.length, inserted: inserted.length, inserted_unique: fresh.unique,
      inserted_tech: fresh.tech, inserted_tech_india: fresh.tech_india, closed: closedCount, duplicates,
    },
    summary: { open: rows.length, inserted: inserted.length, newTechIndia: fresh.tech_india, closed: closedCount, purged: purged.count, duplicates },
  };
}

/**
 * Among open listings sharing a dedupe key with this source's, keeps one, preferring the best kind of
 * source (job_sources.rank), then employers over agencies, then the longest-known; the other copies
 * point at it. Copies on the keeper's own careers page stay: a company posting the same title twice is
 * usually hiring twice, whereas an aggregator listing a job twice has found it on two sites.
 */
async function markDuplicates(sourceId: string): Promise<number> {
  await sql`
    with keys as (
      select distinct dedupe_key from public.job_listings where source_id = ${sourceId} and dedupe_key is not null
    ),
    ranked as (
      select l.id, l.source_id, s.rank, first_value(l.id) over w as keeper, first_value(l.source_id) over w as keeper_source
      -- Closed listings aren't ranked, so a copy whose keeper closed is shown again (the closed keeper's
      -- key is among its source's keys when that source syncs).
      from public.job_listings l
      join public.job_sources s on s.id = l.source_id
      where l.closed_at is null and l.dedupe_key in (select dedupe_key from keys)
      window w as (partition by l.dedupe_key order by s.rank, l.agency, l.first_seen_at, l.id)
    ),
    marks as (
      select id, case when source_id = keeper_source and rank = 0 then null else nullif(keeper, id) end as duplicate_of from ranked
    )
    update public.job_listings l set duplicate_of = m.duplicate_of
    from marks m
    where l.id = m.id and l.duplicate_of is distinct from m.duplicate_of`;
  const [{ count }] = await sql<{ count: number }[]>`
    select count(*)::int as count from public.job_listings
    where source_id = ${sourceId} and closed_at is null and duplicate_of is not null`;
  return count;
}

export function startListingsWorker() {
  const worker = new Worker<{ sourceId?: string }>(
    LISTINGS_QUEUE,
    async (job) => {
      if (job.name === 'listings.sync-all') return syncAll();
      if (job.name === 'listings.sync') return syncSource(job);
      throw new UnrecoverableError(`No processor for job "${job.name}"`);
    },
    // A few boards at once: enough for hundreds of sources every 30 minutes, and polite to each provider.
    { connection, concurrency: 6 },
  );
  worker.on('completed', (job, result) => console.log(`[listings] ${job.name} #${job.id} done`, JSON.stringify(result)));
  worker.on('failed', (job, err) => console.error(`[listings] ${job?.name} #${job?.id} failed (attempt ${job?.attemptsMade}):`, err.message));

  // Every 30 minutes, on the hour and half hour; user matches are refreshed ten minutes later.
  queue
    .upsertJobScheduler('listings-sync', { pattern: '0,30 * * * *' }, { name: 'listings.sync-all', data: {} })
    .catch((err) => console.error('[listings] could not schedule the sync:', err.message));
  return worker;
}

export const closeListingsQueue = () => queue.close();
