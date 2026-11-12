// Finds and verifies employers' job boards before they're added as sources. For each company website in
// the input file (one "Name<TAB>domain" per line), reads the careers link on the company's OWN site
// (listings/careersLink.ts, within its robots.txt) to the ATS board it uses: identifiers come from the
// employer, never guessed. Each board is then read once through its public API and counted: open
// jobs, tech jobs, and tech jobs open to candidates in India, and how many of those aren't already
// stored. Writes nothing to the database; prints JSON lines and a summary.
//
// With --probe, companies whose site links to no supported board are also looked up on each provider's
// official public API by slugs from their name and domain; a board counts only when the provider's own
// answer says whose it is (Greenhouse's board name, SmartRecruiters' company name) or, for Lever, Ashby
// and Workable, when its postings name the company's domain or name.
//
//   cd apps/worker && node --import tsx scripts/verify-boards.ts companies.tsv [--probe] > verified.jsonl
import { readFileSync } from 'node:fs';
import { INDIA_ELIGIBLE, canonicalUrl, dedupeKey, eligibility, techCategory, type ListingProvider } from '@parakeet/shared';
import { sql } from '../src/db.js';
import { fetchBoard } from '../src/listings/boards.js';
import { careersBoards } from '../src/listings/careersLink.js';
import { metered } from '../src/listings/http.js';

/** Providers we add from this tool: published or documented public APIs and feeds. Workday is left out (see SOURCE_POLICIES). */
const ALLOWED = new Set<ListingProvider>(['greenhouse', 'lever', 'ashby', 'smartrecruiters', 'workable', 'teamtailor']);

const PROBE_ONLY = process.argv.includes('--probe-only');
const PROBE = PROBE_ONLY || process.argv.includes('--probe');
const file = process.argv.slice(2).find((a) => !a.startsWith('--'));
if (!file) {
  console.error('usage: verify-boards.ts <companies.tsv>');
  process.exit(1);
}
const companies = readFileSync(file, 'utf8')
  .split('\n')
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith('#'))
  .map((l) => {
    const [name, domain] = l.split('\t');
    return { name: name.trim(), domain: domain.trim().toLowerCase() };
  });

const existing = await sql<{ provider: string; board: string; website: string | null }[]>`select provider, board, website from public.job_sources`;
const known = new Set(existing.map((s) => `${s.provider}:${s.board.toLowerCase()}`));
const knownSites = new Set(existing.map((s) => s.website?.toLowerCase()).filter(Boolean));
const stored = await sql<{ dedupe_key: string | null; canonical_url: string | null }[]>`
  select dedupe_key, canonical_url from public.job_listings where closed_at is null`;
const storedKeys = new Set(stored.map((s) => s.dedupe_key).filter(Boolean));
const storedUrls = new Set(stored.map((s) => s.canonical_url).filter(Boolean));

const squash = (s: string) =>
  s.toLowerCase().replace(/&/g, 'and').replace(/\b(pvt|private|ltd|limited|inc|llc|technologies|technology|software|solutions|india|group|global tech|r&d)\b\.?/g, '').replace(/[^a-z0-9]/g, '');

function slugsFor(name: string, domain: string): string[] {
  const words = name.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, ' ').trim();
  return [...new Set([words.replace(/ /g, ''), domain.split('.')[0], words.replace(/ /g, '-')])].filter((s) => /^[a-z0-9-]{2,60}$/.test(s));
}

async function getJson(url: string): Promise<any | null> {
  const res = await fetch(url, { headers: { accept: 'application/json', 'user-agent': 'FridayJobs/1.0 (job listings sync)' }, signal: AbortSignal.timeout(30_000) });
  return res.ok ? res.json() : null;
}

/** A board on a provider's public API that the provider's own data says is this company's. */
async function probeBoard(name: string, domain: string): Promise<{ provider: ListingProvider; board: string; proof: string } | null> {
  const want = squash(name);
  const label = domain.split('.')[0];
  const mentions = (text: string) => text.toLowerCase().includes(domain) || (want.length >= 4 && squash(text).includes(want));
  for (const slug of slugsFor(name, domain)) {
    const gh = await getJson(`https://boards-api.greenhouse.io/v1/boards/${slug}`).catch(() => null);
    if (gh?.name && (squash(gh.name) === want || squash(gh.name).startsWith(want) || want.startsWith(squash(gh.name)))) {
      return { provider: 'greenhouse', board: slug, proof: `Greenhouse board name "${gh.name}"` };
    }
    const sr = await getJson(`https://api.smartrecruiters.com/v1/companies/${slug}/postings?limit=1`).catch(() => null);
    const srName = sr?.content?.[0]?.company?.name;
    if (srName && (squash(srName) === want || squash(srName).startsWith(want))) {
      return { provider: 'smartrecruiters', board: slug, proof: `SmartRecruiters company "${srName}"` };
    }
    const lv = await getJson(`https://api.lever.co/v0/postings/${slug}?mode=json&limit=5`).catch(() => null);
    if (Array.isArray(lv) && lv.length && lv.some((j: any) => mentions(`${j.descriptionPlain ?? ''} ${j.additionalPlain ?? ''}`))) {
      return { provider: 'lever', board: slug, proof: 'Lever postings name the company' };
    }
    const ab = await getJson(`https://api.ashbyhq.com/posting-api/job-board/${slug}`).catch(() => null);
    if (ab?.jobs?.length && ab.jobs.slice(0, 5).some((j: any) => mentions(`${j.descriptionPlain ?? ''}`))) {
      return { provider: 'ashby', board: slug, proof: 'Ashby postings name the company' };
    }
    const wk = await getJson(`https://apply.workable.com/api/v1/widget/accounts/${slug}`).catch(() => null);
    if (wk?.jobs?.length && wk.name && (squash(wk.name) === want || squash(wk.name).startsWith(want)) && label) {
      return { provider: 'workable', board: slug, proof: `Workable account "${wk.name}"` };
    }
  }
  return null;
}

const pool = 4;
let next = 0;
const results: any[] = [];
async function worker() {
  while (next < companies.length) {
    const c = companies[next++];
    const out: any = { name: c.name, domain: c.domain };
    try {
      if (knownSites.has(c.domain)) out.alreadySource = true;
      const { result: links, requests: siteRequests } = PROBE_ONLY ? { result: [], requests: 0 } : await metered(() => careersBoards(c.domain));
      out.siteRequests = siteRequests;
      out.links = links;
      let link = links.find((l) => ALLOWED.has(l.provider));
      if (!link && PROBE) {
        const found = await probeBoard(c.name, c.domain);
        if (found) {
          out.proof = found.proof;
          link = { provider: found.provider, board: found.board };
        }
      }
      if (!link) {
        out.status = links.length ? `board on ${links.map((l) => l.provider).join(',')} (not added by this tool)` : 'no supported board linked';
      } else if (known.has(`${link.provider}:${link.board.toLowerCase()}`)) {
        out.status = 'already a source';
        out.board = link;
      } else {
        const { result: jobs, requests } = await metered(() => fetchBoard(link.provider, link.board));
        const tech = jobs.filter((j) => techCategory(j.title));
        const techIndia = tech.filter((j) => INDIA_ELIGIBLE.has(eligibility(j.location, j.workplace)));
        const fresh = techIndia.filter(
          (j) =>
            !storedUrls.has(canonicalUrl(j.applyUrl)) &&
            !storedKeys.has(dedupeKey({ company: c.name, title: j.title, location: j.location, workplace: j.workplace })),
        );
        Object.assign(out, {
          status: 'verified',
          board: link,
          requests,
          open: jobs.length,
          tech: tech.length,
          techIndia: techIndia.length,
          newTechIndia: fresh.length,
          techIndiaPosted7d: techIndia.filter((j) => j.postedAt && Date.now() - j.postedAt.getTime() < 7 * 86400_000).length,
          sampleTitles: techIndia.slice(0, 3).map((j) => `${j.title} | ${j.location}`),
        });
      }
    } catch (err) {
      out.status = `error: ${(err as Error).message}`;
    }
    results.push(out);
    console.log(JSON.stringify(out));
  }
}
await Promise.all(Array.from({ length: pool }, worker));
const verified = results.filter((r) => r.status === 'verified');
console.error(
  JSON.stringify({
    companies: companies.length,
    verified: verified.length,
    withTechIndia: verified.filter((r) => r.techIndia > 0).length,
    techIndia: verified.reduce((n, r) => n + r.techIndia, 0),
    newTechIndia: verified.reduce((n, r) => n + r.newTechIndia, 0),
    techIndiaPosted7d: verified.reduce((n, r) => n + r.techIndiaPosted7d, 0),
    requests: results.reduce((n, r) => n + (r.siteRequests ?? 0) + (r.requests ?? 0), 0),
  }),
);
await sql.end();
