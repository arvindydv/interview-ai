import { lookup, resolveMx } from 'node:dns/promises';
import { isIP } from 'node:net';
import { Agent, fetch as undiciFetch } from 'undici';
import {
  AGGREGATORS, GUESSED_MAILBOXES, hiringAddress, pageContacts, postingContacts, robotsAllows, type ColdEmailContact,
} from '@parakeet/shared';
import { sql } from './db.js';
import { env } from './env.js';

// Hiring contacts for cold email (packages/shared/src/coldEmail.ts), most reliable first:
//   1. hiring addresses in this job's posting, then in the company's other postings
//   2. the company's own website: home, careers, contact, about and team pages (found from its links
//      and sitemap), within its robots.txt, for the hiring addresses it publishes
//   3. Hunter.io, only when 1 and 2 found nothing and HUNTER_API_KEY is set (it's paid per search)
//   4. common hiring mailboxes (careers@, jobs@…) at a domain that takes email, marked as unverified
//      guesses, to make up FOUND_TARGET suggestions
// Every address is at the company's own domain, except a posting's (which the company wrote itself).
// Website, Hunter and guess results are cached a month per company (public.contact_lookups).

/** Results are reused for a month per company. */
const LOOKUP_DAYS = 30;

const AGENT = 'FridayJobs';
const USER_AGENT = `${AGENT}/1.0 (+https://friday-ai.in; finds the careers contact a company publishes)`;
/** Pages to try on a company's site, besides careers/contact/team links found on its home page. */
const SITE_PATHS = ['/', '/careers', '/jobs', '/contact', '/contact-us', '/about', '/about-us', '/team'];
const MAX_PAGES = 12;
/** Suggestions to offer: real ones first, topped up with guesses. */
const FOUND_TARGET = 4;
const MAX_PAGE_BYTES = 1_000_000;

const HIRING_POSITION = /recruit|talent|hiring|people|human resources|\bhr\b|staffing|acquisition/i;
const LEADER_POSITION = /founder|ceo|cto|chief|head of|vp|director|manager/i;

/**
 * Hosts where many companies have a page (careers sites, site builders, job boards): their domain
 * belongs to the host, so searching it would find the host's staff. Those companies are looked up by name.
 */
const SHARED_HOSTS = new RegExp(
  `(^|\\.)(${[
    // site builders and hosting
    'notion\\.site', 'notion\\.so', 'github\\.io', 'vercel\\.app', 'netlify\\.app', 'webflow\\.io', 'wixsite\\.com', 'carrd\\.co',
    'framer\\.(website|ai)', 'super\\.site', 'sites\\.google\\.com', 'google\\.com', 'medium\\.com', 'substack\\.com',
    // hiring software (ATS) and their careers sites
    'ashbyhq\\.com', 'lever\\.co', 'greenhouse\\.io', 'workable\\.com', 'smartrecruiters\\.com', 'myworkdayjobs\\.com', 'keka\\.com',
    'zohorecruit\\.(com|in)', 'freshteam\\.com', 'bamboohr\\.com', 'recruitee\\.com', 'breezy\\.hr', 'jobvite\\.com', 'icims\\.com',
    'teamtailor\\.com', 'personio\\.(de|com)', 'darwinbox\\.in', 'applytojob\\.com', 'jazzhr\\.com', 'rippling\\.com', 'gem\\.com',
    'pinpointhq\\.com', 'careers-page\\.com', 'hire\\.trakstar\\.com', 'successfactors\\.(com|eu)', 'taleo\\.net', 'oraclecloud\\.com',
    // job boards and aggregators
    'linkedin\\.com', 'indeed\\.com', 'naukri\\.com', 'foundit\\.in', 'monsterindia\\.com', 'glassdoor\\.(com|co\\.in)', 'wellfound\\.com',
    'angel\\.co', 'instahyre\\.com', 'iimjobs\\.com', 'hirist\\.(com|tech)', 'cutshort\\.io', 'internshala\\.com', 'adzuna\\.[a-z.]+',
    'jooble\\.org', 'careerjet\\.[a-z.]+', 'himalayas\\.app', 'remoteok\\.com', 'jobicy\\.com', 'ycombinator\\.com', 'workatastartup\\.com',
    'weworkremotely\\.com', 'remotive\\.com', 'shine\\.com', 'timesjobs\\.com', 'apna\\.co',
  ].join('|')})$`,
);

const VALID_EMAIL = /^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/;

/** The company's own domain from its website, or null when it's on a shared host. */
export function companyDomain(website: string | null) {
  const domain =
    website?.trim().toLowerCase().replace(/^https?:\/\//, '').split(/[/?#:]/)[0].replace(/^(www|careers|jobs|apply|hire|work|join)\./, '') || null;
  return domain && domain.includes('.') && !isIP(domain) && !SHARED_HOSTS.test(domain) ? domain : null;
}

async function cached(key: string): Promise<ColdEmailContact[] | null> {
  const [row] = await sql<{ contacts: ColdEmailContact[] }[]>`
    select contacts from public.contact_lookups
    where key = ${key} and looked_up_at > now() - make_interval(days => ${LOOKUP_DAYS})`;
  return row?.contacts ?? null;
}

async function remember(key: string, contacts: ColdEmailContact[]) {
  await sql`
    insert into public.contact_lookups (key, contacts) values (${key}, ${sql.json(contacts as never)})
    on conflict (key) do update set contacts = excluded.contacts, looked_up_at = now()`;
}

// --- 2. The company's website ---------------------------------------------------------------------

/** Loopback, private, link-local, carrier-grade NAT and other addresses that aren't the public internet. */
export function isPublicAddress(address: string) {
  const v4 = address.startsWith('::ffff:') ? address.slice(7) : address;
  if (isIP(v4) === 4) {
    const [a, b] = v4.split('.').map(Number);
    return !(
      a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224
    );
  }
  const v6 = address.toLowerCase();
  return !(v6 === '::' || v6 === '::1' || /^f[cd]/.test(v6) || /^fe[89ab]/.test(v6) || v6.startsWith('ff'));
}

/**
 * Connections only to public addresses, checked on the address actually connected to, so a company
 * website can't point the worker at Redis, the API or the cloud metadata service.
 */
const publicOnly = new Agent({
  connect: {
    lookup: (hostname, options, callback) => {
      lookup(hostname, { all: true }).then(
        (addresses) => {
          const ok = addresses.filter((a) => isPublicAddress(a.address));
          if (!ok.length) return callback(new Error(`${hostname} has no public address`), '', 4);
          if ((options as { all?: boolean }).all) return (callback as unknown as (e: null, a: typeof ok) => void)(null, ok);
          callback(null, ok[0].address, ok[0].family);
        },
        (err: Error) => callback(err as NodeJS.ErrnoException, '', 4),
      );
    },
  },
  headersTimeout: 8_000,
  bodyTimeout: 8_000,
});

/** A page on the company's own site as text, or null. Redirects are followed only within the site. */
export async function sitePage(url: URL, domain: string, types = /text\/(html|plain)/): Promise<string | null> {
  let current = url;
  for (let hop = 0; hop < 3; hop++) {
    const res = await undiciFetch(current, {
      dispatcher: publicOnly,
      redirect: 'manual',
      headers: { 'user-agent': USER_AGENT, accept: 'text/html,text/plain' },
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status >= 300 && res.status < 400) {
      const next = res.headers.get('location');
      await res.body?.cancel();
      if (!next) return null;
      current = new URL(next, current);
      const host = current.hostname.toLowerCase();
      if (!/^https?:$/.test(current.protocol) || !(host === domain || host.endsWith(`.${domain}`))) return null;
      continue;
    }
    const type = res.headers.get('content-type') ?? '';
    if (!res.ok || !types.test(type)) {
      await res.body?.cancel();
      return null;
    }
    // Read at most MAX_PAGE_BYTES: a company page, not a download.
    const reader = res.body!.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (size < MAX_PAGE_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      size += value.length;
    }
    await reader.cancel().catch(() => undefined);
    return Buffer.concat(chunks).toString('utf8');
  }
  return null;
}

const INTERESTING = /career|job|join|hiring|recruit|talent|contact|team|about|people|work-with-us/i;

/** Contact emails in a page's structured data (schema.org contactPoint), which sites keep current for search engines. */
function structuredEmails(html: string, domain: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/<script[^>]+type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    for (const e of m[1].matchAll(/"email"\s*:\s*"(?:mailto:)?([^"]+)"/gi)) out.push(e[1]);
  }
  return pageContacts(out.map((e) => `<p>${e}</p>`).join(''), domain);
}

/** Careers, jobs, contact and team pages listed in the site's sitemap. */
async function sitemapLinks(base: URL, domain: string, robots: string): Promise<string[]> {
  const listed = [...robots.matchAll(/^\s*sitemap\s*:\s*(\S+)/gim)].map((m) => m[1]);
  const xml = (await sitePage(new URL(listed[0] ?? '/sitemap.xml', base), domain, /xml|text/).catch(() => null)) ?? '';
  return [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)]
    .map((m) => m[1])
    .filter((u) => {
      try {
        const url = new URL(u);
        return (url.hostname === domain || url.hostname.endsWith(`.${domain}`)) && INTERESTING.test(url.pathname) && url.pathname.split('/').length <= 4;
      } catch {
        return false;
      }
    })
    .slice(0, 6);
}

/** Same-site links on the home page that look like careers, jobs, contact or team pages. */
export function interestingLinks(html: string, base: URL, domain: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/href\s*=\s*["']([^"'#]+)["']/gi)) {
    try {
      const url = new URL(m[1], base);
      const host = url.hostname.toLowerCase();
      if (/^https?:$/.test(url.protocol) && (host === domain || host.endsWith(`.${domain}`)) && INTERESTING.test(url.pathname)) {
        out.push(url.toString());
      }
    } catch {}
  }
  return [...new Set(out)];
}

/** Hiring addresses the company publishes on its own site, within its robots.txt. Never throws. */
async function websiteContacts(domain: string): Promise<ColdEmailContact[]> {
  const key = `site:${domain}`;
  const hit = await cached(key);
  if (hit) return hit;
  const found = new Set<string>();
  try {
    const base = new URL(`https://${domain}/`);
    const robots = (await sitePage(new URL('/robots.txt', base), domain).catch(() => null)) ?? '';
    const queue = [...SITE_PATHS.map((p) => new URL(p, base).toString()), ...(await sitemapLinks(base, domain, robots))];
    const seen = new Set<string>();
    while (queue.length && seen.size < MAX_PAGES) {
      const url = new URL(queue.shift()!);
      url.hash = '';
      if (seen.has(url.toString()) || !robotsAllows(robots, AGENT, url.pathname)) continue;
      seen.add(url.toString());
      const html = await sitePage(url, domain).catch(() => null);
      if (!html) continue;
      for (const email of [...pageContacts(html, domain), ...structuredEmails(html, domain)]) found.add(email);
      // Pages the home page links to come next: on most sites the careers page isn't at /careers.
      if (url.pathname === '/') queue.splice(1, 0, ...interestingLinks(html, url, domain).slice(0, 8));
    }
  } catch (err) {
    console.warn(`[contacts] website ${domain}:`, (err as Error).message);
  }
  const contacts = [...found]
    .sort((a, b) => mailboxRank(a) - mailboxRank(b))
    .map((email): ColdEmailContact => ({ email, name: null, position: null, source: 'website', confidence: null }));
  await remember(key, contacts);
  return contacts;
}

/** Hiring mailboxes before general ones (careers@ before hello@), people last. */
function mailboxRank(email: string) {
  const box = email.split('@')[0];
  if (/career|job|hiring|recruit|talent|apply|resume|\bcv\b/.test(box)) return 0;
  if (/^(hr|people)([._-]|$)/.test(box)) return 1;
  if (/^(hello|team|join|work)([._-]|$)/.test(box)) return 3;
  return 2;
}

// --- 3. Hunter.io (paid) --------------------------------------------------------------------------

interface HunterEmail {
  value: string;
  type: 'personal' | 'generic';
  confidence: number | null;
  first_name: string | null;
  last_name: string | null;
  position: string | null;
  department: string | null;
}

/** After Hunter says the key is bad or a limit is reached, it isn't asked again until then. */
let hunterPausedUntil = 0;

async function hunterSearch(params: Record<string, string>): Promise<HunterEmail[]> {
  const url = new URL('https://api.hunter.io/v2/domain-search');
  for (const [k, v] of Object.entries({ ...params, limit: '10', api_key: env.HUNTER_API_KEY! })) url.searchParams.set(k, v);
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  // 400: Hunter couldn't use the domain or company name. Nothing to find, and retrying won't change it.
  if (res.status === 400 || res.status === 404) return [];
  // 401: bad key. 403: too many requests a second. 429: the month's searches are used up.
  if (res.status === 401 || res.status === 403 || res.status === 429) {
    hunterPausedUntil = Date.now() + (res.status === 403 ? 60_000 : 3600_000);
    throw new Error(res.status === 401 ? 'Hunter refused the API key' : `Hunter limit reached (HTTP ${res.status})`);
  }
  if (!res.ok) throw new Error(`Hunter domain search: HTTP ${res.status}`);
  const body = (await res.json()) as { data?: { emails?: HunterEmail[] } };
  return body.data?.emails ?? [];
}

/** Recruiters first, then leaders, then shared mailboxes; more confident first within each. */
function rank(c: ColdEmailContact) {
  const role = HIRING_POSITION.test(c.position ?? '') ? 300 : LEADER_POSITION.test(c.position ?? '') ? 200 : c.name ? 100 : 0;
  return role + (c.confidence ?? 0);
}

/**
 * The company's recruiters (then founders and managers, who hire at small companies) from Hunter.
 * Empty when HUNTER_API_KEY isn't set or Hunter fails.
 */
async function hunterContacts(domain: string | null, company: string): Promise<ColdEmailContact[]> {
  if (!env.HUNTER_API_KEY || Date.now() < hunterPausedUntil) return [];
  const key = `hunter:${domain ?? `name:${company.toLowerCase()}`}`;
  const hit = await cached(key);
  if (hit) return hit;

  const target: Record<string, string> = domain ? { domain } : { company };
  let emails: HunterEmail[];
  try {
    emails = await hunterSearch({ ...target, department: 'hr' });
    if (!emails.some((e) => e.type === 'personal')) emails = [...emails, ...(await hunterSearch({ ...target, department: 'executive' }))];
  } catch (err) {
    console.warn(`[contacts] Hunter lookup for ${key} failed:`, (err as Error).message);
    return [];
  }
  const seen = new Set<string>();
  const contacts = emails
    .map((e) => ({ ...e, value: (e.value ?? '').trim().toLowerCase() }))
    // A person's address Hunter is fairly sure of, or a shared mailbox that takes applications (not support@, privacy@…).
    .filter((e) => VALID_EMAIL.test(e.value) && (e.confidence ?? 0) >= 50 && (e.type === 'personal' || hiringAddress(e.value) !== null))
    .filter((e) => !seen.has(e.value) && seen.add(e.value))
    .map((e): ColdEmailContact => ({
      email: e.value,
      name: [e.first_name, e.last_name].filter(Boolean).join(' ') || null,
      position: e.position,
      source: 'finder',
      confidence: e.confidence,
    }))
    .sort((a, b) => rank(b) - rank(a));
  await remember(key, contacts);
  return contacts;
}

// --- 4. Guesses -----------------------------------------------------------------------------------

/** Common hiring mailboxes at a domain that receives email (it has MX records). Never verified per address. */
async function guessedContacts(domain: string): Promise<ColdEmailContact[]> {
  const key = `guess:${domain}`;
  const hit = await cached(key);
  if (hit) return hit;
  // Only a domain that receives email (MX records, not a "null MX") gets guesses.
  const mx = await resolveMx(domain).catch(() => []);
  const contacts = mx.some((r) => r.exchange && r.exchange !== '.')
    ? GUESSED_MAILBOXES.map((m): ColdEmailContact => ({ email: `${m}@${domain}`, name: null, position: null, source: 'guess', confidence: null }))
    : [];
  await remember(key, contacts);
  return contacts;
}

/** Hiring addresses in the company's other open postings (newest first), at its own domain when it has one. */
async function otherPostings(company: string, domain: string | null, skip: string | null): Promise<string[]> {
  const rows = await sql<{ description: string }[]>`
    select l.description_text as description from public.job_listings l
    join public.job_sources s on s.id = l.source_id
    where l.closed_at is null and l.id is distinct from ${skip}
      and (lower(l.company) = lower(${company}) or (${domain}::text is not null and s.website = ${domain}))
      and l.description_text ~* '@[a-z0-9-]+\\.'
    order by l.posted_at desc nulls last limit 40`;
  return [...new Set(rows.flatMap((r) => postingContacts(r.description)))].filter(
    (e) => !domain || e.endsWith(`@${domain}`) || e.endsWith(`.${domain}`),
  );
}

/**
 * The company's own domain: its careers source's website, or, for a listing from a job board, the
 * website of a source we sync for the same company, or the apply link when it's on the company's site.
 */
export async function domainFor(company: string, website: string | null, applyUrl: string | null): Promise<string | null> {
  const own = companyDomain(website);
  if (own) return own;
  const [other] = await sql<{ website: string }[]>`
    select website from public.job_sources
    where lower(company) = lower(${company}) and website is not null and not (provider = any(${[...AGGREGATORS]}::text[]))
    limit 1`;
  if (other && companyDomain(other.website)) return companyDomain(other.website);
  try {
    const host = applyUrl ? new URL(applyUrl).hostname : null;
    // companyDomain() turns down job boards' and ATSs' own hosts: those say nothing about the company.
    const fromApply = companyDomain(host);
    if (fromApply) return fromApply;
  } catch {}
  return null;
}

/**
 * Everything found for a job's company, best first, without duplicates: the real ones, then guesses
 * to make up FOUND_TARGET. Never throws.
 */
export async function findContacts(job: {
  listingId: string | null;
  description: string;
  company: string;
  website: string | null;
  applyUrl: string | null;
}): Promise<ColdEmailContact[]> {
  const out: ColdEmailContact[] = [];
  const add = (more: ColdEmailContact[]) => out.push(...more.filter((m) => VALID_EMAIL.test(m.email) && !out.some((o) => o.email === m.email)));
  const posting = (email: string): ColdEmailContact => ({ email, name: null, position: null, source: 'posting', confidence: null });
  add(postingContacts(job.description).map(posting));
  try {
    const domain = await domainFor(job.company, job.website, job.applyUrl);
    add((await otherPostings(job.company, domain, job.listingId)).map(posting));
    if (domain) add(await websiteContacts(domain));
    if (!out.length) add(await hunterContacts(domain, job.company));
    if (out.length < FOUND_TARGET && domain) {
      // A guess for a mailbox that's already been found, at any of the company's domains, adds nothing.
      const have = new Set(out.map((c) => c.email.split('@')[0]));
      add((await guessedContacts(domain)).filter((g) => !have.has(g.email.split('@')[0])).slice(0, FOUND_TARGET - out.length));
    }
  } catch (err) {
    console.warn(`[contacts] ${job.company}:`, (err as Error).message);
  }
  return out.slice(0, 8);
}
