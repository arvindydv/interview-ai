import type { Locator, Page } from 'playwright-core';
import { sleep, waitForYou } from '../browser.js';
import { fillForm } from '../form.js';
import type { JobRef, PlatformBot, Result } from './types.js';

// Indeed: searches "Easily apply" jobs newest first, opens each one and steps through Indeed Apply
// (smartapply.indeed.com) with your Indeed resume. Jobs that apply on the company's site are skipped.
// Indeed shows verification pages often; the bot waits for you to clear them.

const ORIGIN = 'https://in.indeed.com';
/** Exported for the selector test. */
export const INDEED_SELECTORS = {
  card: 'a[data-jk]',
  cardCompany: '[data-testid="company-name"]',
  cardLocation: '[data-testid="text-location"]',
  title: 'h1[data-testid="jobsearch-JobInfoHeader-title"], h1',
  company: '[data-testid="inlineHeader-companyName"], [data-company-name="true"]',
  applied: 'text=/^Applied$|You applied/i',
  apply: '#indeedApplyButton, button:has-text("Apply now")',
  external: '#applyButtonLinkContainer a, button:has-text("Apply on company site"), a:has-text("Apply on company site")',
  submit: 'button:has-text("Submit your application"), button:has-text("Submit application")',
  forward: 'button:has-text("Continue"), button:has-text("Review your application")',
  error: '[role="alert"], [class*="error" i]:visible',
  success: 'text=/application has been submitted|your application has been sent|you.ve applied/i',
};
const S = INDEED_SELECTORS;

const text = async (l: Locator) => ((await l.first().textContent({ timeout: 3000 }).catch(() => '')) ?? '').replace(/\s+/g, ' ').trim();

export const indeed: PlatformBot = {
  platform: 'indeed',
  loginUrl: 'https://secure.indeed.com/account/login',
  homeUrl: 'https://in.indeed.com/',

  async isSignedIn(page) {
    const cookies = await page.context().cookies(['https://in.indeed.com', 'https://secure.indeed.com']);
    return cookies.some((c) => /^(SOCK|SHOE|PPID)$/.test(c.name));
  },

  async *search(page, search, config) {
    for (let start = 0; start < 50; start += 10) {
      const params = new URLSearchParams({
        q: search.keywords,
        l: /^india$/i.test(search.location) ? '' : search.location,
        fromage: String(config.postedWithinDays),
        sort: 'date',
        start: String(start),
        sc: '0kf:attr(DSQF7);',
      });
      await page.goto(`${ORIGIN}/jobs?${params}`, { waitUntil: 'domcontentloaded' });
      if (!(await waitForYou(page, 'Indeed'))) return;
      await page.locator(S.card).first().waitFor({ timeout: 15_000 }).catch(() => {});
      const cards = await page.locator(S.card).all();
      if (!cards.length) return;
      for (const card of cards) {
        const id = (await card.getAttribute('data-jk')) ?? '';
        if (!id) continue;
        const box = card.locator('xpath=ancestor::*[contains(@class,"job_seen_beacon") or contains(@class,"cardOutline")][1]');
        yield { id, title: await text(card), company: await text(box.locator(S.cardCompany)), location: await text(box.locator(S.cardLocation)), url: `${ORIGIN}/viewjob?jk=${id}` };
      }
      if (cards.length < 10) return;
    }
  },

  async apply(page, job, config, dryRun): Promise<Result> {
    const skip = config.skipTitles.find((t) => job.title.toLowerCase().includes(t.toLowerCase()))
      ?? config.skipCompanies.find((c) => job.company.toLowerCase().includes(c.toLowerCase()));
    if (skip) return { outcome: 'skipped', detail: `matches "${skip}" in your skip list` };
    await page.goto(job.url, { waitUntil: 'domcontentloaded' });
    if (!(await waitForYou(page, 'Indeed'))) return { outcome: 'failed', detail: 'verification not cleared' };
    job.title = (await text(page.locator(S.title))).replace(/- job post$/i, '').trim() || job.title;
    job.company = (await text(page.locator(S.company))) || job.company;
    if (await page.locator(S.applied).first().isVisible({ timeout: 1500 }).catch(() => false)) return { outcome: 'already_applied', detail: '' };
    const apply = page.locator(S.apply).first();
    if (!(await apply.isVisible({ timeout: 5000 }).catch(() => false))) {
      return (await page.locator(S.external).count()) ? { outcome: 'external', detail: 'applies on the company site' } : { outcome: 'skipped', detail: 'no apply button (closed?)' };
    }
    // Indeed Apply opens in this tab or a new one.
    const popup = page.context().waitForEvent('page', { timeout: 8000 }).catch(() => null);
    await apply.click();
    const flow: Page = (await popup) ?? page;
    await flow.waitForLoadState('domcontentloaded').catch(() => {});
    const close = async () => {
      if (flow !== page) await flow.close().catch(() => {});
    };

    let lastUrl = '';
    let same = 0;
    for (let step = 0; step < 15; step++) {
      await sleep(1500);
      if (!(await waitForYou(flow, 'Indeed'))) {
        await close();
        return { outcome: 'failed', detail: 'verification not cleared' };
      }
      if (await flow.locator(S.success).first().isVisible().catch(() => false)) {
        await close();
        return { outcome: 'applied', detail: '' };
      }
      const unanswered = await fillForm(flow, flow.locator('main, body').first(), config);
      if (unanswered.length) {
        await close();
        return { outcome: 'needs_answer', detail: unanswered.join(' | ') };
      }
      const submit = flow.locator(S.submit).first();
      if (await submit.isVisible().catch(() => false)) {
        if (dryRun) {
          await close();
          return { outcome: 'dry-run', detail: 'filled every step; stopped before Submit' };
        }
        await submit.click();
        const ok = await flow.locator(S.success).first().waitFor({ timeout: 15_000 }).then(() => true, () => false);
        await close();
        return ok ? { outcome: 'applied', detail: '' } : { outcome: 'failed', detail: 'submitted, but no confirmation shown (check Indeed)' };
      }
      const forward = flow.locator(S.forward).first();
      if (!(await forward.isVisible().catch(() => false))) {
        await close();
        return { outcome: 'failed', detail: `no Continue or Submit button (${flow.url()})` };
      }
      await forward.click();
      same = flow.url() === lastUrl ? same + 1 : 0;
      lastUrl = flow.url();
      if (same >= 2) {
        const errors = (await flow.locator(S.error).allTextContents().catch(() => [])).map((e) => e.trim()).filter(Boolean);
        await close();
        return { outcome: 'needs_answer', detail: `Indeed didn't move on: ${errors.join(' | ') || 'a required field is empty'}` };
      }
    }
    await close();
    return { outcome: 'failed', detail: 'too many steps' };
  },
};
