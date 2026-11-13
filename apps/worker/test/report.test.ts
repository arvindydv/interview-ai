import { test } from 'node:test';
import assert from 'node:assert/strict';
import postgres from 'postgres';

const { applicationCounts, capacitySplit, usageCost } = await import('../src/queues/report.js');

test('capacity: API only with an employer credential, cloud only for enabled providers, else extension or assisted', () => {
  const boards = [
    { provider: 'greenhouse', board: 'acme', jobs: 10 },
    { provider: 'greenhouse', board: 'other', jobs: 7 },
    { provider: 'lever', board: 'beta', jobs: 5 },
    { provider: 'workable', board: 'gamma', jobs: 3 },
    { provider: 'keka', board: 'delta', jobs: 4 },
    { provider: 'himalayas', board: 'himalayas', jobs: 2 },
  ];
  // Nothing authorized, nothing enabled: public discovery alone never makes a job API-submittable.
  assert.deepEqual(capacitySplit(boards, new Set(), new Set()), { apiAuthorized: 0, cloudForm: 0, extensionOnly: 25, assistedOnly: 6 });
  assert.deepEqual(capacitySplit(boards, new Set(['greenhouse:acme']), new Set(['lever'])), {
    apiAuthorized: 10, cloudForm: 5, extensionOnly: 10, assistedOnly: 6,
  });
  // Workable has no API connector yet: a credential alone doesn't make it API.
  assert.equal(capacitySplit(boards, new Set(['workable:gamma']), new Set()).apiAuthorized, 0);
});

test('applications: only evidence counts as submitted; unverified, submitting and failed never do', () => {
  const c = applicationCounts(
    [
      { status: 'submitted', reasonCode: null, via: 'cloud', channel: 'cloud_form' },
      { status: 'submitted', reasonCode: null, via: 'api', channel: 'api' },
      { status: 'submitted', reasonCode: null, via: 'user', channel: 'extension' },
      { status: 'submitted', reasonCode: null, via: 'verified', channel: 'bot:linkedin' },
      { status: 'submitted', reasonCode: null, via: 'user_reported', channel: 'assisted' },
      // A "submitted" row without a sender has no evidence.
      { status: 'submitted', reasonCode: null, via: null, channel: 'extension' },
      { status: 'pending', reasonCode: 'unverified', via: 'browser', channel: 'extension' },
      { status: 'pending', reasonCode: 'submitting', via: null, channel: 'cloud_form' },
      { status: 'pending', reasonCode: 'needs_answers', via: null, channel: 'extension' },
      { status: 'failed', reasonCode: 'submit_failed', via: null, channel: 'cloud_form' },
      { status: 'prepared', reasonCode: null, via: null, channel: 'api' },
      { status: 'preparing', reasonCode: null, via: null, channel: 'api' },
    ],
    0.123456,
  );
  assert.equal(c.submittedVerified, 3);
  assert.equal(c.submittedUserConfirmed, 2);
  assert.equal(c.failed, 1);
  // Unverified asks the candidate to confirm; needs answers asks for answers. Submitting is ours.
  assert.equal(c.needsAction, 2);
  assert.deepEqual(c.byChannel, { cloud_form: 1, api: 1, extension: 1, 'bot:linkedin': 1, assisted: 1 });
  assert.equal(c.llmCostUsd, 0.1235);
});

test('model cost: the provider’s figure when given, else tokens at list price', () => {
  assert.equal(usageCost({ model: 'anthropic/claude-haiku-5.5', usage: { cost: 0.0021926 } }), 0.0021926);
  assert.equal(usageCost({ model: 'claude-haiku-5-5', usage: { input_tokens: 1_000_000, output_tokens: 100_000 } }), 1.5);
  assert.equal(usageCost({ model: 'claude-sonnet-5-5', usage: { input_tokens: 1000, output_tokens: 1000 } }), 0.018);
  assert.equal(usageCost(null), 0);
});

// Against the local database (skipped when there is none, as in CI): closing listings nothing confirms.
const db = postgres(process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres', { max: 1, connect_timeout: 2, onnotice: () => {} });
const reachable = await db`select 1`.then(() => true, () => false);

test('stale and gone boards: their listings close, healthy and search sources keep theirs', { skip: !reachable && 'no local database' }, async () => {
  const { closeGoneBoard, closeStaleListings, closeListingsQueue } = await import('../src/queues/listings.js');
  const { sql } = await import('../src/db.js');
  const tag = `zz-test-${Date.now()}`;
  const mk = (provider: string, board: string, extra: Record<string, unknown> = {}) =>
    db`insert into public.job_sources ${db({ provider, board: `${tag}-${board}`, company: 'Test Co', ...extra })} returning id`.then((r) => r[0].id as string);
  try {
    const healthy = await mk('greenhouse', 'healthy');
    const failing = await mk('greenhouse', 'failing');
    const slow = await mk('smartrecruiters', 'slow', { sync_every: '1 day' });
    const off = await mk('lever', 'off', { enabled: false });
    const search = await mk('jooble', 'search');
    const gone = await mk('ashby', 'gone');
    const listing = (sourceId: string, id: string, seenDaysAgo: number) =>
      db`insert into public.job_listings ${db({
        source_id: sourceId, external_id: id, title: 'Backend Engineer', company: 'Test Co', apply_url: `https://example.com/${tag}/${id}`,
        last_seen_at: new Date(Date.now() - seenDaysAgo * 86400_000),
      })}`;
    await listing(healthy, 'h', 0.01);
    await listing(failing, 'f', 4); // not read for 4 days, synced every 30 minutes
    await listing(slow, 's', 2); // daily board: 3 syncs = 3 days, not yet stale
    await listing(off, 'o', 0.01);
    await listing(search, 'q', 4); // search engines: 14 days
    await listing(gone, 'g', 0.01);

    await closeStaleListings();
    assert.equal(await closeGoneBoard(gone), 1);
    const rows = await db<{ external_id: string; closed: boolean }[]>`
      select l.external_id, l.closed_at is not null as closed from public.job_listings l
      join public.job_sources s on s.id = l.source_id where s.board like ${`${tag}-%`} order by 1`;
    assert.deepEqual(Object.fromEntries(rows.map((r) => [r.external_id, r.closed])), { f: true, g: true, h: false, o: true, q: false, s: false });
    await closeListingsQueue();
    await sql.end();
  } finally {
    await db`delete from public.job_sources where board like ${`${tag}-%`}`;
    await db.end();
  }
});

test('placeholder posting dates are no date (a year-0 date failed whole Keka syncs)', async () => {
  const { date } = await import('../src/listings/boards.js');
  assert.equal(date('0000-12-31T18:06:32.000Z'), null);
  assert.equal(date('9999-01-01'), null);
  assert.equal(date('not a date'), null);
  assert.equal(date('2026-11-10T09:00:00Z')?.toISOString(), '2026-11-10T09:00:00.000Z');
});
