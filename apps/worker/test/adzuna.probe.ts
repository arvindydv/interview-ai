// Adzuna India coverage probe: how many fresh, relevant, new-to-us software jobs Adzuna would add a day.
// Read-only: it calls Adzuna's search API and reads job_listings / job_sources, writing nothing to the
// database. Every response is saved in the cache directory, so re-running the analysis makes no new
// calls, and calls.json there counts every call ever made: the probe never makes more than
// ADZUNA_PROBE_MAX_CALLS (default 20) in total, across runs. It stops at the first failed call.
//
//   cd apps/worker && node --env-file=.env --import tsx test/adzuna.probe.ts --plan   # lists the calls, makes none
//   cd apps/worker && node --env-file=.env --import tsx test/adzuna.probe.ts [cacheDir]
//
// Calls, in order: the last day's IT jobs (page 1, with their count), the IT counts over 7 and 30 days,
// one page for each role over the last day, then more pages of the last day's IT jobs until the cap.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import postgres from 'postgres';
import { dedupeKey, isAgency } from '@parakeet/shared';

const PLAN = process.argv.includes('--plan');
const APP_ID = process.env.ADZUNA_APP_ID;
const APP_KEY = process.env.ADZUNA_APP_KEY;
if (!PLAN && (!APP_ID || !APP_KEY || !process.env.DATABASE_URL)) {
  console.error('Set ADZUNA_APP_ID, ADZUNA_APP_KEY and DATABASE_URL.');
  process.exit(1);
}
const MAX_CALLS = Number(process.env.ADZUNA_PROBE_MAX_CALLS ?? 20);
const CACHE = resolve(process.argv.slice(2).find((a) => !a.startsWith('--')) ?? '.adzuna-probe');
mkdirSync(CACHE, { recursive: true });
/** The India IT category (Adzuna's tag in every country). */
const IT = 'it-jobs';

/** The roles asked about, each searched once over the last day. */
const ROLES = [
  'backend developer', 'full stack developer', 'react developer', 'node.js developer', 'python developer',
  'data engineer', 'ai engineer',
];

// Every call ever made from this cache directory, failed ones included (they may count against quota).
const LEDGER = join(CACHE, 'calls.json');
const ledger: { at: string; page: number; params: Record<string, string>; status: number }[] = existsSync(LEDGER)
  ? JSON.parse(readFileSync(LEDGER, 'utf8'))
  : [];
let calls = 0;
const planned: string[] = [];
const quotaHeaders: Record<string, string>[] = [];

/** One search, from the cache when this exact request was made before; null once the cap is reached. */
async function search(params: Record<string, string>, page = 1): Promise<any> {
  const path = `jobs/in/search/${page}`;
  const key = createHash('sha1').update(path + JSON.stringify(params)).digest('hex').slice(0, 16);
  const file = join(CACHE, `${key}.json`);
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8')).body;
  if (ledger.length >= MAX_CALLS) return null;
  if (PLAN) {
    planned.push(`${planned.length + 1}. page ${page} ${JSON.stringify(params)}`);
    ledger.push({ at: '', page, params, status: 0 });
    // A stand-in so the plan follows the same path a real run would (a full first page of IT jobs).
    return { count: 10_000, results: Array.from({ length: 50 }, () => ({})) };
  }
  if (calls) await new Promise((r) => setTimeout(r, 2_600)); // under 25 a minute
  calls++;
  const qs = new URLSearchParams({ app_id: APP_ID!, app_key: APP_KEY!, 'content-type': 'application/json', ...params });
  const res = await fetch(`https://api.adzuna.com/v1/api/${path}?${qs}`, { signal: AbortSignal.timeout(60_000) });
  ledger.push({ at: new Date().toISOString(), page, params, status: res.status });
  writeFileSync(LEDGER, JSON.stringify(ledger, null, 2));
  const limits = Object.fromEntries([...res.headers].filter(([h]) => /limit|quota|remaining|retry/i.test(h)));
  if (Object.keys(limits).length) quotaHeaders.push(limits);
  // No retries: a failed call is reported and the run stops.
  if (!res.ok) throw new Error(`${path} ${JSON.stringify(params)}: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
  const body = await res.json();
  writeFileSync(file, JSON.stringify({ path, params, page, at: new Date().toISOString(), body }));
  return body;
}

// Titles: software engineering (what the jobs site is for), other tech, and the rest.
const SWE =
  /\b(software|backend|back[- ]end|frontend|front[- ]end|full[- ]?stack|web|mobile|android|ios|flutter|react|angular|vue|node(\.?js)?|python|java|golang|go developer|\.net|dotnet|c#|php|laravel|django|ruby|rust|scala|kotlin|typescript|javascript|sde|developer|programmer|devops|sre|site reliability|cloud|platform|data engineer|ml|machine learning|ai\b|artificial intelligence|llm|gen ?ai|data scientist|mlops|qa automation|sdet|test automation|security engineer|embedded|firmware)\b/i;
const TECH_OTHER = /\b(qa|tester|testing|data analyst|bi\b|power bi|tableau|sap|salesforce|servicenow|it support|desktop support|network|system admin|sysadmin|dba|database|erp|technical support|it\b)\b/i;
const NOT_SWE = /\b(sales|business development|bde|marketing|recruiter|hr\b|telecaller|customer (care|support|service)|bpo|voice process|accountant|teacher|trainer|counsel+or|delivery|driver)\b/i;
const kind = (title: string) => (NOT_SWE.test(title) ? 'non-tech' : SWE.test(title) ? 'swe' : TECH_OTHER.test(title) ? 'tech-other' : 'non-tech');
const ROLE_TEST: Record<string, RegExp> = {
  backend: /\b(backend|back[- ]end|server[- ]side|api developer)\b/i,
  'full stack': /\bfull[- ]?stack\b/i,
  react: /\breact\b/i,
  'node.js': /\bnode(\.?js)?\b/i,
  python: /\b(python|django|flask|fastapi)\b/i,
  'data engineering': /\b(data engineer|etl|big data|spark|databricks|data platform)\b/i,
  'ai engineering': /\b(ai|ml|machine learning|gen ?ai|llm|deep learning|nlp|computer vision|mlops)\b/i,
};

interface Ad {
  id: string;
  title: string;
  company: string;
  location: string;
  created: string;
  url: string;
  description: string;
  category: string;
  from: string;
}
const toAd = (j: any, from: string): Ad => ({
  id: String(j.id),
  title: String(j.title ?? '').replace(/<[^>]*>/g, '').trim(),
  company: String(j.company?.display_name ?? '').trim(),
  location: String(j.location?.display_name ?? '').trim(),
  created: j.created,
  url: j.redirect_url,
  description: String(j.description ?? ''),
  category: j.category?.tag ?? '',
  from,
});

const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 1000) / 10}%` : '–');

async function main() {
  const ads: Ad[] = [];
  const counts: Record<string, number> = {};
  const itDay = { category: IT, max_days_old: '1', sort_by: 'date', results_per_page: '50' };
  let itPages = 0;
  const itPage = async (page: number) => {
    const b = await search(itDay, page);
    if (!b) return null;
    counts.it_1d = b.count;
    const got = (b.results ?? []).map((j: any) => toAd(j, 'it-1d'));
    ads.push(...got);
    itPages++;
    return got.length === 50 && page * 50 < b.count;
  };

  // 1. The last day's IT jobs, page 1: their count, and whether the category tag is right (no jobs:
  // the category phase is skipped rather than spending calls on it).
  let more = await itPage(1);
  const itWorks = (counts.it_1d ?? 0) > 0;

  // 2. IT counts over 7 and 30 days: a steadier daily rate than one day gives.
  if (itWorks) {
    for (const days of [7, 30]) {
      const b = await search({ category: IT, max_days_old: String(days), results_per_page: '1' });
      if (b) counts[`it_${days}d`] = b.count;
    }
  }

  // 3. Each role over the last day (one page each: its count, and 50 ads).
  for (const role of ROLES) {
    const b = await search({ what: role, max_days_old: '1', sort_by: 'date', results_per_page: '50' });
    if (!b) break;
    counts[`role:${role}`] = b.count;
    ads.push(...(b.results ?? []).map((j: any) => toAd(j, `role:${role}`)));
  }

  // 4. More of the last day's IT jobs, page by page, until done or the cap.
  for (let page = 2; itWorks && more; page++) more = await itPage(page);

  if (PLAN) {
    console.log(`Would make ${planned.length} calls (cap ${MAX_CALLS}, already made ${ledger.length - planned.length}):`);
    console.log(planned.join('\n'));
    return;
  }

  // ---- analysis ----
  const byId = new Map<string, Ad>();
  for (const a of ads) if (!byId.has(a.id)) byId.set(a.id, a);
  const unique = [...byId.values()];
  // "Last 24 hours" means before the probe's first call, so re-analysing the cache later gives the same sample.
  const now = ledger.length ? Date.parse(ledger[0].at) : Date.now();
  const fresh = unique.filter((a) => now - Date.parse(a.created) <= 24 * 3600_000);
  const byUrl = new Set(unique.map((a) => a.url.split('?')[0]));
  const keyed = new Map<string, Ad>();
  for (const a of unique) {
    const k = dedupeKey({ company: a.company || '?', title: a.title, location: a.location, workplace: null });
    if (k && !keyed.has(k)) keyed.set(k, a);
  }

  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  const rows = await sql<{ dedupe_key: string; src: string }[]>`
    select l.dedupe_key,
      case when s.origin = 'search' then s.provider when s.provider in ('himalayas','remoteok','jobicy') then 'remote-boards' else 'careers' end as src
    from public.job_listings l join public.job_sources s on s.id = l.source_id
    where l.dedupe_key is not null and (l.closed_at is null or l.closed_at > now() - interval '14 days')`;
  const crawled = new Set(
    (await sql<{ c: string }[]>`select lower(company) as c from public.job_sources where origin <> 'search'`).map((r) => r.c),
  );
  await sql.end();
  const inDb = new Map<string, Set<string>>();
  // Looser too: same company and title in any city (search engines often give a different city form).
  const looseOf = (k: string) => k.split('|').slice(0, 2).join('|');
  const inDbLoose = new Map<string, Set<string>>();
  for (const r of rows) {
    (inDb.get(r.dedupe_key) ?? inDb.set(r.dedupe_key, new Set()).get(r.dedupe_key)!).add(r.src);
    const l = looseOf(r.dedupe_key);
    (inDbLoose.get(l) ?? inDbLoose.set(l, new Set()).get(l)!).add(r.src);
  }

  const analyse = (list: [string, Ad][]) => {
    const overlap: Record<string, number> = {};
    let newExact = 0;
    let newLoose = 0;
    for (const [k] of list) {
      const hit = inDb.get(k);
      if (hit) for (const s of hit) overlap[s] = (overlap[s] ?? 0) + 1;
      else newExact++;
      if (!inDbLoose.get(looseOf(k))) newLoose++;
    }
    return { total: list.length, newExact, newLoose, overlap };
  };
  const all = [...keyed];
  const freshKeyed = all.filter(([, a]) => now - Date.parse(a.created) <= 24 * 3600_000);
  const kinds = { swe: 0, 'tech-other': 0, 'non-tech': 0 } as Record<string, number>;
  for (const [, a] of freshKeyed) kinds[kind(a.title)]++;
  const sweFresh = freshKeyed.filter(([, a]) => kind(a.title) === 'swe');
  const agency = sweFresh.filter(([, a]) => isAgency(a.company, a.description, true)).length;
  const undisclosed = sweFresh.filter(([, a]) => !a.company).length;
  const ownBoard = sweFresh.filter(([, a]) => crawled.has(a.company.toLowerCase())).length;
  const roleHits = Object.fromEntries(Object.entries(ROLE_TEST).map(([r, re]) => [r, sweFresh.filter(([, a]) => re.test(a.title)).length]));

  // Of the IT category's last day only (the full harvest), for the projection.
  const itOnly = freshKeyed.filter(([, a]) => a.from === 'it-1d');
  const itSwe = itOnly.filter(([, a]) => kind(a.title) === 'swe');
  const itSweNew = itSwe.filter(([k]) => !inDb.has(k));
  const itSweNewEmployer = itSweNew.filter(([, a]) => a.company && !isAgency(a.company, a.description, true));
  const harvested = itPages * 50;
  const scale = counts.it_1d && harvested < counts.it_1d ? counts.it_1d / Math.max(itOnly.length, 1) : 1;

  const report = {
    callsThisRun: calls,
    callsEver: ledger.length,
    callCap: MAX_CALLS,
    cacheDir: CACHE,
    itCategoryTags: [...new Set(unique.filter((a) => a.from === 'it-1d').map((a) => a.category))],
    quotaHeaders,
    adzunaCounts: counts,
    itPagesFetched: itPages,
    '1_fetched': { rows: ads.length, uniqueIds: unique.length, uniqueUrls: byUrl.size, uniqueJobs: keyed.size },
    '2_last24h': { uniqueIds: fresh.length, uniqueJobs: freshKeyed.length },
    '3_dedupe_vs_db_last24h': analyse(freshKeyed),
    '4_relevance_last24h': {
      ...kinds,
      swePct: pct(kinds.swe, freshKeyed.length),
      sweByRole: roleHits,
      sweAgency: agency,
      sweCompanyUndisclosed: undisclosed,
      sweFromCompaniesWeCrawl: ownBoard,
    },
    '5_new_beyond_jsearch_and_careers_swe_last24h': analyse(sweFresh),
    projection: {
      itJobsPerDay_adzuna: counts.it_1d,
      itJobsPerDay_7dAvg: counts.it_7d && Math.round(counts.it_7d / 7),
      itJobsPerDay_30dAvg: counts.it_30d && Math.round(counts.it_30d / 30),
      itSample: itOnly.length,
      sweShareOfIt: pct(itSwe.length, itOnly.length),
      sweNewShareOfIt: pct(itSweNew.length, itOnly.length),
      sweNewEmployerShareOfIt: pct(itSweNewEmployer.length, itOnly.length),
      projectedNewSwePerDay: Math.round(itSweNew.length * scale),
      projectedNewSweEmployerPerDay: Math.round(itSweNewEmployer.length * scale),
      callsPerDayToHarvest: counts.it_1d ? Math.ceil(counts.it_1d / 50) : null,
    },
  };
  writeFileSync(join(CACHE, 'report.json'), JSON.stringify(report, null, 2));
  writeFileSync(
    join(CACHE, 'swe-new-sample.tsv'),
    itSweNew.map(([, a]) => [a.created, a.company, a.title, a.location, a.url].join('\t')).join('\n'),
  );
  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
