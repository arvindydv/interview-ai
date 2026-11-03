import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL ??= 'http://127.0.0.1:54321';
process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
process.env.REDIS_URL ??= 'redis://127.0.0.1:6380';
process.env.GMAIL_TOKEN_KEY = Buffer.alloc(32, 7).toString('base64');
process.env.GOOGLE_CLIENT_ID = 'client';
process.env.GOOGLE_CLIENT_SECRET = 'secret';

import { hiringAddress, postingContacts } from '@parakeet/shared';
const { buildMime, decryptToken, encryptToken, signState, verifyState } = await import('../src/lib/gmail.js');

test('only hiring addresses in a posting are cold-emailed', () => {
  assert.equal(hiringAddress('Careers@Deepgram.com.'), 'careers@deepgram.com');
  assert.equal(hiringAddress('recruiting_us@druva.com'), 'recruiting_us@druva.com');
  assert.equal(hiringAddress('richie+hiring@aiosmedical.com'), 'richie+hiring@aiosmedical.com');
  for (const no of ['accommodations@scale.com', 'privacy@trmlabs.com', 'security@linear.app', 'support@clickup.com', 'name@checkr.com', 'jobs@example.com']) {
    assert.equal(hiringAddress(no), null, no);
  }
  // A person's address only when the posting says to apply there.
  assert.equal(hiringAddress('rishi@kastle.ai', 'Send your resume to '), 'rishi@kastle.ai');
  assert.equal(hiringAddress('rishi@kastle.ai', 'Our office manager is '), null);
  // A hiring inbox given for accommodations or scam reports isn't for applications.
  assert.equal(hiringAddress('hr@cloudflare.com', 'If you require a reasonable accommodation, contact '), null);
});

test('postingContacts reads each address in its context', () => {
  const jd = `Apply below. Questions? jobs@zapier.com. Need an accommodation? Email accommodations@zapier.com or hr@zapier.com.
    If someone claiming to be our recruiter contacts you, report it to careers@zapier.com. Or send your CV to priya@zapier.com`;
  assert.deepEqual(postingContacts(jd), ['jobs@zapier.com', 'priya@zapier.com']);
});

test('refresh tokens round-trip and are not stored in the clear', () => {
  const blob = encryptToken('1//refresh-token');
  assert.ok(!blob.includes(Buffer.from('refresh-token')));
  assert.equal(decryptToken(blob), '1//refresh-token');
  blob[blob.length - 1] ^= 1;
  assert.throws(() => decryptToken(blob));
});

test('OAuth state is signed', () => {
  const state = signState('user-1', '/recommended?job=abc');
  assert.deepEqual(verifyState(state), { userId: 'user-1', returnTo: '/recommended?job=abc' });
  const [payload] = state.split('.');
  const forged = Buffer.from(JSON.stringify({ u: 'user-2', r: '/', e: Date.now() + 60_000 })).toString('base64url');
  assert.equal(verifyState(`${forged}.${state.split('.')[1]}`), null);
  assert.equal(verifyState(`${payload}.`), null);
  assert.equal(verifyState('garbage'), null);
});

test('the email is plain text with the resume attached, and headers cannot be injected', () => {
  const mime = buildMime({
    fromName: 'Priya Sharma',
    fromEmail: 'priya@gmail.com',
    to: 'hr@acme.com\r\nBcc: everyone@acme.com',
    subject: 'Backend role\r\nBcc: x@y.z — 4 yrs Node.js',
    text: 'Hi Acme team,\n\nThanks.',
    attachment: { name: 'Priya Sharma Resume.pdf', type: 'application/pdf', data: Buffer.from('%PDF-1.7 test') },
  });
  const [head] = mime.split('\r\n\r\n');
  assert.doesNotMatch(head, /^Bcc:/m);
  assert.match(head, /^From: Priya Sharma <priya@gmail\.com>$/m);
  // Non-ASCII subject (the em dash) is RFC 2047 encoded.
  const subject = head.match(/^Subject: =\?UTF-8\?B\?(.+)\?=$/m)?.[1];
  assert.equal(Buffer.from(subject!, 'base64').toString('utf8'), 'Backend role Bcc: x@y.z — 4 yrs Node.js');
  assert.match(mime, /Content-Disposition: attachment; filename="Priya Sharma Resume\.pdf"/);
  assert.ok(mime.includes(Buffer.from('%PDF-1.7 test').toString('base64')));
  assert.ok(mime.includes(Buffer.from('Hi Acme team,\r\n\r\nThanks.').toString('base64')));
  assert.ok(mime.trimEnd().endsWith('--'));
});
