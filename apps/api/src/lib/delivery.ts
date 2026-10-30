import { AUDIO_FORMAT, hesitationStats, speechStats, type PracticeAnswer, type PracticeDelivery } from '@parakeet/shared';

// How a spoken practice answer was delivered: pauses, pace, loudness, hesitation, and whether it
// sounded read out. Measured on the server from the candidate's microphone audio and the live
// transcript, so the debrief can coach confidence and not only content.

const WINDOW_MS = 20;
const WINDOW_SAMPLES = (AUDIO_FORMAT.sampleRate * WINDOW_MS) / 1000;
/** Silences shorter than this are breaths between words, not pauses. */
const LONG_PAUSE_MS = 2000;
/** Pace is measured over buckets of this length. */
const PACE_BUCKET_MS = 6000;

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const round2 = (n: number) => Math.round(n * 100) / 100;

function coefficientOfVariation(xs: number[]) {
  if (xs.length < 3) return null;
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  if (mean <= 0) return null;
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length);
  return round2(sd / mean);
}

/**
 * Listens to one answer: from the moment the question finished playing until the answer is done.
 * Time is counted in audio (20 ms windows), so it doesn't depend on when frames arrive.
 */
export class AnswerMeter {
  private ms = 0;
  private firstVoice: number | null = null;
  private lastVoice: number | null = null;
  private voicedMs = 0;
  private silenceStart: number | null = null;
  private longPauses = 0;
  private longestPause = 0;
  private pausedMs = 0;
  private noiseFloor = 200;
  private carry: Buffer = Buffer.alloc(0);
  private rmsSum = 0;
  private rmsSq = 0;
  private rmsN = 0;
  /** (audio ms, words so far), from transcript updates. */
  private pace: [number, number][] = [];
  private confidence: number[] = [];

  /** Audio since the question ended, in ms. */
  get elapsedMs() {
    return this.ms;
  }

  get heardVoice() {
    return this.firstVoice !== null;
  }

  /** Raw PCM (linear16, mono) from the microphone. */
  audio(pcm: Buffer) {
    let buf = this.carry.length ? Buffer.concat([this.carry, pcm]) : pcm;
    const bytes = WINDOW_SAMPLES * 2;
    let off = 0;
    for (; off + bytes <= buf.length; off += bytes) this.window(buf, off);
    this.carry = Buffer.from(buf.subarray(off));
  }

  private window(buf: Buffer, off: number) {
    let sq = 0;
    for (let i = 0; i < WINDOW_SAMPLES; i++) {
      const s = buf.readInt16LE(off + i * 2);
      sq += s * s;
    }
    const rms = Math.sqrt(sq / WINDOW_SAMPLES);
    // The noise floor follows quiet windows quickly and drifts up slowly, so a noisy room isn't voice.
    if (rms < this.noiseFloor) this.noiseFloor = Math.max(30, 0.9 * this.noiseFloor + 0.1 * rms);
    else this.noiseFloor *= 1.0005;
    const voiced = rms > Math.max(this.noiseFloor * 3, 350);

    if (voiced) {
      if (this.firstVoice === null) this.firstVoice = this.ms;
      else if (this.silenceStart !== null) {
        const gap = this.ms - this.silenceStart;
        this.pausedMs += gap;
        if (gap >= LONG_PAUSE_MS) this.longPauses++;
        this.longestPause = Math.max(this.longestPause, gap);
      }
      this.silenceStart = null;
      this.lastVoice = this.ms + WINDOW_MS;
      this.voicedMs += WINDOW_MS;
      this.rmsSum += rms;
      this.rmsSq += rms * rms;
      this.rmsN++;
    } else if (this.firstVoice !== null && this.silenceStart === null) {
      this.silenceStart = this.ms;
    }
    this.ms += WINDOW_MS;
  }

  /** The number of words recognised so far in this answer (for pace through the answer). */
  words(total: number) {
    const last = this.pace[this.pace.length - 1];
    if (!last || total > last[1]) this.pace.push([this.ms, total]);
  }

  /** Per-word recognition confidence, 0–1, when the recogniser reports it. */
  wordConfidence(values: number[]) {
    for (const v of values) if (Number.isFinite(v)) this.confidence.push(v);
  }

  private paceVariation() {
    if (this.firstVoice === null || this.lastVoice === null) return null;
    const rates: number[] = [];
    let prev: [number, number] = [this.firstVoice, 0];
    for (const [ms, words] of this.pace) {
      if (ms - prev[0] < PACE_BUCKET_MS) continue;
      rates.push(((words - prev[1]) / (ms - prev[0])) * 60_000);
      prev = [ms, words];
    }
    return coefficientOfVariation(rates);
  }

  private volumeVariation() {
    if (this.rmsN < 50) return null;
    const mean = this.rmsSum / this.rmsN;
    const sd = Math.sqrt(Math.max(this.rmsSq / this.rmsN - mean * mean, 0));
    return mean > 0 ? round2(sd / mean) : null;
  }

  /** The answer, with how it was said. `copilotAnswer` is what the desktop app showed for this question. */
  finish(text: string, copilotAnswer: string | null): PracticeAnswer {
    const first = this.firstVoice ?? 0;
    const span = this.lastVoice !== null ? this.lastVoice - first : 0;
    const durationMs = span || this.ms;
    const stats = speechStats(text, durationMs, 'voice');
    const { hedges, restarts } = hesitationStats(text);
    const clarity = this.confidence.length
      ? round2(this.confidence.reduce((a, b) => a + b, 0) / this.confidence.length)
      : null;
    const base = {
      thinkMs: this.firstVoice ?? this.ms,
      speakingMs: this.voicedMs,
      longPauses: this.longPauses,
      longestPauseMs: this.longestPause,
      pauseRatio: span > 0 ? round2(clamp01(this.pausedMs / span)) : 0,
      paceVariation: this.paceVariation(),
      volumeVariation: this.volumeVariation(),
      hedges,
      restarts,
      clarity,
      copilotOverlap: copilotAnswer ? copilotOverlap(text, copilotAnswer) : null,
    };
    const readingLikelihood = readingScore(base, stats.words, stats.fillers);
    const delivery: PracticeDelivery = {
      ...base,
      readingLikelihood,
      confidenceHint: confidenceScore({ ...base, readingLikelihood }, stats.words, stats.wpm, stats.fillers),
    };
    return { text, mode: 'voice', durationMs, skipped: !text.trim(), ...stats, delivery };
  }
}

const tokens = (text: string) =>
  text
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[^\p{L}\p{N}'\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);

/** Share of the answer's three-word sequences that also appear in `source`, 0–1. */
export function copilotOverlap(answer: string, source: string) {
  const a = tokens(answer);
  const s = tokens(source);
  if (a.length < 8 || s.length < 3) return 0;
  const grams = new Set<string>();
  for (let i = 0; i + 2 < s.length; i++) grams.add(`${s[i]} ${s[i + 1]} ${s[i + 2]}`);
  let hit = 0;
  for (let i = 0; i + 2 < a.length; i++) if (grams.has(`${a[i]} ${a[i + 1]} ${a[i + 2]}`)) hit++;
  return round2(hit / (a.length - 2));
}

type Signals = Omit<PracticeDelivery, 'readingLikelihood' | 'confidenceHint'>;
const per100 = (n: number, words: number) => (words > 0 ? (n / words) * 100 : 0);
const total = (xs: { count: number }[]) => xs.reduce((n, x) => n + x.count, 0);

/**
 * How much an answer sounded read out, 0–1. Matching the desktop app's suggested answer word for word
 * is strong evidence. Without it, reading shows as a metronome-steady pace, almost no fillers or false
 * starts in a long answer, and flat loudness; those alone are never treated as certain.
 */
export function readingScore(d: Signals, words: number, fillers: { count: number }[]) {
  const steady = d.paceVariation === null ? 0.3 : clamp01((0.35 - d.paceVariation) / 0.2);
  const slips = per100(total(fillers) + d.restarts, words);
  const fluent = words >= 50 ? clamp01(1 - slips / 3) : 0;
  const flat = d.volumeVariation === null ? 0.3 : clamp01((0.6 - d.volumeVariation) / 0.3);
  const heuristic = (0.45 * steady + 0.4 * fluent + 0.15 * flat) * Math.min(1, words / 60);
  const matched = d.copilotOverlap === null ? 0 : clamp01((d.copilotOverlap - 0.2) / 0.4);
  return round2(Math.max(matched, heuristic * 0.8));
}

/** A first estimate of how confident an answer sounded, 0–10, from hesitation, pauses and pace. */
export function confidenceScore(
  d: Signals & { readingLikelihood: number },
  words: number,
  wpm: number | null,
  fillers: { count: number }[],
) {
  let score = 10;
  score -= Math.min(3, 0.6 * per100(total(fillers), words));
  score -= Math.min(2.5, 0.7 * per100(total(d.hedges), words));
  score -= Math.min(1.5, 0.5 * per100(d.restarts, words));
  score -= Math.min(2, 0.5 * Math.max(0, d.longPauses - 1));
  if (d.thinkMs > 12_000) score -= 2;
  else if (d.thinkMs > 6_000) score -= 1;
  if (wpm !== null && (wpm < 100 || wpm > 190)) score -= 1;
  if (d.clarity !== null && d.clarity < 0.8) score -= 1;
  if (words < 25) score -= 1.5;
  if (d.readingLikelihood >= 0.65) score -= 1.5;
  return Math.round(Math.max(0, Math.min(10, score)) * 10) / 10;
}
