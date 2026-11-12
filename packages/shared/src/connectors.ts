// Application connectors: every channel Friday Jobs uses to find jobs or send applications, with what it
// can really do. A capability is true only when it's implemented here AND permitted for us to use;
// "submitApplications" in particular is never true for a route the platform's terms forbid. The admin
// console shows this registry with each connector's live health (GET /admin/connectors).

export interface ConnectorCapabilities {
  discoverJobs: boolean;
  readJobDetails: boolean;
  /** Submits applications through a route the platform or employer permits. */
  submitApplications: boolean;
  uploadResume: boolean;
  answerScreeningQuestions: boolean;
  /** The platform's own confirmation is checked before a job counts as applied. */
  verifySubmission: boolean;
  requiresUserInteraction: boolean;
  supportsCloudExecution: boolean;
  requiresPartnership: boolean;
}

export type ConnectorStatus =
  /** Working and permitted. */
  | 'active'
  /** Built, off until a licence, partnership or key is in place. */
  | 'blocked_pending_agreement'
  /** The site refuses us (e.g. 403); Assisted Apply only. */
  | 'access_restricted'
  /** Candidate submits themselves; Friday prepares. */
  | 'assisted_only'
  /** Works for allowlisted personal use only; not a permitted integration. */
  | 'personal_use_only';

export interface Connector {
  id: string;
  name: string;
  /** How jobs are found. */
  discovery: string;
  /** How applications are sent, if at all. */
  submission: string;
  auth: string;
  capabilities: ConnectorCapabilities;
  status: ConnectorStatus;
  /** What it would take to do more (partnership, licence…). */
  unlock: string | null;
  rateLimits: string | null;
  countries: string;
  restrictions: string[];
  /** job_sources.provider values whose syncs count as this connector's discovery health. */
  sourceProviders: string[];
  /** Where its submissions are recorded, for health: Auto Apply (ATS) or the platform bot. */
  submissionsFrom: { autoApplyProvider?: string; botPlatform?: string } | null;
}

const NONE: ConnectorCapabilities = {
  discoverJobs: false, readJobDetails: false, submitApplications: false, uploadResume: false, answerScreeningQuestions: false,
  verifySubmission: false, requiresUserInteraction: false, supportsCloudExecution: false, requiresPartnership: false,
};

/** Employer ATS boards: public job APIs for discovery; the employer's own public application form for submission. */
const ats = (id: string, name: string, extra: Partial<Connector> = {}): Connector => ({
  id,
  name,
  discovery: `${name} public job board API (per employer board)`,
  submission: 'The employer’s public application form, filled by Cloud Auto Apply with the candidate’s consent; the form’s own confirmation is checked. CAPTCHAs are handed to the candidate.',
  auth: 'None for discovery; the candidate’s consent for applying',
  capabilities: { ...NONE, discoverJobs: true, readJobDetails: true, submitApplications: true, uploadResume: true, answerScreeningQuestions: true, verifySubmission: true, supportsCloudExecution: true },
  status: 'active',
  unlock: 'API submission (no browser) needs each employer’s own ATS API key.',
  rateLimits: null,
  countries: 'Worldwide (filtered to India-eligible)',
  restrictions: ['Forms with a CAPTCHA wait for the candidate', 'Never resubmitted after the submit click'],
  sourceProviders: [id],
  submissionsFrom: { autoApplyProvider: id },
  ...extra,
});

export const CONNECTORS: Connector[] = [
  ats('greenhouse', 'Greenhouse'),
  ats('lever', 'Lever', { rateLimits: 'Application POST: 2/s (API)' }),
  ats('ashby', 'Ashby'),
  ats('workable', 'Workable', { restrictions: ['Widget endpoint undocumented', 'Forms with a CAPTCHA wait for the candidate'] }),
  ats('smartrecruiters', 'SmartRecruiters', { rateLimits: '10 requests/s, 8 concurrent' }),
  ats('workday', 'Workday', {
    status: 'blocked_pending_agreement',
    unlock: 'Workday’s site terms prohibit robots without written consent: needs a decision or each employer’s consent.',
    restrictions: ['Site terms prohibit automated extraction', 'Discovery uses the JSON its career site loads'],
  }),
  {
    id: 'teamtailor', name: 'Teamtailor', discovery: 'Careers-site RSS feed (jobs.rss)', submission: 'None (links to the careers site)',
    auth: 'None', capabilities: { ...NONE, discoverJobs: true, readJobDetails: true }, status: 'active',
    unlock: 'Application submission needs the employer’s Teamtailor API key.', rateLimits: null, countries: 'Worldwide',
    restrictions: [], sourceProviders: ['teamtailor'], submissionsFrom: null,
  },
  {
    id: 'linkedin', name: 'LinkedIn', discovery: 'Search in the candidate’s own signed-in session (platform bot)',
    submission: 'Easy Apply driven in the candidate’s own session (allowlisted personal use), or Assisted Apply',
    auth: 'Candidate signs in on LinkedIn’s own page; session kept on the machine running the worker',
    capabilities: { ...NONE, discoverJobs: true, readJobDetails: true, uploadResume: true, answerScreeningQuestions: true, verifySubmission: true, requiresUserInteraction: true },
    status: 'personal_use_only',
    unlock: 'No route exists: LinkedIn has no candidate-side submission API (Apply Connect, AWLI and the Job Posting API all send applications to employers, and AWLI/Job Posting are closed to new partners).',
    rateLimits: 'LinkedIn caps Easy Apply per account per day',
    countries: 'Worldwide',
    restrictions: ['User Agreement prohibits bots and automated access', 'Headless sessions are challenged; never bypassed'],
    sourceProviders: [], submissionsFrom: { botPlatform: 'linkedin' },
  },
  {
    id: 'naukri', name: 'Naukri', discovery: 'None permitted (no public API; background browser refused with 403)',
    submission: 'Assisted Apply: Friday tailors the resume from the pasted job, the candidate submits on Naukri and confirms',
    auth: 'None (candidate applies in their own browser)',
    capabilities: { ...NONE, uploadResume: false, requiresUserInteraction: true, requiresPartnership: true },
    status: 'access_restricted',
    unlock: 'No published programme: job data only via an Info Edge partnership (account manager). Naukri’s own auto-apply is Naukri Neo (Naukri360 Pro), which has no integration.',
    rateLimits: null, countries: 'India',
    restrictions: ['Akamai returns 403 to automated browsers', 'Terms forbid automated access'],
    sourceProviders: [], submissionsFrom: { botPlatform: 'naukri' },
  },
  {
    id: 'indeed', name: 'Indeed', discovery: 'Search in the candidate’s own signed-in session (platform bot)',
    submission: 'Indeed Apply driven in the candidate’s own session (allowlisted personal use), or Assisted Apply',
    auth: 'Candidate signs in on Indeed’s own page',
    capabilities: { ...NONE, discoverJobs: true, readJobDetails: true, uploadResume: true, answerScreeningQuestions: true, verifySubmission: true, requiresUserInteraction: true },
    status: 'personal_use_only',
    unlock: 'Indeed’s terms (§A.3) ban automating Indeed Apply outside its own tools; its APIs are for ATS partners. Only route: a “Permitted AI Connector” agreement, at Indeed’s discretion.',
    rateLimits: null, countries: 'India and worldwide',
    restrictions: ['Terms §D.21 and §A.3 prohibit automated applications', 'Verification pages wait for the candidate'],
    sourceProviders: [], submissionsFrom: { botPlatform: 'indeed' },
  },
  ...(['himalayas', 'jobicy', 'remoteok'] as const).map((id): Connector => ({
    id, name: { himalayas: 'Himalayas', jobicy: 'Jobicy', remoteok: 'Remote OK' }[id], discovery: 'Public remote-jobs API',
    submission: 'None: their terms require applying through their own link', auth: 'None',
    capabilities: { ...NONE, discoverJobs: true, readJobDetails: true, supportsCloudExecution: true }, status: 'active', unlock: null,
    rateLimits: { himalayas: '60/min, 10,000/day (keyless calls share an allowance)', jobicy: 'Poll at most hourly', remoteok: null }[id],
    countries: 'Remote, India-eligible', restrictions: ['Credit and link back required', 'Apply only via their link'],
    sourceProviders: [id], submissionsFrom: null,
  })),
  {
    id: 'adzuna', name: 'Adzuna', discovery: 'Search API', submission: 'None', auth: 'API key',
    capabilities: { ...NONE, discoverJobs: true, requiresPartnership: true }, status: 'blocked_pending_agreement',
    unlock: 'Adzuna commercial licence (after the 14-day trial); then set ADZUNA_SYNC_ENABLED.', rateLimits: 'Per account plan',
    countries: 'India', restrictions: ['Off in production until licensed'], sourceProviders: ['adzuna'], submissionsFrom: null,
  },
  {
    id: 'jsearch', name: 'JSearch (Google for Jobs)', discovery: 'RapidAPI search', submission: 'None', auth: 'API key',
    capabilities: { ...NONE, discoverJobs: true, readJobDetails: true }, status: 'blocked_pending_agreement',
    unlock: 'Confirm storage/redistribution terms; upstream boards (LinkedIn, Indeed) bar republication.', rateLimits: 'Plan quota',
    countries: 'India', restrictions: ['Off in production until terms are confirmed'], sourceProviders: ['jsearch'], submissionsFrom: null,
  },
];

export const CONNECTOR_STATUS_LABELS: Record<ConnectorStatus, string> = {
  active: 'Active',
  blocked_pending_agreement: 'Needs agreement',
  access_restricted: 'Access restricted',
  assisted_only: 'Assisted only',
  personal_use_only: 'Personal use only',
};

/** GET /admin/connectors: the registry with each connector's live health. */
export interface ConnectorHealth extends Connector {
  lastSyncAt: string | null;
  syncFailures24h: number;
  lastSubmissionAt: string | null;
  submissions30d: number;
}
