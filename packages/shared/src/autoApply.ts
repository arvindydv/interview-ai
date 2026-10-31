// Friday Jobs Auto Apply: every day the worker picks the user's best new matches, tailors their resume
// to each and answers the application form from their profile (apps/worker/src/queues/autoApply.ts),
// whether or not their computer is on. Prepared applications are submitted by Friday's servers where the
// job board allows it (apps/worker/src/applier.ts), and otherwise from the user's own browser by the
// Friday extension; a CAPTCHA or sign-in the servers meet is handed to the browser, never bypassed.
// They count as submitted only once the job board confirms them.

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
  | 'submitting' // Friday's servers or the extension are filling the form
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

/**
 * Job boards whose forms Auto Apply can prepare and the extension can submit. Greenhouse, Lever, Ashby
 * and Workable forms are read in advance; SmartRecruiters and Workday forms only when the extension
 * opens them (their questions aren't public), and Workday asks the user to sign in to each employer.
 */
export const AUTO_APPLY_PROVIDERS = ['greenhouse', 'lever', 'ashby', 'workable', 'smartrecruiters', 'workday'] as const;
export type AutoApplyProvider = (typeof AUTO_APPLY_PROVIDERS)[number];

/**
 * Job boards Friday's servers submit to. Workday wants a sign-in to each employer's site, so it is
 * left to the user's browser.
 */
export const AUTO_APPLY_CLOUD_PROVIDERS = ['greenhouse', 'lever', 'ashby', 'workable', 'smartrecruiters'] as const satisfies readonly AutoApplyProvider[];

/**
 * What each job board shows once it has the application (kept in step with apps/extension/src/filler.js).
 * Submissions count only when the page the browser landed on matches, so a form that silently failed
 * is never marked Submitted.
 */
const CONFIRMATION: Record<AutoApplyProvider, { url: RegExp; text: RegExp }> = {
  greenhouse: {
    url: /greenhouse\.io\/.*(confirmation|thank)/i,
    text: /thank you for applying|application (has been )?(received|submitted)|we('ve| have) received your application/i,
  },
  lever: {
    url: /lever\.co\/[^/]+\/[^/]+\/thanks/i,
    text: /application submitted|thank(s| you) for applying|we('ve| have) received your application/i,
  },
  ashby: {
    url: /ashbyhq\.com\/.*(submitted|confirmation)/i,
    text: /application (was )?(successfully )?submitted|thank(s| you) for (applying|submitting)|we('ve| have) received your application/i,
  },
  // Not yet seen live on these three; a miss only means the user is asked to confirm.
  workable: {
    url: /workable\.com\/.*(success|thank|submitted)/i,
    text: /thank(s| you) for (applying|your application)|application (has been |was )?(successfully )?(submitted|received)/i,
  },
  smartrecruiters: {
    url: /smartrecruiters\.com\/.*(success|thank|confirmation)/i,
    text: /thank(s| you) for (applying|your application)|application (has been |was )?(successfully )?(submitted|received)/i,
  },
  workday: {
    url: /myworkdayjobs\.com\/.*(applicationSubmitted|submitted)/i,
    text: /application submitted|thank(s| you) for applying|your application (has been|was) (submitted|received)/i,
  },
};

/** Whether what the page showed after submitting is the job board's confirmation. */
export function verifySubmission(provider: AutoApplyProvider, evidence: { url: string; text: string } | undefined) {
  if (!evidence) return false;
  const c = CONFIRMATION[provider];
  return c.url.test(evidence.url) || c.text.test(evidence.text);
}

/** The page the extension opens to apply. */
export function autoApplyUrl(provider: AutoApplyProvider, board: string, externalId: string, listingUrl: string) {
  switch (provider) {
    case 'workable':
      return `https://apply.workable.com/${encodeURIComponent(board)}/j/${encodeURIComponent(externalId)}/apply/`;
    // The posting page; the extension presses its Apply button.
    case 'smartrecruiters':
      return listingUrl;
    case 'workday':
      return `${listingUrl.replace(/\/$/, '')}/apply/applyManually`;
    // Greenhouse's own hosted form, also used when a company embeds it in its careers site.
    case 'greenhouse':
      return `https://boards.greenhouse.io/embed/job_app?for=${encodeURIComponent(board)}&token=${encodeURIComponent(externalId)}`;
    case 'lever':
      return `https://jobs.lever.co/${encodeURIComponent(board)}/${encodeURIComponent(externalId)}/apply`;
    case 'ashby':
      return `https://jobs.ashbyhq.com/${encodeURIComponent(board)}/${encodeURIComponent(externalId)}/application`;
  }
}


export const AUTO_APPLY_LIMITS = {
  minScore: 50,
  maxScore: 90,
  defaultScore: 70,
  /** The highest daily limit of any plan (jobsPlans.ts); each plan caps it lower. */
  maxPerDay: 500,
  /** Prepared applications not submitted within this many days are skipped as expired. */
  expireDays: 7,
} as const;

export interface AutoApplySettings {
  enabled: boolean;
  /** auto: Friday picks the jobs. review: only jobs the user swipes right on. */
  mode: 'auto' | 'review';
  /** Lowest match score (50–90) a job needs to be applied to. */
  minScore: number;
  /** At most the plan's daily applications. */
  dailyLimit: number;
  /** IANA zone the daily limit resets in, e.g. "Asia/Kolkata". */
  timezone: string;
  /** When the user agreed to applications being sent in their name; Auto Apply can't be on without it. */
  consentedAt: string | null;
  /**
   * Friday's servers submit applications on the job boards that allow it, so they go out while the
   * user's computer is off. Off: everything waits for the user's browser.
   */
  cloudSubmit: boolean;
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
  // Common questions: each one answered here is one Auto Apply never has to stop and ask.
  /** What they'd like to be called, when not their first name. */
  preferredName: string;
  /** e.g. "she/her". Empty: not shared. */
  pronouns: string;
  /** Home town and state, e.g. "Lucknow, Uttar Pradesh" (Indian forms ask for a home state). */
  hometown: string;
  /** Languages they can work in, e.g. ["English", "Hindi"]. */
  languages: string[];
  /** Every country not in workAuthorization. null: asked each time. */
  otherCountries: { authorized: boolean; needsSponsorship: boolean } | null;
  /** Work arrangements they accept. Empty: asked each time. */
  workplaces: ('remote' | 'hybrid' | 'onsite')[];
  willingToTravel: boolean | null;
  /** Whether they hold a government security clearance. null: asked each time. */
  securityClearance: boolean | null;
  /** Interviews may be recorded or transcribed (AI notetakers). null: asked each time. */
  recordingConsent: boolean | null;
  /** A background check if they're offered the job. null: asked each time. */
  backgroundCheckConsent: boolean | null;
  /**
   * Friday answers judgment questions itself (how they'd approach something, which role type fits,
   * open questions) from the resume, instead of waiting. Never personal or legal facts.
   */
  letAiDecide: boolean;
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
  preferredName: '',
  pronouns: '',
  hometown: '',
  languages: [],
  otherCountries: null,
  workplaces: [],
  willingToTravel: null,
  securityClearance: null,
  recordingConsent: null,
  backgroundCheckConsent: null,
  letAiDecide: true,
  savedAnswers: [],
};

/**
 * The profile question that answers a form's question, when one does. Those are asked once, in the
 * profile, never per application: answered there, they fill every form.
 */
export function profileQuestionFor(label: string): string | null {
  const l = label.toLowerCase();
  const rules: [RegExp, string][] = [
    [/notice period|how soon can you (join|start)|joining time|earliest (start|joining)/, 'Notice period'],
    [/(expected|desired|asking).{0,30}(ctc|salary|compensation|pay)/, 'Expected salary'],
    [/(current|present|last|previous|existing).{0,30}(ctc|salary|compensation|pay)/, 'Current salary'],
    [/linked\s?in/, 'LinkedIn'],
    [/github/, 'GitHub'],
    [/portfolio/, 'Portfolio'],
    [/sponsorship|authori[sz]ed to work|work permit|right to work|visa status/, 'Where you can work'],
    [/relocat|location preference|preferred (work )?location/, 'Relocation'],
    [/\btravel/, 'Travel'],
    [/languages?\b/, 'Languages'],
    [/home ?(town|state|city|district)|native (place|state)/, 'Home town'],
    [/(hold|have|possess).{0,40}security clearance/, 'Security clearance'],
    [/notetaker|recorded|recording|transcri/, 'Recorded interviews'],
    [/background (check|verification|screening)/, 'Background check'],
  ];
  return rules.find(([re]) => re.test(l))?.[1] ?? null;
}

/** Common questions forms ask, and whether the profile answers each (for "N of M answered"). */
export function commonQuestions(p: ApplicationProfile): { label: string; answered: boolean }[] {
  return [
    { label: 'LinkedIn', answered: Boolean(p.linkedin.trim()) },
    { label: 'Notice period', answered: p.noticePeriodDays !== null },
    { label: 'Current salary', answered: Boolean(p.currentSalary.trim()) },
    { label: 'Expected salary', answered: Boolean(p.expectedSalary.trim()) },
    { label: 'Where you can work', answered: p.workAuthorization.length > 0 && p.otherCountries !== null },
    { label: 'Work arrangements', answered: p.workplaces.length > 0 },
    { label: 'Relocation', answered: p.willingToRelocate !== null },
    { label: 'Travel', answered: p.willingToTravel !== null },
    { label: 'Languages', answered: p.languages.length > 0 },
    { label: 'Home town', answered: Boolean(p.hometown.trim()) },
    { label: 'Security clearance', answered: p.securityClearance !== null },
    { label: 'Recorded interviews', answered: p.recordingConsent !== null },
    { label: 'Background check', answered: p.backgroundCheckConsent !== null },
  ];
}

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
  source: 'profile' | 'resume' | 'ai' | 'user' | 'declined' | 'file' | 'cover_letter';
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
  /** The user's Friday Jobs plan, which caps the daily limit. */
  plan: import('./jobsPlans.js').JobsPlan;
  planExpiresAt: string | null;
  profile: ApplicationProfile;
  /** What's still needed before Auto Apply can be turned on. */
  blockers: string[];
  /** Applications counted against today's limit. */
  today: number;
  counts: Record<AutoApplyStatus, number>;
  /** Pending applications that need the user. */
  needsYou: number;
  /** Browsers connected through the Friday extension, most recently seen first. */
  devices: AutoApplyDevice[];
}

/** A browser running the Friday extension, which submits prepared applications. */
export interface AutoApplyDevice {
  id: string;
  /** e.g. "Chrome on Linux" */
  name: string;
  createdAt: string;
  /** When it last asked for work or reported; null before its first request. */
  lastSeenAt: string | null;
}

/** POST /v1/auto-apply/devices: the extension connects with the site's session and gets its own token. */
export interface AutoApplyDeviceToken {
  token: string;
  device: AutoApplyDevice;
  userId: string;
  email: string;
}

/** POST /v1/auto-apply/claim: the next prepared application, for the extension (or Friday's servers) to submit. */
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
  /** The cover letter PDF, when one was written. */
  coverLetterPath: string | null;
  coverLetterFileName: string | null;
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
  /** The submit button had been pressed: a failure then is never retried, the user confirms instead. */
  afterSubmit?: boolean;
}

/** GET /v1/swipe: a matched job to decide on. Right is apply, left is skip. */
export interface SwipeCard {
  listingId: string;
  title: string;
  company: string;
  companyWebsite: string | null;
  companyLogo: string | null;
  location: string;
  workplace: string | null;
  salary: string | null;
  postedAt: string | null;
  score: number;
  matchedSkills: string[];
  /** The start of the description, as text. */
  summary: string;
  provider: AutoApplyProvider;
}

export interface SwipeResult {
  decision: 'apply' | 'skip';
  /** For apply: the application Auto Apply is now preparing. */
  applicationId?: string;
  /** Applications counted against today's limit, and the limit. */
  today: number;
  limit: number;
}

/** GET /v1/jobs-analytics?days=30: how the user's applications are doing. */
export interface JobsAnalytics {
  days: number;
  totals: {
    applied: number;
    /** Sent by Auto Apply (confirmed by the job board) vs by the user. */
    auto: number;
    manual: number;
    /** Any reply the user recorded: interviewing, offer or not selected. */
    responses: number;
    interviews: number;
    offers: number;
    rejected: number;
    /** responses / applied, 0–1. */
    responseRate: number;
  };
  /** One row per day in the period, oldest first. */
  daily: { day: string; applied: number; responses: number }[];
  /** Best response rate first. */
  bySource: { source: string; label: string; applied: number; responses: number; interviews: number; rate: number }[];
  /** Applications by how well the job matched. */
  byScore: { band: string; applied: number; responses: number; rate: number }[];
  /** Auto Apply applications in the period by status. */
  autoApply: Record<AutoApplyStatus, number>;
  /** Who sent them, and how often Friday's servers needed a browser. */
  autoApplyChannels: AutoApplyChannels;
}

/** Auto Apply in a period by who sent each application (also for all users, in the admin overview). */
export interface AutoApplyChannels {
  /** Confirmed by the job board (or by the user), by who sent them. Before server submission: browser. */
  submitted: { cloud: number; browser: number; user: number };
  /** Sent, but no confirmation seen yet, by who sent them. */
  unverified: { cloud: number; browser: number };
  /** Friday's servers met a CAPTCHA or sign-in and passed the application to the user's browser. */
  handedToBrowser: number;
  /** ...with no browser connected, so it waited for the user. */
  waitedForUser: number;
  /** Server submissions that failed (each try), and that ended up Failed. */
  cloudFailures: number;
  /** cloud / (cloud + handedToBrowser + waitedForUser): how much the servers finished alone, 0–1. */
  cloudShare: number;
}
