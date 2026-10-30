import type { ListingProvider, Workplace } from '@parakeet/shared';
import { env } from '../env.js';
import {
  BoardNotFoundError, RateLimitedError, USER_AGENT, clean, companyName, date, decodeEntities, sanitize, toText, type Posting,
} from './boards.js';

// Job search engines (Adzuna, Jooble): searched through their partner APIs for a set of roles, since
// neither offers a full feed. Both index jobs from employers' sites and other boards across India, and
// both give only a description excerpt plus a tracked link to the job on their site, which is where
// the candidate applies. Their keys come from the worker's environment; without one the source is
// skipped (see configuredSearchProviders).

export function configuredSearchProviders(): Set<ListingProvider> {
  const on = new Set<ListingProvider>();
  if (env.ADZUNA_APP_ID && env.ADZUNA_APP_KEY) on.add('adzuna');
  if (env.JOOBLE_API_KEY) on.add('jooble');
  return on;
}

/** Searches each query once (one page, newest first) and returns every posting found. */
export async function fetchSearch(provider: ListingProvider, country: string, queries: string[]): Promise<Posting[]> {
  const out: Posting[] = [];
  for (const [i, q] of queries.entries()) {
    if (i) await pause(provider === 'adzuna' ? 2_500 : 1_000);
    try {
      out.push(...(provider === 'adzuna' ? await adzuna(country, q) : await jooble(q)));
    } catch (err) {
      // A bad key fails every query; a rate limit means stop for this round and keep what we have.
      if (err instanceof BoardNotFoundError || (err instanceof RateLimitedError && !out.length)) throw err;
      if (err instanceof RateLimitedError) break;
      console.warn(`[listings] ${provider} search "${q}" failed:`, (err as Error).message);
    }
  }
  return out;
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function request(url: string, init: RequestInit = {}): Promise<any> {
  const res = await fetch(url, {
    ...init,
    headers: { accept: 'application/json', 'user-agent': USER_AGENT, ...init.headers },
    signal: AbortSignal.timeout(60_000),
  });
  const where = url.replace(/(app_key=|\/api\/)[^&/?]+/, '$1…');
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

async function adzuna(country: string, what: string): Promise<Posting[]> {
  const params = new URLSearchParams({
    app_id: env.ADZUNA_APP_ID!,
    app_key: env.ADZUNA_APP_KEY!,
    results_per_page: '50',
    what,
    sort_by: 'date',
    max_days_old: '30',
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

async function jooble(keywords: string): Promise<Posting[]> {
  const body = await request(`https://${env.JOOBLE_HOST}/api/${encodeURIComponent(env.JOOBLE_API_KEY!)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ keywords, location: 'India', page: '1', ResultOnPage: '50' }),
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
