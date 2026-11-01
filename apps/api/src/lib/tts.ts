import WebSocket from 'ws';
import { INTERVIEWER_AUDIO } from '@parakeet/shared';
import { env } from '../env.js';

// Deepgram Aura text-to-speech: the practice interviewer's voice. Browser text-to-speech has no
// voices at all on many Linux setups and sounds robotic elsewhere, so the room plays this instead and
// falls back to the browser only when it's unavailable.
//
// Aura streams audio about as fast as it is spoken, so a line is forwarded chunk by chunk as raw PCM
// (INTERVIEWER_AUDIO) and starts playing after the first chunk, not after the whole line.
//
// The room speaks through a Voice: one WebSocket to Aura kept open for the whole interview. Over plain
// HTTPS, Deepgram drops an idle connection within about 2 s, so nearly every line paid a new TLS
// handshake to the US (1.3–4.5 s to the first audio, measured); over the socket it's 0.4–0.7 s, even
// after a minute idle. Lines the room can predict (Speech) are still started before they're needed.

export const ttsConfigured = () => Boolean(env.DEEPGRAM_API_KEY);

interface Sink {
  /** The first audio is ready. */
  start: () => void;
  /** PCM, always a whole number of samples. */
  chunk: (pcm: Buffer) => void;
}

type Log = { warn: (o: object, m: string) => void };

const speakParams = () =>
  new URLSearchParams({
    model: env.DEEPGRAM_TTS_MODEL,
    encoding: INTERVIEWER_AUDIO.encoding,
    sample_rate: String(INTERVIEWER_AUDIO.sampleRate),
  });

/** Holds back a trailing odd byte, so every chunk is whole 16-bit samples. */
class Samples {
  private odd: Buffer | null = null;
  take(part: Buffer) {
    let buf = this.odd ? Buffer.concat([this.odd, part]) : part;
    this.odd = buf.length % 2 ? buf.subarray(buf.length - 1) : null;
    if (this.odd) buf = buf.subarray(0, buf.length - 1);
    return buf;
  }
}

/** Speaks `text` into `sink`. Resolves false if no audio could be produced (nothing was started). */
export async function streamSpeech(text: string, sink: Sink, log: Log, signal?: AbortSignal): Promise<boolean> {
  if (!ttsConfigured()) return false;
  const params = speakParams();
  params.set('container', 'none');
  let started = false;
  try {
    const res = await fetch(`https://api.deepgram.com/v1/speak?${params}`, {
      method: 'POST',
      headers: { authorization: `Token ${env.DEEPGRAM_API_KEY}`, 'content-type': 'application/json' },
      // Aura reads at most 2000 characters per request; interviewer lines are far shorter.
      body: JSON.stringify({ text: text.slice(0, 2000) }),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000),
    });
    if (!res.ok || !res.body) {
      log.warn({ status: res.status, body: (await res.text().catch(() => '')).slice(0, 200) }, 'text-to-speech failed');
      return false;
    }
    const samples = new Samples();
    for await (const part of res.body as AsyncIterable<Uint8Array>) {
      const buf = samples.take(Buffer.from(part));
      if (!buf.length) continue;
      if (!started) {
        started = true;
        sink.start();
      }
      sink.chunk(buf);
    }
    return started;
  } catch (err) {
    if (!signal?.aborted) log.warn({ err: (err as Error).message }, 'text-to-speech unreachable');
    // Part of the line may have been sent; the browser plays what it got.
    return started;
  }
}

/**
 * A line being synthesised now, to be played later (or never). Audio is kept as it arrives, so it can
 * be played any number of times: at once if it has all arrived, or as it streams in.
 */
export class Speech {
  private chunks: Buffer[] = [];
  private listeners = new Set<(pcm: Buffer) => void>();
  private ctrl = new AbortController();
  /** True once audio is ready; false if there will be none. */
  readonly ready: Promise<boolean>;
  /** Resolves when all the audio has arrived: true if there was any. */
  readonly done: Promise<boolean>;

  constructor(readonly text: string, log: Log, voice?: Voice | null) {
    let ready!: (ok: boolean) => void;
    this.ready = new Promise((r) => (ready = r));
    const sink: Sink = {
      start: () => ready(true),
      chunk: (pcm) => {
        this.chunks.push(pcm);
        for (const l of this.listeners) l(pcm);
      },
    };
    this.done = (voice ? voice.speak(text, sink, this.ctrl.signal) : streamSpeech(text, sink, log, this.ctrl.signal)).then((ok) => {
      ready(ok);
      return ok;
    });
  }

  /** Sends the audio to `sink`: what has arrived at once, the rest as it comes. Resolves when it's all sent. */
  async play(sink: (pcm: Buffer) => void) {
    for (const c of this.chunks) sink(c);
    this.listeners.add(sink);
    try {
      return await this.done;
    } finally {
      this.listeners.delete(sink);
    }
  }

  /** Stops synthesising a line that won't be said. */
  cancel() {
    this.ctrl.abort();
  }
}

interface Job {
  text: string;
  sink: Sink;
  signal: AbortSignal;
  started: boolean;
  samples: Samples;
  end: (ok: boolean) => void;
}

/** A line with no audio after this long is given up on the socket and synthesised over HTTPS instead. */
const JOB_TIMEOUT_MS = 8_000;

/**
 * Aura over one WebSocket for the length of an interview (see the top of the file). Lines are
 * synthesised one at a time, in order; one no longer wanted is skipped, or cleared if it's under way.
 * While the socket is down, lines go over HTTPS.
 */
export class Voice {
  private ws: WebSocket | null = null;
  private open = false;
  private queue: Job[] = [];
  private current: Job | null = null;
  private timer: NodeJS.Timeout | null = null;
  private closed = false;
  private retry: NodeJS.Timeout | null = null;

  constructor(private readonly log: Log) {
    if (ttsConfigured()) this.connect();
  }

  private connect() {
    const ws = new WebSocket(`wss://api.deepgram.com/v1/speak?${speakParams()}`, { headers: { Authorization: `Token ${env.DEEPGRAM_API_KEY}` } });
    this.ws = ws;
    ws.on('open', () => {
      this.open = true;
      this.pump();
    });
    ws.on('message', (data, isBinary) => {
      const job = this.current;
      if (isBinary) {
        if (!job || job.signal.aborted) return;
        const buf = job.samples.take(Buffer.isBuffer(data) ? data : Buffer.concat(data as Buffer[]));
        if (!buf.length) return;
        if (!job.started) {
          job.started = true;
          job.sink.start();
        }
        job.sink.chunk(buf);
        return;
      }
      let msg: { type?: string; description?: string };
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }
      if (msg.type === 'Flushed' || msg.type === 'Cleared') this.finish(Boolean(job?.started && !job.signal.aborted));
      else if (msg.type === 'Warning' || msg.type === 'Error') this.log.warn({ msg }, 'text-to-speech socket');
    });
    ws.on('error', (err) => this.log.warn({ err: err.message }, 'text-to-speech socket error'));
    ws.on('close', () => {
      if (this.ws === ws) this.ws = null;
      this.open = false;
      // The line under way is finished over HTTPS, and so is the rest until the socket is back.
      const job = this.current;
      this.current = null;
      if (this.timer) clearTimeout(this.timer);
      if (job && !job.started) this.overHttp(job);
      else job?.end(Boolean(job.started));
      for (const j of this.queue.splice(0)) this.overHttp(j);
      if (!this.closed) this.retry = setTimeout(() => this.connect(), 1_000);
    });
  }

  /** Synthesises `text` into `sink`. Resolves false if no audio could be produced. */
  speak(text: string, sink: Sink, signal: AbortSignal): Promise<boolean> {
    if (!ttsConfigured()) return Promise.resolve(false);
    if (!this.open && !this.ws) return streamSpeech(text, sink, this.log, signal);
    return new Promise((end) => {
      const job: Job = { text, sink, signal, started: false, samples: new Samples(), end };
      signal.addEventListener('abort', () => this.cancel(job), { once: true });
      this.queue.push(job);
      this.pump();
    });
  }

  private pump() {
    if (this.current || !this.open || !this.ws) return;
    let job = this.queue.shift();
    while (job?.signal.aborted) {
      job.end(false);
      job = this.queue.shift();
    }
    if (!job) return;
    this.current = job;
    this.ws.send(JSON.stringify({ type: 'Speak', text: job.text.slice(0, 2000) }));
    this.ws.send(JSON.stringify({ type: 'Flush' }));
    this.timer = setTimeout(() => {
      if (this.current !== job) return;
      this.log.warn({}, 'text-to-speech socket stalled; reconnecting');
      this.ws?.terminate();
    }, JOB_TIMEOUT_MS);
  }

  private finish(ok: boolean) {
    const job = this.current;
    this.current = null;
    if (this.timer) clearTimeout(this.timer);
    job?.end(ok);
    this.pump();
  }

  private cancel(job: Job) {
    const queued = this.queue.indexOf(job);
    if (queued >= 0) {
      this.queue.splice(queued, 1);
      job.end(false);
    } else if (this.current === job && this.open) {
      this.ws?.send(JSON.stringify({ type: 'Clear' }));
    }
  }

  private overHttp(job: Job) {
    if (job.signal.aborted) return job.end(false);
    void streamSpeech(job.text, job.sink, this.log, job.signal).then(job.end);
  }

  close() {
    this.closed = true;
    if (this.retry) clearTimeout(this.retry);
    if (this.timer) clearTimeout(this.timer);
    for (const job of this.queue.splice(0)) job.end(false);
    this.current?.end(false);
    this.current = null;
    const ws = this.ws;
    this.ws = null;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'Close' }));
    ws?.close();
  }
}
