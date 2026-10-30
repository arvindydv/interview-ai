import { test } from 'node:test';
import assert from 'node:assert/strict';

import { resumeName } from '../src/lib/resumeName.js';

test('the interviewer uses the name on the resume', () => {
  assert.equal(resumeName('Arvind Yadav', ''), 'Arvind Yadav');
  assert.equal(resumeName('ARVIND YADAV', ''), 'Arvind Yadav');
  assert.equal(resumeName('McKenzie O’Neil', ''), 'McKenzie O’Neil');
  // Before the analysis finishes: the first line, when it looks like a name.
  assert.equal(resumeName(null, '\n  PRIYA SHARMA | Bengaluru | priya@example.com\nSoftware engineer'), 'Priya Sharma');
  assert.equal(resumeName(null, 'Curriculum Vitae of a software engineer with many years of experience'), '');
  assert.equal(resumeName(null, 'Experience: 5 years'), '');
});
