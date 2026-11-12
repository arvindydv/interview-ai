import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.JSEARCH_API_KEY = 'test-rapidapi-key';
process.env.JSEARCH_DATE_POSTED = '3days';
const { fetchSearch } = await import('../src/listings/search.js');

// The shape of /search-v2: { data: { jobs, cursor } }.
const RESPONSE = {
  status: 'OK',
  data: { cursor: 'next', jobs: [
    {
      job_id: 'abc123==', job_title: 'Senior Node.js Developer', employer_name: 'Acme Payments Pvt Ltd',
      employer_logo: 'https://logo.example/acme.png', job_publisher: 'LinkedIn', job_employment_type: 'FULLTIME',
      job_apply_link: 'https://www.linkedin.com/jobs/view/1', job_is_remote: false,
      apply_options: [{ publisher: 'LinkedIn', apply_link: 'https://www.linkedin.com/jobs/view/1', is_direct: false },
                      { publisher: 'Acme Careers', apply_link: 'https://careers.acme.in/jobs/42', is_direct: true }],
      job_description: 'We build payments.\n\nYou will:\n- own Node.js services\n- mentor <engineers>',
      job_posted_at_datetime_utc: '2026-11-02T09:00:00.000Z', job_city: 'Bengaluru', job_state: 'Karnataka', job_country: 'IN',
      job_min_salary: 1800000, job_max_salary: 2600000, job_salary_currency: 'INR', job_salary_period: 'YEAR',
    },
    { job_id: 'no-link', job_title: 'Dropped: nowhere to apply', employer_name: 'X' },
  ] },
};

test('JSearch postings keep the publisher, the full description, the employer link and the salary', async () => {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), headers: init.headers as Record<string, string> });
    return new Response(JSON.stringify(RESPONSE), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  const [p, ...rest] = await fetchSearch('jsearch', 'in', ['node.js developer']);
  assert.equal(rest.length, 0, 'a posting with no apply link is dropped');
  const url = new URL(calls[0].url);
  assert.equal(url.origin + url.pathname, 'https://jsearch.p.rapidapi.com/search-v2');
  assert.equal(url.searchParams.get('date_posted'), '3days');
  assert.equal(url.searchParams.get('country'), 'in');
  assert.equal(url.searchParams.get('num_pages'), '1', 'one page per call, so each call is one request');
  assert.equal(calls[0].headers['x-rapidapi-key'], 'test-rapidapi-key');
  assert.ok(!calls[0].url.includes('test-rapidapi-key'), 'the key never goes in the URL');
  assert.equal(p.externalId, 'abc123==');
  assert.equal(p.postedOn, 'LinkedIn');
  assert.equal(p.applyUrl, 'https://careers.acme.in/jobs/42', "the employer's own page when there is one");
  assert.equal(p.location, 'Bengaluru, Karnataka, IN');
  assert.equal(p.employmentType, 'Full-time');
  assert.equal(p.salary, '₹18L–₹26L a year');
  assert.equal(p.postedAt?.toString(), new Date('2026-11-02T09:00:00.000Z').toString());
  assert.match(p.descriptionHtml, /<p>We build payments\.<\/p>/);
  assert.match(p.descriptionHtml, /&lt;engineers&gt;/, 'text is escaped, not taken as HTML');
});

test('a quota or key problem from RapidAPI never shows the key', async () => {
  globalThis.fetch = (async () => new Response('{"message":"You have exceeded the MONTHLY quota"}', { status: 429 })) as typeof fetch;
  await assert.rejects(fetchSearch('jsearch', 'in', ['x']), (e: Error) => !e.message.includes('test-rapidapi-key'));
  globalThis.fetch = (async () => new Response('{}', { status: 403 })) as typeof fetch;
  await assert.rejects(fetchSearch('jsearch', 'in', ['x']), (e: Error) => /API key/.test(e.message) && !e.message.includes('test-rapidapi-key'));
});
