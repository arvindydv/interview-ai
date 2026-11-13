import { mkdirSync } from 'node:fs';
import { chromium, type BrowserContext, type Page } from 'playwright-core';
import { chromePath } from '../../autoapply/cloud.js';
import { env } from '../../env.js';
import { profileDir } from './config.js';

// Chrome for the platform bot, with a profile per user in JOB_BOT_HOME holding their sessions.
// Applying runs headless: a separate background process, nothing opens on screen. Signing in (and
// clearing a site's verification) opens a visible window, the one time the user needs to act. The bot
// doesn't disguise itself and doesn't solve CAPTCHAs: a check in a headless run stops that platform
// until the user clears it with "Verify".

const interactive = new WeakSet<BrowserContext>();

/** Thrown when a site wants the user to verify (sign in again, CAPTCHA, OTP) during a headless run. */
export class VerificationNeeded extends Error {}

/** The site refuses this browser outright (e.g. Naukri's CDN answers background Chrome with 403 Access Denied). */
export class SiteBlocked extends Error {}

export async function openBrowser(userId: string, { visible }: { visible: boolean }): Promise<BrowserContext> {
  mkdirSync(profileDir(userId), { recursive: true, mode: 0o700 });
  const context = await chromium.launchPersistentContext(profileDir(userId), {
    executablePath: chromePath(env.JOB_BOT_CHROME),
    headless: !visible,
    viewport: visible ? null : { width: 1366, height: 900 },
    args: visible ? ['--start-maximized'] : [],
  });
  if (visible) interactive.add(context);
  return context;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const between = ([min, max]: [number, number]) => sleep((min + Math.random() * (max - min)) * 1000);

/** A sign-in wall, checkpoint, CAPTCHA or "verify you are human" page. */
export async function humanCheck(page: Page): Promise<string | null> {
  const url = page.url();
  if (/\/checkpoint\/|\/challenge|captcha|\/authwall|\/uas\/login|secure\.indeed\.com\/auth|nlogin\/login/i.test(url)) return url;
  const signals = await page
    .locator('iframe[src*="captcha"], iframe[title*="challenge" i], iframe[src*="challenges.cloudflare"], #challenge-form, :text-matches("verify you are (a )?human|security verification|unusual activity|are you a robot", "i")')
    .count()
    .catch(() => 0);
  return signals ? `${url} (verification shown)` : null;
}

/**
 * In a visible window, waits (up to 10 minutes) for the user to clear a check. In a headless run,
 * throws VerificationNeeded at once: the platform is marked "needs verification" and skipped.
 */
export async function waitForYou(page: Page, platform: string): Promise<boolean> {
  if (/^access denied$/i.test((await page.title().catch(() => '')).trim())) {
    throw new SiteBlocked(`${platform} refused the background browser (Access Denied)`);
  }
  const check = await humanCheck(page);
  if (!check) return true;
  if (!interactive.has(page.context())) throw new VerificationNeeded(`${platform} asked to verify it's you (${check})`);
  await page.bringToFront().catch(() => {});
  for (let i = 0; i < 120; i++) {
    await sleep(5000);
    if (!(await humanCheck(page))) return true;
  }
  return false;
}
