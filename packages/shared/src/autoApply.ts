// Friday Jobs Auto Apply: every day the worker picks the user's best new matches, tailors their resume
// to each and answers the application form from their profile (apps/worker/src/queues/autoApply.ts),
// whether or not their computer is on. Prepared applications are submitted from the user's own browser
// by the Friday extension, never by bypassing a CAPTCHA, and count as submitted only once the job board
// confirms them.

/**
 * - preparing: being tailored and answered (internal step before Prepared)
 * - prepared: ready to submit
 * - pending: being submitted, or waiting for the user (see reasonCode)
 * - submitted: the job board confirmed the application
 * - failed: couldn't be prepared or submitted after retries
 * - skipped: not sent (closed listing, duplicate, already applied, removed by the user…)
 */
export const AUTO_APPLY_STATUSES = ['preparing', 'prepared', 'pending', 'submitted', 'failed', 'skipped'] as const;
export type AutoApplyStatus = (typeof AUTO_APPLY_STATUSES)[number];

export const AUTO_APPLY_STATUS_LABELS: Record<AutoApplyStatus, string> = {
  preparing: 'Preparing',
  prepared: 'Prepared',
  pending: 'Pending',
  submitted: 'Submitted',
  failed: 'Failed',
  skipped: 'Skipped',
};

/** Why an application is pending, failed or skipped. */
export type AutoApplyReason =
  // pending
  | 'submitting' // the extension is filling the form
  | 'needs_answers' // a required question can't be answered from the profile or resume
  | 'captcha' // the job board asked for a CAPTCHA challenge
  | 'login_required' // the job board wants the user to sign in
  | 'unverified' // submitted, but the confirmation wasn't seen
  // failed
  | 'tailoring_failed'
  | 'form_unavailable'
  | 'submit_failed'
  // skipped
  | 'listing_closed'
  | 'already_applied'
  | 'duplicate'
  | 'expired'
  | 'removed_by_user';

/** Job boards whose forms Auto Apply can prepare and the extension can submit. */
export const AUTO_APPLY_PROVIDERS = ['greenhouse', 'lever', 'ashby'] as const;
export type AutoApplyProvider = (typeof AUTO_APPLY_PROVIDERS)[number];

export const AUTO_APPLY_LIMITS = {
  minScore: 50,
  maxScore: 90,
  defaultScore: 70,
  maxPerDay: 100,
  /** Prepared applications waiting to be submitted; preparation pauses at this many (saves model cost). */
  maxBacklog: 100,
  /** Prepared applications not submitted within this many days are skipped as expired. */
  expireDays: 7,
} as const;

export interface AutoApplySettings {
  enabled: boolean;
  /** Lowest match score (50–90) a job needs to be applied to. */
  minScore: number;
  /** At most 100. */
  dailyLimit: number;
  /** IANA zone the daily limit resets in, e.g. "Asia/Kolkata". */
  timezone: string;
  /** When the user agreed to applications being sent in their name; Auto Apply can't be on without it. */
  consentedAt: string | null;
}

export interface WorkAuthorization {
  /** Country name, e.g. "India", "United States". */
  country: string;
  authorized: boolean;
  needsSponsorship: boolean;
}

/** What application forms ask that a resume doesn't say. Filled in once by the user. */
export interface ApplicationProfile {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  city: string;
  country: string;
  linkedin: string;
  github: string;
  portfolio: string;
  website: string;
  workAuthorization: WorkAuthorization[];
  /** Days; null when not said. */
  noticePeriodDays: number | null;
  /** Free text with currency, e.g. "₹18 LPA" or "$120k". Empty: not shared. */
  currentSalary: string;
  expectedSalary: string;
  willingToRelocate: boolean | null;
  /** e.g. "Immediately" or "1 March 2027". */
  earliestStart: string;
  /** Voluntary diversity questions are always declined unless the user says otherwise here. */
  gender: string;
  /** The user's answers to questions Auto Apply couldn't answer, reused for the same question later. */
  savedAnswers: { question: string; answer: string }[];
}

export const EMPTY_APPLICATION_PROFILE: ApplicationProfile = {
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  city: '',
  country: '',
  linkedin: '',
  github: '',
  portfolio: '',
  website: '',
  workAuthorization: [],
  noticePeriodDays: null,
  currentSalary: '',
  expectedSalary: '',
  willingToRelocate: null,
  earliestStart: '',
  gender: '',
  savedAnswers: [],
};

/** Fields Auto Apply needs before it can be turned on. */
export function missingProfileFields(p: ApplicationProfile): string[] {
  const missing: string[] = [];
  if (!p.firstName.trim()) missing.push('First name');
  if (!p.lastName.trim()) missing.push('Last name');
  if (!/^\S+@\S+\.\S+$/.test(p.email.trim())) missing.push('Email');
  if (p.phone.replace(/\D/g, '').length < 7) missing.push('Phone');
  if (!p.city.trim()) missing.push('City');
  if (!p.country.trim()) missing.push('Country');
  if (!p.workAuthorization.length) missing.push('Work authorization');
  return missing;
}

export type FormFieldType = 'text' | 'textarea' | 'select' | 'multiselect' | 'checkbox' | 'file' | 'date' | 'number' | 'hidden';

/** One question on a job board's application form, normalised across providers. */
export interface FormQuestion {
  /** The form field's name on the job board (what the extension fills). */
  key: string;
  label: string;
  type: FormFieldType;
  required: boolean;
  options: string[];
  /** Standard contact fields, the resume, custom questions, or voluntary diversity (EEO) questions. */
  kind: 'standard' | 'resume' | 'custom' | 'eeo';
  description?: string;
}

export interface PreparedAnswer {
  key: string;
  label: string;
  /** Option labels for select fields; null when left blank. */
  value: string | string[] | null;
  /** Where the answer came from. */
  source: 'profile' | 'resume' | 'ai' | 'user' | 'declined' | 'file';
}

export interface AutoApplication {
  id: string;
  listingId: string | null;
  title: string;
  company: string;
  provider: AutoApplyProvider;
  applyUrl: string;
  score: number | null;
  status: AutoApplyStatus;
  reasonCode: AutoApplyReason | null;
  /** For the user: what's wrong, or what they need to do. */
  reason: string | null;
  /** Questions waiting for the user's answer when reasonCode is needs_answers. */
  missing: FormQuestion[];
  attempts: number;
  submittedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AutoApplicationDetail extends AutoApplication {
  form: FormQuestion[];
  answers: PreparedAnswer[];
  tailoredResumeReady: boolean;
  events: { at: string; kind: string; message: string }[];
}

/** GET /v1/auto-apply */
export interface AutoApplyOverview {
  settings: AutoApplySettings;
  profile: ApplicationProfile;
  /** What's still needed before Auto Apply can be turned on. */
  blockers: string[];
  /** Applications counted against today's limit. */
  today: number;
  counts: Record<AutoApplyStatus, number>;
  /** Pending applications that need the user. */
  needsYou: number;
}

/** POST /v1/auto-apply/claim: the next prepared application, for the extension to submit. */
export interface AutoApplyTask {
  id: string;
  provider: AutoApplyProvider;
  applyUrl: string;
  title: string;
  company: string;
  answers: PreparedAnswer[];
  form: FormQuestion[];
  /** GET this with the user's token for the tailored resume file. */
  resumePath: string;
  resumeFileName: string;
  /** Claim lease: report back before this, or the application returns to Prepared. */
  leaseUntil: string;
}

/** POST /v1/auto-apply/applications/:id/report, from the extension. */
export interface AutoApplyReport {
  outcome: 'submitted' | 'captcha' | 'login_required' | 'needs_answers' | 'failed';
  /** For submitted: what the page showed afterwards, checked against the job board's confirmation. */
  evidence?: { url: string; text: string };
  /** For needs_answers: the required fields the extension couldn't fill. */
  unanswered?: string[];
  message?: string;
}
