import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canReport, reportErrorMessage, reportInput } from '../src/report.ts';

const answer = { turnId: 't-1', question: 'Why us?', text: 'Because…', done: true };

test('only finished answers with text can be reported', () => {
  assert.equal(canReport(answer), true);
  assert.equal(canReport({ ...answer, done: false }), false, 'still streaming');
  assert.equal(canReport({ ...answer, text: '  ' }), false, 'no text');
  assert.equal(canReport({ ...answer, turnId: '' }), false, 'no id');
  assert.equal(canReport(null), false);
  assert.equal(canReport(undefined), false);
});

test('the report carries the response id, reason, trimmed details and what the user saw', () => {
  assert.deepEqual(reportInput(answer, 'misleading', '  Wrong facts  '), {
    turnId: 't-1',
    reason: 'misleading',
    details: 'Wrong facts',
    question: 'Why us?',
    answer: 'Because…',
  });
  assert.equal(reportInput({ ...answer, question: undefined }, 'other', '').question, '');
});

test('server messages are shown as-is; transport failures get a friendly message', () => {
  assert.equal(reportErrorMessage(new Error('Too many reports. Please try again in an hour.')), 'Too many reports. Please try again in an hour.');
  const friendly = /Check your connection/;
  assert.match(reportErrorMessage(new Error('error sending request for url (https://api.friday-ai.in/v1/reports)')), friendly);
  assert.match(reportErrorMessage(new Error('HTTP 502 Bad Gateway')), friendly);
  assert.match(reportErrorMessage(''), friendly);
});
