import { test } from 'node:test';
import assert from 'node:assert/strict';
import { INDIA_ELIGIBLE, SOURCE_POLICIES, LISTING_PROVIDERS, canonicalUrl, dedupeKey, eligibility, techCategory } from '@parakeet/shared';

test('tech roles are told apart by title, most specific first', () => {
  const cases: [string, string | null][] = [
    ['Senior Software Engineer', 'software'],
    ['SDE II', 'software'],
    ['Member of Technical Staff', 'software'],
    ['Frontend Engineer (React)', 'frontend'],
    ['Next.js Developer', 'frontend'],
    ['Backend Engineer II (Pune, Hybrid)', 'backend'],
    ['Node.js Developer', 'backend'],
    ['Java Developer - Vice President', 'backend'],
    ['Full Stack Developer (MERN)', 'fullstack'],
    ['Android Developer', 'mobile'],
    ['Senior Azure DevOps Engineer', 'devops'],
    ['Site Reliability Engineer', 'devops'],
    ['Lead Platform Engineer', 'devops'],
    ['Data Engineer (Python)', 'data_engineering'],
    ['Senior Data Scientist', 'data_science'],
    ['Product Data Analyst', 'data_science'],
    ['Software Engineer, Machine Learning', 'ml_ai'],
    ['LLM Engineer', 'ml_ai'],
    ['Applied Scientist', 'ml_ai'],
    ['Product Security Engineer', 'security'],
    ['QA Automation Engineer', 'qa'],
    ['QA Engineer - Digital Marketing', 'qa'],
    ['Staff Product Engineer - Ads Formats', 'product_engineering'],
  ];
  for (const [title, want] of cases) assert.equal(techCategory(title), want, title);
});

test('sales, recruiting, hardware and other engineers are not tech roles', () => {
  for (const title of [
    'Senior Sales Engineer', 'Sales Compensation Engineer', 'Talent Acquisition Specialist - IT Recruitment',
    'Account Executive', 'Mechanical Design Engineer', 'Fire Protection Engineer', 'Cardiologist',
    'Staff Product Manager, Agentic AI Applications', 'Senior AI Governance Specialist', 'Growth Marketing Manager',
    'Solutions Engineer, Denver',
  ]) {
    assert.equal(techCategory(title), null, title);
  }
});

test('eligibility for candidates in India comes from the location and workplace', () => {
  const cases: [string, 'remote' | 'hybrid' | 'onsite' | null, string][] = [
    ['Bengaluru, Karnataka, India', null, 'india'],
    ['Bangalore,IND', null, 'india'],
    ['Gurugram', 'hybrid', 'india'],
    ['Remote, India', 'remote', 'remote_india'],
    ['Sr. Software Engineer (Remote, IND)', null, 'remote_india'],
    ['Worldwide', 'remote', 'remote_global'],
    ['Remote, Global', null, 'remote_global'],
    ['APAC', 'remote', 'remote_apac'],
    ['Remote', 'remote', 'remote_unspecified'],
    ['Remote - USA', 'remote', 'remote_other'],
    ['Indianapolis, IN', null, 'elsewhere'],
    ['San Francisco, CA', null, 'elsewhere'],
    ['', null, 'unknown'],
  ];
  for (const [location, workplace, want] of cases) assert.equal(eligibility(location, workplace), want, location);
  assert.ok(INDIA_ELIGIBLE.has('remote_global') && !INDIA_ELIGIBLE.has('remote_apac') && !INDIA_ELIGIBLE.has('remote_unspecified'));
});

test('canonical apply URLs drop tracking, apply steps and host variants', () => {
  assert.equal(
    canonicalUrl('https://job-boards.greenhouse.io/acme/jobs/123?gh_src=abc&utm_source=himalayas#apply'),
    'https://boards.greenhouse.io/acme/jobs/123',
  );
  assert.equal(canonicalUrl('https://jobs.lever.co/acme/1f2e/apply?lever-source=LinkedIn'), 'https://jobs.lever.co/acme/1f2e');
  assert.equal(canonicalUrl('https://jobs.ashbyhq.com/acme/9a8b/application/'), 'https://jobs.ashbyhq.com/acme/9a8b');
  assert.equal(
    canonicalUrl('https://acme.wd5.myworkdayjobs.com/en-US/External/job/Bangalore/SWE_R1/apply'),
    'https://acme.wd5.myworkdayjobs.com/External/job/Bangalore/SWE_R1',
  );
  // A job id in the query is part of the address.
  assert.equal(canonicalUrl('https://www.acme.com/careers?gh_jid=42&ref=x'), 'https://acme.com/careers?gh_jid=42');
  assert.equal(canonicalUrl('mailto:jobs@acme.com'), null);
  assert.equal(canonicalUrl('not a url'), null);
});

test('dedupe keys ignore bracketed notes in titles', () => {
  assert.equal(
    dedupeKey({ company: 'Acme Pvt Ltd', title: 'Backend Engineer [Remote]', location: 'Bengaluru, India' }),
    dedupeKey({ company: 'Acme', title: 'Backend Engineer', location: 'Bangalore' }),
  );
});

test('every provider has its terms recorded; Adzuna is blocked from production; no aggregator allows auto apply', () => {
  for (const p of LISTING_PROVIDERS) assert.ok(SOURCE_POLICIES[p], p);
  assert.ok(SOURCE_POLICIES.adzuna.productionBlocked);
  for (const p of ['himalayas', 'remoteok', 'jobicy', 'adzuna', 'jooble', 'jsearch'] as const) {
    assert.deepEqual(SOURCE_POLICIES[p].applyModes, ['direct'], p);
  }
  // No source has given us an authorised submission route.
  for (const p of LISTING_PROVIDERS) assert.ok(!SOURCE_POLICIES[p].applyModes.includes('native'), p);
});
