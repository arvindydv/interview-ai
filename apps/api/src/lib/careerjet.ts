import { env } from '../env.js';

// Careerjet's job search API (search.api.careerjet.net/v4), queried live for a visitor's search. Its
// terms tie every call to the visitor who triggered it (their IP and user agent are required), so
// results are passed through, never stored or fetched in the background.

export interface CareerjetJob {
  title: string;
  company: string;
  date: string;
  description: string;
  locations: string;
  salary: string;
  url: string;
}

export interface CareerjetResult {
  hits: number;
  jobs: CareerjetJob[];
}

export const careerjetEnabled = () => Boolean(env.CAREERJET_API_KEY);

export async function searchCareerjet(opts: {
  keywords: string;
  location?: string;
  page: number;
  pageSize: number;
  userIp: string;
  userAgent: string;
}): Promise<CareerjetResult> {
  const params = new URLSearchParams({
    locale_code: env.CAREERJET_LOCALE,
    keywords: opts.keywords,
    page: String(opts.page),
    page_size: String(opts.pageSize),
    fragment_size: '240',
    sort: 'relevance',
    user_ip: opts.userIp,
    user_agent: opts.userAgent,
  });
  if (opts.location) params.set('location', opts.location);
  const res = await fetch(`https://search.api.careerjet.net/v4/query?${params}`, {
    headers: {
      accept: 'application/json',
      authorization: `Basic ${Buffer.from(`${env.CAREERJET_API_KEY}:`).toString('base64')}`,
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Careerjet: HTTP ${res.status}`);
  const body = await res.json();
  // An unknown or ambiguous location comes back as type "LOCATIONS" with no jobs.
  if (body.type !== 'JOBS') return { hits: 0, jobs: [] };
  return { hits: Number(body.hits) || 0, jobs: Array.isArray(body.jobs) ? body.jobs : [] };
}
