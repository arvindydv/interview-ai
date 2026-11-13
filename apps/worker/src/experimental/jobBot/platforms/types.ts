import type { Page } from 'playwright-core';
import type { BotOutcome } from '@parakeet/shared';
import type { Config, Platform, Search } from '../config.js';

export interface JobRef {
  id: string;
  title: string;
  company: string;
  location: string;
  url: string;
}

export interface Result {
  /** 'dry-run': filled everything, stopped before submitting (never stored). */
  outcome: BotOutcome | 'dry-run';
  detail: string;
}

export interface PlatformBot {
  platform: Platform;
  /** The site's own sign-in page. */
  loginUrl: string;
  /** A page that needs signing in, to check a session still works. */
  homeUrl: string;
  isSignedIn(page: Page): Promise<boolean>;
  /** Jobs from one search, newest first, that can be applied to on the platform itself. */
  search(page: Page, search: Search, config: Config): AsyncGenerator<JobRef>;
  /** Applies (or, in a dry run, fills everything and stops before submitting). */
  apply(page: Page, job: JobRef, config: Config, dryRun: boolean): Promise<Result>;
}
