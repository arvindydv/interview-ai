import type { ListingProvider, Workplace } from '@parakeet/shared';
import { env } from '../env.js';
import { httpFetch } from './http.js';
import {
  BoardNotFoundError, RateLimitedError, USER_AGENT, clean, companyName, date, decodeEntities, sanitize, toText, type Posting,
} from './boards.js';

// Job search engines (Adzuna, Jooble, JSearch): searched through their APIs for a set of roles, since
// none offers a full feed. Adzuna and Jooble index jobs from employers' sites and other boards across
// India, and give a description excerpt plus a tracked link to the job on their site, which is where
// the candidate applies. JSearch returns Google for Jobs results (postings on LinkedIn, Naukri, Indeed
// and employers' sites) with the full description and the posting's own apply link. Their keys come
// from the worker's environment; without one the source is skipped (see configuredSearchProviders).

export function configuredSearchProviders(): Set<ListingProvider> {
  const on = new Set<ListingProvider>();
  // Keys alone don't turn Adzuna on: its commercial licence must be confirmed first (ADZUNA_SYNC_ENABLED).
  if (env.ADZUNA_SYNC_ENABLED && env.ADZUNA_APP_ID && env.ADZUNA_APP_KEY) on.add('adzuna');
  if (env.JOOBLE_API_KEY) on.add('jooble');
  if (env.JSEARCH_API_KEY) on.add('jsearch');
  return on;
}

/** A role to search for, in a city (null: anywhere in the country). */
export interface SearchQuery {
  what: string;
  where: string | null;
}

/** Searches each query once (one page, newest first) and returns every posting found. */
export async function fetchSearch(provider: ListingProvider, country: string, queries: (SearchQuery | string)[]): Promise<Posting[]> {
  const out: Posting[] = [];
  for (const [i, query] of queries.entries()) {
    const q = typeof query === 'string' ? { what: query, where: null } : query;
    if (i) await pause(provider === 'adzuna' ? 2_500 : 1_000);
    try {
      out.push(...(provider === 'adzuna' ? await adzuna(country, q) : provider === 'jsearch' ? await jsearch(country, q) : await jooble(q)));
    } catch (err) {
      // A bad key fails every query; a rate limit means stop for this round and keep what we have.
      if (err instanceof BoardNotFoundError || (err instanceof RateLimitedError && !out.length)) throw err;
      if (err instanceof RateLimitedError) break;
      console.warn(`[listings] ${provider} search "${q.what}${q.where ? ` in ${q.where}` : ''}" failed:`, (err as Error).message);
    }
  }
  return out;
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function request(url: string, init: RequestInit = {}): Promise<any> {
  const res = await httpFetch(url, {
    ...init,
    headers: { accept: 'application/json', 'user-agent': USER_AGENT, ...init.headers },
    signal: AbortSignal.timeout(60_000),
  });
  const where = url.replace(/(app_key=|\/api\/)[^&/?]+/, '$1…').replace(/^(https:\/\/[^/]+\/[^?]*).*$/, '$1');
  if (res.status === 401 || res.status === 403) throw new BoardNotFoundError(`${where}: HTTP ${res.status} (check the API key)`);
  if (res.status === 429) throw new RateLimitedError(`${where}: HTTP 429`);
  if (!res.ok) throw new Error(`${where}: HTTP ${res.status}`);
  return res.json();
}

const stripTags = (s: unknown) => clean(decodeEntities(String(s ?? '').replace(/<[^>]*>/g, '')));
const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const remote = (...s: string[]): Workplace | null => (s.some((x) => /\b(remote|work from home|wfh)\b/i.test(x)) ? 'remote' : null);

/** An excerpt as a paragraph; the full posting is on the engine's page. */
function excerpt(text: string) {
  const html = sanitize(`<p>${escape(text)}</p>`);
  return { descriptionHtml: html, descriptionText: toText(html) };
}

const ADZUNA_TIME: Record<string, string> = { full_time: 'Full-time', part_time: 'Part-time' };
const ADZUNA_CONTRACT: Record<string, string> = { contract: 'Contract' };

async function adzuna(country: string, { what, where }: SearchQuery): Promise<Posting[]> {
  const params = new URLSearchParams({
    app_id: env.ADZUNA_APP_ID!,
    app_key: env.ADZUNA_APP_KEY!,
    results_per_page: '50',
    what,
    ...(where ? { where } : {}),
    sort_by: 'date',
    // Searched four times a day: the last few days hold everything new since the previous search.
    max_days_old: '3',
    'content-type': 'application/json',
  });
  const body = await request(`https://api.adzuna.com/v1/api/jobs/${encodeURIComponent(country)}/search/1?${params}`);
  return (body.results ?? [])
    .filter((j: any) => j.id && j.title && j.redirect_url)
    .map((j: any): Posting => {
      const title = stripTags(j.title);
      const location = stripTags(j.location?.display_name);
      const category = stripTags(j.category?.label);
      // Adzuna estimates salaries it isn't given ("salary_is_predicted"); only stated ones are shown.
      const stated = j.salary_min && String(j.salary_is_predicted) !== '1';
      const fmt = (n: number) => Math.round(n).toLocaleString('en-IN');
      return {
        externalId: String(j.id),
        title,
        department: category && !/unknown|other\/general/i.test(category) ? category : null,
        location,
        workplace: remote(title, location),
        employmentType: ADZUNA_CONTRACT[j.contract_type] ?? ADZUNA_TIME[j.contract_time] ?? null,
        salary: stated
          ? `${country === 'in' ? 'INR' : ''} ${fmt(j.salary_min)}${j.salary_max > j.salary_min ? `–${fmt(j.salary_max)}` : ''} yearly`.trim()
          : null,
        ...excerpt(stripTags(j.description)),
        applyUrl: j.redirect_url,
        postedAt: date(j.created),
        company: companyName(stripTags(j.company?.display_name)) || 'Company not disclosed',
        companyLogo: null,
        postedOn: null,
      };
    });
}

async function jooble({ what, where }: SearchQuery): Promise<Posting[]> {
  const body = await request(`https://${env.JOOBLE_HOST}/api/${encodeURIComponent(env.JOOBLE_API_KEY!)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ keywords: what, location: where ?? 'India', page: '1', ResultOnPage: '50' }),
  });
  return (body.jobs ?? [])
    .filter((j: any) => j.id && j.title && j.link)
    .map((j: any): Posting => {
      const title = stripTags(j.title);
      const location = stripTags(j.location);
      const type = stripTags(j.type);
      // The site Jooble found it on ("naukri.com"), unless that is Jooble itself.
      const source = stripTags(j.source).toLowerCase();
      return {
        externalId: String(j.id),
        title,
        department: null,
        location,
        workplace: remote(title, location, type),
        employmentType: type || null,
        salary: stripTags(j.salary) || null,
        ...excerpt(stripTags(j.snippet)),
        applyUrl: j.link,
        postedAt: date(j.updated),
        company: companyName(stripTags(j.company)) || 'Company not disclosed',
        companyLogo: null,
        postedOn: source && !source.includes('jooble') ? source.slice(0, 80) : null,
      };
    });
}

const JSEARCH_TYPE: Record<string, string> = { FULLTIME: 'Full-time', PARTTIME: 'Part-time', CONTRACTOR: 'Contract', INTERN: 'Internship' };

/** "₹6L–₹9L a year" style, from JSearch's numbers; null when it gives none. */
function jsearchSalary(j: any): string | null {
  const [min, max] = [j.job_min_salary, j.job_max_salary].map((n: unknown) => (typeof n === 'number' && n > 0 ? n : null));
  if (min === null && max === null) return null;
  const cur = typeof j.job_salary_currency === 'string' ? j.job_salary_currency : '';
  const fmt = (n: number) => `${cur === 'INR' ? '₹' : cur ? `${cur} ` : ''}${n >= 100_000 && cur === 'INR' ? `${Math.round(n / 10_000) / 10}L` : n.toLocaleString('en-IN')}`;
  const per = { YEAR: ' a year', MONTH: ' a month', HOUR: ' an hour' }[String(j.job_salary_period)] ?? '';
  return `${[min, max].filter((n): n is number => n !== null).map(fmt).join('–')}${per}`;
}

/** The description as paragraphs: JSearch gives plain text with line breaks. */
function paragraphs(text: string) {
  const html = sanitize(
    text
      .split(/\n{2,}/)
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p) => `<p>${escape(p).replace(/\n/g, '<br>')}</p>`)
      .join(''),
  );
  return { descriptionHtml: html, descriptionText: toText(html) };
}

async function jsearch(country: string, { what, where }: SearchQuery): Promise<Posting[]> {
  const params = new URLSearchParams({ query: where ? `${what} in ${where}` : what, page: '1', num_pages: '1', country, date_posted: env.JSEARCH_DATE_POSTED });
  // /search-v2 (the v1 /search endpoint was retired): { data: { jobs, cursor } }.
  const body = await request(`https://jsearch.p.rapidapi.com/search-v2?${params}`, {
    headers: { 'x-rapidapi-key': env.JSEARCH_API_KEY!, 'x-rapidapi-host': 'jsearch.p.rapidapi.com' },
  });
  const jobs: unknown[] = Array.isArray(body.data) ? body.data : (body.data?.jobs ?? []);
  return jobs
    .filter((j: any) => j.job_id && j.job_title && (j.job_apply_link || j.apply_options?.length))
    .map((j: any): Posting => {
      const title = stripTags(j.job_title);
      const location = stripTags(j.job_location) || [j.job_city, j.job_state, j.job_country].map(stripTags).filter(Boolean).join(', ');
      // The employer's own page when Google found one, else the posting's (LinkedIn, Naukri…).
      const direct = (j.apply_options ?? []).find((o: any) => o.is_direct && o.apply_link)?.apply_link;
      return {
        externalId: String(j.job_id),
        title,
        department: null,
        location,
        workplace: j.job_is_remote ? 'remote' : remote(title, location),
        employmentType: JSEARCH_TYPE[String(j.job_employment_types?.[0] ?? j.job_employment_type)] ?? null,
        salary: stripTags(j.job_salary_string) || jsearchSalary(j),
        ...paragraphs(String(j.job_description ?? '')),
        applyUrl: direct ?? j.job_apply_link,
        postedAt: date(j.job_posted_at_datetime_utc),
        company: companyName(stripTags(j.employer_name)) || 'Company not disclosed',
        companyLogo: typeof j.employer_logo === 'string' && /^https:\/\//.test(j.employer_logo) ? j.employer_logo : null,
        // Where it was posted ("LinkedIn", "Naukri.com"), shown as "which found it on …".
        postedOn: stripTags(j.job_publisher).slice(0, 80) || null,
      };
    });
}
