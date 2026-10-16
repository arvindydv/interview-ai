import { AUDIO_SOURCE_BYTE, type AudioSource, type ListenState, type ServerMessage } from '@parakeet/shared';
import { FluxStream, sttConfigured, type TurnInfo } from './stt.js';

// Live listening for one session: a Flux stream per audio source, the transcript sent to the
// client, and auto-answer. When the interviewer finishes a question, it is answered without a key
// press, speculatively from Flux's EagerEndOfTurn so the answer is already streaming by the time
// the turn is confirmed.

const SOURCES: AudioSource[] = ['interviewer', 'you'];
const SOURCE_BY_BYTE = new Map(Object.entries(AUDIO_SOURCE_BYTE).map(([source, byte]) => [byte, source as AudioSource]));

const normalize = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** Recent finished turns, passed with each question so follow-ups ("why?", "go deeper") make sense. */
export class Conversation {
  private lines: { source: AudioSource; text: string }[] = [];

  add(source: AudioSource, text: string) {
    this.lines.push({ source, text });
    // Keep the last few minutes: enough for follow-ups, small enough not to slow the answer down.
    while (this.lines.length > 16 || this.lines.reduce((n, l) => n + l.text.length, 0) > 6000) this.lines.shift();
  }

  /** The transcript, minus a trailing line that is the question being asked (it's sent on its own). */
  render(question?: string) {
    const lines = [...this.lines];
    if (question && lines.length && normalize(lines[lines.length - 1].text) === normalize(question)) lines.pop();
    return lines.map((l) => `${l.source === 'interviewer' ? 'Interviewer' : 'Candidate'}: ${l.text}`).join('\n');
  }
}

// Words that open a question or a request ("tell me…", "walk me through…").
const CUES = new Set(
  (
    'what whats what\'s why how when where who whom whose which can could would will should shall do does did ' +
    'is are was were have has had tell describe explain walk give share talk discuss design write implement ' +
    'solve compare define imagine suppose say list name calculate estimate show convince sell pitch plan ' +
    'outline elaborate clarify expand ask let\'s lets any anything'
  ).split(' '),
);
// Lead-ins skipped before looking for a cue ("okay so now tell me…").
const LEAD_INS = new Set('so okay ok and now alright all right well um uh great next then just maybe also but let me'.split(' '));

/**
 * Whether an interviewer turn is worth answering: a question or a request, not "thanks, that's great".
 * Missed ones are one key press away (Answer), so this errs towards fewer, better triggers.
 */
export function isQuestion(text: string) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length < 3) return false;
  if (text.includes('?')) return true;
  return text.split(/[.!;:,]+/).some((clause) => {
    const w = clause.toLowerCase().replace(/[^a-z' ]/g, ' ').split(/\s+/).filter(Boolean);
    let i = 0;
    while (i < w.length - 1 && LEAD_INS.has(w[i])) i++;
    return i < w.length && CUES.has(w[i]);
  });
}

export interface AnswerHandle {
  /** Shows a held (speculative) answer, including everything streamed so far. */
  release(): void;
  cancel(): void;
}

interface ListenerDeps {
  send: (m: ServerMessage) => void;
  conversation: Conversation;
  /** Starts answering a heard question. With `hold`, output is buffered until release(). */
  answer: (text: string, hold: boolean) => AnswerHandle;
  /** Terms to boost in recognition (company, role). */
  keyterms: () => Promise<string[]>;
  log: { debug: (o: object, m: string) => void; info: (o: object, m: string) => void; warn: (o: object, m: string) => void };
}

export class Listener {
  private streams = new Map<AudioSource, FluxStream>();
  private states: Record<AudioSource, ListenState> = { interviewer: 'off', you: 'off' };
  private error: string | undefined;
  private autoAnswer = true;
  private speculative: { id: string; text: string; handle: AnswerHandle } | null = null;
  private queue = Promise.resolve();
  private closed = false;

  constructor(private readonly deps: ListenerDeps) {}

  /** Applies a `listen` message. Serialised, so quick toggles can't open duplicate streams. */
  configure(sources: AudioSource[], autoAnswer: boolean) {
    this.queue = this.queue.then(() => this.apply(sources, autoAnswer)).catch((err) => {
      this.deps.log.warn({ err }, 'listen configure failed');
    });
  }

  private async apply(sources: AudioSource[], autoAnswer: boolean) {
    if (this.closed) return;
    this.autoAnswer = autoAnswer;
    if (!autoAnswer) this.dropSpeculative();
    const wanted = new Set(SOURCES.filter((s) => sources.includes(s)));
    for (const [source, stream] of this.streams) {
      if (wanted.has(source)) continue;
      stream.close();
      this.streams.delete(source);
      this.states[source] = 'off';
    }
    const missing = [...wanted].filter((s) => !this.streams.has(s));
    if (missing.length && !sttConfigured()) {
      this.error = 'Live transcription isn’t set up on the server (DEEPGRAM_API_KEY).';
      for (const s of missing) this.states[s] = 'down';
      return this.status();
    }
    const keyterms = missing.length ? await this.deps.keyterms().catch(() => []) : [];
    if (this.closed) return;
    for (const source of missing) {
      const stream: FluxStream = new FluxStream({
        keyterms,
        log: this.deps.log,
        onTurn: (turn, epoch) => this.onTurn(source, turn, epoch),
        onState: (state, error) => {
          if (this.streams.get(source) !== stream) return;
          this.states[source] = state;
          this.error = state === 'up' ? undefined : (error ?? this.error);
          this.status();
        },
      });
      this.streams.set(source, stream);
      stream.start();
    }
    this.status();
  }

  /** A binary frame from the client: source byte + PCM. */
  audio(frame: Buffer) {
    const source = SOURCE_BY_BYTE.get(frame[0]);
    if (source) this.streams.get(source)?.send(frame.subarray(1));
  }

  private onTurn(source: AudioSource, turn: TurnInfo, epoch: number) {
    const id = `${source}-${epoch}-${turn.turn_index}`;
    const text = turn.transcript.trim();
    const interviewer = source === 'interviewer';
    switch (turn.event) {
      case 'EndOfTurn':
        if (text) this.deps.send({ type: 'transcript', id, source, text, final: true });
        if (interviewer) this.endOfQuestion(id, text);
        if (text) this.deps.conversation.add(source, text);
        return;
      case 'EagerEndOfTurn':
        if (text) this.deps.send({ type: 'transcript', id, source, text, final: false });
        if (interviewer && this.autoAnswer && isQuestion(text)) {
          this.deps.log.debug({ id }, 'eager end of question: answering speculatively');
          this.dropSpeculative();
          this.speculative = { id, text, handle: this.deps.answer(text, true) };
        }
        return;
      case 'TurnResumed':
        // They kept talking: the speculative answer was for half a question.
        if (interviewer) this.dropSpeculative();
        break;
    }
    if (text) this.deps.send({ type: 'transcript', id, source, text, final: false });
  }

  private endOfQuestion(id: string, text: string) {
    const spec = this.speculative;
    this.speculative = null;
    if (spec && spec.id === id && normalize(spec.text) === normalize(text)) {
      this.deps.log.debug({ id }, 'question confirmed: showing the speculative answer');
      return spec.handle.release();
    }
    if (spec) this.deps.log.debug({ id, eager: spec.text, final: text }, 'question changed: restarting the answer');
    spec?.handle.cancel();
    if (this.autoAnswer && text && isQuestion(text)) this.deps.answer(text, false);
  }

  private dropSpeculative() {
    this.speculative?.handle.cancel();
    this.speculative = null;
  }

  private status() {
    if (this.closed) return;
    this.deps.send({ type: 'listening', sources: { ...this.states }, ...(this.error ? { error: this.error } : {}) });
  }

  close() {
    this.closed = true;
    this.dropSpeculative();
    for (const stream of this.streams.values()) stream.close();
    this.streams.clear();
  }
}
