// Application connectors: every channel Friday Jobs uses to find jobs or send applications, with what it
// can really do. A capability is true only when it's implemented here AND permitted for us to use.
// "submitApplications" means an authorized submission route we can use without anyone's browser: an ATS
// application API with a credential the employer (or a partner) granted us. Public job-board APIs are
// read-only; they never authorize submission. Because credentials are per employer board, no provider
// has it by default: `status` is discovery's status and `submissionStatus` submission's, and the admin
// console adds how many employer credentials are held (GET /admin/connectors).

import type { ApplyChannel } from './applyPipeline.js';

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
  /**
   * Submission's own status: 'blocked_pending_agreement' for an ATS whose API connector is built but
   * needs each employer's credential; 'assisted_only' where the candidate submits.
   */
  submissionStatus: ConnectorStatus;
  /** Channels applications to these jobs can go through when everything they need is in place. */
  submissionChannels: ApplyChannel[];
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

/**
 * Employer ATS boards: public job APIs for discovery (read-only). Submission, in order of preference:
 * the ATS's application API with that employer's credential (authorized; none held by default); the
 * employer's public form filled by Friday's servers (only providers an operator lists in
 * AUTO_APPLY_CLOUD_FORM_PROVIDERS; off by default); the same form in the candidate's own browser
 * (extension); otherwise Assisted Apply.
 */
const ats = (id: string, name: string, extra: Partial<Connector> = {}): Connector => ({
  id,
  name,
  discovery: `${name} public job board API (per employer board; read-only)`,
  submission:
    `${name}’s application API with the employer’s own credential, when we hold one; otherwise the employer’s public form in the candidate’s browser (extension) or Friday’s servers (operator-enabled only), or Assisted Apply. CAPTCHAs are handed to the candidate.`,
  auth: 'None for discovery. Submission API: the employer’s API key (ats_credentials). Forms: the candidate’s consent.',
  // submitApplications stays false: it needs a per-employer credential (see the admin credential count).
  capabilities: { ...NONE, discoverJobs: true, readJobDetails: true, uploadResume: true, answerScreeningQuestions: true, verifySubmission: true, supportsCloudExecution: true, requiresPartnership: true },
  status: 'active',
  submissionStatus: 'blocked_pending_agreement',
  submissionChannels: ['api', 'cloud_form', 'extension', 'assisted'],
  unlock: 'Authorized API submission needs each employer’s ATS API key (or an ATS partnership) with written permission.',
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
  ats('workable', 'Workable', { submissionChannels: ['cloud_form', 'extension', 'assisted'], unlock: 'API submission needs the employer’s Workable token (w_candidates); connector not built yet.', restrictions: ['Widget endpoint undocumented', 'Forms with a CAPTCHA wait for the candidate'] }),
  ats('smartrecruiters', 'SmartRecruiters', { rateLimits: '10 requests/s, 8 concurrent' }),
  ats('workday', 'Workday', {
    status: 'blocked_pending_agreement',
    submission: 'No candidate-side API. The employer’s form in the candidate’s browser (sign-in per employer), or Assisted Apply.',
    submissionChannels: ['extension', 'assisted'],
    capabilities: { ...NONE, discoverJobs: true, readJobDetails: true, uploadResume: true, answerScreeningQuestions: true, requiresUserInteraction: true },
    unlock: 'Workday’s site terms prohibit robots without written consent: needs a decision or each employer’s consent.',
    restrictions: ['Site terms prohibit automated extraction', 'Discovery uses the JSON its career site loads'],
  }),
  {
    id: 'teamtailor', name: 'Teamtailor', discovery: 'Careers-site RSS feed (jobs.rss)', submission: 'None (links to the careers site)',
    auth: 'None', capabilities: { ...NONE, discoverJobs: true, readJobDetails: true }, status: 'active',
    submissionStatus: 'assisted_only', submissionChannels: ['assisted'],
    unlock: 'Application submission needs the employer’s Teamtailor API key (connector not built yet).', rateLimits: null, countries: 'Worldwide',
    restrictions: [], sourceProviders: ['teamtailor'], submissionsFrom: null,
  },
  {
    id: 'linkedin', name: 'LinkedIn', discovery: 'None automated (the candidate finds the job)',
    submission: 'Assisted Apply: Friday tailors the resume and prepares answers, the candidate submits on LinkedIn and confirms. (The earlier session bot is an experimental module, off and never scheduled.)',
    auth: 'None (candidate applies in their own browser)',
    capabilities: { ...NONE, requiresUserInteraction: true, requiresPartnership: true },
    status: 'assisted_only',
    submissionStatus: 'assisted_only',
    submissionChannels: ['assisted'],
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
    submissionStatus: 'assisted_only',
    submissionChannels: ['assisted'],
    unlock: 'No published programme: job data only via an Info Edge partnership (account manager). Naukri’s own auto-apply is Naukri Neo (Naukri360 Pro), which has no integration.',
    rateLimits: null, countries: 'India',
    restrictions: ['Akamai returns 403 to automated browsers', 'Terms forbid automated access'],
    sourceProviders: [], submissionsFrom: { botPlatform: 'naukri' },
  },
  {
    id: 'indeed', name: 'Indeed', discovery: 'None automated (the candidate finds the job)',
    submission: 'Assisted Apply: Friday tailors the resume and prepares answers, the candidate submits on Indeed and confirms. (The earlier session bot is an experimental module, off and never scheduled.)',
    auth: 'None (candidate applies in their own browser)',
    capabilities: { ...NONE, requiresUserInteraction: true, requiresPartnership: true },
    status: 'assisted_only',
    submissionStatus: 'assisted_only',
    submissionChannels: ['assisted'],
    unlock: 'Indeed’s terms (§A.3) ban automating Indeed Apply outside its own tools; its APIs are for ATS partners. Only route: a “Permitted AI Connector” agreement, at Indeed’s discretion.',
    rateLimits: null, countries: 'India and worldwide',
    restrictions: ['Terms §D.21 and §A.3 prohibit automated applications', 'Verification pages wait for the candidate'],
    sourceProviders: [], submissionsFrom: { botPlatform: 'indeed' },
  },
  ...(['himalayas', 'jobicy', 'remoteok'] as const).map((id): Connector => ({
    id, name: { himalayas: 'Himalayas', jobicy: 'Jobicy', remoteok: 'Remote OK' }[id], discovery: 'Public remote-jobs API',
    submission: 'None: their terms require applying through their own link', auth: 'None',
    capabilities: { ...NONE, discoverJobs: true, readJobDetails: true, supportsCloudExecution: true }, status: 'active',
    submissionStatus: 'assisted_only', submissionChannels: ['assisted'], unlock: null,
    rateLimits: { himalayas: '60/min, 10,000/day (keyless calls share an allowance)', jobicy: 'Poll at most hourly', remoteok: null }[id],
    countries: 'Remote, India-eligible', restrictions: ['Credit and link back required', 'Apply only via their link'],
    sourceProviders: [id], submissionsFrom: null,
  })),
  {
    id: 'adzuna', name: 'Adzuna', discovery: 'Search API', submission: 'None', auth: 'API key',
    capabilities: { ...NONE, discoverJobs: true, requiresPartnership: true }, status: 'blocked_pending_agreement',
    submissionStatus: 'assisted_only', submissionChannels: ['assisted'],
    unlock: 'Adzuna commercial licence (after the 14-day trial); then set ADZUNA_SYNC_ENABLED.', rateLimits: 'Per account plan',
    countries: 'India', restrictions: ['Off in production until licensed'], sourceProviders: ['adzuna'], submissionsFrom: null,
  },
  {
    id: 'jsearch', name: 'JSearch (Google for Jobs)', discovery: 'RapidAPI search', submission: 'None', auth: 'API key',
    capabilities: { ...NONE, discoverJobs: true, readJobDetails: true }, status: 'blocked_pending_agreement',
    submissionStatus: 'assisted_only', submissionChannels: ['assisted'],
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
  /** Unrevoked, unflagged employer credentials held for authorized API submission. */
  apiCredentials: number;
}
