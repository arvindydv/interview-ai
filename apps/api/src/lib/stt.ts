import WebSocket from 'ws';
import { AUDIO_FORMAT, type ListenState } from '@parakeet/shared';
import { env } from '../env.js';

// Deepgram Flux: streaming speech-to-text with built-in turn detection. Instead of a silence timer,
// the model says when the speaker has finished (EndOfTurn), and earlier when they have probably
// finished (EagerEndOfTurn), which is when an answer can start speculatively.
// https://developers.deepgram.com/reference/speech-to-text/listen-flux

export function sttConfigured() {
  return Boolean(env.DEEPGRAM_API_KEY);
}

export interface TurnInfo {
  event: 'StartOfTurn' | 'Update' | 'EagerEndOfTurn' | 'TurnResumed' | 'EndOfTurn' | (string & {});
  turn_index: number;
  transcript: string;
  end_of_turn_confidence?: number;
  words?: { word: string; confidence: number }[];
}

interface FluxOptions {
  /** Words to recognise better: the company, the role. */
  keyterms?: string[];
  /** `epoch` increases with every (re)connection; turn indexes restart from 0 on each one. */
  onTurn: (turn: TurnInfo, epoch: number) => void;
  onState: (state: ListenState, error?: string) => void;
  log: { info: (o: object, m: string) => void; warn: (o: object, m: string) => void };
}

/** One Flux stream (one audio source). Reconnects with backoff until closed. */
export class FluxStream {
  private ws: WebSocket | null = null;
  private closed = false;
  private attempts = 0;
  private epoch = 0;
  private retry: NodeJS.Timeout | null = null;

  constructor(private readonly opts: FluxOptions) {}

  start() {
    this.connect();
    return this;
  }

  private url() {
    const params = new URLSearchParams({
      model: env.DEEPGRAM_MODEL,
      encoding: AUDIO_FORMAT.encoding,
      sample_rate: String(AUDIO_FORMAT.sampleRate),
      eot_threshold: String(env.DEEPGRAM_EOT_THRESHOLD),
      eager_eot_threshold: String(env.DEEPGRAM_EAGER_EOT_THRESHOLD),
      eot_timeout_ms: String(env.DEEPGRAM_EOT_TIMEOUT_MS),
    });
    for (const term of this.opts.keyterms ?? []) params.append('keyterm', term);
    return `wss://api.deepgram.com/v2/listen?${params}`;
  }

  private connect() {
    this.opts.onState('connecting');
    const ws = new WebSocket(this.url(), { headers: { Authorization: `Token ${env.DEEPGRAM_API_KEY}` } });
    this.ws = ws;
    let failure: string | undefined;

    ws.on('open', () => {
      this.attempts = 0;
      this.epoch += 1;
      this.opts.onState('up');
    });
    ws.on('message', (data, isBinary) => {
      if (isBinary) return;
      let msg: { type?: string; code?: string; description?: string } & Partial<TurnInfo>;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }
      if (msg.type === 'TurnInfo') this.opts.onTurn(msg as TurnInfo, this.epoch);
      else if (msg.type === 'Error') {
        failure = `Speech-to-text error: ${msg.description ?? msg.code}`;
        this.opts.log.warn({ code: msg.code }, failure);
      } else if (msg.type === 'Warning') this.opts.log.info({ code: msg.code }, `Deepgram warning: ${msg.description}`);
    });
    // The handshake was refused, e.g. a bad key (401) or no balance (402).
    ws.on('unexpected-response', (_req, res) => {
      failure =
        res.statusCode === 401 || res.statusCode === 403
          ? 'Deepgram rejected DEEPGRAM_API_KEY. Check the key on the server.'
          : res.statusCode === 402
            ? 'The Deepgram account is out of credit.'
            : `Speech-to-text is unavailable (HTTP ${res.statusCode}).`;
      this.opts.log.warn({ status: res.statusCode }, failure);
      ws.terminate();
    });
    ws.on('error', (err) => {
      failure ??= 'Speech-to-text is unreachable.';
      this.opts.log.warn({ err: err.message }, 'Deepgram socket error');
    });
    ws.on('close', (code) => {
      if (this.ws === ws) this.ws = null;
      if (this.closed) return;
      this.opts.onState('down', failure);
      // Exponential backoff capped at 10 s; a refused key keeps retrying slowly in case it gets fixed.
      const delay = Math.min(500 * 2 ** this.attempts, 10_000);
      this.attempts += 1;
      this.opts.log.info({ code, delay }, 'Deepgram stream closed; reconnecting');
      this.retry = setTimeout(() => this.connect(), delay);
    });
  }

  /** Raw PCM in AUDIO_FORMAT. Dropped while (re)connecting: late audio is useless for live answers. */
  send(pcm: Buffer) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(pcm);
  }

  close() {
    this.closed = true;
    if (this.retry) clearTimeout(this.retry);
    const ws = this.ws;
    this.ws = null;
    if (!ws) return;
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'CloseStream' }));
      // Let Deepgram finish the stream cleanly, but don't keep the socket around for long.
      setTimeout(() => ws.terminate(), 2000).unref();
    } else {
      ws.terminate();
    }
  }
}
