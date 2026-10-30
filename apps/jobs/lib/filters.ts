import {
  COMPANY_TYPES, FEED_SORTS, JOB_TYPES, LEVELS, PLATFORMS, WORKPLACES, type CompanyType, type FeedFilters, type FeedSort,
  type JobType, type Platform, type Workplace,
} from '@parakeet/shared';

// Feed filters live in the URL (shareable, survive reloads, back button works). These read and
// write them; the API takes the same parameter names (GET /v1/job-feed).

const csv = (v: string | null) => (v ? v.split(',').map((x) => x.trim()).filter(Boolean) : []);

export function readFilters(params: URLSearchParams): FeedFilters {
  const levels = new Set<number>(LEVELS.map((l) => l.id));
  const posted = Number(params.get('posted'));
  const minScore = Number(params.get('minScore'));
  const sort = params.get('sort');
  return {
    q: params.get('q') ?? undefined,
    location: params.get('location') ?? undefined,
    workplace: csv(params.get('workplace')).filter((w): w is Workplace => (WORKPLACES as readonly string[]).includes(w)),
    level: csv(params.get('level')).map(Number).filter((n) => levels.has(n)),
    type: csv(params.get('type')).filter((t): t is JobType => (JOB_TYPES as readonly string[]).includes(t)),
    company: csv(params.get('company')),
    posted: posted > 0 ? posted : undefined,
    minScore: minScore > 0 ? minScore : undefined,
    salary: params.get('salary') === '1' || undefined,
    companyType: csv(params.get('companyType')).filter((c): c is CompanyType => COMPANY_TYPES.some((x) => x.id === c)),
    platform: csv(params.get('platform')).filter((p): p is Platform => PLATFORMS.some((x) => x.id === p)),
    sort: (FEED_SORTS as readonly string[]).includes(sort ?? '') ? (sort as FeedSort) : undefined,
  };
}

/** Filters as URL parameters (empty values left out). */
export function filterParams(f: FeedFilters): Record<string, string | null> {
  const join = (v?: (string | number)[]) => (v?.length ? v.join(',') : null);
  return {
    q: f.q || null,
    location: f.location || null,
    workplace: join(f.workplace),
    level: join(f.level),
    type: join(f.type),
    company: join(f.company),
    posted: f.posted ? String(f.posted) : null,
    minScore: f.minScore ? String(f.minScore) : null,
    salary: f.salary ? '1' : null,
    companyType: join(f.companyType),
    platform: join(f.platform),
    sort: f.sort ?? null,
  };
}

/** How many filter menus are in use (search box and sort aside). */
export const activeFilterCount = (f: FeedFilters) =>
  [f.workplace?.length, f.level?.length, f.type?.length, f.company?.length, f.posted, f.minScore, f.salary, f.companyType?.length, f.platform?.length].filter(Boolean).length;
