import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reportFileName } from '@parakeet/shared';
import { printable } from '../src/lib/pdf.js';

test('reports are named by the day they happened, in the given time zone', () => {
  assert.equal(reportFileName('2026-10-12T10:00:00Z', 'interview', 'Asia/Kolkata'), '12_oct_interview.pdf');
  // 20:00 UTC on 3 September is already the 4th in India; September is "sep", not "sept".
  assert.equal(reportFileName('2026-09-03T20:00:00Z', 'practice', 'Asia/Kolkata'), '4_sep_practice.pdf');
});

test('report text uses characters the font can print, all the way down', () => {
  const data = printable({ say: 'with EXPLAIN to', list: ['sub‑queries', 7], nested: { x: 'a b​c' } });
  assert.deepEqual(data, { say: 'with EXPLAIN to', list: ['sub-queries', 7], nested: { x: 'a bc' } });
});
