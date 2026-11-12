import { robotsAllows, type ListingProvider } from '@parakeet/shared';
import { companyDomain, interestingLinks, sitePage } from '../contacts.js';

// A company's job board, read off its own website: the "Careers" link on its home page (or its
// careers page) points at the board it really uses, e.g. jobs.lever.co/razorpay. Guessing slugs from
// the name (queues/discovery.ts) misses companies whose board has another name, or runs on a provider
// that isn't guessed. A few pages are read, within the site's robots.txt, through the same
// public-address-only client as contact lookups (contacts.ts).

export interface BoardLink {
  provider: ListingProvider;
  board: string;
}

const PATHS = ['/', '/careers', '/careers/', '/jobs', '/join-us', '/work-with-us', '/about/careers', '/company/careers'];
const MAX_PAGES = 6;

/** The board an ATS link points at, in the form boards.ts reads, or null for any other link. */
export function boardFromUrl(raw: string): BoardLink | null {
  let url: URL;
  try {
    url = new URL(raw.replace(/&amp;/g, '&'));
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  const first = url.pathname.split('/').filter(Boolean)[0] ?? '';
  const slug = (s: string) => (/^[A-Za-z0-9][A-Za-z0-9_-]{1,80}$/.test(s) ? s : null);
  let m: RegExpExecArray | null;

  if (/^(boards|job-boards)\.greenhouse\.io$/.test(host)) {
    const embedded = url.searchParams.get('for');
    const s = slug(first === 'embed' ? (embedded ?? '') : first);
    return s ? { provider: 'greenhouse', board: s.toLowerCase() } : null;
  }
  if (host === 'jobs.lever.co') return slug(first) ? { provider: 'lever', board: first.toLowerCase() } : null;
  if (host === 'jobs.ashbyhq.com') return slug(first) ? { provider: 'ashby', board: first } : null;
  if (host === 'apply.workable.com') return slug(first) && first !== 'api' ? { provider: 'workable', board: first.toLowerCase() } : null;
  if ((m = /^([a-z0-9-]+)\.workable\.com$/.exec(host)) && !['www', 'apply', 'jobs'].includes(m[1])) return { provider: 'workable', board: m[1] };
  if (/^(careers|jobs)\.smartrecruiters\.com$/.test(host)) return slug(first) ? { provider: 'smartrecruiters', board: first } : null;
  if ((m = /^([a-z0-9-]+)\.(wd\d{1,3})\.myworkdayjobs\.com$/.exec(host))) {
    // /en-US/<site>/… or /<site>/…
    const parts = url.pathname.split('/').filter(Boolean);
    const site = /^[a-z]{2}-[A-Z]{2}$/.test(parts[0] ?? '') ? parts[1] : parts[0];
    return site && slug(site) ? { provider: 'workday', board: `${m[1]}.${m[2]}/${site}` } : null;
  }
  // Teamtailor careers sites on its own domain (careers sites on a company's domain aren't recognisable by URL).
  if ((m = /^([a-z0-9-]+)\.teamtailor\.com$/.exec(host)) && !['www', 'app', 'support', 'api', 'docs'].includes(m[1])) {
    return { provider: 'teamtailor', board: host };
  }
  if ((m = /^([a-z0-9-]+)\.keka\.com$/.exec(host)) && url.pathname.startsWith('/careers')) return { provider: 'keka', board: m[1] };
  if ((m = /^([a-z0-9-]+)\.freshteam\.com$/.exec(host))) return { provider: 'freshteam', board: m[1] };
  if ((m = /^([a-z0-9-]+)\.zohorecruit\.(in|com)$/.exec(host))) return { provider: 'zohorecruit', board: `${m[1]}.zohorecruit.${m[2]}` };
  return null;
}

/** Every ATS board linked from a page (links, iframes, scripts that embed a board). */
export function boardsInPage(html: string): BoardLink[] {
  const urls = html.match(/https?:\/\/[a-z0-9.-]+\.(?:greenhouse\.io|lever\.co|ashbyhq\.com|workable\.com|smartrecruiters\.com|teamtailor\.com|myworkdayjobs\.com|keka\.com|freshteam\.com|zohorecruit\.(?:in|com))[^\s"'<>)]*/gi) ?? [];
  const seen = new Set<string>();
  const out: BoardLink[] = [];
  for (const u of urls) {
    const b = boardFromUrl(u);
    if (b && !seen.has(`${b.provider}:${b.board}`)) {
      seen.add(`${b.provider}:${b.board}`);
      out.push(b);
    }
  }
  return out;
}

/**
 * A Teamtailor careers site on the company's own domain (careers.acme.com): the page is served by
 * Teamtailor (its CDN or generator tag), and its feed is at the same host. Only for the page's own host.
 */
export function teamtailorSite(html: string, url: URL): BoardLink[] {
  if (!/teamtailor-cdn\.com|<meta[^>]+content="Teamtailor"|assets\.teamtailor/i.test(html)) return [];
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(url.hostname) ? [{ provider: 'teamtailor', board: url.hostname.toLowerCase() }] : [];
}

/**
 * The job boards a company's website links to, most linked first. Empty when the site can't be read or
 * links to none we can read. Never throws.
 */
export async function careersBoards(website: string | null): Promise<BoardLink[]> {
  const domain = companyDomain(website);
  if (!domain) return [];
  const counts = new Map<string, { link: BoardLink; n: number }>();
  try {
    const base = new URL(`https://${domain}/`);
    const robots = (await sitePage(new URL('/robots.txt', base), domain).catch(() => null)) ?? '';
    const queue = PATHS.map((p) => new URL(p, base).toString());
    const seen = new Set<string>();
    while (queue.length && seen.size < MAX_PAGES) {
      const url = new URL(queue.shift()!);
      url.hash = '';
      if (seen.has(url.toString()) || !robotsAllows(robots, 'FridayJobs', url.pathname)) continue;
      seen.add(url.toString());
      const html = await sitePage(url, domain).catch(() => null);
      if (!html) continue;
      for (const link of [...boardsInPage(html), ...teamtailorSite(html, url)]) {
        const key = `${link.provider}:${link.board}`;
        counts.set(key, { link, n: (counts.get(key)?.n ?? 0) + 1 });
      }
      if (counts.size) break;
      // The home page's careers link (careers.acme.com counts as the company's site too).
      if (url.pathname === '/') queue.unshift(...interestingLinks(html, url, domain).filter((l) => /career|job|join|hiring/i.test(l)).slice(0, 4));
    }
  } catch (err) {
    console.warn(`[careers] ${domain}:`, (err as Error).message);
  }
  return [...counts.values()].sort((a, b) => b.n - a.n).map((c) => c.link);
}
