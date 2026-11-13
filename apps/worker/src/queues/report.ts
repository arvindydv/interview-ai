import { Queue, UnrecoverableError, Worker } from 'bullmq';
import { AUTO_APPLY_PROVIDERS, INDIA_ELIGIBLE, resolveChannel, type ApplyChannel, type DailyJobsReport } from '@parakeet/shared';
import { sql } from '../db.js';
import { env } from '../env.js';

// The daily Friday Jobs report (public.jobs_daily_reports, read by the admin console): what discovery
// found, how much of it could actually be applied to through each channel, and what was really sent.
//
//   report.daily (00:30 Asia/Kolkata): the report for the day that just ended (India time).
//
// Capacity is counted per job with resolveChannel, exactly as Auto Apply would route it: the employer's
// API only where an ats_credentials row exists for that board, Friday's servers only for providers an
// operator enabled (AUTO_APPLY_CLOUD_FORM_PROVIDERS), the extension for other supported forms, and
// Assisted Apply for everything else. Applications count as submitted only with evidence: the job
// board's confirmation (verified) or the candidate saying so (user_confirmed). Queued, attempted,
// unverified and failed ones are never counted as submitted.

export const REPORT_QUEUE = 'report';
const TZ = 'Asia/Kolkata';

const connection = { url: env.REDIS_URL };
// Made when the worker starts, so importing the report functions (scripts, tests) opens no connection.
let queue: Queue<{ day?: string }> | null = null;

/** Open, unique, India-eligible tech jobs per board, for the capacity split. */
export interface BoardJobs {
  provider: string;
  board: string;
  jobs: number;
}

export function capacitySplit(boards: BoardJobs[], credentials: Set<string>, cloudFormProviders: Set<string>): DailyJobsReport['capacity'] {
  const out = { apiAuthorized: 0, cloudForm: 0, extensionOnly: 0, assistedOnly: 0 };
  const supported = new Set<string>(AUTO_APPLY_PROVIDERS);
  for (const b of boards) {
    const channel: ApplyChannel = resolveChannel({
      provider: b.provider,
      hasApiCredential: credentials.has(`${b.provider}:${b.board.toLowerCase()}`),
      cloudFormEnabled: cloudFormProviders.has(b.provider),
      extensionSupported: supported.has(b.provider),
    });
    if (channel === 'api') out.apiAuthorized += b.jobs;
    else if (channel === 'cloud_form') out.cloudForm += b.jobs;
    else if (channel === 'extension') out.extensionOnly += b.jobs;
    else out.assistedOnly += b.jobs;
  }
  return out;
}

/** One application's outcome in the period, from any sender. */
export interface ApplicationOutcome {
  /** auto_applications.status, or the bot's outcome mapped onto the same words. */
  status: 'submitted' | 'pending' | 'failed' | 'skipped' | 'preparing' | 'prepared';
  reasonCode: string | null;
  /** Who sent a submitted one: api/cloud/browser (verified by the job board) or user (they confirmed). */
  via: 'api' | 'cloud' | 'browser' | 'user' | 'verified' | 'user_reported' | null;
  channel: string;
}

export function applicationCounts(rows: ApplicationOutcome[], llmCostUsd: number): DailyJobsReport['applications'] {
  const out = { submittedVerified: 0, submittedUserConfirmed: 0, failed: 0, needsAction: 0, byChannel: {} as Record<string, number>, llmCostUsd };
  for (const r of rows) {
    if (r.status === 'submitted' && r.via) {
      if (r.via === 'user' || r.via === 'user_reported') out.submittedUserConfirmed++;
      else out.submittedVerified++;
      out.byChannel[r.channel] = (out.byChannel[r.channel] ?? 0) + 1;
    } else if (r.status === 'failed') out.failed++;
    else if (r.status === 'pending' && r.reasonCode !== 'submitting') out.needsAction++;
  }
  out.llmCostUsd = Math.round(llmCostUsd * 10_000) / 10_000;
  return out;
}

/** USD per million tokens (input, output), for model calls whose provider didn't report a cost. */
const TOKEN_PRICES: [RegExp, number, number][] = [
  [/haiku/i, 1, 5],
  [/sonnet/i, 3, 15],
  [/opus/i, 5, 25],
];

/** The cost of one recorded model call: the provider's own figure (OpenRouter), else tokens × list price. */
export function usageCost(detail: { model?: string; usage?: Record<string, unknown> } | null): number {
  const u = detail?.usage;
  if (!u) return 0;
  if (typeof u.cost === 'number') return u.cost;
  const input = Number(u.input_tokens ?? u.prompt_tokens ?? 0);
  const output = Number(u.output_tokens ?? u.completion_tokens ?? 0);
  const price = TOKEN_PRICES.find(([re]) => re.test(detail?.model ?? ''));
  return price ? (input * price[1] + output * price[2]) / 1e6 : 0;
}

const cloudFormProviders = () =>
  new Set((env.AUTO_APPLY_CLOUD_FORM_PROVIDERS ?? process.env.AUTO_APPLY_CLOUD_FORM_PROVIDERS ?? '').split(',').map((p) => p.trim()).filter(Boolean));

/** Builds (and stores) the report for one India-time calendar day, "YYYY-MM-DD"; yesterday by default. */
export async function generateDailyReport(day?: string): Promise<DailyJobsReport> {
  const [{ d }] = await sql<{ d: string }[]>`
    select to_char(coalesce(${day ?? null}::date, (now() at time zone ${TZ})::date - 1), 'YYYY-MM-DD') as d`;
  const from = sql`(${d}::date::timestamp at time zone ${TZ})`;
  const to = sql`((${d}::date + 1)::timestamp at time zone ${TZ})`;
  const eligible = [...INDIA_ELIGIBLE];

  const [snap] = await sql<{ open: number; unique_open: number; tech_open: number; india_tech_open: number; closed: number }[]>`
    select count(*) filter (where closed_at is null)::int as open,
           count(*) filter (where closed_at is null and duplicate_of is null)::int as unique_open,
           count(*) filter (where closed_at is null and duplicate_of is null and tech_category is not null)::int as tech_open,
           count(*) filter (where closed_at is null and duplicate_of is null and tech_category is not null
                              and eligibility = any(${eligible}::text[]))::int as india_tech_open,
           count(*) filter (where closed_at >= ${from} and closed_at < ${to})::int as closed
    from public.job_listings`;

  // New to the world, not just to us: a source's first (backfill) sync doesn't count.
  const bySource = await sql<{ provider: string; open: number; new: number; failures: number }[]>`
    with runs as (
      select s.provider, count(*) filter (where not r.ok)::int as failures
      from public.job_source_runs r join public.job_sources s on s.id = r.source_id
      where r.started_at >= ${from} and r.started_at < ${to}
      group by 1
    ),
    -- First seen that day, unique, on a source we already read before (not a backfill), and posted
    -- recently: a worker that was down for days would otherwise count its catch-up as "new".
    fresh as (
      select s.provider, count(*)::int as new
      from public.job_listings l join public.job_sources s on s.id = l.source_id
      where l.first_seen_at >= ${from} and l.first_seen_at < ${to} and l.duplicate_of is null
        and (l.posted_at is null or l.posted_at >= ${from} - interval '3 days')
        and exists (select 1 from public.job_source_runs r where r.source_id = s.id and r.ok and r.started_at < ${from})
      group by 1
    ),
    open as (
      select s.provider, count(*)::int as open
      from public.job_listings l join public.job_sources s on s.id = l.source_id
      where l.closed_at is null and l.duplicate_of is null
      group by 1
    )
    select coalesce(o.provider, r.provider, f.provider) as provider, coalesce(o.open, 0) as open, coalesce(f.new, 0) as new,
           coalesce(r.failures, 0) as failures
    from open o full join runs r on r.provider = o.provider full join fresh f on f.provider = coalesce(o.provider, r.provider)
    order by open desc`;

  const boards = await sql<BoardJobs[]>`
    select s.provider, s.board, count(*)::int as jobs
    from public.job_listings l join public.job_sources s on s.id = l.source_id
    where l.closed_at is null and l.duplicate_of is null and l.tech_category is not null and l.eligibility = any(${eligible}::text[])
    group by 1, 2`;
  const creds = await sql<{ provider: string; board: string }[]>`
    select provider, board from public.ats_credentials where revoked_at is null`;
  const capacity = capacitySplit(boards, new Set(creds.map((c) => `${c.provider}:${c.board.toLowerCase()}`)), cloudFormProviders());

  // Submitted that day; failed that day; waiting on the candidate now.
  const auto = await sql<ApplicationOutcome[]>`
    select status, reason_code as "reasonCode", submitted_via as via, coalesce(channel, 'unknown') as channel
    from public.auto_applications
    where (status = 'submitted' and submitted_at >= ${from} and submitted_at < ${to})
       or (status = 'failed' and updated_at >= ${from} and updated_at < ${to})
       or status = 'pending'`;
  const bot = await sql<ApplicationOutcome[]>`
    select case outcome when 'applied' then 'submitted' when 'failed' then 'failed'
                        when 'needs_answer' then 'pending' when 'assisted' then 'pending' else 'skipped' end as status,
           null as "reasonCode", evidence as via,
           case when outcome = 'assisted' or evidence = 'user_reported' then 'assisted' else 'bot:' || platform end as channel
    from public.job_bot_applications
    where (outcome in ('applied', 'failed') and updated_at >= ${from} and updated_at < ${to})
       or outcome in ('needs_answer', 'assisted')`;
  const usage = await sql<{ detail: { model?: string; usage?: Record<string, unknown> } }[]>`
    select detail from public.auto_apply_events
    where created_at >= ${from} and created_at < ${to} and detail ? 'usage'`;
  const cost = usage.reduce((n, u) => n + usageCost(u.detail), 0);

  const report: DailyJobsReport = {
    day: d,
    generatedAt: new Date().toISOString(),
    discovery: {
      newListings: bySource.reduce((n, s) => n + s.new, 0),
      closedListings: snap.closed,
      openListings: snap.open,
      uniqueOpen: snap.unique_open,
      techOpen: snap.tech_open,
      indiaEligibleTechOpen: snap.india_tech_open,
      bySource,
    },
    capacity,
    applications: applicationCounts([...auto, ...bot], cost),
  };
  await sql`
    insert into public.jobs_daily_reports (day, data) values (${d}, ${sql.json(report as never)})
    on conflict (day) do update set data = excluded.data, created_at = now()`;
  return report;
}

export function startReportWorker() {
  const worker = new Worker<{ day?: string }>(
    REPORT_QUEUE,
    async (job) => {
      if (job.name !== 'report.daily') throw new UnrecoverableError(`No processor for job "${job.name}"`);
      const r = await generateDailyReport(job.data.day);
      return { day: r.day, newListings: r.discovery.newListings, capacity: r.capacity, submitted: r.applications.submittedVerified + r.applications.submittedUserConfirmed };
    },
    { connection, concurrency: 1 },
  );
  worker.on('completed', (job, result) => console.log(`[report] ${job.name} #${job.id} done`, JSON.stringify(result)));
  worker.on('failed', (job, err) => console.error(`[report] ${job?.name} #${job?.id} failed:`, err.message));
  queue = new Queue<{ day?: string }>(REPORT_QUEUE, { connection });
  queue
    .upsertJobScheduler('report-daily', { pattern: '30 0 * * *', tz: TZ }, { name: 'report.daily', data: {}, opts: { attempts: 3, backoff: { type: 'exponential', delay: 60_000 } } })
    .catch((err) => console.error('[report] could not schedule the daily report:', err.message));
  return worker;
}

export const closeReportQueue = async () => queue?.close();
