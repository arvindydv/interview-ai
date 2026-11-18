import { test } from 'node:test';
import assert from 'node:assert/strict';
import { feedbackBody } from '../src/lib/feedback.js';

const parse = (x: unknown) => feedbackBody.safeParse(x);
const error = (x: unknown) => {
  const r = parse(x);
  assert.equal(r.success, false);
  return r.error!.issues[0].message;
};

test('a review needs 1 to 5 stars', () => {
  assert.equal(error({ kind: 'review', message: 'Helped me in my HR round' }), 'Choose a star rating');
  assert.equal(error({ kind: 'review', rating: 6, message: 'Helped me in my HR round' }), 'Rating must be 1 to 5 stars');
  assert.equal(parse({ kind: 'review', rating: 5, message: 'Helped me in my HR round' }).success, true);
});

test('a review shown on the website needs a name', () => {
  assert.equal(error({ kind: 'review', rating: 4, message: 'Helped me in my HR round', publish: true }), 'Add the name to show with your review');
  const r = parse({ kind: 'review', rating: 4, message: '  Helped me in my HR round ', displayName: ' Priya   S. ', publish: true });
  assert.ok(r.success);
  assert.equal(r.data.displayName, 'Priya S.');
  assert.equal(r.data.message, 'Helped me in my HR round');
});

test('private feedback drops rating, name and consent to publish', () => {
  const r = parse({ kind: 'idea', rating: 5, message: 'Add a compact overlay mode', displayName: 'X', role: 'Y', publish: true });
  assert.ok(r.success);
  assert.deepEqual(r.data, { kind: 'idea', rating: undefined, message: 'Add a compact overlay mode', displayName: '', role: '', publish: false });
});

test('messages must be a sensible length', () => {
  assert.equal(error({ kind: 'bug', message: 'short' }), 'Write at least 10 characters');
  assert.equal(error({ kind: 'bug', message: 'x'.repeat(1001) }), 'Keep it under 1000 characters');
});
