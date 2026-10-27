import { test } from 'node:test';
import assert from 'node:assert/strict';

// lib/freeTrial.ts reads env (and so DATABASE_URL etc.) on import.
process.env.SUPABASE_URL ??= 'http://127.0.0.1:54321';
process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
process.env.REDIS_URL ??= 'redis://127.0.0.1:6380';
const { isDisposableEmail } = await import('../src/lib/freeTrial.js');

test('temporary inboxes are recognised, including their subdomains and any case', () => {
  for (const e of ['test0987@yopmail.com', 'a@MAILINATOR.com', 'x@guerrillamail.com', 'x@sub.yopmail.com']) {
    assert.equal(isDisposableEmail(e), true, e);
  }
});

test('real mailboxes are not', () => {
  for (const e of ['priya@gmail.com', 'a.b+job@googlemail.com', 'cto@stripe.com', 'teacher@dps.edu.in', 'x@outlook.com', 'broken']) {
    assert.equal(isDisposableEmail(e), false, e);
  }
});
