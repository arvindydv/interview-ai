import type { ListingProvider, Workplace } from './listings.js';

// What a listing is and who can take it: tech relevance (from the title), eligibility for candidates in
// India (from the location and workplace), and a canonical apply URL for spotting the same posting
// across sources. Computed at ingestion (apps/worker/src/queues/listings.ts) and stored on the listing
// (job_listings.tech_category, .eligibility, .canonical_url) so analytics and filters can use them.

export const TECH_CATEGORIES = [
  { id: 'ml_ai', label: 'AI / ML / LLM' },
  { id: 'data_engineering', label: 'Data engineering' },
  { id: 'data_science', label: 'Data science & analytics' },
  { id: 'security', label: 'Cybersecurity' },
  { id: 'qa', label: 'QA & test automation' },
  { id: 'devops', label: 'DevOps, cloud, SRE, platform' },
  { id: 'mobile', label: 'Mobile' },
  { id: 'fullstack', label: 'Full stack' },
  { id: 'frontend', label: 'Frontend' },
  { id: 'backend', label: 'Backend' },
  { id: 'product_engineering', label: 'Product engineering' },
  { id: 'software', label: 'Software engineering' },
] as const;
export type TechCategory = (typeof TECH_CATEGORIES)[number]['id'];

/** The person builds or runs technology; "Engineer" alone isn't enough (mechanical, sales, design engineers). */
const ROLE = String.raw`(engineers?|engineering|developers?|development|dev|scientists?|researchers?|architects?|programmers?|sdet)`;

// Most specific first: "Software Engineer, Machine Learning" is an ML job, "Data Engineer (Python)" a
// data engineering one.
const CATEGORY_RULES: [TechCategory, RegExp][] = [
  ['ml_ai', new RegExp(String.raw`\b(machine learning|ml|ai|artificial intelligence|llms?|gen ?ai|generative ai|deep learning|nlp|computer vision|mlops|ml ?ops|applied scientist|research (scientist|engineer)|ai\/ml|ml\/ai|prompt engineer)\b.*\b${ROLE}\b|\b${ROLE}\b.*\b(machine learning|ml|ai|llms?|gen ?ai|nlp|computer vision|mlops)\b|\b(applied scientist|research staff|member of technical staff.*\b(ai|ml|llm)|mlops|ai engineer|ml engineer|llm engineer)\b`)],
  ['data_engineering', /\b(data (engineer|engineering|platform|warehouse|architect|pipeline|infrastructure)|etl|elt|big data|analytics engineer|dbt|databricks|snowflake|spark|kafka|hadoop|airflow) ?(engineer|developer|architect|specialist|lead)?\b/],
  ['data_science', /\b(data scien(ce|tist)|data analy(st|sis|tics)|business intelligence|bi (developer|analyst|engineer)|power ?bi|tableau|quantitative (analyst|researcher|developer)|statistician|decision scientist|product analyst|analytics analyst|business analytics|analytics (lead|manager|specialist|consultant))\b/],
  ['security', /\b(security|cyber ?security|infosec|appsec|devsecops|penetration|pen ?test|soc (analyst|engineer)|threat|vulnerability|iam|identity and access|detection) ?(engineer|analyst|architect|specialist|researcher|consultant|lead|tester|operations)?\b/],
  ['qa', /\b(qa|quality assurance|sdet|test(ing)? (engineer|automation|analyst|lead|architect|specialist)|automation (test|tester|qa|engineer)|software (development )?engineer in test|manual tester|tester)\b/],
  ['devops', /\b(dev ?ops|site reliability|sre|platform engineer(ing)?|cloud (engineer|architect|developer|ops|infrastructure|consultant|administrator)|infrastructure engineer|kubernetes|k8s|aws (engineer|developer|architect)|azure (engineer|developer|architect|devops)|gcp (engineer|architect)|release engineer|build engineer|production engineer|systems reliability)\b/],
  ['mobile', /\b(android|ios|mobile (engineer|developer|app)|flutter|react native|swift(ui)? developer|kotlin developer)\b/],
  ['fullstack', /\b(full[- ]?stack|mern|mean stack)\b/],
  ['frontend', /\b(front[- ]?end|ui (engineer|developer)|react(\.?js)?|angular(\.?js)?|vue(\.?js)?|next\.?js|web developer|javascript developer|typescript developer)\b/],
  ['backend', /\b(back[- ]?end|node(\.?js)?|java|python|golang|go (engineer|developer)|ruby|rails|php|laravel|\.net|dotnet|c#|django|spring( boot)?|api (engineer|developer)|scala|rust|elixir|c\+\+ (engineer|developer))\b/],
  ['product_engineering', /\bproduct engineer(ing)?\b/],
  ['software', /\b(software|sde|swe|sdet|mts|member of technical staff|founding engineer|forward deployed|research engineer|microservices engineer|staff engineer|principal engineer|application developer|applications? engineer|programmer|technical architect|solutions? architect|engineering manager|tech lead|technical lead|firmware|embedded software|developer)\b/],
];

/** Not tech jobs, unless the title is also plainly a tech role (`QA Engineer - Digital Marketing`). */
const NOT_TECH =
  /\b(sales|account (executive|manager|director)|business development|recruit(er|ing|ment)|talent acquisition|marketing|payroll|accountant|accounting|finance manager|legal|counsel|paralegal|human resources|hr (business partner|generalist|manager)|people (partner|operations)|customer success|customer support|support (agent|associate)|housekeeping|nurse|physician|doctor|cardiolog|pharmacist|teacher|driver|warehouse|retail|cashier|chef|cook|translator|copywriter|content writer|presales|pre-sales|product manager|program manager|project manager|governance|solutions? consultant|account engineer|sales engineer|solutions engineer)\b/;
/** A title that names a tech role outright, which a NOT_TECH word doesn't cancel. */
const PLAINLY_TECH =
  /\b(software (engineer|developer)|qa|sdet|data (scientist|engineer)|machine learning|ml engineer|devops|sre|site reliability|front[- ]?end|back[- ]?end|full[- ]?stack|security engineer|test automation)\b/;

const titleText = (title: string) =>
  ` ${title
    .normalize('NFKD')
    .toLowerCase()
    .replace(/\bsr\.?\b/g, 'senior')
    .replace(/[_|/,()[\]–—-]+/g, ' ')
    .replace(/\s+/g, ' ')} `;

/** The kind of tech job a title is, or null when it isn't one of the tech roles Friday Jobs focuses on. */
export function techCategory(title: string): TechCategory | null {
  const t = titleText(title);
  if (NOT_TECH.test(t) && !PLAINLY_TECH.test(t)) return null;
  for (const [category, rule] of CATEGORY_RULES) if (rule.test(t)) return category;
  return null;
}

/**
 * Who can take the job, for candidates in India:
 * - india: on-site or hybrid in India; remote_india: remote within India;
 * - remote_global: remote anywhere (worldwide, global, anywhere);
 * - remote_apac: remote within APAC / Asia, which usually but not always includes India;
 * - remote_unspecified: "Remote" with no region (often the employer's own country);
 * - remote_other: remote but restricted to other countries; elsewhere: on-site outside India;
 * - unknown: no location given.
 */
export const ELIGIBILITIES = [
  'india', 'remote_india', 'remote_global', 'remote_apac', 'remote_unspecified', 'remote_other', 'elsewhere', 'unknown',
] as const;
export type Eligibility = (typeof ELIGIBILITIES)[number];

/** Open to candidates in India with no relocation abroad. APAC remote is "likely", so counted apart. */
export const INDIA_ELIGIBLE: ReadonlySet<Eligibility> = new Set(['india', 'remote_india', 'remote_global']);

const INDIA_PLACE =
  /\b(india|ind|bharat|bengaluru|bangalore|mumbai|bombay|delhi|new delhi|ncr|gurugram|gurgaon|noida|greater noida|pune|hyderabad|secunderabad|chennai|kolkata|ahmedabad|gandhinagar|jaipur|kochi|cochin|indore|chandigarh|mohali|coimbatore|thiruvananthapuram|trivandrum|mysore|mysuru|mangalore|mangaluru|nagpur|vadodara|surat|bhubaneswar|lucknow|visakhapatnam|vizag|goa|karnataka|karnātaka|maharashtra|telangana|tamil nadu|kerala|haryana|uttar pradesh|gujarat|west bengal|odisha|rajasthan|andhra pradesh|madhya pradesh|punjab)\b/;
const GLOBAL = /\b(worldwide|anywhere|global(ly)?|world ?wide|international|all countries|any location|earth)\b/;
const APAC = /\b(apac|apj|asia|asia pacific|asia-pacific|south asia|emea and apac|apac and emea)\b/;
const REMOTE = /\b(remote|work from home|wfh|telecommute|distributed|virtual)\b/;

export function eligibility(location: string, workplace: Workplace | null): Eligibility {
  const loc = ` ${location.normalize('NFKD').toLowerCase().replace(/[_|/,;·()[\]–—-]+/g, ' ').replace(/\s+/g, ' ')} `;
  const remote = workplace === 'remote' || REMOTE.test(loc);
  if (INDIA_PLACE.test(loc)) return remote && (workplace === 'remote' || !/\b(hybrid|on ?site|office)\b/.test(loc)) ? 'remote_india' : 'india';
  if (GLOBAL.test(loc)) return 'remote_global';
  if (!loc.trim()) return remote ? 'remote_unspecified' : 'unknown';
  if (remote && APAC.test(loc)) return 'remote_apac';
  if (remote) return /^ ?(remote|fully remote|100% remote|remote first|work from home|wfh)( only)? ?$/.test(loc) ? 'remote_unspecified' : 'remote_other';
  return 'elsewhere';
}

/** Query parameters that only say where a click came from. */
const TRACKING_PARAM =
  /^(utm_[a-z]+|gh_src|source|src|ref|referrer|referer|lever-source|lever-origin|lever-via|trk|trackingid|refid|iis|iisn|fbclid|gclid|msclkid|mc_cid|mc_eid|_hsenc|_hsmi|jobboard|ccuid|codes|mode)$/i;

/**
 * The apply URL without tracking parameters, fragments, trailing slashes or the provider's "apply"
 * step, so the same posting reached through two sources compares equal. Null for anything that isn't
 * an http(s) URL.
 */
export function canonicalUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  let host = url.hostname.toLowerCase().replace(/^www\./, '');
  if (host === 'job-boards.greenhouse.io' || host === 'job-boards.eu.greenhouse.io') host = 'boards.greenhouse.io';
  let path = url.pathname.replace(/\/+$/, '');
  if (host === 'jobs.lever.co') path = path.replace(/\/apply$/, '');
  if (host === 'jobs.ashbyhq.com') path = path.replace(/\/application$/, '');
  if (host.endsWith('.myworkdayjobs.com') || host.endsWith('.myworkdaysite.com')) path = path.replace(/^\/[a-z]{2}-[A-Z]{2}(?=\/)/, '').replace(/\/apply(\/.*)?$/, '');
  const params = [...url.searchParams].filter(([k]) => !TRACKING_PARAM.test(k)).sort(([a], [b]) => a.localeCompare(b));
  const query = params.length ? `?${new URLSearchParams(params)}` : '';
  return `https://${host}${path}${query}`;
}

// What each source's terms allow us to do with its jobs. Recorded so the pipeline and the jobs site
// respect them (attribution, apply links, AI use, closing rules), and so new sources are added with
// their terms checked. "documented" means a public, documented API meant for third-party use that is
// silent on the point; "explicit" means the terms say so; "agreement" means not without a written
// licence or partnership; "no" means prohibited; "unverified" means we couldn't confirm either way.
// Sources: docs/jobs-sources.md, checked 2026-11-10.

export type Permission = 'explicit' | 'documented' | 'agreement' | 'no' | 'unverified';

/** How a candidate applies to a source's jobs through Friday Jobs. */
export type ApplyMode =
  /** Link to the source's own page; nothing is submitted for the candidate. */
  | 'direct'
  /** Friday prepares truthful answers and documents; the candidate reviews and submits them. */
  | 'assisted'
  /** Friday submits through an ATS integration the employer authorised, with the candidate's consent. */
  | 'native';

export interface SourcePolicy {
  ingest: Permission;
  store: Permission;
  display: Permission;
  ai: Permission;
  /** Submitting applications for candidates through this source's systems. */
  autoApply: Permission;
  /** The credit and link the source asks for on every job, if any. */
  attribution: string | null;
  /** How applications to this source's jobs may go; 'native' needs the employer's own ATS key, which we don't hold. */
  applyModes: ApplyMode[];
  /** Kept off in production until the stated condition is met. */
  productionBlocked?: string;
  notes: string;
}

const EMPLOYER_BOARD: Omit<SourcePolicy, 'notes'> = {
  ingest: 'documented',
  store: 'documented',
  display: 'documented',
  ai: 'unverified',
  // The application endpoints of Greenhouse, Lever and Ashby need the employer's own API key.
  autoApply: 'agreement',
  attribution: null,
  applyModes: ['direct', 'assisted'],
};

export const SOURCE_POLICIES: Record<ListingProvider, SourcePolicy> = {
  greenhouse: { ...EMPLOYER_BOARD, notes: 'Job Board API (GET is public, meant for embedding careers pages). Application POST needs the employer\'s Job Board API key.' },
  lever: { ...EMPLOYER_BOARD, notes: 'Postings API (public GET). Applying through the API needs an employer-issued key.' },
  ashby: { ...EMPLOYER_BOARD, notes: 'Public job posting API. applicationForm.submit needs the employer\'s API key.' },
  workable: { ...EMPLOYER_BOARD, ingest: 'unverified', store: 'unverified', display: 'unverified', ai: 'no', notes: 'Widget endpoint the careers page loads is undocumented. Workable terms bar using its data to train AI that competes with Workable; matching/tailoring for a candidate is not training, but treat as unclear.' },
  smartrecruiters: { ...EMPLOYER_BOARD, notes: 'Public Posting API (no key), governed by the SAP API Policy; 10 requests/s, 8 concurrent. Application API needs a partner key and candidate consent steps.' },
  teamtailor: { ...EMPLOYER_BOARD, ai: 'explicit', notes: 'Careers-site RSS feed (<careers site>/jobs.rss, documented in Teamtailor\'s help centre; 100 a page, ?offset=). robots.txt Content-Signal: search=yes, ai-input=yes, ai-train=no.' },
  workday: { ...EMPLOYER_BOARD, ingest: 'agreement', store: 'unverified', display: 'unverified', productionBlocked: 'Workday\'s site terms prohibit robots and data extraction without written consent; the /wday/cxs JSON is not a published API. Needs a decision (or each employer\'s consent) before production.', notes: 'JSON the public career site loads; robots.txt allows the career-site pages but does not mention /wday/cxs.' },
  keka: { ...EMPLOYER_BOARD, ingest: 'unverified', store: 'unverified', display: 'unverified', notes: 'JSON the public careers page loads, within robots.txt. No published third-party terms.' },
  freshteam: { ...EMPLOYER_BOARD, ingest: 'unverified', store: 'unverified', display: 'unverified', notes: 'Server-rendered careers pages and schema.org JobPosting; jobs.json is robots-disallowed, so not used.' },
  zohorecruit: { ...EMPLOYER_BOARD, ingest: 'unverified', store: 'unverified', display: 'unverified', notes: 'Public careers page data, within robots.txt. No published third-party terms.' },
  himalayas: {
    ingest: 'explicit', store: 'explicit', display: 'explicit', ai: 'unverified', autoApply: 'no',
    attribution: 'Credit Himalayas with a link to the job on himalayas.app; apply via its link.',
    applyModes: ['direct'], notes: 'Public API (himalayas.app/docs/remote-jobs-api): commercial use allowed; cache but remove jobs once they expire; apply only via applicationLink; never pass jobs on to other boards, Google Jobs or LinkedIn. Keyless: shared allowance; free key 60/min, 10,000/day.',
  },
  remoteok: {
    ingest: 'explicit', store: 'unverified', display: 'explicit', ai: 'unverified', autoApply: 'no',
    attribution: 'Followed (not nofollow) link back to the job on Remote OK, naming Remote OK as the source; logo needs written permission.',
    applyModes: ['direct'], notes: 'Public JSON feed; first element is the legal notice.',
  },
  jobicy: {
    ingest: 'explicit', store: 'explicit', display: 'explicit', ai: 'explicit', autoApply: 'no',
    attribution: 'Credit Jobicy with a direct link; application buttons go to the job URL in the feed.',
    applyModes: ['direct'], notes: 'Public API (jobi.cy/apidocs): last 7 days, cursor pages of 100, poll at most hourly; close only on an explicit "closed" from /api/jobs/status.',
  },
  adzuna: {
    ingest: 'agreement', store: 'agreement', display: 'agreement', ai: 'unverified', autoApply: 'no',
    attribution: 'Adzuna credit and its tracked redirect link.',
    applyModes: ['direct'], productionBlocked: 'Commercial licence from Adzuna not yet confirmed (ADZUNA_SYNC_ENABLED stays false).',
    notes: 'Terms: commercial use allowed for a 14-day trial, then a licence agreement; label each job "Adzuna" linked to adzuna.in; delete all data on termination. Controlled probe done (apps/worker/test/adzuna.probe.ts).',
  },
  jooble: {
    ingest: 'documented', store: 'unverified', display: 'unverified', ai: 'unverified', autoApply: 'no',
    attribution: 'Jooble credit and its link.', applyModes: ['direct'],
    productionBlocked: 'No API terms found; site terms bar republication. Get partner terms in writing.',
    notes: 'Free key: 500 requests in its lifetime.',
  },
  jsearch: {
    ingest: 'documented', store: 'unverified', display: 'unverified', ai: 'unverified', autoApply: 'no',
    attribution: 'Credit the publisher shown ("via LinkedIn") and link to the posting.', applyModes: ['direct'],
    productionBlocked: 'Storage/redistribution terms unverified; upstream boards (LinkedIn, Indeed) bar republication.',
    notes: 'RapidAPI (OpenWeb Ninja). Google for Jobs results.',
  },
};

// GET /admin/jobs-analytics: what the listings pipeline collects and how healthy each source is.
// "New" counts come from job_source_runs: jobs a sync inserted, leaving out a source's first sync
// (a backfill), and counted after duplicate marking.

export interface SourceHealth {
  provider: ListingProvider;
  sources: number;
  enabled: number;
  open: number;
  unique: number;
  tech: number;
  techIndia: number;
  /** Genuinely new in the last 24 hours (not a backfill, not a duplicate). */
  new24h: number;
  newTechIndia24h: number;
  /** Unique tech jobs open to India that the employer published in the last 24 hours. */
  publishedTechIndia24h: number;
  runs24h: number;
  failedRuns24h: number;
  httpRequests24h: number;
  /** Sources whose last sync failed. */
  failing: number;
  lastSuccessAt: string | null;
  policy: SourcePolicy;
}

export interface ListingsAnalytics {
  generatedAt: string;
  totals: {
    collected: number;
    open: number;
    unique: number;
    duplicatePct: number;
    tech: number;
    techPct: number;
    techIndia: number;
    /** Open on the employer's own careers board (company ATS), not an aggregator. */
    directEmployer: number;
    expired7d: number;
    new24h: number;
    newTechIndia24h: number;
    publishedTechIndia24h: number;
    httpRequests24h: number;
    companies: number;
  };
  /** Genuinely new unique tech jobs open to India, per day (UTC), from sync runs. */
  newPerDay: DayCount[];
  byProvider: SourceHealth[];
  byCategory: { category: TechCategory; open: number; india: number }[];
  byEligibility: { eligibility: Eligibility; open: number }[];
  topCompanies: { company: string; techIndia: number; new7d: number }[];
  failures: { provider: ListingProvider; board: string; company: string; error: string; lastSyncedAt: string | null }[];
  /** Open unique tech jobs open to India, by how a candidate may apply. */
  applyModes: { direct: number; assisted: number; native: number };
  cost: {
    /** Monthly spend as configured (JOBS_INFRA_MONTHLY_USD, JOBS_API_MONTHLY_USD); null when not set. */
    infraMonthlyUsd: number | null;
    apiMonthlyUsd: number | null;
    /** Genuinely new unique tech jobs open to India over the last 30 days of runs. */
    newTechIndia30d: number;
    /** (infra + API monthly) / new tech-India jobs in 30 days × 1,000; null without a cost or jobs. */
    usdPer1000New: number | null;
  };
}

export interface DayCount {
  day: string;
  value: number;
}
