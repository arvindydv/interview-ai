import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AnswerMeter, confidenceScore, copilotOverlap, readingScore } from '../src/lib/delivery.js';

const RATE = 16_000;

/** `ms` of PCM: a 200 Hz tone at `amplitude`, or silence. */
function pcm(ms: number, amplitude = 0) {
  const n = (RATE * ms) / 1000;
  const buf = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(amplitude * Math.sin((2 * Math.PI * 200 * i) / RATE)), i * 2);
  return buf;
}

test('the meter measures thinking time, speech and long pauses from the audio', () => {
  const m = new AnswerMeter();
  m.audio(pcm(3000)); // thinking
  m.audio(pcm(4000, 6000));
  m.audio(pcm(2500)); // a long pause
  m.audio(pcm(3000, 4000));
  m.audio(pcm(500)); // a breath, not a pause
  m.audio(pcm(1000, 5000));
  const a = m.finish('So at my last job I led the migration and it went well overall for the team', null);
  assert.equal(a.mode, 'voice');
  assert.ok(a.delivery);
  assert.ok(Math.abs(a.delivery.thinkMs - 3000) <= 40, `thinkMs ${a.delivery.thinkMs}`);
  assert.ok(Math.abs(a.delivery.speakingMs - 8000) <= 80, `speakingMs ${a.delivery.speakingMs}`);
  assert.equal(a.delivery.longPauses, 1);
  assert.ok(Math.abs(a.delivery.longestPauseMs - 2500) <= 40);
  // From the first word to the last: 4 + 2.5 + 3 + 0.5 + 1 seconds.
  assert.ok(Math.abs(a.durationMs - 11_000) <= 60, `durationMs ${a.durationMs}`);
});

test('frames that split a 20 ms window are joined, not dropped', () => {
  const whole = new AnswerMeter();
  whole.audio(pcm(1000, 5000));
  const split = new AnswerMeter();
  const audio = pcm(1000, 5000);
  for (let off = 0; off < audio.length; off += 1002) split.audio(audio.subarray(off, off + 1002));
  assert.equal(split.elapsedMs, whole.elapsedMs);
});

test('copying the desktop app’s answer word for word reads as reading', () => {
  const suggested =
    "So at Acme I led the move from a monolith to services. We split billing out first because it changed most often, and we cut deploy time from two hours to fifteen minutes.";
  const read = 'so at acme i led the move from a monolith to services we split billing out first because it changed most often';
  const own = 'honestly the biggest thing I did there was getting the team to agree on what to split first, we argued about it for weeks';
  assert.ok(copilotOverlap(read, suggested) > 0.8);
  assert.ok(copilotOverlap(own, suggested) < 0.1);
});

const signals = {
  thinkMs: 2000, speakingMs: 30_000, longPauses: 0, longestPauseMs: 800, pauseRatio: 0.1,
  paceVariation: 0.4, volumeVariation: 0.7, hedges: [], restarts: 2, clarity: 0.95, copilotOverlap: null,
};

test('a natural answer is not taken for reading; a matched one is', () => {
  const fillers = [{ word: 'um', count: 3 }];
  assert.ok(readingScore(signals, 90, fillers) < 0.4);
  assert.ok(readingScore({ ...signals, copilotOverlap: 0.75 }, 90, fillers) >= 0.65);
  // Steady and fluent without a match is suspicious, but never certain.
  const steady = readingScore({ ...signals, paceVariation: 0.1, restarts: 0, volumeVariation: 0.25 }, 120, []);
  assert.ok(steady > 0.5 && steady <= 0.8, `steady ${steady}`);
});

test('hedging, fillers and long silences lower the confidence estimate', () => {
  const sure = confidenceScore({ ...signals, readingLikelihood: 0.1 }, 120, 140, []);
  const unsure = confidenceScore(
    { ...signals, longPauses: 4, thinkMs: 9000, hedges: [{ word: 'i think', count: 4 }], readingLikelihood: 0.1 },
    80,
    95,
    [{ word: 'um', count: 6 }],
  );
  assert.ok(sure >= 9, `sure ${sure}`);
  assert.ok(unsure <= 4, `unsure ${unsure}`);
});
