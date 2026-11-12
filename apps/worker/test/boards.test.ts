import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.ADZUNA_APP_ID = 'test-id';
process.env.ADZUNA_APP_KEY = 'test-key';
const { fetchBoard, jobicyClosed } = await import('../src/listings/boards.js');
const { metered } = await import('../src/listings/http.js');
const { boardFromUrl, teamtailorSite } = await import('../src/listings/careersLink.js');
const { configuredSearchProviders } = await import('../src/listings/search.js');

type Handler = (url: string) => { status?: number; body: string; type?: string };
function serve(handler: Handler) {
  const calls: string[] = [];
  globalThis.fetch = (async (url: string) => {
    calls.push(String(url));
    const r = handler(String(url));
    return new Response(r.body, { status: r.status ?? 200, headers: { 'content-type': r.type ?? 'application/json' } });
  }) as typeof fetch;
  return calls;
}

// Shape of a Teamtailor careers-site feed (career.teamtailor.com/jobs.rss), trimmed.
const item = (n: number, remote = 'hybrid', city = 'Bengaluru', country = 'India') => `
  <item>
    <title>Backend Engineer ${n}</title>
    <description>&lt;p&gt;Build &lt;strong&gt;APIs&lt;/strong&gt;&lt;/p&gt;&lt;script&gt;x()&lt;/script&gt;</description>
    <pubDate>Tue, 10 Nov 2026 09:41:26 +0100</pubDate>
    <link>https://acme.teamtailor.com/jobs/${n}-backend-engineer</link>
    <remoteStatus>${remote}</remoteStatus>
    <guid>guid-${n}</guid>
    <tt:locations><tt:location><tt:name>Office</tt:name><tt:city>${city}</tt:city><tt:country>${country}</tt:country></tt:location></tt:locations>
    <tt:department>Engineering</tt:department>
  </item>`;
const feed = (items: string) =>
  `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:tt="https://teamtailor.com/locations"><channel><title>Acme</title>${items}</channel></rss>`;

test('Teamtailor feeds are read page by page with locations, department, remote status and safe HTML', async () => {
  const calls = serve((url) => {
    const offset = Number(new URL(url).searchParams.get('offset'));
    const n = offset === 0 ? 100 : 3;
    return { body: feed(Array.from({ length: n }, (_, i) => item(offset + i, i === 0 ? 'fully' : 'hybrid')).join('')), type: 'application/rss+xml' };
  });
  const { result: jobs, requests } = await metered(() => fetchBoard('teamtailor', 'acme.teamtailor.com'));
  assert.equal(jobs.length, 103);
  assert.equal(requests, 2);
  assert.deepEqual(calls, ['https://acme.teamtailor.com/jobs.rss?offset=0', 'https://acme.teamtailor.com/jobs.rss?offset=100']);
  const [first, second] = jobs;
  assert.equal(first.externalId, 'guid-0');
  assert.equal(first.title, 'Backend Engineer 0');
  assert.equal(first.location, 'Bengaluru, India');
  assert.equal(first.workplace, 'remote');
  assert.equal(second.workplace, 'hybrid');
  assert.equal(first.department, 'Engineering');
  assert.equal(first.applyUrl, 'https://acme.teamtailor.com/jobs/0-backend-engineer');
  assert.equal(first.postedAt?.toISOString(), '2026-11-10T08:41:26.000Z');
  assert.match(first.descriptionHtml, /<strong>APIs<\/strong>/);
  assert.doesNotMatch(first.descriptionHtml, /script/);
});

test('a page that is not a Teamtailor feed is not taken for a board', async () => {
  serve(() => ({ body: '<html>Welcome</html>', type: 'text/html' }));
  await assert.rejects(fetchBoard('teamtailor', 'careers.example.com'), /not a Teamtailor feed/);
  await assert.rejects(fetchBoard('teamtailor', 'bad/host'), /Invalid board/);
});

test('Jobicy is read from its current endpoint through every cursor page', async () => {
  const calls = serve((url) => {
    const cursor = new URL(url).searchParams.get('cursor');
    const page = cursor ? Number(cursor) : 0;
    return {
      body: JSON.stringify({
        success: true, hasMore: page < 2, nextCursor: page < 2 ? String(page + 1) : null,
        jobs: [{ id: 100 + page, url: `https://jobicy.com/jobs/${page}`, jobTitle: 'Python Developer', companyName: 'Acme', jobGeo: 'APAC', jobDescription: '<p>x</p>', pubDate: '2026-11-09T00:00:00+00:00' }],
      }),
    };
  });
  const jobs = await fetchBoard('jobicy', 'all');
  assert.equal(jobs.length, 3);
  assert.ok(calls.every((c) => c.startsWith('https://jobicy.com/api/jobs?count=100')));
  assert.equal(jobs[0].applyUrl, 'https://jobicy.com/jobs/0');
});

test('Jobicy jobs are closed only on an explicit "closed", 100 ids a request', async () => {
  const calls = serve((url) => {
    const ids = new URL(url).searchParams.get('ids')!.split(',');
    return { body: JSON.stringify({ jobs: ids.map((id) => ({ id: Number(id), status: Number(id) % 3 === 0 ? 'closed' : Number(id) % 3 === 1 ? 'active' : 'unknown' })) }) };
  });
  const ids = Array.from({ length: 150 }, (_, i) => String(i + 1));
  const closed = await jobicyClosed([...ids, 'not-a-number']);
  assert.equal(calls.length, 2);
  assert.equal(closed.length, 50);
  assert.ok(closed.every((id) => Number(id) % 3 === 0));
});

test('Himalayas jobs carry their expiry date', async () => {
  serve(() => ({
    body: JSON.stringify({
      totalCount: 1,
      jobs: [{ guid: 'h1', title: 'Data Engineer', companyName: 'Acme', applicationLink: 'https://himalayas.app/companies/acme/jobs/h1', description: '<p>x</p>', pubDate: 1794268811, expiryDate: 1799407257, locationRestrictions: ['India'] }],
    }),
  }));
  const [job] = await fetchBoard('himalayas', 'india');
  assert.equal(job.expiresAt?.toISOString(), new Date(1799407257 * 1000).toISOString());
  assert.equal(job.applyUrl, 'https://himalayas.app/companies/acme/jobs/h1');
});

test('Teamtailor boards are found from careers links and from careers sites Teamtailor serves', () => {
  assert.deepEqual(boardFromUrl('https://acme.teamtailor.com/jobs'), { provider: 'teamtailor', board: 'acme.teamtailor.com' });
  assert.equal(boardFromUrl('https://www.teamtailor.com/en/'), null);
  assert.deepEqual(teamtailorSite('<link href="https://assets.teamtailor-cdn.com/assets/careersite.css">', new URL('https://careers.acme.com/jobs')), [
    { provider: 'teamtailor', board: 'careers.acme.com' },
  ]);
  assert.deepEqual(teamtailorSite('<html>plain</html>', new URL('https://careers.acme.com/')), []);
});

test('Adzuna keys alone never turn on syncing: its commercial licence must be confirmed first', () => {
  assert.equal(process.env.ADZUNA_SYNC_ENABLED, undefined);
  assert.ok(!configuredSearchProviders().has('adzuna'));
});
