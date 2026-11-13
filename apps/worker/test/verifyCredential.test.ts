// The admin console's "Check" on an employer credential (queues/submit.ts verifyCredential): a
// read-only call where the ATS has one, never an application. Accepted keys are marked verified,
// refused ones flagged (so the channel falls back), and providers without a read-only endpoint are left
// as they are. Every HTTP call goes to a mock that records it. Needs the local database (skipped without).
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { dbAvailable } from './dbFixtures.js';

process.env.ATS_CREDENTIALS_KEY = randomBytes(32).toString('base64');
process.env.REDIS_URL = 'redis://127.0.0.1:6380/15';
const available = await dbAvailable();

describe('credential check', { skip: !available && 'local database not reachable' }, () => {
  let mod: typeof import('../src/queues/submit.js');
  let sql: typeof import('../src/db.js').sql;
  let encryptSecret: typeof import('../src/submit/credentials.js').encryptSecret;
  const boards: string[] = [];
  const ids: string[] = [];
  const calls: { url: string; method: string; auth: string | null }[] = [];

  const mock = (status: number, body: unknown = {}) =>
    (async (input: string | URL, init: RequestInit = {}) => {
      calls.push({ url: String(input), method: init.method ?? 'GET', auth: new Headers(init.headers).get('authorization') });
      return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;

  async function credential(provider: string, secret: string) {
    const board = `verify-${randomUUID().slice(0, 8)}`;
    boards.push(board);
    const [{ id }] = await sql<{ id: string }[]>`
      insert into public.ats_credentials (provider, board, secret_enc, granted_by, agreement_ref)
      values (${provider}, ${board}, ${encryptSecret(secret)}, 'Test employer', 'test') returning id`;
    ids.push(id);
    return { id, board };
  }
  const state = async (id: string) =>
    (await sql<{ verified: boolean; last_error: string | null }[]>`
      select verified_at is not null as verified, last_error from public.ats_credentials where id = ${id}`)[0];

  before(async () => {
    mod = await import('../src/queues/submit.js');
    ({ sql } = await import('../src/db.js'));
    ({ encryptSecret } = await import('../src/submit/credentials.js'));
  });
  after(async () => {
    if (boards.length) await sql`delete from public.ats_credentials where board in ${sql(boards)}`;
    if (ids.length) await sql`delete from public.audit_logs where target_type = 'ats_credential' and target_id in ${sql(ids)}`;
    await mod.closeSubmitQueue();
    await sql.end({ timeout: 1 });
  });

  test('Workable: an accepted token is verified with one read-only GET', async () => {
    const c = await credential('workable', 'wk-token-1');
    calls.length = 0;
    const r = await mod.verifyCredential(c.id, mock(200, { jobs: [] }));
    assert.equal(r.verified, true);
    assert.deepEqual(calls, [{ url: `https://${c.board}.workable.com/spi/v3/jobs?limit=1`, method: 'GET', auth: 'Bearer wk-token-1' }]);
    assert.deepEqual(await state(c.id), { verified: true, last_error: null });
  });

  test('Workable: the subdomain in a JSON credential is used; a refused token is flagged', async () => {
    const c = await credential('workable', JSON.stringify({ apiKey: 'wk-token-2', subdomain: 'acme-hiring' }));
    calls.length = 0;
    const r = await mod.verifyCredential(c.id, mock(401));
    assert.equal(r.verified, false);
    assert.equal(calls[0].url, 'https://acme-hiring.workable.com/spi/v3/jobs?limit=1');
    assert.match((await state(c.id)).last_error ?? '', /refused the token \(HTTP 401\)/);
  });

  test('Workable: an unsafe subdomain is refused without any request', async () => {
    const c = await credential('workable', JSON.stringify({ apiKey: 'wk', subdomain: 'evil.com/x' }));
    calls.length = 0;
    const r = await mod.verifyCredential(c.id, mock(200));
    assert.equal(r.verified, false);
    assert.equal(calls.length, 0);
  });

  test('Ashby: checked with apiKey.info (read-only)', async () => {
    const c = await credential('ashby', 'ashby-key');
    calls.length = 0;
    assert.equal((await mod.verifyCredential(c.id, mock(200, { success: true }))).verified, true);
    assert.deepEqual(calls.map((x) => x.url), ['https://api.ashbyhq.com/apiKey.info']);
  });

  test('Greenhouse, Lever, SmartRecruiters: no read-only check exists, so nothing is called or changed', async () => {
    for (const p of ['greenhouse', 'lever', 'smartrecruiters']) {
      const c = await credential(p, `${p}-key`);
      calls.length = 0;
      const r = await mod.verifyCredential(c.id, mock(200));
      assert.equal(r.verified, null, p);
      assert.equal(calls.length, 0, `${p}: never a test submission`);
      assert.deepEqual(await state(c.id), { verified: false, last_error: null });
    }
  });

  test('a check never posts to an application endpoint', () => {
    assert.ok(calls.every((c) => !/candidates|applicationForm\.submit|\/jobs\/\d+$/.test(c.url)));
  });
});
