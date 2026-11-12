import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const home = mkdtempSync(join(tmpdir(), 'jobbot-'));
process.env.JOB_BOT_HOME = home;
const { answerFor, pickOption } = await import('../src/jobBot/answer.js');
const { fillForm } = await import('../src/jobBot/form.js');
const { lakhs } = await import('../src/jobBot/config.js');
import type { Config } from '../src/jobBot/config.js';

const resume = join(home, 'resume.pdf');
writeFileSync(resume, '%PDF-1.4 test');
const config: Config = {
  dailyLimit: { linkedin: 30, naukri: 30, indeed: 30 },
  searches: [], postedWithinDays: 1, totalExperienceYears: 4,
  skillYears: { 'react.js': 3, nodejs: 4, python: 2, kafka: 0, 'spring boot': 1 }, skillDefault: 0,
  skipTitles: [], skipCompanies: [], resumePath: resume,
  profile: {
    firstName: 'Asha', lastName: 'Rao', email: 'asha@example.com', phone: '9876543210', phoneCountry: 'India (+91)', city: 'Bengaluru',
    currentCtcLpa: 12, expectedCtcLpa: 18, noticePeriodDays: 30, currentCompany: 'Acme', currentTitle: 'Software Engineer',
    linkedinUrl: 'https://linkedin.com/in/asha', githubUrl: '', portfolioUrl: '', highestEducation: "Bachelor's (B.Tech)",
    willingToRelocate: true, authorizedToWorkInIndia: true, needsSponsorship: false, comfortableWithHybridOrOnsite: true,
  },
  answers: { 'how did you hear': 'LinkedIn' },
  pauseSeconds: [0, 0], letAiDecide: false, resumeText: '',
};

test('answers come from your config, and unknown questions get none', () => {
  const a = (label: string, kind: any = 'text', options?: string[]) => answerFor({ label, kind, options }, config);
  assert.equal(a('How many years of experience do you have with React?', 'number'), '3');
  assert.equal(a('Years of experience in Node.js', 'number'), '4');
  assert.equal(a('How many years of work experience do you have with Kafka?', 'number'), '0');
  assert.equal(a('Total years of experience', 'number'), '4');
  // The resume says "React.js" and "NodeJS"; questions say "React" and "Node.js".
  assert.equal(a('How many years of experience do you have in ReactJS?', 'number'), '3');
  assert.equal(a('Years of experience with Spring Boot?', 'number'), '1');
  assert.equal(a('How many years of experience do you have with Golang?', 'number'), '0');
  assert.equal(a('How many years of experience do you have in software development?', 'number'), '4');
  assert.equal(a('Current CTC (in Lakhs)', 'number'), '12');
  assert.equal(a('What is your expected CTC (INR per annum)?', 'number'), '1800000');
  assert.equal(a('Notice period (in days)', 'number'), '30');
  assert.equal(a('Mobile phone number'), '9876543210');
  assert.equal(a('Will you require visa sponsorship?', 'radio', ['Yes', 'No']), 'No');
  assert.equal(a('Are you willing to relocate to Pune?', 'radio', ['Yes', 'No']), 'Yes');
  assert.equal(a('Do you have experience with Kafka?', 'radio', ['Yes', 'No']), 'No');
  assert.equal(a('How did you hear about us?'), 'LinkedIn');
  assert.equal(a('Gender', 'select', ['Select', 'Male', 'Female', 'Prefer not to say']), 'Prefer not to say');
  assert.equal(a('Describe your most challenging project', 'textarea'), null);
  // A date only you know: no answer, so the job is skipped and the question listed.
  assert.equal(a('Are you currently serving notice? Last working day?', 'text'), null);
});

test('answers are matched to the options a form offers', () => {
  assert.equal(pickOption('30 days', ['Immediate', '15 days or less', '16-30 days', 'More than 60 days']), '16-30 days');
  assert.equal(pickOption('0', ['Immediate', '15 days or less']), 'Immediate');
  assert.equal(pickOption('4', ['0-1 years', '2-3 years', '4-6 years', '7+ years']), '4-6 years');
  assert.equal(pickOption('12', ['Less than 5', '5 to 10', 'More than 10']), 'More than 10');
  assert.equal(pickOption('Yes', ['Select an option', 'Yes', 'No']), 'Yes');
  assert.equal(pickOption('Mars', ['Yes', 'No']), null);
});

// A stand-in Easy Apply step, offline: labelled inputs, a prefilled email, a select, a radio group,
// consent and follow checkboxes, a resume upload, and one question nothing answers.
const FORM = `<div id="step">
  <label for="e">Email address</label><input id="e" type="email" value="kept@example.com" required>
  <label for="p">Mobile phone number</label><input id="p" type="tel" required>
  <label for="y">How many years of experience do you have with React?</label><input id="y" type="text" inputmode="numeric" required>
  <label for="n">Notice period</label><select id="n" required><option>Select an option</option><option>Immediate</option><option>15-30 days</option><option>60 days</option></select>
  <fieldset><legend>Will you now or in the future require sponsorship?</legend>
    <input type="radio" name="s" id="s1"><label for="s1">Yes</label><input type="radio" name="s" id="s2"><label for="s2">No</label></fieldset>
  <label for="r">Upload resume</label><input id="r" type="file">
  <input type="checkbox" id="c"><label for="c">I agree to the privacy policy</label>
  <input type="checkbox" id="f" checked><label for="f">Follow Acme to stay up to date</label>
  <label for="q">Why do you want to work at Acme?</label><textarea id="q" required></textarea>
</div>`;

test('the form filler fills what it knows, leaves prefilled fields, and lists what it does not', async (t) => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome-stable', headless: true }).catch(() => null);
  if (!browser) return t.skip('Chrome not installed');
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.setContent(FORM);
  const unanswered = await fillForm(page, page.locator('#step'), config);
  assert.deepEqual(unanswered, ['Why do you want to work at Acme?']);
  assert.equal(await page.inputValue('#e'), 'kept@example.com');
  assert.equal(await page.inputValue('#p'), '9876543210');
  assert.equal(await page.inputValue('#y'), '3');
  assert.equal(await page.$eval('#n', (s: HTMLSelectElement) => s.value), '15-30 days');
  assert.equal(await page.isChecked('#s2'), true);
  assert.equal(await page.isChecked('#c'), true);
  assert.equal(await page.isChecked('#f'), false);
  assert.equal(await page.$eval('#r', (i: HTMLInputElement) => i.files?.length), 1);
});

test('salaries from the Application Profile are read as lakhs a year', () => {
  assert.equal(lakhs('₹18 LPA'), 18);
  assert.equal(lakhs('18 lakhs'), 18);
  assert.equal(lakhs('1,800,000'), 18);
  assert.equal(lakhs('12.5'), 12.5);
  assert.equal(lakhs('1.2 Cr'), 120);
  assert.equal(lakhs(''), 0);
});

test('every selector the bot uses is valid (a bad one fails every job)', async (t) => {
  const { LINKEDIN_SELECTORS } = await import('../src/jobBot/platforms/linkedin.js');
  const { NAUKRI_SELECTORS } = await import('../src/jobBot/platforms/naukri.js');
  const { INDEED_SELECTORS } = await import('../src/jobBot/platforms/indeed.js');
  const { humanCheck } = await import('../src/jobBot/browser.js');
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome-stable', headless: true }).catch(() => null);
  if (!browser) return t.skip('Chrome not installed');
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.setContent('<main><p>Applied 3 days ago</p><p>Please verify you are a human</p></main>');
  for (const [site, selectors] of Object.entries({ LINKEDIN_SELECTORS, NAUKRI_SELECTORS, INDEED_SELECTORS })) {
    for (const [name, selector] of Object.entries(selectors)) {
      await assert.doesNotReject(page.locator(selector as string).count(), `${site}.${name}`);
    }
  }
  assert.equal(await page.locator(LINKEDIN_SELECTORS.appliedNote).count(), 1);
  assert.match((await humanCheck(page)) ?? '', /verification shown/);
});
