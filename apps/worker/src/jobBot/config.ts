import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  DEFAULT_JOB_BOT_SETTINGS, EMPTY_APPLICATION_PROFILE, resumeRoles,
  type ApplicationProfile, type BotPlatform, type BotSearch, type JobBotSettings, type ResumeProfile,
} from '@parakeet/shared';
import { sql } from '../db.js';
import { env } from '../env.js';

// What the bot knows about the candidate, built from Friday Jobs: the Application Profile (contact
// details, CTC, notice period, saved answers), the parsed resume (years per skill), job preferences
// (what to search for) and the bot's own settings. Sessions and the resume file sit in the worker's
// JOB_BOT_HOME, one folder per user.

export type Platform = BotPlatform;
export type Search = BotSearch;

export interface Config {
  dailyLimit: Record<Platform, number>;
  searches: Search[];
  postedWithinDays: 1 | 3 | 7;
  totalExperienceYears: number;
  skillYears: Record<string, number>;
  skillDefault: number;
  skipTitles: string[];
  skipCompanies: string[];
  resumePath: string;
  profile: {
    firstName: string; lastName: string; email: string; phone: string; phoneCountry: string; city: string;
    currentCtcLpa: number; expectedCtcLpa: number; noticePeriodDays: number; currentCompany: string; currentTitle: string;
    linkedinUrl: string; githubUrl: string; portfolioUrl: string; highestEducation: string;
    willingToRelocate: boolean; authorizedToWorkInIndia: boolean; needsSponsorship: boolean; comfortableWithHybridOrOnsite: boolean;
  };
  /** Question pattern (regular expression, case-insensitive) → answer. */
  answers: Record<string, string>;
  pauseSeconds: [number, number];
  /** Answer remaining questions about the candidate's work from the resume, with the bulk model. */
  letAiDecide: boolean;
  resumeText: string;
}

export const BOT_HOME = env.JOB_BOT_HOME ?? join(homedir(), '.friday-job-bot');
export const userDir = (userId: string) => join(BOT_HOME, userId);
export const profileDir = (userId: string) => join(userDir(userId), 'chrome-profile');

/** "₹18 LPA", "18 lakhs", "1,800,000", "18" → 18 (lakhs a year); 0 when not said. */
export function lakhs(s: string): number {
  const t = s.toLowerCase().replace(/,/g, '');
  const n = Number(/(\d+(\.\d+)?)/.exec(t)?.[1] ?? NaN);
  if (!Number.isFinite(n) || n <= 0) return 0;
  if (/cr|crore/.test(t)) return n * 100;
  if (/l\b|lakh|lac|lpa/.test(t)) return n;
  return n >= 10_000 ? Math.round((n / 100_000) * 10) / 10 : n;
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export async function loadSettings(userId: string): Promise<JobBotSettings> {
  const [row] = await sql<{ settings: Partial<JobBotSettings> }[]>`select settings from public.job_bot_settings where user_id = ${userId}`;
  const s = row?.settings ?? {};
  return {
    ...DEFAULT_JOB_BOT_SETTINGS,
    ...s,
    platforms: { ...DEFAULT_JOB_BOT_SETTINGS.platforms, ...(s.platforms ?? {}) },
  };
}

/** Searches when none are set: the user's preferred roles (or resume titles) in their preferred cities, or India. */
export async function effectiveSearches(userId: string, settings: JobBotSettings): Promise<Search[]> {
  if (settings.searches.length) return settings.searches;
  const [prefs] = await sql<{ roles: string[]; locations: string[] }[]>`select roles, locations from public.job_preferences where user_id = ${userId}`;
  const [resume] = await sql<{ parsed_json: ResumeProfile | null }[]>`
    select parsed_json from public.resumes where user_id = ${userId} order by created_at desc limit 1`;
  const roles = prefs?.roles.length ? prefs.roles : resumeRoles(resume?.parsed_json ?? null);
  const cities = (prefs?.locations ?? []).filter((l) => !/^(remote|anywhere)$/i.test(l.trim()));
  const where = cities.length ? cities : ['India'];
  return roles.slice(0, 4).flatMap((r) => where.slice(0, 2).map((location) => ({ keywords: r, location })));
}

/**
 * The bot's view of the candidate, with their resume file written to their folder. `missing` lists what
 * must be filled in before the bot can apply at all.
 */
export async function buildConfig(userId: string): Promise<{ config: Config; missing: string[] }> {
  const settings = await loadSettings(userId);
  const [user] = await sql<{ email: string }[]>`select email from public.users where id = ${userId}`;
  const [row] = await sql<{ data: Partial<ApplicationProfile> }[]>`select data from public.application_profiles where user_id = ${userId}`;
  const p: ApplicationProfile = { ...EMPTY_APPLICATION_PROFILE, ...(row?.data ?? {}) };
  const [resume] = await sql<{ file: Buffer | null; file_name: string; parsed_json: ResumeProfile | null; text: string | null }[]>`
    select file, file_name, parsed_json, text from public.resumes where user_id = ${userId} order by created_at desc limit 1`;
  const r = resume?.parsed_json ?? null;

  mkdirSync(userDir(userId), { recursive: true, mode: 0o700 });
  const ext = /\.docx$/i.test(resume?.file_name ?? '') ? 'docx' : 'pdf';
  const resumePath = join(userDir(userId), `resume.${ext}`);
  if (resume?.file) writeFileSync(resumePath, resume.file, { mode: 0o600 });

  const latest = r?.experience?.[0];
  const skillYears = Object.fromEntries(
    (r?.skills ?? []).filter((s) => s.name).map((s) => [s.name.toLowerCase(), s.years ?? (r?.totalYearsExperience ?? 0)]),
  );
  const answers: Record<string, string> = {};
  // A saved answer applies wherever its question appears in a field's label (labels add "*" and repeat text).
  for (const a of p.savedAnswers) if (a.question.trim() && a.answer.trim()) answers[esc(a.question.trim().replace(/[\s?*]+$/, ''))] = a.answer;
  const india = p.workAuthorization.find((w) => /india/i.test(w.country));

  const missing = [
    !resume?.file && 'a resume file (upload your resume again)',
    !(p.phone || '').trim() && 'phone number (Application Profile)',
    !(p.firstName || '').trim() && 'first name (Application Profile)',
    !(p.email || user?.email) && 'email',
  ].filter((m): m is string => Boolean(m));

  const config: Config = {
    dailyLimit: Object.fromEntries(Object.entries(settings.platforms).map(([k, v]) => [k, v.enabled ? v.dailyLimit : 0])) as Record<Platform, number>,
    searches: await effectiveSearches(userId, settings),
    postedWithinDays: settings.postedWithinDays,
    totalExperienceYears: Math.round(r?.totalYearsExperience ?? 0),
    skillYears,
    // A skill the resume doesn't list: honest zero.
    skillDefault: 0,
    skipTitles: settings.skipTitles,
    skipCompanies: settings.skipCompanies,
    resumePath,
    profile: {
      firstName: p.firstName, lastName: p.lastName, email: p.email || user?.email || '', phone: p.phone, phoneCountry: 'India (+91)',
      city: p.city, currentCtcLpa: lakhs(p.currentSalary), expectedCtcLpa: lakhs(p.expectedSalary), noticePeriodDays: p.noticePeriodDays ?? 30,
      currentCompany: latest?.company ?? '', currentTitle: latest?.title ?? '',
      linkedinUrl: p.linkedin, githubUrl: p.github, portfolioUrl: p.portfolio || p.website,
      highestEducation: r?.education?.[0]?.degree ?? '',
      willingToRelocate: p.willingToRelocate ?? true,
      authorizedToWorkInIndia: india ? india.authorized : true,
      needsSponsorship: india ? india.needsSponsorship : false,
      comfortableWithHybridOrOnsite: p.workplaces.length ? p.workplaces.some((w) => w !== 'remote') : true,
    },
    answers,
    pauseSeconds: [25, 60],
    letAiDecide: p.letAiDecide,
    resumeText: resume?.text ?? '',
  };
  return { config, missing };
}
