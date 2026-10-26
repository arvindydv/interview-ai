import assert from 'node:assert/strict';
import { test } from 'node:test';
import { REPORT_LIMITS, REPORT_REASONS } from '@parakeet/shared';
import { reportBody, reportPatch } from '../src/lib/reports.js';

test('accepts every reason the desktop app offers', () => {
  for (const reason of REPORT_REASONS) {
    assert.equal(reportBody.safeParse({ turnId: 't1', reason }).success, true, reason);
  }
});

test('rejects an unknown reason with a readable message', () => {
  const r = reportBody.safeParse({ turnId: 't1', reason: 'spam' });
  assert.equal(r.success, false);
  assert.match(r.error!.issues[0].message, /harmful, inappropriate, misleading or other/);
});

test('requires a turn id', () => {
  assert.equal(reportBody.safeParse({ reason: 'harmful' }).success, false);
  assert.equal(reportBody.safeParse({ turnId: '   ', reason: 'harmful' }).success, false);
  assert.equal(reportBody.safeParse({ turnId: 'x'.repeat(129), reason: 'harmful' }).success, false);
});

test('details are optional, trimmed and capped', () => {
  assert.equal(reportBody.parse({ turnId: 't1', reason: 'other' }).details, '');
  assert.equal(reportBody.parse({ turnId: 't1', reason: 'other', details: '  rude  ' }).details, 'rude');
  const tooLong = 'x'.repeat(REPORT_LIMITS.maxDetailsChars + 1);
  assert.equal(reportBody.safeParse({ turnId: 't1', reason: 'other', details: tooLong }).success, false);
});

test('the client copy of the answer is truncated, not rejected', () => {
  const r = reportBody.parse({ turnId: 't1', reason: 'misleading', answer: 'a'.repeat(REPORT_LIMITS.maxAnswerChars + 50) });
  assert.equal(r.answer.length, REPORT_LIMITS.maxAnswerChars);
});

test('admin review accepts only known statuses', () => {
  assert.equal(reportPatch.safeParse({ status: 'actioned' }).success, true);
  assert.equal(reportPatch.safeParse({ status: 'deleted' }).success, false);
});
