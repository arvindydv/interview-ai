import type { ResumeProfile } from './profile.js';

// Friday Jobs listings: postings aggregated from companies' public job boards by apps/worker and
// served publicly by GET /v1/listings and GET /v1/listings/:id.

export const LISTING_PROVIDERS = [
  'greenhouse', 'lever', 'ashby', 'workable', 'smartrecruiters', 'workday', 'keka', 'freshteam', 'zohorecruit', 'himalayas',
  'remoteok', 'jobicy', 'adzuna', 'jooble',
] as const;
export type ListingProvider = (typeof LISTING_PROVIDERS)[number];

/**
 * Job boards that carry many companies' postings: remote-job boards (Himalayas, Remote OK, Jobicy) and
 * job search engines (Adzuna, Jooble). Their terms ask that each job credits them with a followed link,
 * and that applying goes through their link.
 */
export const AGGREGATOR_NAMES: Partial<Record<ListingProvider, string>> = {
  himalayas: 'Himalayas',
  remoteok: 'Remote OK',
  jobicy: 'Jobicy',
  adzuna: 'Adzuna',
  jooble: 'Jooble',
};
export const AGGREGATORS: ReadonlySet<ListingProvider> = new Set(Object.keys(AGGREGATOR_NAMES) as ListingProvider[]);

/** Each aggregator's home page, linked from its credit ("via Adzuna"). */
export const AGGREGATOR_SITES: Partial<Record<ListingProvider, string>> = {
  himalayas: 'https://himalayas.app',
  remoteok: 'https://remoteok.com',
  jobicy: 'https://jobicy.com',
  adzuna: 'https://www.adzuna.in',
  jooble: 'https://in.jooble.org',
};

/**
 * Job search engines, synced by searching (for the roles users want) rather than reading a whole
 * board. They only give a description excerpt, and a job missing from one sync isn't closed.
 */
export const SEARCH_PROVIDERS: ReadonlySet<ListingProvider> = new Set(['adzuna', 'jooble']);

export const WORKPLACES = ['remote', 'hybrid', 'onsite'] as const;
export type Workplace = (typeof WORKPLACES)[number];

export const WORKPLACE_LABELS: Record<Workplace, string> = {
  remote: 'Remote',
  hybrid: 'Hybrid',
  onsite: 'On-site',
};

export const LISTING_LIMITS = {
  pageSize: 20,
  maxQueryChars: 200,
  /** Pages beyond this aren't served; narrow the search instead. */
  maxPage: 50,
} as const;

/** Query string of GET /v1/listings. */
export interface ListingQuery {
  /** Full-text search over title, company, department, location and description. */
  q?: string;
  /** Substring of the location, e.g. "Bangalore" or "India". */
  location?: string;
  workplace?: Workplace;
  company?: string;
  page?: number;
}

export interface ListingSummary {
  id: string;
  title: string;
  company: string;
  department: string | null;
  location: string;
  workplace: Workplace | null;
  employmentType: string | null;
  salary: string | null;
  postedAt: string | null;
  /** The company's logo, when the source provides one. */
  companyLogo: string | null;
  /** The job board it came from ("Himalayas"), credited on the job; null for the company's own board. */
  via: string | null;
  /** The board's home page, for the credit link. */
  viaUrl: string | null;
  /** Where the board says the job was first posted, e.g. "naukri.com" (Jooble says; others don't). */
  postedOn: string | null;
  /** Posted by a recruitment agency or staffing firm rather than the employer (see isAgency). */
  agency: boolean;
}

export interface ListingDetail extends ListingSummary {
  /** Sanitised HTML (formatting tags and links only). */
  descriptionHtml: string;
  /** Only an excerpt: search engines don't give the full posting, which is on their page. */
  descriptionPartial: boolean;
  /** The company's own application page. */
  applyUrl: string;
  provider: ListingProvider;
  closed: boolean;
}

export interface ListingPage {
  items: ListingSummary[];
  total: number;
  page: number;
  pageSize: number;
}

/** GET /v1/listings/companies: companies with open listings, for the filter. */
export interface ListingCompany {
  company: string;
  open: number;
  /** e.g. "stripe.com", for the logo. */
  website: string | null;
}

// Signed-in Friday Jobs: listings matched to the user's resume and preferences (GET /v1/job-feed),
// and the jobs they save and apply to.

export const FEED_VIEWS = ['recommended', 'top', 'saved', 'applied', 'all'] as const;
export type FeedView = (typeof FEED_VIEWS)[number];

/** Seniority read from a listing's title (job_listings.level). */
export const LEVELS = [
  { id: 0, label: 'Internship' },
  { id: 1, label: 'Entry level' },
  { id: 2, label: 'Mid level' },
  { id: 3, label: 'Senior' },
  { id: 4, label: 'Lead / Staff / Manager' },
  { id: 5, label: 'Director & above' },
] as const;

/** Job types. Postings that don't say are counted as full-time, unless they are internships. */
export const JOB_TYPES = ['fulltime', 'parttime', 'internship', 'contract'] as const;
export type JobType = (typeof JOB_TYPES)[number];
export const JOB_TYPE_LABELS: Record<JobType, string> = {
  fulltime: 'Full-time',
  parttime: 'Part-time',
  internship: 'Internship',
  contract: 'Contract / temporary',
};

/** "Date posted" filter, in days. */
export const POSTED_WITHIN = [
  { days: 1, label: 'Past 24 hours' },
  { days: 3, label: 'Past 3 days' },
  { days: 7, label: 'Past week' },
  { days: 30, label: 'Past month' },
] as const;

/**
 * Where a job was found, for the platform filter. Company careers pages are the companies' own
 * boards (Greenhouse, Lever, Ashby, Workable, Keka, Freshteam, Zoho Recruit); Y Combinator is the
 * subset run by YC startups; the rest are job boards and search engines. A job found in several
 * places is shown once, from the best of them (see dedupeKey).
 */
export const PLATFORMS = [
  { id: 'careers', label: 'Company careers pages' },
  { id: 'ycombinator', label: 'Y Combinator startups' },
  { id: 'adzuna', label: 'Adzuna' },
  { id: 'jooble', label: 'Jooble' },
  { id: 'himalayas', label: 'Himalayas' },
  { id: 'remoteok', label: 'Remote OK' },
  { id: 'jobicy', label: 'Jobicy' },
] as const;
export type Platform = (typeof PLATFORMS)[number]['id'];

/** Who is hiring, for the company type filter (separate from where the job was found). */
export const COMPANY_TYPES = [
  { id: 'direct', label: 'Direct employers' },
  { id: 'agency', label: 'Recruitment agencies' },
  { id: 'startup', label: 'Startups' },
] as const;
export type CompanyType = (typeof COMPANY_TYPES)[number]['id'];

export const FEED_SORTS = ['match', 'newest'] as const;
export type FeedSort = (typeof FEED_SORTS)[number];

/**
 * Query string of GET /v1/job-feed. List filters are comma-separated: `workplace=remote,hybrid`,
 * `level=2,3`, `type=fulltime`, `company=Stripe,Okta`.
 */
export interface FeedFilters {
  q?: string;
  location?: string;
  workplace?: Workplace[];
  level?: number[];
  type?: JobType[];
  company?: string[];
  /** Posted within this many days. */
  posted?: number;
  /** Lowest match score (matched views and All jobs). */
  minScore?: number;
  /** Only listings that state a salary. */
  salary?: boolean;
  companyType?: CompanyType[];
  platform?: Platform[];
  sort?: FeedSort;
}

/** GET /v1/job-feed/facets?view=…: how many jobs in the view have each value, for the filter menus. */
export interface FeedFacets {
  workplace: Record<string, number>;
  level: Record<string, number>;
  type: Record<string, number>;
  company: { company: string; website: string | null; count: number }[];
  withSalary: number;
  companyType: Record<string, number>;
  platform: Record<string, number>;
}

/** Lowest match score shown in each matched view. */
export const MATCH_THRESHOLDS = { recommended: 60, top: 80 } as const;

export const APPLICATION_STATUSES = ['saved', 'applied', 'interviewing', 'offer', 'rejected'] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export const APPLICATION_STATUS_LABELS: Record<ApplicationStatus, string> = {
  saved: 'Saved',
  applied: 'Applied',
  interviewing: 'Interviewing',
  offer: 'Offer',
  rejected: 'Not selected',
};

export const PREFERENCE_LIMITS = { maxItems: 10, maxChars: 80 } as const;

export interface ListingMatch {
  /** 0–100 overall. */
  score: number;
  /** 0–100: the listing's title is the kind of job the user does or wants. */
  titleScore: number;
  /** 0–100: how many of the user's skills the posting mentions. */
  skillScore: number;
  /** 0–100: the seniority fits the user's years of experience. */
  levelScore: number;
  matchedSkills: string[];
}

export interface FeedItem extends ListingSummary {
  /** e.g. "stripe.com", for the company logo. */
  companyWebsite: string | null;
  startup: boolean;
  /** Y Combinator batch, e.g. "Summer 2021". */
  ycBatch: string | null;
  match: ListingMatch | null;
  status: ApplicationStatus | null;
  closed: boolean;
}

export interface FeedPage {
  items: FeedItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface FeedDetail extends ListingDetail {
  companyWebsite: string | null;
  startup: boolean;
  ycBatch: string | null;
  match: ListingMatch | null;
  status: ApplicationStatus | null;
}

export interface JobPreferences {
  /** Target job titles. Empty: the resume's recent titles are used. */
  roles: string[];
  /** Cities or countries. Empty: anywhere. */
  locations: string[];
  /** Empty: any. */
  workplaces: Workplace[];
}

/** GET /v1/job-feed/summary: everything the signed-in shell needs on load. */
export interface JobsSummary {
  profile: {
    name: string | null;
    headline: string | null;
    years: number | null;
    topSkills: string[];
    /** Null when no resume has been uploaded. */
    resumeStatus: 'parsing' | 'ready' | 'failed' | null;
    resumeFileName: string | null;
  };
  preferences: JobPreferences;
  /** Titles the matcher uses when `preferences.roles` is empty. */
  resumeRoles: string[];
  counts: Record<'recommended' | 'top' | 'saved' | 'applied', number> & {
    /** Recommended jobs posted in the last 7 days. */
    newThisWeek: number;
  };
  /** A refresh is queued or running; poll until false. */
  matching: boolean;
  matchedAt: string | null;
  openListings: number;
  companies: number;
  lastSyncAt: string | null;
}

/** Titles matched against when the user hasn't chosen roles: their two most recent, internships aside. */
export function resumeRoles(profile: ResumeProfile | null): string[] {
  const titles = [...new Set((profile?.experience ?? []).map((e) => e.title.trim()).filter(Boolean))];
  const jobs = titles.filter((t) => !/\b(intern|internship|trainee)\b/i.test(t));
  return (jobs.length ? jobs : titles).slice(0, 2);
}

// Cross-platform duplicates. The same job is often on the company's board and on several aggregators,
// each with its own id; jobs with the same key are shown once (job_listings.duplicate_of).

const LEGAL_SUFFIXES =
  /\b(private|pvt|limited|ltd|inc|incorporated|llc|llp|plc|corp|corporation|co|company|gmbh|pte|sa|bv|india|in)\b/g;

const CITY_ALIASES: Record<string, string> = {
  bengaluru: 'bangalore',
  gurugram: 'gurgaon',
  bombay: 'mumbai',
  'new delhi': 'delhi',
  madras: 'chennai',
  calcutta: 'kolkata',
  'navi mumbai': 'mumbai',
};

const norm = (s: string) =>
  s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/&/g, ' and ');
const words = (s: string) => s.replace(/[^a-z0-9+#]+/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * "acme|senior backend engineer|bangalore": company without legal suffixes, title, and first city (or
 * "remote"). Null when there's too little to tell jobs apart.
 */
export function dedupeKey(job: { company: string; title: string; location: string; workplace?: Workplace | null }): string | null {
  const company = words(norm(job.company).replace(/\.(com|in|io|ai|co)\b/g, '').replace(/[.,]/g, ' ').replace(LEGAL_SUFFIXES, ' '));
  const title = words(norm(job.title).replace(/\bsr\b\.?/g, 'senior').replace(/\bjr\b\.?/g, 'junior'));
  if (!company || !title) return null;
  const first = words(norm(job.location.split(/[,·/|;]| - /)[0] ?? ''));
  const city = job.workplace === 'remote' || /^(remote|anywhere|worldwide|global)\b/.test(first) ? 'remote' : (CITY_ALIASES[first] ?? first);
  return `${company}|${title}|${city}`;
}

// Recruitment agencies and staffing firms. Plain "consulting" / "consultancy" is left out: TCS, Deloitte
// and BCG hire for themselves.
const AGENCY_NAME =
  /\b(staffing|recruit(ment|ers?|ing)|placements?|manpower|head ?hunt(ers?|ing)|executive search|search partners|talent (acquisition|solutions|partners)|hr (services|solutions|consultants?)|human resources? (services|solutions)|resourcing|consultants)\b/i;
const AGENCY_FIRMS =
  /\b(randstad|adecco|teamlease|quess|manpowergroup|kelly services|allegis|teksystems|robert half|michael page|hays|abc consultants|ciel hr|careernet|xpheno|people ?prime|innovsource|genius consultants|kforce|insight global|aston carter)\b/i;
// Postings that say they hire for someone else. Singular "client" only: employers that serve clients
// write "for our clients" too.
const AGENCY_TEXT =
  /\b(our client(,| is\b| has\b)|(hiring|recruiting) for our client\b|for one of our clients\b|on behalf of (our|a) client\b|client of ours|(hiring|recruiting) for (a|one of) (the )?(leading|reputed|top) )/i;

/**
 * Whether a posting is from a recruitment agency rather than the employer. Company names are checked
 * everywhere; the posting's wording only for aggregator jobs (a company's own board is the employer's).
 */
export function isAgency(company: string, description: string, fromAggregator: boolean): boolean {
  if (AGENCY_NAME.test(company) || AGENCY_FIRMS.test(company)) return true;
  return fromAggregator && AGENCY_TEXT.test(description.slice(0, 4000));
}

// Searches on job sites that offer no API Friday Jobs may use. Their terms forbid copying listings, so
// the jobs site links to the same search on their own pages instead.

export interface ElsewhereLink {
  site: string;
  url: string;
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export function elsewhereLinks(q: string, location: string | undefined, internship: boolean): ElsewhereLink[] {
  const where = location?.trim() || '';
  const loc = where || 'India';
  const e = encodeURIComponent;
  return [
    { site: 'LinkedIn', url: `https://www.linkedin.com/jobs/search/?keywords=${e(q)}&location=${e(loc)}` },
    { site: 'Naukri', url: `https://www.naukri.com/${slug(q)}-jobs${where && !/^india$/i.test(where) ? `-in-${slug(where)}` : ''}` },
    { site: 'Indeed', url: `https://in.indeed.com/jobs?q=${e(q)}&l=${e(where)}` },
    { site: 'Internshala', url: `https://internshala.com/${internship ? 'internships' : 'jobs'}/keywords-${e(q)}/` },
    { site: 'Wellfound', url: `https://wellfound.com/role/${where && !/^(india|remote)$/i.test(where) ? `l/${slug(q)}/${slug(where)}` : slug(q)}` },
  ];
}

/** GET /v1/job-feed/web: live results from Careerjet for a search, not stored (its terms tie each call to a visitor). */
export interface WebJob {
  title: string;
  company: string;
  location: string;
  salary: string | null;
  postedAt: string | null;
  snippet: string;
  url: string;
  agency: boolean;
}

export interface WebJobPage {
  items: WebJob[];
  /** Careerjet's own count, before jobs already on Friday Jobs were left out. */
  total: number;
  page: number;
  /** False when no Careerjet key is configured. */
  available: boolean;
}

/**
 * What tailoring changed in the candidate's own resume file for one job (apps/worker/src/queues/tailor.ts).
 * The file keeps its design: only the wording of some lines changes, using facts already in it.
 */
export interface TailoredResume {
  format: 'pdf' | 'docx';
  /** Each rewritten paragraph or bullet, as it was and as it is now. */
  edits: { before: string; after: string }[];
  /** Set in bold wherever they appear: the job's requirements the resume shows. */
  bold: string[];
  /** The job's requirements the resume now shows. */
  matchedKeywords: string[];
  /** The job's requirements their resume doesn't support. Never added to the resume. */
  missingKeywords: string[];
  /** What was changed for this job, one short line each. */
  changes: string[];
}

export type TailorStatus = 'tailoring' | 'ready' | 'failed';

/** GET/POST /v1/job-feed/:id/resume. */
export interface TailoredResumeRecord {
  id: string;
  listingId: string | null;
  title: string;
  company: string;
  status: TailorStatus;
  content: TailoredResume | null;
  /** The tailored file's name, once it's ready (GET /v1/job-feed/:id/resume/file). */
  fileName: string | null;
  /** The cover letter written for the job (PDF: GET /v1/job-feed/:id/cover-letter). */
  coverLetter: string | null;
  error: string | null;
  updatedAt: string;
}

/** New tailorings a day per user, and the wait before the same job can be tailored again. */
export const TAILOR_LIMITS = { perDay: 30, retrySeconds: 30 } as const;
