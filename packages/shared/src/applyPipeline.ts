// Friday Jobs application pipeline: discovery → matching → tailored resume → answers → submission
// through a channel the provider actually authorizes → evidence → dashboard.
//
// The rule this file encodes: an application is sent automatically only through a route that is both
// implemented and permitted. Public job-board APIs (Greenhouse, Lever, Ashby…) permit *discovery*;
// their application endpoints need the employer's own API key, so API submission happens only for boards
// with a credential in ats_credentials. Filling the employer's public form from Friday's servers is a
// separate, operator-enabled channel (AUTO_APPLY_CLOUD_FORM_PROVIDERS). Everything else is Assisted.

import type { AutoApplyProvider } from './autoApply.js';

// ---- Channels ------------------------------------------------------------------------------------

export const APPLY_CHANNELS = ['api', 'cloud_form', 'extension', 'assisted'] as const;
export type ApplyChannel = (typeof APPLY_CHANNELS)[number];

export const APPLY_CHANNEL_LABELS: Record<ApplyChannel, string> = {
  api: 'Employer ATS API',
  cloud_form: 'Friday servers (employer form)',
  extension: 'Your browser (extension)',
  assisted: 'Assisted Apply',
};

/** What a provider's application route allows, independent of any one employer. */
export interface ProviderSubmissionCapability {
  provider: string;
  /** The ATS has an application-submission API. */
  apiExists: boolean;
  /** What that API needs: never satisfied by the public discovery endpoint. */
  apiRequires: string;
  /** Official documentation of the submission API. */
  apiDocs: string | null;
  /** The employer's public form can be filled by a browser (extension or Friday's servers). */
  publicForm: boolean;
  /** Friday's API connector for it is implemented and tested (with mocks). */
  connectorImplemented: boolean;
}

/** Submission capability per ATS (verified against each vendor's docs, 2026-11). */
export const PROVIDER_SUBMISSION: Record<string, ProviderSubmissionCapability> = {
  greenhouse: {
    provider: 'greenhouse', apiExists: true, publicForm: true, connectorImplemented: true,
    apiRequires: 'The employer’s Job Board API key (HTTP Basic). The public boards-api GET endpoints are read-only.',
    apiDocs: 'https://developers.greenhouse.io/job-board.html#submit-an-application',
  },
  lever: {
    provider: 'lever', apiExists: true, publicForm: true, connectorImplemented: true,
    apiRequires: 'An API key from the employer’s Lever account (Postings API apply, ?key=). 2 requests/s.',
    apiDocs: 'https://github.com/lever/postings-api#apply-to-a-job-posting',
  },
  ashby: {
    provider: 'ashby', apiExists: true, publicForm: true, connectorImplemented: true,
    apiRequires: 'The employer’s Ashby API key with candidate write permission (applicationForm.submit).',
    apiDocs: 'https://developers.ashbyhq.com/reference/applicationformsubmit',
  },
  smartrecruiters: {
    provider: 'smartrecruiters', apiExists: true, publicForm: true, connectorImplemented: true,
    apiRequires: 'An X-SmartToken from the employer or a SmartRecruiters partner agreement (Application API).',
    apiDocs: 'https://developers.smartrecruiters.com/docs/application-api',
  },
  workable: {
    provider: 'workable', apiExists: true, publicForm: true, connectorImplemented: false,
    apiRequires: 'The employer’s Workable API token with w_candidates scope.',
    apiDocs: 'https://workable.readme.io/reference/job-candidates-create',
  },
  teamtailor: {
    provider: 'teamtailor', apiExists: true, publicForm: false, connectorImplemented: false,
    apiRequires: 'The employer’s Teamtailor admin API key (candidates + job-applications).',
    apiDocs: 'https://docs.teamtailor.com/#job-applications',
  },
  workday: {
    provider: 'workday', apiExists: false, publicForm: true, connectorImplemented: false,
    apiRequires: 'No candidate-side API; each employer’s career site needs its own sign-in. Site terms bar robots without consent.',
    apiDocs: null,
  },
};

export interface ChannelInputs {
  provider: AutoApplyProvider | string;
  /** An unrevoked ats_credentials row exists for this provider and board. */
  hasApiCredential: boolean;
  /** The provider is in AUTO_APPLY_CLOUD_FORM_PROVIDERS and the user allows server submission. */
  cloudFormEnabled: boolean;
  /** The provider's public form can be filled by the extension (AUTO_APPLY_PROVIDERS). */
  extensionSupported: boolean;
}

/**
 * The channel an application goes through: the most automatic one that is both implemented and
 * permitted. API needs an implemented connector AND the employer's credential; anything without an
 * automatic route is Assisted.
 */
export function resolveChannel(i: ChannelInputs): ApplyChannel {
  const cap = PROVIDER_SUBMISSION[i.provider];
  if (cap?.apiExists && cap.connectorImplemented && i.hasApiCredential) return 'api';
  if (cap?.publicForm && i.cloudFormEnabled) return 'cloud_form';
  if (cap?.publicForm && i.extensionSupported) return 'extension';
  return 'assisted';
}

/** Channels that send without the candidate doing anything (laptop off). */
export const UNATTENDED_CHANNELS: readonly ApplyChannel[] = ['api', 'cloud_form'];

// ---- Matching ------------------------------------------------------------------------------------

export interface MatchWeights {
  title: number;
  skills: number;
  experience: number;
  location: number;
  salary: number;
  recency: number;
}

/** Per-user thresholds and weights (job_preferences.match_config). */
export interface MatchConfig {
  /** Shown as a strong match and the default Auto Apply minimum. */
  strongMatch: number;
  /** Below this a job isn't kept as a match at all. */
  minScore: number;
  weights: MatchWeights;
  /** Lowest acceptable salary, lakhs a year; null: not checked. */
  minSalaryLpa: number | null;
  /** Accepted employment types; empty: all. */
  employmentTypes: ('full_time' | 'part_time' | 'contract' | 'internship' | 'temporary')[];
  /** Jobs asking for more than this many years above the candidate's experience are ineligible. */
  maxExperienceGapYears: number;
  /** Postings older than this are not recommended. */
  maxPostedDays: number;
}

export const DEFAULT_MATCH_CONFIG: MatchConfig = {
  strongMatch: 80,
  minScore: 30,
  weights: { title: 0.35, skills: 0.3, experience: 0.15, location: 0.1, salary: 0.05, recency: 0.05 },
  minSalaryLpa: null,
  employmentTypes: [],
  maxExperienceGapYears: 3,
  maxPostedDays: 30,
};

/** What a job description requires, extracted deterministically (job_requirements.data). */
export interface JobRequirements {
  mandatorySkills: string[];
  preferredSkills: string[];
  minYears: number | null;
  maxYears: number | null;
  /** Lakhs a year, INR (converted when the posting gives another currency). */
  salaryMinLpa: number | null;
  salaryMaxLpa: number | null;
  employmentType: MatchConfig['employmentTypes'][number] | null;
  workplace: 'remote' | 'hybrid' | 'onsite' | null;
  /** Countries the candidate must be authorized in, e.g. ["United States"]. Empty: not stated. */
  workAuthCountries: string[];
  sponsorship: 'offered' | 'not_offered' | 'unknown';
  degreeRequired: string | null;
}

export interface MatchExplanation {
  score: number;
  /** False when a mandatory requirement fails; such jobs are never auto-applied. */
  eligible: boolean;
  /** Each 0–100. */
  components: Record<keyof MatchWeights, number>;
  mandatoryMatched: string[];
  mandatoryMissing: string[];
  preferredMatched: string[];
  /** Why it fits, short sentences. */
  reasons: string[];
  /** Why it doesn't, short sentences. */
  gaps: string[];
  /** Mandatory failures (subset of gaps) that made it ineligible. */
  rejections: string[];
}

// ---- Applied Jobs dashboard ----------------------------------------------------------------------

/**
 * How we know an application was sent:
 * - verified: the ATS confirmed it (API response with an application id, or its confirmation page)
 * - user_confirmed: the candidate told us they submitted it
 * Queued, attempted and failed applications have no evidence and are never counted.
 */
export type ApplicationEvidence = 'verified' | 'user_confirmed';

export type AppliedJobStatus =
  | 'submitted' // evidence exists
  | 'needs_action' // waiting for the candidate (answers, CAPTCHA, confirm, assisted)
  | 'in_progress' // queued, preparing, prepared, submitting
  | 'failed'
  | 'skipped';

export interface AppliedJob {
  /** "<kind>:<id>" — kind is auto (auto_applications), bot (job_bot_applications) or manual (job_applications). */
  id: string;
  title: string;
  company: string;
  location: string;
  /** Platform/ATS the job is on, e.g. greenhouse, linkedin, naukri. */
  platform: string;
  /** manual: the candidate recorded it themselves; bot: the experimental platform bot in their own session. */
  channel: ApplyChannel | 'manual' | 'bot';
  status: AppliedJobStatus;
  evidence: ApplicationEvidence | null;
  /** Confirmation text/URL or the ATS application id; redacted. */
  evidenceDetail: string | null;
  appliedAt: string | null;
  createdAt: string;
  jobUrl: string;
  score: number | null;
  /** Signed, short-lived URL of the exact resume sent; null when none was tailored. */
  resumeUrl: string | null;
  failure: { code: string; message: string; at: string | null } | null;
  /** For needs_action: what the candidate has to do. */
  action: string | null;
  /** Questions waiting for an answer (needs_action because of missing answers). */
  questions: { key: string; label: string }[];
}

export interface AppliedJobsStats {
  /** Confirmed submissions (evidence exists), all time. */
  total: number;
  today: number;
  thisMonth: number;
  verified: number;
  userConfirmed: number;
  needsAction: number;
  failed: number;
  inProgress: number;
  /** Confirmed submissions by platform. */
  byPlatform: { platform: string; submitted: number }[];
}

export interface AppliedJobsPage {
  stats: AppliedJobsStats;
  items: AppliedJob[];
  page: number;
  pageSize: number;
  /** Rows matching the filters. */
  total: number;
}

// ---- Reporting -----------------------------------------------------------------------------------

/** jobs_daily_reports.data: what discovery found and what could actually be applied to. */
export interface DailyJobsReport {
  day: string;
  generatedAt: string;
  discovery: {
    newListings: number;
    closedListings: number;
    openListings: number;
    uniqueOpen: number;
    techOpen: number;
    indiaEligibleTechOpen: number;
    bySource: { provider: string; open: number; new: number; failures: number }[];
  };
  capacity: {
    /** Unique, open, India-eligible tech jobs whose provider has an implemented connector AND a credential. */
    apiAuthorized: number;
    /** …on providers whose public form Friday's servers are enabled to fill. */
    cloudForm: number;
    /** …fillable by the extension only (candidate's browser must be on). */
    extensionOnly: number;
    /** Everything else: candidate submits. */
    assistedOnly: number;
  };
  applications: {
    submittedVerified: number;
    submittedUserConfirmed: number;
    failed: number;
    needsAction: number;
    byChannel: Record<string, number>;
    llmCostUsd: number;
  };
}

// ---- Redaction -----------------------------------------------------------------------------------

const SECRET_KEYS = /pass(word)?|secret|token|api[_-]?key|authorization|cookie|session|refresh|private/i;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const PHONE = /(?<![\w-])\+?\d[\d\s().-]{8,}\d(?![\w-])/g;

/** Masks secrets by key name, and emails and phone numbers in strings, before logging or auditing. */
export function redactSensitive<T>(value: T, depth = 0): T {
  if (depth > 6) return '[…]' as T;
  if (typeof value === 'string') return value.replace(EMAIL, '[email]').replace(PHONE, '[phone]') as T;
  if (Array.isArray(value)) return value.map((v) => redactSensitive(v, depth + 1)) as T;
  if (value && typeof value === 'object' && !(value instanceof Date) && !(value instanceof Uint8Array)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = SECRET_KEYS.test(k) ? '[redacted]' : redactSensitive(v, depth + 1);
    return out as T;
  }
  return value;
}
