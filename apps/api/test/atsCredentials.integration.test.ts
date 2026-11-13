// Employer credential management (routes/admin/atsCredentials.ts) against the local stack: admin only,
// written permission required, the secret never comes back out, what the API encrypts the worker can
// decrypt (two implementations of one format), revoking takes effect, every change is audited, and the
// targets list ranks boards by what a credential would unlock. Skipped unless SUPABASE_SERVICE_ROLE_KEY
// is set (see appliedJobs.integration.test.ts).
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import Fastify, { type FastifyInstance } from 'fastify';
import sensible from '@fastify/sensible';

const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
process.env.ATS_CREDENTIALS_KEY = randomBytes(32).toString('base64');
process.env.REDIS_URL = 'redis://127.0.0.1:6380/15';

describe('employer credentials (admin)', { skip: !serviceKey && 'set SUPABASE_SERVICE_ROLE_KEY to run against the local stack' }, () => {
  let app: FastifyInstance;
  let sql: typeof import('../src/lib/db.js').sql;
  let adminToken = '';
  let sourceId = '';
  const board = `cred-test-${randomUUID().slice(0, 8)}`;
  const SECRET = `gh_${randomUUID()}`;

  const call = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, body?: unknown, token: string | null = adminToken) =>
    app.inject({ method, url, payload: body as never, headers: token ? { authorization: `Bearer ${token}` } : {} });

  before(async () => {
    ({ sql } = await import('../src/lib/db.js'));
    adminToken = (await (await import('../src/lib/adminAuth.js')).issueAdminToken('ops@test')).token;
    [{ id: sourceId }] = await sql<{ id: string }[]>`
      insert into public.job_sources (provider, board, company, enabled) values ('greenhouse', ${board}, 'Cred Test Co', true) returning id`;
    // Three open India tech jobs and one closed: the targets list counts the open ones.
    for (const closed of [false, false, false, true]) {
      await sql`
        insert into public.job_listings (source_id, external_id, title, company, apply_url, description_text, location, tech_category, eligibility, closed_at)
        values (${sourceId}, ${randomUUID()}, 'Backend Engineer', 'Cred Test Co', 'https://example.com', 'Build.', 'Bengaluru', 'backend', 'india',
                ${closed ? sql`now()` : null})`;
    }
    app = Fastify();
    await app.register(sensible);
    await app.register((await import('../src/routes/admin/atsCredentials.js')).default);
    await app.ready();
  });

  after(async () => {
    await app?.close();
    if (sql) {
      await sql`delete from public.audit_logs where target_type = 'ats_credential' and detail->>'board' = ${board}`;
      await sql`delete from public.ats_credentials where board = ${board}`;
      if (sourceId) await sql`delete from public.job_sources where id = ${sourceId}`;
      await sql.end();
    }
    await (await import('../src/lib/redis.js')).redis.quit();
    await (await import('../src/lib/queues.js')).closeQueues();
  });

  test('admins only: no token and a user-style token are refused', async () => {
    assert.equal((await call('GET', '/admin/ats-credentials', undefined, null)).statusCode, 401);
    assert.equal((await call('GET', '/admin/ats-credentials', undefined, 'not-a-token')).statusCode, 401);
  });

  test('written permission is required', async () => {
    const res = await call('POST', '/admin/ats-credentials', { provider: 'greenhouse', board, secret: SECRET, grantedBy: 'Cred Test Co' });
    assert.equal(res.statusCode, 400);
  });

  test('targets rank boards by the open India tech jobs a credential would unlock', async () => {
    const res = await call('GET', '/admin/ats-credentials/targets?limit=300');
    assert.equal(res.statusCode, 200);
    const mine = (res.json() as { board: string; indiaTech: number; connectorImplemented: boolean; credential: string | null }[]).find((t) => t.board === board);
    assert.ok(mine, 'the test board is listed');
    assert.deepEqual([mine.indiaTech, mine.connectorImplemented, mine.credential], [3, true, null]);
  });

  test('added: stored encrypted, never returned, decryptable by the worker, audited', async () => {
    const res = await call('POST', '/admin/ats-credentials', { provider: 'greenhouse', board, secret: SECRET, grantedBy: 'Cred Test Co (CTO)', agreementRef: 'email 2026-11-13' });
    assert.equal(res.statusCode, 200, res.body);
    const list = await call('GET', '/admin/ats-credentials');
    assert.ok(!list.body.includes(SECRET), 'the secret never comes back');
    const row = (list.json() as { board: string; openListings: number; agreementRef: string }[]).find((c) => c.board === board)!;
    assert.deepEqual([row.openListings, row.agreementRef], [3, 'email 2026-11-13']);

    const [stored] = await sql<{ secret_enc: Buffer }[]>`select secret_enc from public.ats_credentials where board = ${board}`;
    assert.ok(!stored.secret_enc.toString('utf8').includes(SECRET), 'encrypted at rest');
    const { decryptSecret } = await import('../../worker/src/submit/credentials.js');
    assert.equal(decryptSecret(stored.secret_enc, process.env.ATS_CREDENTIALS_KEY), SECRET, 'the worker reads what the API wrote');

    const audits = await sql<{ action: string; detail: Record<string, unknown> }[]>`
      select action, detail from public.audit_logs where target_type = 'ats_credential' and detail->>'board' = ${board}`;
    assert.deepEqual(audits.map((a) => a.action), ['ats_credential.added']);
    assert.equal((audits[0].detail as { dailyCap?: number }).dailyCap, 10);
    assert.ok(!JSON.stringify(audits).includes(SECRET), 'the audit log has no secret');

    const t = (await call('GET', '/admin/ats-credentials/targets?limit=300')).json() as { board: string; credential: string | null }[];
    assert.equal(t.find((x) => x.board === board)?.credential, 'active');
  });

  test('the daily cap agreed with the employer: set when added, changed later, bounded, audited', async () => {
    const list = async () => ((await call('GET', '/admin/ats-credentials')).json() as { id: string; board: string; dailyCap: number; sentToday: number }[]).find((c) => c.board === board)!;
    const c = await list();
    assert.deepEqual([c.dailyCap, c.sentToday], [10, 0], 'default 10, nothing sent');
    assert.equal((await call('PATCH', `/admin/ats-credentials/${c.id}`, { dailyCap: 0 })).statusCode, 400);
    assert.equal((await call('PATCH', `/admin/ats-credentials/${c.id}`, { dailyCap: 5000 })).statusCode, 400);
    assert.equal((await call('PATCH', `/admin/ats-credentials/${c.id}`, { dailyCap: 3 })).statusCode, 200);
    assert.equal((await list()).dailyCap, 3);
    const [a] = await sql<{ n: number }[]>`select count(*)::int as n from public.audit_logs where action = 'ats_credential.cap_changed' and target_id = ${c.id}`;
    assert.equal(a.n, 1);
    // Replacing the key keeps whatever cap is sent with it.
    await call('POST', '/admin/ats-credentials', { provider: 'greenhouse', board, secret: SECRET, grantedBy: 'Cred Test Co (CTO)', agreementRef: 'email 2026-11-13', dailyCap: 7 });
    assert.equal((await list()).dailyCap, 7);
  });

  test('revoked: no longer usable by the worker, audited', async () => {
    const [{ id }] = await sql<{ id: string }[]>`select id from public.ats_credentials where board = ${board}`;
    assert.equal((await call('DELETE', `/admin/ats-credentials/${id}`)).statusCode, 200);
    assert.equal((await call('DELETE', `/admin/ats-credentials/${id}`)).statusCode, 404, 'already revoked');
    const { loadCredential } = await import('../../worker/src/submit/credentials.js');
    assert.equal(await loadCredential('greenhouse', board), null);
    const [a] = await sql<{ n: number }[]>`select count(*)::int as n from public.audit_logs where action = 'ats_credential.revoked' and target_id = ${id}`;
    assert.equal(a.n, 1);
    await (await import('../../worker/src/db.js')).sql.end({ timeout: 1 });
  });
});
