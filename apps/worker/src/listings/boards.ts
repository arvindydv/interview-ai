import sanitizeHtml from 'sanitize-html';
import type { ListingProvider, Workplace } from '@parakeet/shared';

// Fetches open postings from a public job board API and normalises them: companies' own boards
// (Greenhouse, Lever, Ashby, Workable: the endpoints each provider documents for embedding careers
// pages; Keka, Freshteam, Zoho Recruit: what their public careers pages load, within their robots.txt)
// and remote-job boards (Himalayas, Remote OK, Jobicy: free public feeds whose terms ask for a
// visible credit and their own apply link). No keys are needed.

export interface Posting {
  externalId: string;
  title: string;
  department: string | null;
  location: string;
  workplace: Workplace | null;
  employmentType: string | null;
  salary: string | null;
  descriptionHtml: string;
  descriptionText: string;
  applyUrl: string;
  postedAt: Date | null;
  /** Set by remote-job boards, which carry many companies; company boards use the source's company. */
  company?: string;
  companyLogo?: string | null;
  /** Where an aggregator says the job was first posted, e.g. "naukri.com". */
  postedOn?: string | null;
}

/** The board doesn't exist or the provider rejected the request; retrying won't help. */
export class BoardNotFoundError extends Error {}

/** The provider asked us to slow down (HTTP 429); worth retrying later. */
export class RateLimitedError extends Error {}

const MAX_DESCRIPTION_CHARS = 100_000;

/**
 * `detailPages` caps the per-job pages read for providers that need them (Freshteam, Zoho Recruit);
 * discovery only needs a few postings to recognise a board.
 */
export async function fetchBoard(provider: ListingProvider, board: string, { detailPages = DETAIL_PAGES_MAX } = {}): Promise<Posting[]> {
  const slug = encodeURIComponent(board);
  switch (provider) {
    case 'greenhouse':
      return greenhouse(await getJson(`https://boards-api.greenhouse.io/v1/boards/${slug}/jobs?content=true`));
    case 'lever':
      return lever(await getJson(`https://api.lever.co/v0/postings/${slug}?mode=json`));
    case 'ashby':
      return ashby(await getJson(`https://api.ashbyhq.com/posting-api/job-board/${slug}?includeCompensation=true`));
    case 'workable':
      return workable(await getJson(`https://apply.workable.com/api/v1/widget/accounts/${slug}?details=true`));
    case 'keka':
      return keka(board);
    case 'freshteam':
      return freshteam(board, detailPages);
    case 'zohorecruit':
      return zohoRecruit(board, detailPages);
    case 'himalayas':
      return himalayas();
    case 'remoteok':
      return remoteok(await getJson('https://remoteok.com/api'));
    case 'jobicy':
      return jobicy();
    case 'adzuna':
    case 'jooble':
      throw new BoardNotFoundError(`${provider} is searched, not read as a board (listings/search.ts)`);
  }
}

export const USER_AGENT = 'FridayJobs/1.0 (job listings sync)';

/** A careers page as text; a redirect away from it means the company has no board there. */
async function getPage(url: string): Promise<string> {
  const res = await fetch(url, { headers: { 'user-agent': USER_AGENT }, redirect: 'manual', signal: AbortSignal.timeout(60_000) });
  if (res.status === 404 || (res.status >= 300 && res.status < 400)) throw new BoardNotFoundError(`${url}: HTTP ${res.status}`);
  if (res.status === 429) throw new RateLimitedError(`${url}: HTTP 429`);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.text();
}

async function getJson(url: string): Promise<any> {
  const res = await fetch(url, {
    headers: { accept: 'application/json', 'user-agent': USER_AGENT },
    signal: AbortSignal.timeout(60_000),
  });
  if (res.status === 404 || res.status === 400) throw new BoardNotFoundError(`${url}: HTTP ${res.status}`);
  if (res.status === 429) throw new RateLimitedError(`${url}: HTTP 429`);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

function greenhouse(body: any): Posting[] {
  return (body.jobs ?? []).map((j: any): Posting => {
    const location = clean(j.location?.name);
    // Greenhouse returns the description HTML entity-escaped.
    const html = sanitize(decodeEntities(j.content ?? ''));
    return {
      externalId: String(j.id),
      title: clean(j.title),
      department: clean(j.departments?.[0]?.name) || null,
      location,
      workplace: /\bremote\b/i.test(location) ? 'remote' : null,
      employmentType: null,
      salary: null,
      descriptionHtml: html,
      descriptionText: toText(html),
      applyUrl: j.absolute_url,
      postedAt: date(j.first_published ?? j.updated_at),
    };
  });
}

function lever(body: any): Posting[] {
  if (!Array.isArray(body)) return [];
  return body.map((j: any): Posting => {
    const c = j.categories ?? {};
    const lists = (j.lists ?? []).map((l: any) => `<h3>${escape(l.text ?? '')}</h3><ul>${l.content ?? ''}</ul>`).join('');
    const html = sanitize(`${j.description ?? ''}${lists}${j.additional ?? ''}`);
    const workplace = ({ remote: 'remote', hybrid: 'hybrid', onsite: 'onsite' } as const)[j.workplaceType as string] ?? null;
    return {
      externalId: String(j.id),
      title: clean(j.text),
      department: clean(c.team) || null,
      location: clean((c.allLocations?.length ? c.allLocations : [c.location]).filter(Boolean).join(' · ')),
      workplace,
      employmentType: clean(c.commitment) || null,
      salary: salaryRange(j.salaryRange),
      descriptionHtml: html,
      descriptionText: toText(html),
      applyUrl: j.hostedUrl,
      postedAt: typeof j.createdAt === 'number' ? new Date(j.createdAt) : null,
    };
  });
}

const ASHBY_WORKPLACE: Record<string, Workplace> = { Remote: 'remote', Hybrid: 'hybrid', OnSite: 'onsite' };
const ASHBY_EMPLOYMENT: Record<string, string> = {
  FullTime: 'Full-time',
  PartTime: 'Part-time',
  Intern: 'Internship',
  Contract: 'Contract',
  Temporary: 'Temporary',
};

function ashby(body: any): Posting[] {
  return (body.jobs ?? [])
    .filter((j: any) => j.isListed !== false)
    .map((j: any): Posting => {
      const html = sanitize(j.descriptionHtml ?? '');
      const locations = [j.location, ...(j.secondaryLocations ?? []).map((l: any) => l.location)].filter(Boolean);
      return {
        externalId: String(j.id),
        title: clean(j.title),
        department: clean(j.department) || null,
        location: clean(locations.join(' · ')),
        workplace: ASHBY_WORKPLACE[j.workplaceType] ?? (j.isRemote ? 'remote' : null),
        employmentType: ASHBY_EMPLOYMENT[j.employmentType] ?? null,
        salary: clean(j.compensation?.compensationTierSummary) || null,
        descriptionHtml: html,
        descriptionText: toText(html),
        applyUrl: j.jobUrl,
        postedAt: date(j.publishedAt),
      };
    });
}

function workable(body: any): Posting[] {
  return (body.jobs ?? []).map((j: any): Posting => {
    const html = sanitize(j.description ?? '');
    const locations = (j.locations?.length ? j.locations : [j])
      .map((l: any) => [l.city, l.country].filter(Boolean).join(', '))
      .filter(Boolean);
    return {
      externalId: String(j.shortcode),
      title: clean(j.title),
      department: clean(j.department) || null,
      location: clean([...new Set(locations)].join(' · ')),
      workplace: j.telecommuting ? 'remote' : null,
      employmentType: clean(j.employment_type) || null,
      salary: null,
      descriptionHtml: html,
      descriptionText: toText(html),
      applyUrl: j.url ?? j.shortlink,
      postedAt: date(j.published_on ?? j.created_at),
    };
  });
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Subdomain boards (Keka, Freshteam): one DNS label. */
const label = (board: string) => {
  if (!/^[a-z0-9-]{1,63}$/.test(board)) throw new BoardNotFoundError(`Invalid board "${board}"`);
  return board;
};

const KEKA_JOB_TYPES: Record<number, string> = { 1: 'Part-time', 2: 'Full-time' };

/** Keka: the JSON its careers page loads, every open job with its full description. */
async function keka(board: string): Promise<Posting[]> {
  const base = `https://${label(board)}.keka.com/careers`;
  const res = await fetch(`${base}/api/jobs/default/active`, {
    headers: { accept: 'application/json', 'user-agent': USER_AGENT },
    // Non-customers and disabled portals redirect to an error page.
    redirect: 'manual',
    signal: AbortSignal.timeout(60_000),
  });
  if (res.status !== 200 || !res.headers.get('content-type')?.includes('json')) {
    throw new BoardNotFoundError(`${base}: HTTP ${res.status}`);
  }
  const jobs = await res.json();
  if (!Array.isArray(jobs)) throw new BoardNotFoundError(`${base}: not a job list`);
  return jobs.map((j: any): Posting => {
    const html = sanitize(j.description ?? '');
    const places: string[] = (j.jobLocations ?? []).map((l: any) => clean(l.name || l.city)).filter(Boolean);
    return {
      externalId: String(j.id),
      title: clean(j.title),
      department: clean(j.departmentName) || null,
      location: [...new Set(places)].join(' · '),
      // Keka has no workplace field; remote roles list a location called "Remote".
      workplace: places.some((p) => /^remote$/i.test(p)) ? 'remote' : null,
      employmentType: KEKA_JOB_TYPES[j.jobType] ?? null,
      salary: null,
      descriptionHtml: html,
      descriptionText: toText(html),
      applyUrl: `${base}/jobdetails/${j.id}`,
      postedAt: date(j.publishedOn),
    };
  });
}

/** Detail pages fetched per sync: Freshteam and Zoho Recruit only give full descriptions per job. */
const DETAIL_PAGES_MAX = 60;

const SCHEMA_EMPLOYMENT: Record<string, string> = {
  FULL_TIME: 'Full-time',
  PART_TIME: 'Part-time',
  CONTRACTOR: 'Contract',
  TEMPORARY: 'Temporary',
  INTERN: 'Internship',
};

/**
 * Freshteam: the server-rendered /jobs page lists the openings, and each job's page carries a
 * schema.org JobPosting. (Its jobs.json widget is disallowed by robots.txt, so it isn't used.)
 */
async function freshteam(board: string, detailPages: number): Promise<Posting[]> {
  const origin = `https://${label(board)}.freshteam.com`;
  const page = await getPage(`${origin}/jobs`);
  // Non-customers get a small 404 page with status 200.
  if (page.includes('/src/404.css')) throw new BoardNotFoundError(`${origin}: no careers site`);

  const cards = new Map<string, { path: string; location: string | null; remote: boolean }>();
  for (const m of page.matchAll(/<a\b[^>]*href="(\/jobs\/([A-Za-z0-9_-]{8,20})\/[^"]*)"[^>]*>/g)) {
    const tag = m[0];
    const prev = cards.get(m[2]);
    const location = tag.match(/data-portal-location="([^"]*)"/)?.[1] ?? null;
    const remote = /data-portal-remote-location=("?)true\1/.test(tag);
    cards.set(m[2], { path: prev?.path ?? m[1], location: prev?.location ?? location, remote: prev?.remote || remote });
  }

  const out: Posting[] = [];
  for (const [id, card] of [...cards].slice(0, detailPages)) {
    const detail = await getPage(`${origin}${card.path}`).catch(() => null);
    const ld = detail?.match(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/)?.[1];
    let job: any = null;
    try {
      job = ld ? JSON.parse(ld) : null;
    } catch {
      job = null;
    }
    if (!job?.title) continue;
    const html = sanitize(decodeEntities(job.description ?? ''));
    const address = job.jobLocation?.address ?? {};
    const type = Array.isArray(job.employmentType) ? job.employmentType[0] : job.employmentType;
    out.push({
      externalId: id,
      title: clean(job.title),
      department: null,
      location: clean(card.location ?? [address.addressRegion, address.addressCountry].filter(Boolean).join(', ')),
      workplace: card.remote || job.jobLocationType === 'TELECOMMUTE' || job.remote === true ? 'remote' : null,
      employmentType: SCHEMA_EMPLOYMENT[type] ?? null,
      salary: null,
      descriptionHtml: html,
      descriptionText: toText(html),
      applyUrl: `${origin}${card.path}`,
      postedAt: date(job.datePosted),
    });
    await pause(250);
  }
  return out;
}

/**
 * The company a Keka or Zoho Recruit board says it belongs to, for discovery to check a guessed board
 * is the right company's (a Zoho subdomain is often another firm's, or a trial portal). Null when the
 * provider doesn't say.
 */
export async function boardOwner(provider: ListingProvider, board: string): Promise<string | null> {
  if (provider === 'keka') {
    const info = await getJson(`https://${label(board)}.keka.com/careers/api/organization/default/careerportalinfo`);
    return clean(info?.name) || null;
  }
  if (provider === 'zohorecruit' && /^[a-z0-9-]{1,63}\.zohorecruit\.(in|com)$/.test(board)) {
    const page = await getPage(`https://${board}/jobs/Careers`);
    const raw = page.match(/<input[^>]*value="([^"]*)"[^>]*id="meta"/)?.[1];
    return raw ? clean(JSON.parse(decodeEntities(raw))?.org_info?.company_name) || null : null;
  }
  return null;
}

/** A JavaScript single-quoted string literal's contents, unescaped. */
function jsUnescape(s: string): string {
  return s.replace(/\\(x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4}|[\s\S])/g, (_, e: string) => {
    if (e.length > 1) return String.fromCharCode(parseInt(e.slice(1), 16));
    return ({ n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v', '0': '\0' } as Record<string, string>)[e] ?? e;
  });
}

/**
 * Zoho Recruit (board = "acme.zohorecruit.in" or ".com", separate data centres): the careers page
 * embeds every opening as JSON with a shortened description; each job's page has the full one.
 */
async function zohoRecruit(board: string, detailPages: number): Promise<Posting[]> {
  if (!/^[a-z0-9-]{1,63}\.zohorecruit\.(in|com)$/.test(board)) throw new BoardNotFoundError(`Invalid board "${board}"`);
  const origin = `https://${board}`;
  const page = await getPage(`${origin}/jobs/Careers`);
  const raw = page.match(/<input[^>]*value="([^"]*)"[^>]*id="jobs"/)?.[1];
  // Non-customers get an error page without the jobs field.
  if (raw === undefined) throw new BoardNotFoundError(`${origin}: no careers site`);
  const jobs: any[] = JSON.parse(decodeEntities(raw));

  const out: Posting[] = [];
  for (const [i, j] of jobs.entries()) {
    const url = `${origin}/jobs/Careers/${encodeURIComponent(j.id)}?source=CareerSite`;
    let description: string = j.Job_Description ?? '';
    if (i < detailPages) {
      const detail = await getPage(url).catch(() => null);
      const literal = detail?.match(/var jobs = JSON\.parse\('((?:\\.|[^'\\])*)'\)/)?.[1];
      try {
        if (literal) description = JSON.parse(jsUnescape(literal))[0]?.Job_Description ?? description;
      } catch {
        // Keep the short description from the list.
      }
      await pause(250);
    }
    const html = sanitize(description);
    out.push({
      externalId: String(j.id),
      title: clean(j.Posting_Title ?? j.Job_Opening_Name),
      department: clean(j.Industry) || null,
      location: clean([j.City, j.State, j.Country ?? j.Country1].filter(Boolean).join(', ')),
      workplace: j.Remote_Job === true ? 'remote' : null,
      employmentType: clean(j.Job_Type) || null,
      salary: j.Salary ? clean(`${j.Currency ?? ''} ${j.Salary}`) : null,
      descriptionHtml: html,
      descriptionText: toText(html),
      applyUrl: url,
      postedAt: date(j.Date_Opened),
    });
  }
  return out;
}

/** Himalayas pages its search 20 at a time; this caps a sync at a few thousand jobs. */
const HIMALAYAS_MAX_PAGES = 200;

/** Remote jobs open to people in India, and worldwide ones. */
async function himalayas(): Promise<Posting[]> {
  const out: Posting[] = [];
  for (let page = 1; page <= HIMALAYAS_MAX_PAGES; page++) {
    const body = await getJson(`https://himalayas.app/jobs/api/search?country=India&worldwide=true&page=${page}`);
    const jobs: any[] = body.jobs ?? [];
    for (const j of jobs) {
      const html = sanitize(j.description ?? '');
      const salary =
        j.minSalary && j.currency
          ? `${j.currency} ${Number(j.minSalary).toLocaleString('en-US')}${j.maxSalary && j.maxSalary !== j.minSalary ? `–${Number(j.maxSalary).toLocaleString('en-US')}` : ''}${j.salaryPeriod ? ` ${j.salaryPeriod}` : ''}`
          : null;
      out.push({
        externalId: String(j.guid ?? j.applicationLink),
        title: clean(j.title),
        department: clean(j.parentCategories?.[0]) || null,
        location: j.locationRestrictions?.length ? clean(j.locationRestrictions.join(', ')) : 'Worldwide',
        workplace: 'remote',
        employmentType: clean(j.employmentType) || null,
        salary,
        descriptionHtml: html,
        descriptionText: toText(html),
        applyUrl: j.applicationLink,
        postedAt: typeof j.pubDate === 'number' ? new Date(j.pubDate * 1000) : null,
        company: companyName(j.companyName),
        companyLogo: j.companyLogo || null,
      });
    }
    // Pages can come back a job or two short, so stop on an empty page or past the total.
    if (!jobs.length || page * 20 >= (body.totalCount ?? 0)) break;
    await pause(400);
  }
  return out;
}

function remoteok(body: any): Posting[] {
  // The first element is the API's legal notice.
  return (Array.isArray(body) ? body : []).filter((j: any) => j.id && j.position).map((j: any): Posting => {
    const html = sanitize(j.description ?? '');
    return {
      externalId: String(j.id),
      title: clean(j.position),
      department: null,
      location: clean(j.location) || 'Worldwide',
      workplace: 'remote',
      employmentType: null,
      salary: j.salary_min ? `USD ${Number(j.salary_min).toLocaleString('en-US')}${j.salary_max > j.salary_min ? `–${Number(j.salary_max).toLocaleString('en-US')}` : ''} yearly` : null,
      descriptionHtml: html,
      descriptionText: toText(html),
      applyUrl: j.url,
      postedAt: date(j.date),
      company: companyName(j.company),
      companyLogo: j.company_logo || j.logo || null,
    };
  });
}

const JOBICY_MAX_PAGES = 5;

async function jobicy(): Promise<Posting[]> {
  const out: Posting[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < JOBICY_MAX_PAGES; page++) {
    const body = await getJson(`https://jobicy.com/api/v2/remote-jobs?count=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
    for (const j of body.jobs ?? []) {
      const html = sanitize(j.jobDescription ?? '');
      out.push({
        externalId: String(j.id),
        title: clean(decodeEntities(j.jobTitle ?? '')),
        department: clean(j.jobIndustry?.[0] ? decodeEntities(j.jobIndustry[0]) : '') || null,
        location: clean(j.jobGeo) || 'Worldwide',
        workplace: 'remote',
        employmentType: clean(j.jobType?.[0]) || null,
        salary: j.salaryMin && j.salaryCurrency ? `${j.salaryCurrency} ${Number(j.salaryMin).toLocaleString('en-US')}${j.salaryMax > j.salaryMin ? `–${Number(j.salaryMax).toLocaleString('en-US')}` : ''}${j.salaryPeriod ? ` ${j.salaryPeriod}` : ''}` : null,
        descriptionHtml: html,
        descriptionText: toText(html),
        applyUrl: j.url,
        postedAt: date(j.pubDate),
        company: companyName(decodeEntities(j.companyName ?? '')),
        companyLogo: j.companyLogo || null,
      });
    }
    if (!body.hasMore || !body.nextCursor) break;
    cursor = body.nextCursor;
    await pause(1000);
  }
  return out;
}

function salaryRange(r: any): string | null {
  if (!r || typeof r.min !== 'number') return null;
  const fmt = (n: number) => n.toLocaleString('en-US');
  const range = r.max && r.max !== r.min ? `${fmt(r.min)}–${fmt(r.max)}` : fmt(r.min);
  const interval = typeof r.interval === 'string' ? ` ${r.interval.replace(/-/g, ' ')}` : '';
  return `${r.currency ?? ''} ${range}${interval}`.trim();
}

/** Keeps formatting and links only: postings come from third parties and are rendered on our site. */
export function sanitize(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: ['p', 'div', 'br', 'ul', 'ol', 'li', 'strong', 'b', 'em', 'i', 'u', 'h2', 'h3', 'h4', 'blockquote', 'a'],
    // target and rel are set by the transform below, not taken from the source.
    allowedAttributes: { a: ['href', 'target', 'rel'] },
    allowedSchemes: ['http', 'https', 'mailto'],
    transformTags: {
      h1: 'h2',
      h5: 'h4',
      h6: 'h4',
      a: sanitizeHtml.simpleTransform('a', { target: '_blank', rel: 'noopener noreferrer nofollow' }),
    },
    // Ashby pads with empty `<p style="min-height:1.5em"></p>` spacers.
    exclusiveFilter: (frame) => frame.tag === 'p' && !frame.text.trim(),
  }).slice(0, MAX_DESCRIPTION_CHARS);
}

/** Plain text of sanitised HTML, for search and (later) the model. */
export function toText(html: string): string {
  const text = sanitizeHtml(html.replace(/<\/(p|div|li|h[2-4]|blockquote)>|<br\s*\/?>/g, '$&\n'), {
    allowedTags: [],
    allowedAttributes: {},
  });
  return decodeEntities(text).replace(/[ \t ]+/g, ' ').replace(/\n\s*\n+/g, '\n\n').trim();
}

export function decodeEntities(s: string): string {
  const char = (code: number) => (code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '');
  return s
    .replace(/&#(\d+);/g, (_, n) => char(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => char(parseInt(n, 16)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/** Company names as posted to remote boards, without registration details ("Acme Ltd. Company No. 123, VAT …"). */
export const companyName = (s: unknown) => clean(s).split(/,|\s+(?:company|registration|reg\.?) no\b/i)[0].slice(0, 80).trim();

const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export const clean = (s: unknown) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim() : '');

export function date(s: unknown): Date | null {
  if (typeof s !== 'string') return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}
