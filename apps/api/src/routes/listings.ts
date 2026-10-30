import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  AGGREGATORS, AGGREGATOR_NAMES, AGGREGATOR_SITES, LISTING_LIMITS, SEARCH_PROVIDERS, WORKPLACES, type ListingCompany, type ListingDetail, type ListingPage, type ListingProvider,
  type ListingSummary, type Workplace,
} from '@parakeet/shared';
import { sql } from '../lib/db.js';

// Friday Jobs listings (public, no sign-in): postings synced from company job boards by apps/worker
// (queues/listings.ts). Read by the jobs site's server components.

interface SummaryRow {
  id: string;
  title: string;
  company: string;
  department: string | null;
  location: string;
  workplace: Workplace | null;
  employment_type: string | null;
  salary: string | null;
  posted_at: Date | null;
  company_logo: string | null;
  posted_on: string | null;
  agency: boolean;
  provider: ListingProvider;
}

interface DetailRow extends SummaryRow {
  description_html: string;
  apply_url: string;
  closed_at: Date | null;
}

const toSummary = (r: SummaryRow): ListingSummary => ({
  id: r.id,
  title: r.title,
  company: r.company,
  department: r.department,
  location: r.location,
  workplace: r.workplace,
  employmentType: r.employment_type,
  salary: r.salary,
  postedAt: r.posted_at?.toISOString() ?? null,
  companyLogo: r.company_logo,
  via: AGGREGATOR_NAMES[r.provider] ?? null,
  viaUrl: AGGREGATOR_SITES[r.provider] ?? null,
  postedOn: r.posted_on,
  agency: r.agency,
});

const text = z.string().max(LISTING_LIMITS.maxQueryChars).transform((s) => s.trim()).optional();

const listQuery = z.object({
  q: text,
  location: text,
  company: text,
  workplace: z.enum(WORKPLACES).optional(),
  page: z.coerce.number().int().min(1).max(LISTING_LIMITS.maxPage).default(1),
});

/** Escapes LIKE wildcards so user input matches literally. */
const likeContains = (s: string) => `%${s.replace(/[\\%_]/g, '\\$&')}%`;

export default async function listingRoutes(app: FastifyInstance) {
  app.get('/v1/listings', async (req, reply): Promise<ListingPage | void> => {
    const parsed = listQuery.safeParse(req.query);
    if (!parsed.success) return reply.code(400).send({ error: 'bad_request', message: 'Invalid search.' });
    const { q, location, company, workplace, page } = parsed.data;
    const pageSize = LISTING_LIMITS.pageSize;

    const query = q ? sql`websearch_to_tsquery('english', ${q})` : null;
    const rows = await sql<(SummaryRow & { total: number })[]>`
      select l.id, l.title, l.company, l.department, l.location, l.workplace, l.employment_type, l.salary, l.posted_at,
             l.company_logo, l.posted_on, l.agency, s.provider, count(*) over ()::int as total
      from public.job_listings l join public.job_sources s on s.id = l.source_id
      where l.closed_at is null and l.duplicate_of is null
        ${query ? sql`and l.search @@ ${query}` : sql``}
        ${location ? sql`and l.location ilike ${likeContains(location)}` : sql``}
        ${company ? sql`and l.company = ${company}` : sql``}
        ${workplace ? sql`and l.workplace = ${workplace}` : sql``}
      order by ${query ? sql`ts_rank(l.search, ${query}) desc,` : sql``} l.posted_at desc nulls last, l.id
      limit ${pageSize} offset ${(page - 1) * pageSize}`;

    reply.header('cache-control', 'public, max-age=60');
    return { items: rows.map(toSummary), total: rows[0]?.total ?? 0, page, pageSize };
  });

  app.get('/v1/listings/companies', async (_req, reply): Promise<ListingCompany[]> => {
    const rows = await sql<ListingCompany[]>`
      select l.company, count(*)::int as open,
             max(case when s.provider = any(${[...AGGREGATORS]}::text[]) then null else s.website end) as website
      from public.job_listings l join public.job_sources s on s.id = l.source_id
      where l.closed_at is null and l.duplicate_of is null group by l.company order by lower(l.company)`;
    reply.header('cache-control', 'public, max-age=300');
    return rows;
  });

  app.get<{ Params: { id: string } }>('/v1/listings/:id', async (req, reply): Promise<ListingDetail | void> => {
    if (!z.uuid().safeParse(req.params.id).success) return reply.notFound('No such job.');
    const [r] = await sql<DetailRow[]>`
      select l.id, l.title, l.company, l.department, l.location, l.workplace, l.employment_type, l.salary,
             l.posted_at, l.company_logo, l.posted_on, l.agency, l.description_html, l.apply_url, l.closed_at, s.provider
      from public.job_listings l join public.job_sources s on s.id = l.source_id
      where l.id = ${req.params.id}`;
    if (!r) return reply.notFound('No such job.');
    reply.header('cache-control', 'public, max-age=300');
    return {
      ...toSummary(r),
      descriptionHtml: r.description_html,
      descriptionPartial: SEARCH_PROVIDERS.has(r.provider),
      applyUrl: r.apply_url,
      provider: r.provider,
      closed: r.closed_at !== null,
    };
  });
}
