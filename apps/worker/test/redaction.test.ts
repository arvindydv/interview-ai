import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redactSensitive } from '@parakeet/shared';

test('secrets are masked by key name, at any depth', () => {
  const out = redactSensitive({
    password: 'hunter2', apiKey: 'sk-123', nested: { refresh_token: 'x', Authorization: 'Bearer y', ok: 'fine' },
    list: [{ session: 'abc', cookie: 'c=1' }],
  });
  assert.deepEqual(out, {
    password: '[redacted]', apiKey: '[redacted]', nested: { refresh_token: '[redacted]', Authorization: '[redacted]', ok: 'fine' },
    list: [{ session: '[redacted]', cookie: '[redacted]' }],
  });
});

test('emails and phone numbers in text are masked; ordinary numbers are not', () => {
  assert.equal(
    redactSensitive('Contact asha.rao+jobs@example.co.in or +91 98765 43210 about job 4021 (3 years)'),
    'Contact [email] or [phone] about job 4021 (3 years)',
  );
  assert.equal(redactSensitive('HTTP 429 after 30000 ms'), 'HTTP 429 after 30000 ms');
});

test('non-plain values pass through, and the input is not modified', () => {
  const input = { when: new Date(0), n: 5, flag: true, none: null, text: 'a@b.co' };
  const out = redactSensitive(input);
  assert.equal(out.when, input.when);
  assert.equal(out.n, 5);
  assert.equal(out.none, null);
  assert.equal(input.text, 'a@b.co');
  assert.equal(out.text, '[email]');
});

test('deep structures are cut off rather than recursing forever', () => {
  let deep: Record<string, unknown> = { v: 'end' };
  for (let i = 0; i < 20; i++) deep = { next: deep };
  assert.doesNotThrow(() => redactSensitive(deep));
});
