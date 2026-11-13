import { test } from 'node:test';
import assert from 'node:assert/strict';

const { checkEdits } = await import('../src/queues/tailor.js');

const resume = 'Asha Rao. Software Engineer, Acme Payments, 2022 - present. Built REST APIs in Node.js serving 2M requests a day. B.Tech, IIT Delhi.';
const units = [
  { id: 'u1', text: 'Built REST APIs in Node.js serving 2M requests a day.', label: '', fixed: false, min: 30, max: 90 },
  { id: 'u2', text: 'Software Engineer, Acme Payments', label: '', fixed: true, min: 0, max: 40 },
];

test('tailoring keeps truthful rewrites and drops any line that adds a fact', () => {
  const edits = checkEdits(units, [{ id: 'u1', text: 'Built Node.js REST APIs handling 2M requests a day for payments.' }], resume);
  assert.equal(edits.u1, 'Built Node.js REST APIs handling 2M requests a day for payments.');
  for (const text of [
    'Built Node.js REST APIs with Kafka handling 2M requests a day.', // a tool not on the resume
    'Built Node.js REST APIs handling 5M requests a day for payments.', // a number not on the resume
    'AWS Certified engineer who built Node.js REST APIs for 2M requests.', // a certification
    'Built Node.js REST APIs at Google handling 2M requests a day.', // an employer
  ]) {
    assert.deepEqual(checkEdits(units, [{ id: 'u1', text }], resume), {}, text);
  }
  // Fixed lines (employers, titles, dates) are never edited.
  assert.deepEqual(checkEdits(units, [{ id: 'u2', text: 'Senior Software Engineer, Acme Payments' }], resume), {});
});
