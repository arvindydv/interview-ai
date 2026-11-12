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

test("a company's own pages give its hiring addresses, never support, privacy or someone else's", async () => {
  const { pageContacts } = await import('@parakeet/shared');
  const html = `<main><p>Join us! Send your CV to <a href="mailto:careers@wingify.com">careers@wingify.com</a>.</p>
    <p>Need an accommodation? Write to accessibility@wingify.com</p></main>
    <footer>hello [at] wingify [dot] com · support@wingify.com · <a href="mailto:jobs@wingify.com?subject=Hi">Email our team</a>
    · errors@sentry.io · <a href="mailto:privacy@wingify.com">Privacy</a></footer>
    <script>const leak = "hr@wingify.com"</script>`;
  assert.deepEqual(pageContacts(html, 'wingify.com'), ['careers@wingify.com', 'hello@wingify.com', 'jobs@wingify.com']);
  assert.deepEqual(pageContacts('<p>Careers: talent&#64;in.acme.com</p>', 'acme.com'), ['talent@in.acme.com']);
});

test('robots.txt is respected', async () => {
  const { robotsAllows } = await import('@parakeet/shared');
  const robots = 'User-agent: *\nDisallow: /careers/private\nDisallow: /admin\nAllow: /admin/public\n\nUser-agent: FridayJobs\nDisallow: /team$';
  assert.equal(robotsAllows(robots, 'FridayJobs', '/careers'), true);
  assert.equal(robotsAllows(robots, 'FridayJobs', '/team'), false, 'its own group applies');
  assert.equal(robotsAllows(robots, 'FridayJobs', '/team/alice'), true, '$ anchors the end');
  assert.equal(robotsAllows(robots, 'OtherBot', '/careers/private/x'), false);
  assert.equal(robotsAllows(robots, 'OtherBot', '/admin/public/a'), true, 'the longer Allow wins');
  assert.equal(robotsAllows('User-agent: *\nDisallow: /', 'FridayJobs', '/careers'), false);
  assert.equal(robotsAllows('', 'FridayJobs', '/careers'), true);
});
