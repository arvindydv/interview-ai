import { Queue, UnrecoverableError, Worker, type Job } from 'bullmq';
import type { ListingProvider } from '@parakeet/shared';
import { sql } from '../db.js';
import { env } from '../env.js';
import { RateLimitedError, boardOwner, fetchBoard, type Posting } from '../listings/boards.js';
import { INDIA_STARTUPS } from '../listings/indiaStartups.js';
import { queueSourceSync } from './listings.js';

// Finds startups' job boards. "discovery.run" refreshes the candidate list (hiring companies in Y
// Combinator's directory, plus listings/indiaStartups.ts), then probes the companies that are due on
// each provider's public board API. A board that has openings and mentions the company becomes a job
// source, synced with the others every 30 minutes. Misses are retried monthly.

export const DISCOVERY_QUEUE = 'discovery';

/** Y Combinator's company directory as open data (github.com/yc-oss/api), refreshed daily upstream. */
const YC_COMPANIES_URL = 'https://yc-oss.github.io/api/companies/all.json';
/** Companies probed per run, so a run takes minutes and the providers see a modest request rate. */
const PER_RUN = 300;
// Providers rate-limit bursts; failed probes are retried next run.
const CONCURRENCY = 4;
const RECHECK_DAYS = 30;
const RETRY_INCOMPLETE_DAYS = 7;
/** Most startups are on Ashby, so it is tried first. */
const PROVIDERS: ListingProvider[] = ['ashby', 'greenhouse', 'lever', 'workable'];
/** Read one page per job, so synced less often. */
const PAGE_PROVIDERS = new Set<ListingProvider>(['freshteam', 'zohorecruit']);
/** Careers platforms common in India, tried for Indian companies only. */
const INDIA_PROVIDERS: ListingProvider[] = ['keka', 'freshteam', 'zohorecruit'];

/** Boards to try for one slug: Zoho Recruit runs separate .in and .com data centres. */
const boardsFor = (provider: ListingProvider, slug: string) =>
  provider === 'zohorecruit' ? [`${slug}.zohorecruit.in`, `${slug}.zohorecruit.com`] : [slug];

/**
 * Indian companies hire in India: without an owner to check, a board with no Indian location is
 * another company's that shares the name ("Leap", "Porter").
 */
const INDIA_PLACES =
  /india|bengaluru|bangalore|mumbai|delhi|gurugram|gurgaon|noida|pune|hyderabad|chennai|kolkata|ahmedabad|jaipur|kochi|indore|chandigarh/i;

/** Squashed lowercase name, for comparing "Wingify Software Pvt. Ltd." with "Wingify". */
const squash = (s: string) =>
  s.toLowerCase().replace(/\b(pvt|private|ltd|limited|inc|llp|llc|technologies|technology|software|solutions|india)\b\.?/g, '').replace(/[^a-z0-9]/g, '');

const connection = { url: env.REDIS_URL };
const queue = new Queue<{ limit?: number }>(DISCOVERY_QUEUE, { connection });

interface Candidate {
  key: string;
  origin: 'yc' | 'india';
  name: string;
  website: string | null;
  slugs: string[];
  yc_batch: string | null;
}

const domainOf = (url: string | null | undefined) =>
  url ? url.replace(/^https?:\/\//, '').replace(/^www\./, '').split(/[/?#]/)[0].toLowerCase() || null : null;

/** Board slugs a company probably uses: its name squashed or hyphenated, and its domain's first label. */
function slugsFor(name: string, website: string | null, extra?: string): string[] {
  const words = name.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, ' ').trim();
  return [...new Set([extra, words.replace(/ /g, ''), words.replace(/ /g, '-'), website?.split('.')[0]])]
    .filter((s): s is string => Boolean(s && /^[a-z0-9-]{2,60}$/.test(s)))
    .slice(0, 3);
}

async function loadCandidates() {
  const rows: Candidate[] = INDIA_STARTUPS.map((c) => ({
    key: `india:${c.website}`,
    origin: 'india',
    name: c.name,
    website: c.website,
    slugs: slugsFor(c.name, c.website),
    yc_batch: null,
  }));
  try {
    const res = await fetch(YC_COMPANIES_URL, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const companies = (await res.json()) as { slug: string; name: string; website?: string; isHiring?: boolean; status?: string; batch?: string }[];
    for (const c of companies) {
      if (!c.isHiring || c.status !== 'Active') continue;
      const website = domainOf(c.website);
      rows.push({ key: `yc:${c.slug}`, origin: 'yc', name: c.name, website, slugs: slugsFor(c.name, website, c.slug), yc_batch: c.batch ?? null });
    }
  } catch (err) {
    // The curated list still gets probed.
    console.error('[discovery] could not load the YC directory:', (err as Error).message);
  }
  for (let i = 0; i < rows.length; i += 500) {
    await sql`
      insert into public.job_source_candidates ${sql(rows.slice(i, i + 500), 'key', 'origin', 'name', 'website', 'slugs', 'yc_batch')}
      on conflict (key) do update set
        name = excluded.name, website = excluded.website, slugs = excluded.slugs, yc_batch = excluded.yc_batch`;
  }
  return rows.length;
}

const ATS_HOSTS = /(^|\.)(greenhouse\.io|lever\.co|ashbyhq\.com|workable\.com)$/;

/**
 * Whether the board is this company's: a slug like "ultra" or "slice" can belong to someone else, so
 * the postings must name the company (or its website, for very short names), and postings hosted on a
 * company's own site must be on this company's domain.
 */
function isTheirs(c: Candidate, postings: Posting[]): boolean {
  const label = c.website?.split('.')[0];
  const ownHosts = postings.map((p) => domainOf(p.applyUrl)).filter((h): h is string => Boolean(h && !ATS_HOSTS.test(h)));
  if (label && ownHosts.some((h) => !h.split('.').includes(label))) return false;

  const name = c.name
    .toLowerCase()
    .replace(/\b(inc|labs|technologies|ai|hq)\b\.?/g, '')
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '');
  const needles = [c.website, name.length >= 4 ? name : null].filter((n): n is string => Boolean(n));
  const text = postings
    .slice(0, 5)
    .map((p) => `${p.title}\n${p.descriptionText}`)
    .join('\n')
    .toLowerCase();
  return needles.some((n) => new RegExp(`(^|[^a-z0-9])${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`).test(text));
}

/**
 * The company's board, if a provider has one. `complete` is false when some provider couldn't be
 * asked (rate limit, timeout, network error, or `paused` for this run), so a miss is re-checked sooner.
 */
async function probe(c: Candidate, paused: Set<ListingProvider>) {
  let complete = true;
  const providers = c.origin === 'india' ? [...PROVIDERS, ...INDIA_PROVIDERS] : PROVIDERS;
  for (const slug of c.slugs) {
    for (const provider of providers) {
      if (paused.has(provider)) {
        complete = false;
        continue;
      }
      for (const board of boardsFor(provider, slug)) {
        try {
          const postings = await fetchBoard(provider, board, { detailPages: 3 });
          if (!postings.length) continue;
          // Where the board names its company, that decides; otherwise the postings must name it.
          const owner = await boardOwner(provider, board).catch(() => null);
          const theirs = owner
            ? squash(owner).includes(squash(c.name)) || squash(c.name).includes(squash(owner))
            : isTheirs(c, postings) && (c.origin !== 'india' || postings.some((p) => INDIA_PLACES.test(p.location)));
          if (theirs) return { hit: { provider, board }, complete: true };
        } catch (err) {
          // A provider that rate-limits us is left alone for the rest of the run. Other errors (an
          // error page, a 403 from a disabled portal) count as no board.
          if (err instanceof RateLimitedError) paused.add(provider);
          if (err instanceof RateLimitedError || (err instanceof Error && ['TimeoutError', 'AbortError', 'TypeError'].includes(err.name))) {
            complete = false;
          }
        }
      }
    }
  }
  return { hit: null, complete };
}

async function run(job: Job<{ limit?: number }>) {
  const loaded = await loadCandidates();
  const due = await sql<Candidate[]>`
    select key, origin, name, website, slugs, yc_batch from public.job_source_candidates
    where checked_at is null or checked_at < now() - make_interval(days => ${RECHECK_DAYS})
    order by checked_at nulls first, origin = 'india' desc
    limit ${job.data.limit ?? PER_RUN}`;

  let found = 0;
  let incomplete = 0;
  let next = 0;
  const paused = new Set<ListingProvider>();
  const workers = Array.from({ length: CONCURRENCY }, async () => {
    while (next < due.length) {
      const c = due[next++];
      const { hit, complete } = await probe(c, paused);
      if (!complete && !hit) incomplete++;
      let sourceId: string | null = null;
      if (hit) {
        const [source] = await sql<{ id: string }[]>`
          insert into public.job_sources (provider, board, company, website, origin, startup, yc_batch, sync_every)
          values (${hit.provider}, ${hit.board}, ${c.name}, ${c.website}, ${c.origin}, true, ${c.yc_batch},
                  ${PAGE_PROVIDERS.has(hit.provider) ? '2 hours' : '30 minutes'})
          on conflict (provider, board) do update set
            startup = true, yc_batch = coalesce(job_sources.yc_batch, excluded.yc_batch),
            website = coalesce(job_sources.website, excluded.website)
          returning id`;
        sourceId = source.id;
        found++;
        await queueSourceSync(sourceId);
      }
      // A miss with providers left unasked comes round again in a week instead of a month.
      await sql`
        update public.job_source_candidates
        set checked_at = ${hit || complete ? sql`now()` : sql`now() - make_interval(days => ${RECHECK_DAYS - RETRY_INCOMPLETE_DAYS})`},
            source_id = coalesce(${sourceId}, source_id)
        where key = ${c.key}`;
    }
  });
  await Promise.all(workers);
  return { candidates: loaded, probed: due.length, found, incomplete, paused: [...paused] };
}

export function startDiscoveryWorker() {
  const worker = new Worker<{ limit?: number }>(
    DISCOVERY_QUEUE,
    async (job) => {
      if (job.name !== 'discovery.run') throw new UnrecoverableError(`No processor for job "${job.name}"`);
      return run(job);
    },
    // One run at a time; a run can take several minutes.
    { connection, concurrency: 1, lockDuration: 10 * 60_000 },
  );
  worker.on('completed', (job, result) => console.log(`[discovery] ${job.name} #${job.id} done`, JSON.stringify(result)));
  worker.on('failed', (job, err) => console.error(`[discovery] ${job?.name} #${job?.id} failed:`, err.message));

  // Every 6 hours: the first runs work through the whole list, later ones pick up new startups and
  // monthly re-checks.
  queue
    .upsertJobScheduler('discovery-run', { pattern: '20 */6 * * *' }, { name: 'discovery.run', data: {} })
    .catch((err) => console.error('[discovery] could not schedule discovery:', err.message));
  return worker;
}

export const closeDiscoveryQueue = () => queue.close();
