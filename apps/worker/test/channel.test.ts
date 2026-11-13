// Channel resolution and per-provider capability enforcement: an application is only ever routed to a
// channel that is both implemented and permitted. Pure checks plus channelFor() against the local
// database (`pnpm infra:up`).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { PROVIDER_SUBMISSION, resolveChannel, AUTO_APPLY_PROVIDERS } from '@parakeet/shared';

process.env.ATS_CREDENTIALS_KEY = randomBytes(32).toString('base64');
process.env.AUTO_APPLY_CLOUD_FORM_PROVIDERS = '';
const { channelFor, cloudFormProviders } = await import('../src/submit/channel.js');
const { CONNECTORS_BY_PROVIDER } = await import('../src/submit/index.js');
const { encryptSecret, decryptSecret } = await import('../src/submit/credentials.js');
const { sql } = await import('../src/db.js');

const ALL = { hasApiCredential: true, cloudFormEnabled: true, extensionSupported: true };

test('api is chosen only with an implemented connector AND a credential', () => {
  for (const [provider, cap] of Object.entries(PROVIDER_SUBMISSION)) {
    const ch = resolveChannel({ provider, ...ALL });
    assert.equal(ch === 'api', cap.apiExists && cap.connectorImplemented, provider);
    assert.notEqual(resolveChannel({ provider, ...ALL, hasApiCredential: false }), 'api', provider);
  }
  // Built but no credential: never api.
  assert.equal(resolveChannel({ provider: 'greenhouse', hasApiCredential: false, cloudFormEnabled: false, extensionSupported: true }), 'extension');
  // Teamtailor's API connector isn't built: a credential alone doesn't make it api.
  assert.notEqual(resolveChannel({ provider: 'teamtailor', ...ALL }), 'api');
  // Workable's is: with the employer's credential, api.
  assert.equal(resolveChannel({ provider: 'workable', ...ALL }), 'api');
});

test('cloud_form is never chosen when no provider is enabled; unknown providers are assisted', () => {
  assert.equal(cloudFormProviders('').size, 0);
  assert.deepEqual([...cloudFormProviders(' Greenhouse , lever,,')], ['greenhouse', 'lever']);
  for (const provider of AUTO_APPLY_PROVIDERS) {
    const ch = resolveChannel({ provider, hasApiCredential: false, cloudFormEnabled: cloudFormProviders('').has(provider), extensionSupported: false });
    assert.equal(ch, 'assisted', provider);
  }
  assert.equal(resolveChannel({ provider: 'linkedin', ...ALL }), 'assisted');
  assert.equal(resolveChannel({ provider: 'naukri', ...ALL }), 'assisted');
  // Teamtailor has no public form path and no connector: assisted even with a credential.
  assert.equal(resolveChannel({ provider: 'teamtailor', ...ALL }), 'assisted');
});

test('the connector registry matches the capability matrix', () => {
  const implemented = Object.entries(PROVIDER_SUBMISSION).filter(([, c]) => c.connectorImplemented).map(([p]) => p).sort();
  assert.deepEqual(Object.keys(CONNECTORS_BY_PROVIDER).sort(), implemented);
});

test('credentials round-trip and fail closed with the wrong key', () => {
  const blob = encryptSecret('gh_live_secret_123');
  assert.equal(decryptSecret(blob), 'gh_live_secret_123');
  assert.ok(!blob.toString('utf8').includes('gh_live_secret_123'));
  assert.throws(() => decryptSecret(blob, randomBytes(32).toString('base64')));
});

test('channelFor uses what is actually in place (database)', async (t) => {
  const userId = randomUUID();
  const board = `channel-test-${randomUUID().slice(0, 8)}`;
  const email = `channel-${userId.slice(0, 8)}@example.com`;
  await sql`insert into auth.users (id, email, aud, role) values (${userId}, ${email}, 'authenticated', 'authenticated')`;
  await sql`insert into public.users (id, email) values (${userId}, ${email})`;
  await sql`insert into public.auto_apply_settings (user_id, enabled, cloud_submit) values (${userId}, false, true)`;
  t.after(async () => {
    await sql`delete from public.ats_credentials where board = ${board}`;
    await sql`delete from auth.users where id = ${userId}`;
  });
  // No credential, cloud form off (env empty) though the user allows it, no browser: the candidate submits.
  assert.equal(await channelFor({ provider: 'greenhouse', board, userId }), 'assisted');
  // A connected browser: the extension.
  await sql`insert into public.auto_apply_devices (user_id, name, token_hash, last_seen_at) values (${userId}, 'Chrome', ${randomUUID()}, now())`;
  assert.equal(await channelFor({ provider: 'greenhouse', board, userId }), 'extension');
  // The employer's credential: the API.
  const [c] = await sql<{ id: string }[]>`
    insert into public.ats_credentials (provider, board, secret_enc, granted_by, agreement_ref)
    values ('greenhouse', ${board}, ${encryptSecret('k')}, 'QA employer', 'test') returning id`;
  assert.equal(await channelFor({ provider: 'greenhouse', board, userId }), 'api');
  assert.equal(await channelFor({ provider: 'greenhouse', board, userId }, { skipApi: true }), 'extension');
  // A flagged or revoked credential is not used.
  await sql`update public.ats_credentials set last_error = 'HTTP 403' where id = ${c.id}`;
  assert.equal(await channelFor({ provider: 'greenhouse', board, userId }), 'extension');
  await sql`update public.ats_credentials set last_error = null, revoked_at = now() where id = ${c.id}`;
  assert.equal(await channelFor({ provider: 'greenhouse', board, userId }), 'extension');
  // Same board on another provider: no.
  assert.notEqual(await channelFor({ provider: 'lever', board, userId }), 'api');
});

test.after(() => sql.end());
