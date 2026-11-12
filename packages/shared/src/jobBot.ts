// Friday Jobs platform bot: applies for the user on LinkedIn (Easy Apply), Naukri and Indeed (Easily
// apply) in the background, from the worker, in a headless Chrome signed in as the user. Sessions are
// made by the user signing in once on each site's own login page (in a window the worker opens); no
// password is stored. Available only to the accounts the worker's JOB_BOT_USER_EMAILS lists, on the
// machine whose worker holds their sessions. Answers come from the Application Profile, the resume and
// saved answers; a question nothing answers skips the job and is listed for the user to answer.

export const BOT_PLATFORMS = ['linkedin', 'naukri', 'indeed'] as const;
export type BotPlatform = (typeof BOT_PLATFORMS)[number];

export const BOT_PLATFORM_LABELS: Record<BotPlatform, string> = { linkedin: 'LinkedIn', naukri: 'Naukri', indeed: 'Indeed' };

export const BOT_LIMITS = { maxPerDay: 50, defaultPerDay: 30, maxSearches: 10, pageSize: 50 } as const;

export interface BotSearch {
  keywords: string;
  /** City, or "India". */
  location: string;
}

export interface JobBotSettings {
  /** Runs on its schedule (every two hours, 9:00–21:00 IST) while on. */
  enabled: boolean;
  platforms: Record<BotPlatform, { enabled: boolean; dailyLimit: number }>;
  /** Empty: the roles and cities in the user's job preferences (or resume titles), across India. */
  searches: BotSearch[];
  postedWithinDays: 1 | 3 | 7;
  skipTitles: string[];
  skipCompanies: string[];
}

export const DEFAULT_JOB_BOT_SETTINGS: JobBotSettings = {
  enabled: false,
  platforms: {
    linkedin: { enabled: true, dailyLimit: BOT_LIMITS.defaultPerDay },
    naukri: { enabled: true, dailyLimit: BOT_LIMITS.defaultPerDay },
    indeed: { enabled: true, dailyLimit: BOT_LIMITS.defaultPerDay },
  },
  searches: [],
  postedWithinDays: 1,
  skipTitles: ['intern', 'director'],
  skipCompanies: [],
};

/**
 * connected: signed in and working. disconnected: never signed in, or signed out.
 * needs_verification: the site asked to verify it's you (CAPTCHA, OTP, checkpoint); the bot stops there
 * until the user clears it in the window "Verify" opens. connecting: that window is open now.
 */
export type BotSessionStatus = 'connected' | 'disconnected' | 'needs_verification' | 'connecting' | 'access_restricted';

/**
 * assisted: a job the candidate found themselves; Friday tailored the resume, the candidate submits on
 * the site and then confirms (evidence 'user_reported').
 */
export type BotOutcome = 'applied' | 'skipped' | 'needs_answer' | 'failed' | 'already_applied' | 'external' | 'assisted';

/**
 * How we know an application was submitted. verified: the site's own confirmation was seen after the
 * bot submitted. user_reported: the candidate submitted it and told us. Never inferred from a click.
 */
export type BotEvidence = 'verified' | 'user_reported';

/** An access restriction (site refused the bot) is retried automatically only after this long. */
export const BOT_RESTRICTED_RETRY_HOURS = 24;

export interface BotPlatformStatus {
  platform: BotPlatform;
  status: BotSessionStatus;
  message: string | null;
  /** For access_restricted: when the bot will try the site again by itself. */
  retryAfter: string | null;
  appliedToday: number;
  appliedTotal: number;
  lastRunAt: string | null;
}

export interface JobBotState {
  /** This account may use the bot (JOB_BOT_USER_EMAILS). */
  available: boolean;
  settings: JobBotSettings;
  platforms: BotPlatformStatus[];
  /** A run is queued or running. */
  running: boolean;
  /** Searches actually used when settings.searches is empty. */
  effectiveSearches: BotSearch[];
  /** Questions the bot couldn't answer, most frequent first: answer them and it applies next run. */
  questions: { question: string; jobs: number }[];
  /** What's missing for the bot to apply at all (resume file, phone…). */
  missing: string[];
}

export interface BotApplication {
  id: string;
  platform: BotPlatform;
  title: string;
  company: string;
  location: string;
  url: string;
  outcome: BotOutcome;
  detail: string | null;
  evidence: BotEvidence | null;
  /** The resume tailored for this job, when there is one. */
  tailoredResumeId: string | null;
  tailorStatus: 'tailoring' | 'ready' | 'failed' | null;
  at: string;
}

/** POST /v1/job-bot/assisted: a job the candidate found, to tailor their resume for. */
export interface AssistedJobInput {
  platform: BotPlatform;
  url: string;
  title: string;
  company: string;
  /** The job description, pasted from the site (sites like Naukri can't be read by Friday). */
  description: string;
}

export interface BotApplicationPage {
  items: BotApplication[];
  total: number;
  page: number;
  pageSize: number;
}
