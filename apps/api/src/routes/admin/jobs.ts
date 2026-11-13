import type { FastifyInstance } from 'fastify';
import {
  CONNECTORS, INDIA_ELIGIBLE, type DailyJobsReport, LISTING_PROVIDERS, SOURCE_POLICIES, type ConnectorHealth,
  type Eligibility, type ListingProvider, type ListingsAnalytics, type SourceHealth, type TechCategory,
} from '@parakeet/shared';
import { requireAdmin } from '../../lib/adminAuth.js';
import { sql } from '../../lib/db.js';
import { env } from '../../env.js';
import { fillDays } from './overview.js';

// Friday Jobs listings analytics for the admin console: what's collected, what's genuinely new, and
// each source's health and API usage. "New" comes from the sync log (job_source_runs), leaving out a
// source's first sync, which is a backfill; listing classifications come from the worker
// (packages/shared/src/listingQuality.ts).

const DAYS = 30;
const ELIGIBLE = [...INDIA_ELIGIBLE];

export default async function adminJobsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAdmin);

  // The worker's daily reports (queues/report.ts): discovery, capacity by channel, and real submissions.
  app.get<{ Querystring: { days?: string } }>('/admin/jobs-reports', async (req): Promise<DailyJobsReport[]> => {
    const days = Math.min(90, Math.max(1, Number(req.query.days) || 30));
    const rows = await sql<{ data: DailyJobsReport }[]>`
      select data from public.jobs_daily_reports where day > current_date - ${days}::int order by day desc`;
    return rows.map((r) => r.data);
  });

  // Every application connector with what it can do and how it's doing.
  app.get('/admin/connectors', async (): Promise<ConnectorHealth[]> => {
    const [syncs, ats, bot, creds] = await Promise.all([
      sql<{ provider: string; last_ok: Date | null; failed: number }[]>`
        select s.provider, max(r.finished_at) filter (where r.ok) as last_ok,
          count(*) filter (where r.ok is false and r.started_at > now() - interval '24 hours')::int as failed
        from public.job_source_runs r join public.job_sources s on s.id = r.source_id group by s.provider`,
      sql<{ provider: string; last: Date | null; n: number }[]>`
        select provider, max(submitted_at) as last, count(*) filter (where submitted_at > now() - interval '30 days')::int as n
        from public.auto_applications where status = 'submitted' group by provider`,
      sql<{ platform: string; last: Date | null; n: number }[]>`
        select platform, max(updated_at) as last, count(*) filter (where updated_at > now() - interval '30 days')::int as n
        from public.job_bot_applications where outcome = 'applied' group by platform`,
      sql<{ provider: string; n: number }[]>`
        select provider, count(*)::int as n from public.ats_credentials
        where revoked_at is null and last_error is null group by provider`,
    ]);
    const credBy = new Map(creds.map((x) => [x.provider, x.n]));
    const syncBy = new Map(syncs.map((x) => [x.provider, x]));
    const atsBy = new Map(ats.map((x) => [x.provider, x]));
    const botBy = new Map(bot.map((x) => [x.platform, x]));
    const latest = (dates: (Date | null | undefined)[]) => {
      const t = Math.max(...dates.map((d) => d?.getTime() ?? 0));
      return t > 0 ? new Date(t).toISOString() : null;
    };
    return CONNECTORS.map((c) => {
      const sub = c.submissionsFrom?.autoApplyProvider ? atsBy.get(c.submissionsFrom.autoApplyProvider) : c.submissionsFrom?.botPlatform ? botBy.get(c.submissionsFrom.botPlatform) : undefined;
      return {
        ...c,
        lastSyncAt: latest(c.sourceProviders.map((p) => syncBy.get(p)?.last_ok)),
        syncFailures24h: c.sourceProviders.reduce((n, p) => n + (syncBy.get(p)?.failed ?? 0), 0),
        lastSubmissionAt: sub?.last?.toISOString() ?? null,
        submissions30d: sub?.n ?? 0,
        apiCredentials: credBy.get(c.id) ?? 0,
      };
    });
  });

  app.get('/admin/jobs-analytics', async (): Promise<ListingsAnalytics> => {
    const [providers, runs, perDay, categories, eligibilities, companies, failures, [totals]] = await Promise.all([
      sql<{
        provider: ListingProvider; sources: number; enabled: number; failing: number; open: number; unique: number; tech: number;
        tech_india: number; published_tech_india_24h: number; direct: number;
      }[]>`
        select s.provider,
          count(distinct s.id)::int as sources,
          count(distinct s.id) filter (where s.enabled)::int as enabled,
          count(distinct s.id) filter (where s.last_error is not null and s.enabled)::int as failing,
          count(l.id)::int as open,
          count(l.id) filter (where l.duplicate_of is null)::int as unique,
          count(l.id) filter (where l.duplicate_of is null and l.tech_category is not null)::int as tech,
          count(l.id) filter (where l.duplicate_of is null and l.tech_category is not null and l.eligibility = any(${ELIGIBLE}::text[]))::int as tech_india,
          count(l.id) filter (where l.duplicate_of is null and l.tech_category is not null and l.eligibility = any(${ELIGIBLE}::text[])
            and l.posted_at > now() - interval '24 hours')::int as published_tech_india_24h,
          count(l.id) filter (where l.duplicate_of is null and s.rank = 0)::int as direct
        from public.job_sources s
        left join public.job_listings l on l.source_id = s.id and l.closed_at is null
        group by s.provider`,
      sql<{
        provider: ListingProvider; runs: number; failed: number; requests: number; new: number; new_tech_india: number; last_success: Date | null;
      }[]>`
        select s.provider,
          count(r.id) filter (where r.started_at > now() - interval '24 hours')::int as runs,
          count(r.id) filter (where r.started_at > now() - interval '24 hours' and r.ok is false)::int as failed,
          coalesce(sum(r.http_requests) filter (where r.started_at > now() - interval '24 hours'), 0)::int as requests,
          coalesce(sum(r.inserted_unique) filter (where r.started_at > now() - interval '24 hours' and not r.initial), 0)::int as new,
          coalesce(sum(r.inserted_tech_india) filter (where r.started_at > now() - interval '24 hours' and not r.initial), 0)::int as new_tech_india,
          max(r.finished_at) filter (where r.ok) as last_success
        from public.job_sources s join public.job_source_runs r on r.source_id = s.id
        where r.started_at > now() - make_interval(days => ${DAYS})
        group by s.provider`,
      sql<{ day: string; n: number }[]>`
        select to_char((started_at at time zone 'utc')::date, 'YYYY-MM-DD') as day, sum(inserted_tech_india)::int as n
        from public.job_source_runs
        where not initial and ok and started_at > now() - make_interval(days => ${DAYS})
        group by 1`,
      sql<{ category: TechCategory; open: number; india: number }[]>`
        select tech_category as category, count(*)::int as open,
          count(*) filter (where eligibility = any(${ELIGIBLE}::text[]))::int as india
        from public.job_listings where closed_at is null and duplicate_of is null and tech_category is not null
        group by 1 order by 2 desc`,
      sql<{ eligibility: Eligibility; open: number }[]>`
        select coalesce(eligibility, 'unknown') as eligibility, count(*)::int as open
        from public.job_listings where closed_at is null and duplicate_of is null group by 1 order by 2 desc`,
      sql<{ company: string; tech_india: number; new7d: number }[]>`
        select company, count(*)::int as tech_india,
          count(*) filter (where first_seen_at > now() - interval '7 days')::int as new7d
        from public.job_listings
        where closed_at is null and duplicate_of is null and tech_category is not null and eligibility = any(${ELIGIBLE}::text[])
        group by company order by 2 desc limit 25`,
      sql<{ provider: ListingProvider; board: string; company: string; last_error: string; last_synced_at: Date | null }[]>`
        select provider, board, company, last_error, last_synced_at from public.job_sources
        where enabled and last_error is not null order by provider, company limit 100`,
      sql<{ collected: number; open: number; unique: number; tech: number; tech_india: number; expired7d: number; companies: number; new_tech_india_30d: number }[]>`
        select
          (select count(*)::int from public.job_listings) as collected,
          (select count(*)::int from public.job_listings where closed_at is null) as open,
          (select count(*)::int from public.job_listings where closed_at is null and duplicate_of is null) as unique,
          (select count(*)::int from public.job_listings where closed_at is null and duplicate_of is null and tech_category is not null) as tech,
          (select count(*)::int from public.job_listings where closed_at is null and duplicate_of is null and tech_category is not null
             and eligibility = any(${ELIGIBLE}::text[])) as tech_india,
          (select count(*)::int from public.job_listings where closed_at > now() - interval '7 days') as expired7d,
          (select count(distinct lower(company))::int from public.job_listings where closed_at is null and duplicate_of is null) as companies,
          (select coalesce(sum(inserted_tech_india), 0)::int from public.job_source_runs
             where not initial and ok and started_at > now() - interval '30 days') as new_tech_india_30d`,
    ]);

    const runsBy = new Map(runs.map((r) => [r.provider, r]));
    const byProvider: SourceHealth[] = providers
      .filter((p) => (LISTING_PROVIDERS as readonly string[]).includes(p.provider))
      .map((p) => {
        const r = runsBy.get(p.provider);
        return {
          provider: p.provider, sources: p.sources, enabled: p.enabled, open: p.open, unique: p.unique, tech: p.tech, techIndia: p.tech_india,
          new24h: r?.new ?? 0, newTechIndia24h: r?.new_tech_india ?? 0, publishedTechIndia24h: p.published_tech_india_24h,
          runs24h: r?.runs ?? 0, failedRuns24h: r?.failed ?? 0, httpRequests24h: r?.requests ?? 0, failing: p.failing,
          lastSuccessAt: r?.last_success?.toISOString() ?? null, policy: SOURCE_POLICIES[p.provider],
        };
      })
      .sort((a, b) => b.techIndia - a.techIndia);

    // How candidates may apply to the open tech jobs open to India, by each source's terms.
    const applyModes = { direct: 0, assisted: 0, native: 0 };
    for (const p of byProvider) {
      const modes = p.policy.applyModes;
      applyModes[modes.includes('native') ? 'native' : modes.includes('assisted') ? 'assisted' : 'direct'] += p.techIndia;
    }

    const sum = (f: (p: SourceHealth) => number) => byProvider.reduce((n, p) => n + f(p), 0);
    const infra = env.JOBS_INFRA_MONTHLY_USD ?? null;
    const api = env.JOBS_API_MONTHLY_USD ?? null;
    const monthly = infra === null && api === null ? null : (infra ?? 0) + (api ?? 0);
    return {
      generatedAt: new Date().toISOString(),
      totals: {
        collected: totals.collected,
        open: totals.open,
        unique: totals.unique,
        duplicatePct: totals.open ? (totals.open - totals.unique) / totals.open : 0,
        tech: totals.tech,
        techPct: totals.unique ? totals.tech / totals.unique : 0,
        techIndia: totals.tech_india,
        directEmployer: providers.reduce((n, p) => n + p.direct, 0),
        expired7d: totals.expired7d,
        new24h: sum((p) => p.new24h),
        newTechIndia24h: sum((p) => p.newTechIndia24h),
        publishedTechIndia24h: sum((p) => p.publishedTechIndia24h),
        httpRequests24h: sum((p) => p.httpRequests24h),
        companies: totals.companies,
      },
      newPerDay: fillDays(perDay, DAYS),
      byProvider,
      byCategory: categories,
      byEligibility: eligibilities,
      topCompanies: companies.map((c) => ({ company: c.company, techIndia: c.tech_india, new7d: c.new7d })),
      failures: failures.map((f) => ({
        provider: f.provider, board: f.board, company: f.company, error: f.last_error, lastSyncedAt: f.last_synced_at?.toISOString() ?? null,
      })),
      applyModes,
      cost: {
        infraMonthlyUsd: infra,
        apiMonthlyUsd: api,
        newTechIndia30d: totals.new_tech_india_30d,
        usdPer1000New: monthly !== null && totals.new_tech_india_30d > 0 ? (monthly / totals.new_tech_india_30d) * 1000 : null,
      },
    };
  });
}
