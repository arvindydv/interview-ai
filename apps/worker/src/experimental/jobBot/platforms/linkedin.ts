import type { Locator, Page } from 'playwright-core';
import { sleep, waitForYou } from '../browser.js';
import { fillForm } from '../form.js';
import type { JobRef, PlatformBot, Result } from './types.js';

// LinkedIn Easy Apply: searches with the Easy Apply and date filters, opens each job's page, and steps
// through the Easy Apply dialog. Jobs that apply on the company's site are skipped (outcome "external").
// LinkedIn changes its markup often (Nov 2026: generated class names, cards keyed by componentkey, Easy
// Apply as a link): selectors match on stable attributes and text, old and new, and are kept together.
// LinkedIn also caps Easy Apply per account per day; when it says so, LinkedIn stops for the day.

/** Exported for the selector test. */
export const LINKEDIN_SELECTORS = {
  /** Job ids: the redesigned list keys each card "job-card-component-ref-<id>"; the old one used data-occludable-job-id. */
  cardNew: '[componentkey^="job-card-component-ref-"]',
  card: 'li[data-occludable-job-id]',
  title: 'h1, .job-details-jobs-unified-top-card__job-title',
  company: '.job-details-jobs-unified-top-card__company-name, .jobs-unified-top-card__company-name',
  location: '.job-details-jobs-unified-top-card__primary-description-container, .job-details-jobs-unified-top-card__tertiary-description-container',
  easyApply: 'a[aria-label*="Easy Apply" i], button[aria-label*="Easy Apply" i], button.jobs-apply-button:has-text("Easy Apply")',
  externalApply: 'a[aria-label*="Apply" i]:not([aria-label*="Easy" i]), button[aria-label*="Apply" i]:not([aria-label*="Easy" i]), button.jobs-apply-button:has-text("Apply"), a.jobs-apply-button',
  // CSS lists can't mix in Playwright's text= engine; :text-matches() works inside CSS.
  appliedNote: '.jobs-s-apply .artdeco-inline-feedback--success, .post-apply-timeline__entity, :text-matches("^Applied \\\\d+ (minute|hour|day|week)s? ago$", "i")',
  /** LinkedIn's own daily cap on Easy Apply for the account. */
  dailyLimit: 'text=/reached today.s Easy Apply limit/i',
  dialog: '[role="dialog"]:has(button[aria-label*="next step" i]), [role="dialog"]:has(button[aria-label*="Review your application" i]), [role="dialog"]:has(button[aria-label*="Submit application" i]), div[role="dialog"].jobs-easy-apply-modal, div[role="dialog"]:has(.jobs-easy-apply-content), [role="dialog"]:has(form)',
  submit: 'button[aria-label*="Submit application" i], button:has-text("Submit application")',
  review: 'button[aria-label*="Review your application" i], button:has-text("Review")',
  next: 'button[aria-label*="Continue to next step" i], button:has-text("Next")',
  error: '.artdeco-inline-feedback--error',
  followBox: 'label[for="follow-company-checkbox"]',
  dismiss: 'button[aria-label="Dismiss"]',
  discard: 'button[data-control-name="discard_application_confirm_btn"], button:has-text("Discard")',
  sent: 'text=/application (was )?sent|your application was sent/i',
};
const S = LINKEDIN_SELECTORS;

/** LinkedIn won't take more Easy Apply applications from this account today. */
export class LinkedInDailyLimit extends Error {}

const text = async (l: Locator) => ((await l.first().textContent({ timeout: 3000 }).catch(() => '')) ?? '').replace(/\s+/g, ' ').trim();

async function discard(page: Page) {
  await page.locator(S.dismiss).first().click({ timeout: 3000 }).catch(() => {});
  await page.locator(S.discard).first().click({ timeout: 3000 }).catch(() => {});
}

export const linkedin: PlatformBot = {
  platform: 'linkedin',
  loginUrl: 'https://www.linkedin.com/login',
  homeUrl: 'https://www.linkedin.com/feed/',

  async isSignedIn(page) {
    return (await page.context().cookies('https://www.linkedin.com')).some((c) => c.name === 'li_at');
  },

  async *search(page, search, config) {
    for (let start = 0; start < 100; start += 25) {
      const params = new URLSearchParams({
        keywords: search.keywords,
        location: search.location,
        f_AL: 'true',
        f_TPR: `r${config.postedWithinDays * 86400}`,
        sortBy: 'DD',
        start: String(start),
      });
      await page.goto(`https://www.linkedin.com/jobs/search/?${params}`, { waitUntil: 'domcontentloaded' });
      if (!(await waitForYou(page, 'LinkedIn'))) return;
      await page.locator(`${S.cardNew}, ${S.card}`).first().waitFor({ timeout: 15_000 }).catch(() => {});
      // The list loads more cards as it scrolls: scroll to the last card until no new ones appear.
      const ids = new Set<string>();
      for (let round = 0; round < 6; round++) {
        const before = ids.size;
        for (const id of await page.locator(S.cardNew).evaluateAll((els) => els.map((e) => (e.getAttribute('componentkey') ?? '').replace('job-card-component-ref-', '')))) {
          if (/^\d+$/.test(id)) ids.add(id);
        }
        for (const id of await page.locator(S.card).evaluateAll((els) => els.map((e) => e.getAttribute('data-occludable-job-id') ?? ''))) if (/^\d+$/.test(id)) ids.add(id);
        if (ids.size === before && round > 0) break;
        await page.locator(`${S.cardNew}, ${S.card}`).last().scrollIntoViewIfNeeded().catch(() => {});
        await sleep(1500);
      }
      if (!ids.size) return;
      for (const id of ids) yield { id, title: '', company: '', location: '', url: `https://www.linkedin.com/jobs/view/${id}/` };
      if (ids.size < 20) return;
    }
  },

  async apply(page, job, config, dryRun): Promise<Result> {
    await page.goto(job.url, { waitUntil: 'domcontentloaded' });
    if (!(await waitForYou(page, 'LinkedIn'))) return { outcome: 'failed', detail: 'verification not cleared' };
    await page.locator(`${S.easyApply}, ${S.externalApply}, ${S.title}`).first().waitFor({ timeout: 15_000 }).catch(() => {});
    // The redesigned page has no h1; its title reads "<job> | <company> | LinkedIn".
    // Job titles can contain " | " themselves: the company is the part before "LinkedIn".
    const parts = (await page.title()).split(' | ');
    if (parts.at(-1) === 'LinkedIn') parts.pop();
    const companyPart = parts.length > 1 ? parts.pop() : '';
    job.title = (await text(page.locator('h1'))) || parts.join(' | ').trim();
    job.company = (await text(page.locator(S.company))) || (companyPart ?? '').trim();
    job.location = (await text(page.locator(S.location))).split('·')[0].trim();

    const skip = config.skipTitles.find((t) => job.title.toLowerCase().includes(t.toLowerCase()))
      ?? config.skipCompanies.find((c) => job.company.toLowerCase().includes(c.toLowerCase()));
    if (skip) return { outcome: 'skipped', detail: `matches "${skip}" in your skip list` };
    if (await page.locator(S.appliedNote).count()) return { outcome: 'already_applied', detail: '' };
    const easy = page.locator(S.easyApply).first();
    if (!(await easy.isVisible({ timeout: 5000 }).catch(() => false))) {
      return (await page.locator(S.externalApply).count())
        ? { outcome: 'external', detail: 'applies on the company site' }
        : { outcome: 'skipped', detail: 'no apply button (closed?)' };
    }
    await easy.click();
    const opened = await Promise.race([
      page.locator(S.dialog).first().waitFor({ timeout: 15_000 }).then(() => 'form' as const),
      page.locator(S.dailyLimit).first().waitFor({ timeout: 15_000 }).then(() => 'limit' as const),
    ]).catch(() => null);
    if (opened === 'limit') {
      await page.locator('button:has-text("Got it"), button[aria-label="Dismiss"]').first().click().catch(() => {});
      throw new LinkedInDailyLimit('LinkedIn says this account reached today’s Easy Apply limit');
    }
    if (!opened) return { outcome: 'failed', detail: 'the Easy Apply form didn’t open' };
    const dialog = page.locator(S.dialog).first();

    let lastStep = '';
    let stuck = 0;
    for (let step = 0; step < 15; step++) {
      await sleep(800);
      const unanswered = await fillForm(page, dialog, config);
      if (unanswered.length) {
        await discard(page);
        return { outcome: 'needs_answer', detail: unanswered.join(' | ') };
      }
      if (await dialog.locator(S.submit).isVisible().catch(() => false)) {
        if (await page.locator(S.followBox).isVisible().catch(() => false)) {
          const checked = await page.locator('#follow-company-checkbox').isChecked().catch(() => false);
          if (checked) await page.locator(S.followBox).click().catch(() => {});
        }
        if (dryRun) {
          await discard(page);
          return { outcome: 'dry-run', detail: 'filled every step; stopped before Submit' };
        }
        await dialog.locator(S.submit).click();
        const sent = await page.locator(S.sent).first().waitFor({ timeout: 15_000 }).then(() => true, () => false);
        await page.locator(S.dismiss).first().click({ timeout: 3000 }).catch(() => {});
        return sent ? { outcome: 'applied', detail: '' } : { outcome: 'failed', detail: 'submitted, but no confirmation shown (check LinkedIn)' };
      }
      const forward = (await dialog.locator(S.review).isVisible().catch(() => false)) ? S.review : S.next;
      if (!(await dialog.locator(forward).isVisible().catch(() => false))) {
        await discard(page);
        return { outcome: 'failed', detail: 'no Next, Review or Submit button in the dialog' };
      }
      await dialog.locator(forward).click();
      await sleep(1000);
      const errors = await dialog.locator(S.error).allTextContents().catch(() => []);
      const heading = await text(dialog.locator('h3, .t-16'));
      if (errors.length) {
        const progress = `${heading}:${errors.join('|')}`;
        stuck = progress === lastStep ? stuck + 1 : 0;
        lastStep = progress;
        if (stuck >= 1) {
          await discard(page);
          return { outcome: 'needs_answer', detail: `LinkedIn says: ${errors.map((e) => e.trim()).join(' | ')} (on "${heading}")` };
        }
      }
    }
    await discard(page);
    return { outcome: 'failed', detail: 'too many steps' };
  },
};
