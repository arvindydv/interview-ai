import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import postgres from 'postgres';
import { DATABASE_URL, createUser, dbAvailable, deleteUser } from './dbFixtures.js';

// Worker recovery: the restart cases as SQL contracts (kept in step with resumeStalledPreparations() and
// sweepLapsedClaims() in src/queues/autoApply.ts; apps/api/test/pipeline.e2e.test.ts runs the real functions),
// and database interruptions against the real prepare().
//
// This file's worker modules talk to a database that refuses connections (port 1) and a Redis database
// no dev worker reads, so nothing here can reach real queues.
process.env.DATABASE_URL = 'postgresql://postgres:postgres@127.0.0.1:1/postgres';
process.env.REDIS_URL = 'redis://127.0.0.1:6380/15';

const available = await dbAvailable();
const STALLED_PREPARE_MIN = 20;
const CLAIM_LEASE_MIN = 15;

describe('worker recovery', { skip: !available && 'local database not reachable' }, () => {
  const sql = postgres(DATABASE_URL, { max: 3, onnotice: () => {} });
  let userId: string;

  const app = async (fields: { status: string; reason_code?: string | null; minsAgo: number; clicked?: boolean }) => {
    const [a] = await sql<{ id: string }[]>`
      insert into public.auto_applications (user_id, provider, apply_url, title, company, status, reason_code, plan_day,
        claimed_by, claimed_at, submit_clicked_at, updated_at)
      values (${userId}, 'greenhouse', 'https://example.com', 'Engineer', 'Test Co', ${fields.status}, ${fields.reason_code ?? null}, current_date,
        ${fields.reason_code === 'submitting' ? 'applier:test' : null},
        ${fields.reason_code === 'submitting' ? sql`now() - make_interval(mins => ${fields.minsAgo})` : null},
        ${fields.clicked ? sql`now() - make_interval(mins => ${fields.minsAgo})` : null},
        now() - make_interval(mins => ${fields.minsAgo}))
      returning id`;
    return a.id;
  };
  const row = async (id: string) =>
    (await sql<{ status: string; reason_code: string | null; claimed_by: string | null }[]>`
      select status, reason_code, claimed_by from public.auto_applications where id = ${id}`)[0];

  before(async () => {
    userId = (await createUser(sql)).id;
  });
  after(async () => {
    if (userId) await deleteUser(sql, userId);
    await sql.end();
    // The worker modules' own connections (the refused database, Redis db 15).
    const worker = await import('../src/queues/autoApply.js');
    await worker.closeAutoApplyQueue();
    await (await import('../src/db.js')).sql.end({ timeout: 1 });
  });

  test('after a restart, preparations stalled past the limit are picked up again; recent ones are left alone', async () => {
    const stalled = await app({ status: 'preparing', minsAgo: STALLED_PREPARE_MIN + 5 });
    const fresh = await app({ status: 'preparing', minsAgo: 2 });
    // As in tick(): stalled rows are touched and re-queued for preparation.
    const picked = await sql<{ id: string }[]>`
      update public.auto_applications set updated_at = now()
      where status = 'preparing' and updated_at < now() - make_interval(mins => ${STALLED_PREPARE_MIN}) and user_id = ${userId}
      returning id`;
    assert.deepEqual(picked.map((r) => r.id), [stalled]);
    assert.equal((await row(fresh)).status, 'preparing');
  });

  test('a lapsed submission returns to Prepared, unless the submit button was pressed: then it is Unverified, never resent', async () => {
    const notClicked = await app({ status: 'pending', reason_code: 'submitting', minsAgo: CLAIM_LEASE_MIN + 5 });
    const clicked = await app({ status: 'pending', reason_code: 'submitting', minsAgo: CLAIM_LEASE_MIN + 5, clicked: true });
    const live = await app({ status: 'pending', reason_code: 'submitting', minsAgo: 3 });
    await sql`
      update public.auto_applications
      set status = case when submit_clicked_at is null then 'prepared' else 'pending' end,
          reason_code = case when submit_clicked_at is null then null else 'unverified' end,
          claimed_by = null, claimed_at = null, updated_at = now()
      where status = 'pending' and reason_code = 'submitting' and user_id = ${userId}
        and claimed_at < now() - make_interval(mins => ${CLAIM_LEASE_MIN})`;
    assert.deepEqual(await row(notClicked), { status: 'prepared', reason_code: null, claimed_by: null });
    assert.deepEqual(await row(clicked), { status: 'pending', reason_code: 'unverified', claimed_by: null });
    assert.equal((await row(live)).reason_code, 'submitting');
    // Never counted as submitted by recovery.
    assert.notEqual((await row(clicked)).status, 'submitted');
  });

  test('database unreachable: prepare() throws (so BullMQ retries) and changes nothing', async () => {
    const id = await app({ status: 'preparing', minsAgo: 1 });
    const { prepare } = await import('../src/queues/autoApply.js');
    const job = { id: 'test', data: { applicationId: id }, attemptsMade: 0, opts: { attempts: 3 } };
    await assert.rejects(() => prepare(job as never), (err: Error & { code?: string }) => /ECONNREFUSED|connect/i.test(`${err.code} ${err.message}`));
    const [r] = await sql<{ status: string; attempts: number; claimed_by: string | null }[]>`
      select status, attempts, claimed_by from public.auto_applications where id = ${id}`;
    assert.deepEqual(r, { status: 'preparing', attempts: 0, claimed_by: null });
  });

  test('connection killed mid-write: the transaction rolls back, nothing is marked submitted', async (t) => {
    const id = await app({ status: 'pending', reason_code: 'submitting', minsAgo: 1 });
    // psql as the writer: the server drops its connection mid-transaction (as in a restart or failover).
    const { spawnSync } = await import('node:child_process');
    const run = spawnSync('psql', [DATABASE_URL, '-v', 'ON_ERROR_STOP=1', '-c',
      `begin; update public.auto_applications set status = 'submitted', submitted_via = 'cloud', submitted_at = now() where id = '${id}';
       select pg_terminate_backend(pg_backend_pid()); commit;`], { encoding: 'utf8' });
    if (run.error) return t.skip('psql not installed');
    assert.notEqual(run.status, 0, 'the interrupted transaction must fail');
    assert.equal((await row(id)).status, 'pending');
  });
});
