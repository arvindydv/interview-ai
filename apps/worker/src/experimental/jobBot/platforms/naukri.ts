import type { Locator, Page } from 'playwright-core';
import { answerFor, pickOption, type Question } from '../answer.js';
import { sleep, waitForYou } from '../browser.js';
import type { Config } from '../config.js';
import { answerFromResume } from '../llm.js';
import type { JobRef, PlatformBot, Result } from './types.js';

// Naukri: searches newest first (by experience and age), opens each job and clicks Apply. Jobs that
// apply on the company's site are skipped. Some employers ask questions in a chat panel after Apply;
// each is answered from your config, or the job is left and the question listed. Clicking Apply on
// Naukri is itself the application, so a dry run stops before it.

/** Exported for the selector test. */
export const NAUKRI_SELECTORS = {
  card: '.srp-jobtuple-wrapper[data-job-id], article.jobTuple[data-job-id], div[data-job-id].cust-job-tuple',
  cardTitle: 'a.title',
  cardCompany: '.comp-name, a.subTitle',
  cardLocation: '.locWdth, .loc-wrap, .location',
  title: 'h1',
  company: '[class*="jd-header-comp-name"] a, .jd-header-comp-name a',
  applied: '#already-applied, button:has-text("Applied")',
  companySite: '#company-site-button, button:has-text("Apply on company site")',
  apply: '#apply-button, button.apply-button, button:text-is("Apply")',
  success: 'text=/successfully applied|application (has been )?submitted|applied successfully/i',
  chat: '.chatbot_DrawerContentWrapper, [class*="chatbot_Drawer"]',
  botMessage: '.botMsg, [class*="botMsg"]',
  chatRadio: '.ssrc__radio-btn-container, [class*="singleselect-radiobutton"] label',
  chatCheckbox: '.mcc__label, [class*="multicheckbox"] label',
  chatInput: 'div[contenteditable="true"], .chatbot_InputContainer input, textarea',
  chatSend: '.sendMsg, [class*="sendMsg"], button:has-text("Save")',
  chatClose: '.crossIcon, [class*="chatBot-close"], [class*="crossIcon"]',
};
const S = NAUKRI_SELECTORS;

const text = async (l: Locator) => ((await l.first().textContent({ timeout: 3000 }).catch(() => '')) ?? '').replace(/\s+/g, ' ').trim();
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

async function answerChat(page: Page, config: Config, dryRun: boolean): Promise<Result | null> {
  const chat = page.locator(S.chat).first();
  if (!(await chat.isVisible({ timeout: 4000 }).catch(() => false))) return null;
  let last = '';
  for (let i = 0; i < 20; i++) {
    await sleep(1200);
    if (await page.locator(S.success).first().isVisible().catch(() => false)) return { outcome: 'applied', detail: 'answered the employer\'s questions' };
    if (!(await chat.isVisible().catch(() => false))) break;
    const question = (await chat.locator(S.botMessage).allTextContents()).map((t) => t.trim()).filter(Boolean).at(-1) ?? '';
    if (!question || question === last) continue;
    last = question;
    const radios = chat.locator(S.chatRadio);
    const checks = chat.locator(S.chatCheckbox);
    const options = (await radios.count()) ? await radios.allTextContents() : (await checks.count()) ? await checks.allTextContents() : [];
    const q: Question = { label: question, kind: options.length ? 'radio' : /\b(years|number|how many|ctc|salary|lakh|days)\b/i.test(question) ? 'number' : 'text', options };
    const answer = answerFor(q, config) ?? (await answerFromResume(q, config));
    const choice = answer && options.length ? pickOption(answer, options.map((o) => o.trim())) : answer;
    if (!choice) {
      await chat.locator(S.chatClose).first().click().catch(() => {});
      return { outcome: 'needs_answer', detail: options.length ? `${question} (options: ${options.join(' / ')})` : question };
    }
    if (dryRun) {
      await chat.locator(S.chatClose).first().click().catch(() => {});
      return { outcome: 'dry-run', detail: `would answer "${question}" with "${choice}"` };
    }
    if (options.length) {
      const pool = (await radios.count()) ? radios : checks;
      await pool.nth(options.map((o) => o.trim()).indexOf(choice)).click();
    } else {
      const input = chat.locator(S.chatInput).last();
      await input.click();
      await input.fill(choice).catch(async () => page.keyboard.type(choice));
    }
    await chat.locator(S.chatSend).last().click().catch(() => page.keyboard.press('Enter'));
  }
  const ok = await page.locator(S.success).first().waitFor({ timeout: 10_000 }).then(() => true, () => false);
  return ok ? { outcome: 'applied', detail: 'answered the employer\'s questions' } : { outcome: 'failed', detail: 'question panel closed without a confirmation' };
}

export const naukri: PlatformBot = {
  platform: 'naukri',
  loginUrl: 'https://www.naukri.com/nlogin/login',
  homeUrl: 'https://www.naukri.com/mnjuser/homepage',

  async isSignedIn(page) {
    const cookies = await page.context().cookies('https://www.naukri.com');
    return cookies.some((c) => /^(nauk_at|nauk_rt|NKWAP)$/.test(c.name) || c.name.startsWith('MYNAUKRI'));
  },

  async *search(page, search, config) {
    const where = /^(india|anywhere)$/i.test(search.location.trim()) ? '' : search.location;
    for (let n = 1; n <= 4; n++) {
      const path = `${slug(search.keywords)}-jobs${where ? `-in-${slug(where)}` : ''}${n > 1 ? `-${n}` : ''}`;
      const params = new URLSearchParams({ k: search.keywords, ...(where ? { l: where } : {}), experience: String(config.totalExperienceYears), jobAge: String(config.postedWithinDays) });
      await page.goto(`https://www.naukri.com/${path}?${params}`, { waitUntil: 'domcontentloaded' });
      if (!(await waitForYou(page, 'Naukri'))) return;
      await page.locator(S.card).first().waitFor({ timeout: 15_000 }).catch(() => {});
      const cards = await page.locator(S.card).all();
      if (!cards.length) return;
      for (const card of cards) {
        const id = (await card.getAttribute('data-job-id')) ?? '';
        const href = (await card.locator(S.cardTitle).first().getAttribute('href').catch(() => null)) ?? '';
        if (!id || !href) continue;
        yield { id, title: await text(card.locator(S.cardTitle)), company: await text(card.locator(S.cardCompany)), location: await text(card.locator(S.cardLocation)), url: href };
      }
      if (cards.length < 20) return;
    }
  },

  async apply(page, job, config, dryRun): Promise<Result> {
    const skip = config.skipTitles.find((t) => job.title.toLowerCase().includes(t.toLowerCase()))
      ?? config.skipCompanies.find((c) => job.company.toLowerCase().includes(c.toLowerCase()));
    if (skip) return { outcome: 'skipped', detail: `matches "${skip}" in your skip list` };
    await page.goto(job.url, { waitUntil: 'domcontentloaded' });
    if (!(await waitForYou(page, 'Naukri'))) return { outcome: 'failed', detail: 'verification not cleared' };
    await page.locator(S.title).first().waitFor({ timeout: 15_000 }).catch(() => {});
    job.title = (await text(page.locator(S.title))) || job.title;
    job.company = (await text(page.locator(S.company))) || job.company;
    if (await page.locator(S.applied).first().isVisible({ timeout: 2000 }).catch(() => false)) return { outcome: 'already_applied', detail: '' };
    if (await page.locator(S.companySite).first().isVisible({ timeout: 2000 }).catch(() => false)) return { outcome: 'external', detail: 'applies on the company site' };
    const apply = page.locator(S.apply).first();
    if (!(await apply.isVisible({ timeout: 5000 }).catch(() => false))) return { outcome: 'skipped', detail: 'no Apply button (closed?)' };
    if (dryRun) return { outcome: 'dry-run', detail: 'Apply button found; not clicked (clicking it applies on Naukri)' };
    await apply.click();
    if (!(await waitForYou(page, 'Naukri'))) return { outcome: 'failed', detail: 'verification not cleared' };
    const chat = await answerChat(page, config, false);
    if (chat) return chat;
    const ok = await page.locator(S.success).first().waitFor({ timeout: 12_000 }).then(() => true, () => false);
    return ok ? { outcome: 'applied', detail: '' } : { outcome: 'failed', detail: 'clicked Apply, no confirmation shown (check Naukri)' };
  },
};
