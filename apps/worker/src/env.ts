import { existsSync } from 'node:fs';
import { z } from 'zod';

if (existsSync('.env')) process.loadEnvFile('.env');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  REDIS_URL: z.url().default('redis://127.0.0.1:6380'),
  DATABASE_URL: z.url().default('postgresql://postgres:postgres@127.0.0.1:54322/postgres'),

  // Resume analysis: Claude (ANTHROPIC_API_KEY, or any source the SDK resolves) or OpenRouter. Without
  // either, resumes are still used for answers as full text, just not analysed.
  ANTHROPIC_API_KEY: z.string().optional(),
  OPENROUTER_API_KEY: z.string().optional(),
  /**
   * Resume analysis runs before the interview, so quality matters more than speed (spec A4). Ids with
   * a "/" go through OpenRouter. Default: claude-sonnet-5-5, or anthropic/claude-sonnet-5.5 when only
   * OPENROUTER_API_KEY is set.
   */
  LLM_PROFILE_MODEL: z.string().optional(),
  /** Mock-interview questions and scoring (spec F1/F2). Defaults to LLM_PROFILE_MODEL, then the same default. */
  LLM_PRACTICE_MODEL: z.string().optional(),
  /** Friday Jobs resume tailoring. Defaults to LLM_PROFILE_MODEL, then the same default. */
  LLM_TAILOR_MODEL: z.string().optional(),
  /** Python with PyMuPDF and python-docx, for editing resume files (python/requirements.txt). Default:
   * apps/worker/.venv/bin/python when it exists, otherwise python3. */
  PYTHON_BIN: z.string().optional(),
  /** Auto Apply's bulk tailoring and form answers: cheaper than LLM_TAILOR_MODEL, as it runs up to 100 times a
   * day per user. Default: claude-haiku-5-5, or anthropic/claude-haiku-5.5 when only OPENROUTER_API_KEY is set. */
  LLM_BULK_MODEL: z.string().optional(),
  /** Links in emails: the website and the Friday Jobs site. */
  APP_URL: z.url().default('http://localhost:3100'),
  JOBS_URL: z.url().default('http://localhost:3300'),

  // Brevo transactional SMTP. Without credentials (dev only) mail goes to the local Mailpit inbox.
  SMTP_HOST: z.string().default('smtp-relay.brevo.com'),
  SMTP_PORT: z.coerce.number().default(587),
  BREVO_SMTP_LOGIN: z.string().optional(),
  BREVO_SMTP_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default('Friday AI <no-reply@localhost>'),
  EMAIL_REPLY_TO: z.string().optional(),

  // Friday Jobs: job search engines, searched for the roles users want. Each is skipped until its key
  // is set. Adzuna: developer.adzuna.com (the free plan allows 250 calls a day, 2,500 a month; a
  // commercial product needs their licence). Jooble: jooble.org/api/about.
  ADZUNA_APP_ID: z.string().optional(),
  ADZUNA_APP_KEY: z.string().optional(),
  /** Searches per sync (four a day): 20 keeps within the free plan's 2,500 a month. */
  /**
   * Adzuna's terms need a commercial licence after a 14-day trial, so it isn't synced, even with keys
   * set, until this is "true" (once the licence is confirmed). The controlled probe
   * (test/adzuna.probe.ts) reads the keys directly and is unaffected.
   */
  ADZUNA_SYNC_ENABLED: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  ADZUNA_CALLS_PER_SYNC: z.coerce.number().int().min(1).max(200).default(20),
  JOOBLE_API_KEY: z.string().optional(),
  /** Jooble keys are issued for one country's site. */
  JOOBLE_HOST: z.string().default('jooble.org'),
  /**
   * Searches per sync (one sync a day). Jooble's free key allows 500 requests in its lifetime, not per
   * month: 4 a day lasts about four months. Ask Jooble for a partner key before raising it.
   */
  JOOBLE_CALLS_PER_SYNC: z.coerce.number().int().min(1).max(200).default(4),
  /**
   * JSearch (RapidAPI: rapidapi.com/letscrape-6bRBa3QguO5/api/jsearch, key from the RapidAPI dashboard):
   * Google for Jobs results, which include postings from LinkedIn, Naukri and Indeed. Off until set.
   */
  JSEARCH_API_KEY: z.string().optional(),
  /** Searches per sync (one sync a day): 6 keeps within the free plan's 200 requests a month. */
  JSEARCH_CALLS_PER_SYNC: z.coerce.number().int().min(1).max(200).default(6),
  /** Only postings this recent: today, 3days, week or month. */
  JSEARCH_DATE_POSTED: z.enum(['today', '3days', 'week', 'month']).default('3days'),

  // Friday Jobs cold email: finds recruiters' and hiring managers' addresses by company domain
  // (hunter.io, API key from hunter.io/api-keys). Unset: only addresses in the posting, or ones the
  // candidate types, are used. Results are cached a month per company (public.contact_lookups).
  HUNTER_API_KEY: z.string().optional(),
  /** Cold emails: Sonnet-tier by default, as they go to a person in the candidate's name. */
  LLM_COLD_EMAIL_MODEL: z.string().optional(),

  // Authorized ATS submission (src/submit): employer/partner API keys in public.ats_credentials are
  // AES-256-GCM encrypted with this key (32 bytes, base64: openssl rand -base64 32). Unset: no API submission.
  ATS_CREDENTIALS_KEY: z.string().optional(),
  /**
   * Providers whose employer forms Friday's servers may fill (comma-separated, e.g. "greenhouse,lever").
   * Empty (the default): server-side form filling is off and those applications go to the candidate's
   * browser (extension) or Assisted Apply. An operator lists a provider only once it's approved.
   */
  AUTO_APPLY_CLOUD_FORM_PROVIDERS: z.string().default(''),

  // Data retention (queues/retention.ts), in days. Each policy is documented there.
  RETENTION_EVENT_DETAIL_DAYS: z.coerce.number().int().min(7).default(90),
  RETENTION_EVIDENCE_TEXT_DAYS: z.coerce.number().int().min(30).default(180),
  RETENTION_UNSENT_RESUME_FILE_DAYS: z.coerce.number().int().min(7).default(30),
  RETENTION_SOURCE_RUN_DAYS: z.coerce.number().int().min(7).default(90),
  RETENTION_AUDIT_LOG_DAYS: z.coerce.number().int().min(90).default(400),
  RETENTION_CLOSED_LISTING_DAYS: z.coerce.number().int().min(14).default(60),

  // EXPERIMENTAL platform bot (apps/worker/src/experimental): LinkedIn/Indeed/Naukri automation in the
  // user's own session. Off by default and never scheduled: those sites' terms prohibit automated
  // applications, so production uses Assisted Apply. Both this flag and the allowlist must match the worker's.
  JOB_BOT_EXPERIMENTAL: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  /** Accounts allowed to use the experimental bot (comma-separated emails). Empty: off for everyone. */
  JOB_BOT_USER_EMAILS: z.string().default(''),
  /** Where sessions and resume copies live, one folder per user. Default ~/.friday-job-bot. */
  JOB_BOT_HOME: z.string().optional(),
  /** Chrome for the bot (default: the system Chrome or Chromium). */
  JOB_BOT_CHROME: z.string().optional(),
});

// Empty values in .env mean "not set".
export const env = schema.parse(Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== '')));

if (env.NODE_ENV === 'production' && !(env.BREVO_SMTP_LOGIN && env.BREVO_SMTP_KEY)) {
  throw new Error('BREVO_SMTP_LOGIN and BREVO_SMTP_KEY are required in production');
}
