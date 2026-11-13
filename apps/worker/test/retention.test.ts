import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import postgres from 'postgres';
import { DATABASE_URL, createListing, createSource, createUser, dbAvailable, deleteUser } from './dbFixtures.js';

const available = await dbAvailable();

describe('data retention', { skip: !available && 'local database not reachable' }, () => {
  const sql = postgres(DATABASE_URL, { max: 2, onnotice: () => {} });
  let userId: string;
  let sourceId: string;
  let runRetention: typeof import('../src/queues/retention.js').runRetention;
  let closeRetentionQueue: () => Promise<void>;
  const ids: Record<string, string> = {};

  const app = async (status: string, daysAgo: number, tailoredId: string, listingId: string | null, evidence: unknown = null) => {
    const [a] = await sql<{ id: string }[]>`
      insert into public.auto_applications (user_id, listing_id, tailored_resume_id, provider, apply_url, title, company, status,
        plan_day, evidence, submitted_at, submitted_via, updated_at)
      values (${userId}, ${listingId}, ${tailoredId}, 'greenhouse', 'https://example.com', 'Engineer', 'Test Co', ${status},
        current_date, ${evidence === null ? null : sql.json(evidence as never)},
        ${status === 'submitted' ? sql`now() - make_interval(days => ${daysAgo})` : null},
        ${status === 'submitted' ? 'browser' : null}, now() - make_interval(days => ${daysAgo}))
      returning id`;
    return a.id;
  };
  const tailored = async () => {
    const [t] = await sql<{ id: string }[]>`
      insert into public.tailored_resumes (user_id, title, company, status, file, cover_letter_file)
      values (${userId}, 'Engineer', 'Test Co', 'ready', ${Buffer.from('%PDF-1.4')}, ${Buffer.from('%PDF-1.4')}) returning id`;
    return t.id;
  };

  before(async () => {
    ({ runRetention, closeRetentionQueue } = await import('../src/queues/retention.js'));
    userId = (await createUser(sql)).id;
    sourceId = await createSource(sql);

    // Resume files: failed long ago → removed; submitted long ago → kept; failed recently → kept;
    // shared between a failed and a pending application → kept.
    ids.failedOld = await tailored();
    await app('failed', 45, ids.failedOld, null);
    ids.submittedOld = await tailored();
    ids.submittedApp = await app('submitted', 400, ids.submittedOld, null, { url: 'https://boards.greenhouse.io/x/confirmation', text: 'Thank you for applying. '.repeat(40) });
    ids.failedRecent = await tailored();
    await app('skipped', 5, ids.failedRecent, null);
    ids.shared = await tailored();
    await app('failed', 45, ids.shared, null);
    await app('pending', 45, ids.shared, null);

    // Events: old detail cleared, recent kept.
    for (const [key, days] of [['eventOld', 120], ['eventNew', 10]] as const) {
      const [e] = await sql<{ id: string }[]>`
        insert into public.auto_apply_events (application_id, user_id, kind, message, detail, created_at)
        values (${ids.submittedApp}, ${userId}, 'answered', 'Answered', ${sql.json({ usage: 1 })}, now() - make_interval(days => ${days}))
        returning id`;
      ids[key] = e.id;
    }

    // Listings: closed long ago and unreferenced → deleted; closed long ago but applied to → kept; closed recently → kept.
    ids.listingGone = await createListing(sql, sourceId, 90);
    ids.listingApplied = await createListing(sql, sourceId, 90);
    await sql`insert into public.job_applications (user_id, listing_id, title, company, apply_url, status) values (${userId}, ${ids.listingApplied}, 'E', 'T', 'https://e', 'applied')`;
    ids.listingRecent = await createListing(sql, sourceId, 10);

    const [run] = await sql<{ id: string }[]>`insert into public.job_source_runs (source_id, started_at) values (${sourceId}, now() - interval '100 days') returning id`;
    ids.runOld = run.id;
    const [aud] = await sql<{ id: string }[]>`insert into public.audit_logs (user_id, actor, action, created_at) values (${userId}, 'user', 'test.old', now() - interval '500 days') returning id`;
    ids.auditOld = aud.id;
    const [aud2] = await sql<{ id: string }[]>`insert into public.audit_logs (user_id, actor, action) values (${userId}, 'user', 'test.new') returning id`;
    ids.auditNew = aud2.id;

    const result = await runRetention(sql);
    for (const [k, v] of Object.entries(result)) assert.equal(typeof v, 'number', `${k}: ${v}`);
  });

  after(async () => {
    await sql`delete from public.job_sources where id = ${sourceId}`;
    if (userId) await deleteUser(sql, userId);
    await sql.end();
    await closeRetentionQueue?.();
  });

  const fileOf = async (id: string) => (await sql<{ has: boolean }[]>`select file is not null as has from public.tailored_resumes where id = ${id}`)[0].has;

  test('resume files of long-failed applications are deleted', async () => assert.equal(await fileOf(ids.failedOld), false));
  test('the resume a submitted application was sent with is kept, however old', async () => assert.equal(await fileOf(ids.submittedOld), true));
  test('recently skipped applications keep their files', async () => assert.equal(await fileOf(ids.failedRecent), true));
  test('a file also used by a pending application is kept', async () => assert.equal(await fileOf(ids.shared), true));

  test('evidence page text is trimmed, the confirmation URL kept', async () => {
    const [a] = await sql<{ evidence: { url: string; text: string; trimmed?: boolean } }[]>`select evidence from public.auto_applications where id = ${ids.submittedApp}`;
    assert.equal(a.evidence.url, 'https://boards.greenhouse.io/x/confirmation');
    assert.equal(a.evidence.text.length, 200);
    assert.equal(a.evidence.trimmed, true);
  });

  test('old event details are cleared, recent ones kept', async () => {
    const rows = await sql<{ id: string; detail: unknown }[]>`select id::text, detail from public.auto_apply_events where id in ${sql([ids.eventOld, ids.eventNew])}`;
    const by = new Map(rows.map((r) => [r.id, r.detail]));
    assert.equal(by.get(String(ids.eventOld)), null);
    assert.deepEqual(by.get(String(ids.eventNew)), { usage: 1 });
  });

  test('closed listings go only when nothing points at them', async () => {
    const rows = await sql<{ id: string }[]>`select id from public.job_listings where id in ${sql([ids.listingGone, ids.listingApplied, ids.listingRecent])}`;
    const left = new Set(rows.map((r) => r.id));
    assert.equal(left.has(ids.listingGone), false);
    assert.equal(left.has(ids.listingApplied), true);
    assert.equal(left.has(ids.listingRecent), true);
  });

  test('old sync logs and audit entries are deleted, recent audit entries kept', async () => {
    assert.equal((await sql`select 1 from public.job_source_runs where id = ${ids.runOld}`).length, 0);
    assert.equal((await sql`select 1 from public.audit_logs where id = ${ids.auditOld}`).length, 0);
    assert.equal((await sql`select 1 from public.audit_logs where id = ${ids.auditNew}`).length, 1);
  });
});
