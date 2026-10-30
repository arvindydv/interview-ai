import { randomUUID } from 'node:crypto';
import {
  PRACTICE_DIFFICULTIES, PRACTICE_LIMITS, ROUND_TYPES, speechStats,
  type DesktopStatus, type InterviewerState, type PracticeAnswer, type PracticePhase, type PracticeQuestion,
  type PracticeQuestionKind, type PracticeServerMessage, type PracticeSession,
} from '@parakeet/shared';
import { AnswerMeter } from './delivery.js';
import { interviewerTurn, type Turn } from './interviewer.js';
import { subscribeLive, type LiveEvent } from './liveEvents.js';
import { onlineUserIds } from './liveRegistry.js';
import { warmConnections } from './warm.js';
import { FluxStream, sttConfigured, type TurnInfo } from './stt.js';
import { chargeMinutes, minutesLeft, trialBalance } from './trial.js';
import { streamSpeech } from './tts.js';

// One live practice interview (spec F1), driven from the server: the interviewer greets the
// candidate by name, checks they're ready, starts the clock, then asks questions from their resume
// one at a time, listening to each answer until the candidate has finished, until the time is up.
//
// The candidate's microphone streams here and goes through Deepgram Flux (turn detection), so the
// interviewer knows when a sentence ends; whether the *answer* has ended is the interviewer model's
// call, with a patience timer for long silences. Each spoken answer is also measured for delivery
// (lib/delivery.ts) for the confidence debrief.

/** After a sentence ends, wait this long for more before deciding the answer might be done. */
const SETTLE_MS = 400;
/** Silence after an answer the model judged unfinished, before moving on anyway. */
const PATIENCE_MS = 4_000;
/** While the room is open, connections to the speech and model services are kept warm this often. */
const WARM_MS = 25_000;
/** If speech started but the recogniser never closed the sentence, decide anyway after this long. */
const STUCK_MS = 10_000;
/** Silence after a question before the interviewer offers to repeat it (once per question). */
const NUDGE_MS = 25_000;
/** Interview time is recorded (and charged) this often. */
const TICK_MS = 10_000;
/** With this little time left after an answer, the interviewer closes instead of asking again. */
const WRAP_AT_MS = 45_000;
/** The desktop app may finish hearing a line a moment before the browser reports it played. */
const HEARD_EARLY_MS = 3_000;

/** What happens before the interview starts if the interviewer model can't be reached. */
const FALLBACK: Record<'greeting' | 'confirm', Turn> = {
  greeting: { answer_complete: true, action: 'reply', say: '', question_kind: 'opener', looking_for: '' },
  confirm: {
    answer_complete: true,
    action: 'start',
    say: "Great, let's begin. Walk me through your background, and tell me about your most recent role.",
    question_kind: 'opener',
    looking_for: 'A short, structured introduction: current role, key experience and achievements, and why this kind of role.',
  },
};

const TEST_LINE = 'This is a sound check. Tell me a little about yourself and your most recent role.';

export interface RoomStore {
  /** Appends a question (with an empty answer slot). */
  addQuestion(q: PracticeQuestion): Promise<void>;
  setAnswer(index: number, answer: PracticeAnswer): Promise<void>;
  /** Removes a trailing question that was never answered. */
  dropLastQuestion(): Promise<void>;
  start(): Promise<void>;
  addSeconds(seconds: number): Promise<void>;
  /** Ends the interview and queues the debrief; resolves with the final session. */
  finish(seconds: number): Promise<PracticeSession>;
  load(): Promise<PracticeSession>;
}

interface RoomDeps {
  userId: string;
  session: PracticeSession;
  candidateName: string;
  /** Rendered resume and target interview for the interviewer model. */
  context: string;
  keyterms: string[];
  model: string;
  /** The candidate's local hour, for "good morning". */
  hour: number;
  store: RoomStore;
  send: (m: PracticeServerMessage) => void;
  /** A chunk of the interviewer's voice (INTERVIEWER_AUDIO). */
  sendAudio: (pcm: Buffer) => void;
  close: () => void;
  log: { info: (o: object, m: string) => void; warn: (o: object, m: string) => void; error: (o: object, m: string) => void };
}

type Line = { role: 'interviewer' | 'candidate'; text: string };

const greetingTime = (hour: number) => (hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening');
const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? '';
const normalize = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const wordCount = (s: string) => (s.trim() ? s.trim().split(/\s+/).length : 0);

export class PracticeRoom {
  private phase: PracticePhase = 'lobby';
  private interviewer: InterviewerState = 'idle';
  private session: PracticeSession;
  private lines: Line[] = [];
  private flux: FluxStream | null = null;
  private closed = false;

  // Speaking: the line being played, resolved when the browser reports it finished.
  private playing: { id: string; done: () => void } | null = null;
  private lineEndedAt = 0;
  private lastQuestion: string | null = null;

  // Listening: the reply being given now.
  private listening = false;
  private parts: string[] = [];
  private partial = '';
  private meter: AnswerMeter | null = null;
  private typed = false;
  private settleTimer: NodeJS.Timeout | null = null;
  private patienceTimer: NodeJS.Timeout | null = null;
  private nudgeTimer: NodeJS.Timeout | null = null;
  private nudged = false;
  /** Bumped whenever the candidate says more, so a decision made on an older transcript is dropped. */
  private generation = 0;
  private thinking: AbortController | null = null;
  /**
   * A decision started speculatively when the recogniser thought the candidate had *probably*
   * finished (EagerEndOfTurn). If the sentence ends as predicted, it's used at once instead of
   * waiting for the confirmed end and asking the model then.
   */
  private spec: { reply: string; turn: Promise<Turn | null>; ctrl: AbortController } | null = null;
  private warmer: NodeJS.Timeout | null = null;

  // The clock: interview time used before this connection, plus time since `since` while running.
  private endsAt = 0;
  private since = 0;
  private tick: NodeJS.Timeout | null = null;
  private endTimer: NodeJS.Timeout | null = null;
  private timeUp = false;
  private finishing = false;

  // The desktop app, if it's answering along.
  private desktop: DesktopStatus = { connected: false, hearing: false, heard: null, answerAfterMs: null };
  private desktopTurns = new Map<string, { text: string; answer: string; firstAt: number | null }>();
  private copilotAnswer: { text: string; at: number } | null = null;
  private unsubscribe: () => void;

  constructor(private readonly deps: RoomDeps) {
    this.session = deps.session;
    this.desktop.connected = onlineUserIds().has(deps.userId);
    this.unsubscribe = subscribeLive(deps.userId, (e) => this.onDesktop(e));
  }

  // ---- connection --------------------------------------------------------------------------------

  /** The candidate pressed Join: open the microphone stream and greet them (or welcome them back). */
  async join() {
    if (this.phase !== 'lobby' || this.closed) return;
    this.openFlux();
    warmConnections();
    this.warmer = setInterval(warmConnections, WARM_MS);
    if (this.session.startedAt) return this.resume();
    this.setPhase('greeting');
    const name = firstName(this.deps.candidateName);
    const round = ROUND_TYPES.find((r) => r.id === this.session.roundType)?.label ?? 'practice';
    const target = this.session.title && this.session.title !== 'General practice' ? ` for ${this.session.title.replace(' · ', ' at ')}` : '';
    await this.say(
      `Hi${name ? ` ${name}` : ''}, good ${greetingTime(this.deps.hour)}! I'm Friday, and I'll be taking your ${round.toLowerCase()} interview today${target}. How are you doing?`,
    );
    this.listen();
  }

  private async resume() {
    const left = (this.session.durationMinutes ?? 0) * 60 - this.session.seconds;
    if (left <= 5) return this.end();
    this.rebuildLines();
    this.setPhase('interview');
    this.startClock(left * 1000);
    const name = firstName(this.deps.candidateName);
    const open = this.openQuestionIndex();
    if (open !== null) {
      const q = this.session.questions[open].question;
      this.lastQuestion = q;
      await this.say(`Welcome back${name ? `, ${name}` : ''}. Let's pick up where we left off. ${q}`);
      this.listen();
    } else {
      await this.say(`Welcome back${name ? `, ${name}` : ''}. Let's carry on.`);
      await this.decide(true, 'next');
    }
  }

  /** PCM from the candidate's microphone. */
  audio(pcm: Buffer) {
    if (this.closed) return;
    this.flux?.send(pcm);
    if (this.listening) this.meter?.audio(pcm);
  }

  said(id: string) {
    if (this.playing?.id === id) this.playing.done();
  }

  /** The candidate says they've finished answering. */
  done() {
    if (this.listening && this.replyText()) void this.decide(true);
  }

  async repeat() {
    if (!this.listening || this.phase !== 'interview' || !this.lastQuestion) return;
    this.resetReply();
    await this.say(`Sure. ${this.lastQuestion}`);
    this.listen();
  }

  /** A typed reply (no microphone). */
  text(text: string) {
    const t = text.trim().slice(0, PRACTICE_LIMITS.maxAnswerChars);
    if (!this.listening || !t) return;
    this.typed = true;
    this.parts.push(t);
    this.lines.push({ role: 'candidate', text: t });
    void this.decide(true);
  }

  /** Plays a sample question, so the candidate can check the desktop app hears this tab. */
  async test() {
    if (this.phase !== 'lobby' || this.interviewer === 'speaking') return;
    await this.say(TEST_LINE, { test: true });
    if (this.phase === 'lobby') this.state('idle');
  }

  /** The candidate ended the interview early. */
  async endEarly() {
    if (this.finishing || this.phase === 'closing' || this.phase === 'ended') return;
    if (this.phase === 'interview') {
      this.recordReply();
      return this.end();
    }
    this.close();
    this.deps.close();
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.thinking?.abort();
    this.dropSpec();
    this.clearTimers();
    if (this.warmer) clearInterval(this.warmer);
    if (this.tick) clearInterval(this.tick);
    if (this.endTimer) clearTimeout(this.endTimer);
    this.playing?.done();
    this.flux?.close();
    this.unsubscribe();
    // Record the time on the clock since the last tick (the interview can be resumed later).
    if (this.since && !this.finishing) void this.recordTime();
  }

  // ---- speaking ----------------------------------------------------------------------------------

  /** Says a line and resolves once the browser has played it. */
  private async say(text: string, opts: { test?: boolean } = {}) {
    if (this.closed) return;
    this.listening = false;
    this.clearTimers();
    this.playing?.done();
    this.state('speaking');
    const id = randomUUID();
    if (!opts.test) this.lines.push({ role: 'interviewer', text });
    const played = new Promise<void>((resolve) => {
      // If the browser never reports back, carry on after a generous estimate of the line's length.
      const fallback = setTimeout(() => this.playing?.id === id && this.playing.done(), 8_000 + wordCount(text) * 600);
      this.playing = {
        id,
        done: () => {
          clearTimeout(fallback);
          if (this.playing?.id === id) this.playing = null;
          resolve();
        },
      };
    });
    const say = (audio: boolean) => this.deps.send({ type: 'say', id, text, audio, ...(opts.test ? { test: true } : {}) });
    const streamed = await streamSpeech(text, { start: () => say(true), chunk: (pcm) => !this.closed && this.deps.sendAudio(pcm) }, this.deps.log);
    if (this.closed) return;
    // Without the server's voice, the browser reads the line itself.
    if (streamed) this.deps.send({ type: 'audio_end', id });
    else say(false);
    await played;
    this.lineEndedAt = Date.now();
  }

  // ---- listening ---------------------------------------------------------------------------------

  private openFlux() {
    if (!sttConfigured() || this.flux) return;
    this.flux = new FluxStream({
      keyterms: this.deps.keyterms,
      log: this.deps.log,
      onTurn: (turn) => this.onTurn(turn),
      onState: (state, error) => {
        if (state === 'down' && error) this.deps.send({ type: 'error', code: 'stt', message: error });
      },
    }).start();
  }

  /** Starts listening for the candidate's reply to what was just said. */
  private listen() {
    if (this.closed || this.phase === 'ended' || this.phase === 'closing') return;
    this.resetReply();
    this.listening = true;
    this.state('listening');
    if (this.phase === 'interview' && !this.nudged) {
      this.nudgeTimer = setTimeout(() => void this.nudge(), NUDGE_MS);
    }
  }

  private resetReply() {
    this.parts = [];
    this.partial = '';
    this.typed = false;
    this.meter = new AnswerMeter();
    this.clearTimers();
  }

  private replyText() {
    return [...this.parts, this.partial].filter(Boolean).join(' ').trim();
  }

  private onTurn(turn: TurnInfo) {
    if (!this.listening) return;
    const text = turn.transcript.trim();
    const grew = turn.event === 'Update' && text && wordCount(text) > wordCount(this.partial);
    if (turn.event === 'StartOfTurn' || turn.event === 'TurnResumed' || grew) {
      // They're (still) talking: whatever was being decided is out of date.
      this.saidMore();
    }
    if (turn.event === 'EagerEndOfTurn' && text) {
      this.partial = text;
      this.speculate();
    }
    if (turn.event === 'EndOfTurn') {
      this.partial = '';
      if (text) {
        this.parts.push(text);
        this.lines.push({ role: 'candidate', text });
        this.meter?.wordConfidence(turn.words?.map((w) => w.confidence) ?? []);
      }
      const reply = this.replyText();
      this.deps.send({ type: 'transcript', text: reply, final: true });
      this.meter?.words(wordCount(reply));
      const spec = this.spec;
      this.spec = null;
      if (spec && normalize(spec.reply) === normalize(reply)) void this.decide(false, undefined, spec);
      else {
        spec?.ctrl.abort();
        if (reply) this.settleTimer = setTimeout(() => void this.decide(false), SETTLE_MS);
      }
      return;
    }
    if (text) {
      this.partial = text;
      this.meter?.words(wordCount(this.replyText()));
      this.deps.send({ type: 'transcript', text: this.replyText(), final: false });
    }
  }

  /** Starts deciding on the reply as it stands, in case this is where the sentence ends. */
  private speculate() {
    if (this.closed || this.finishing || !['greeting', 'confirm', 'interview'].includes(this.phase)) return;
    if (this.phase === 'interview' && (this.timeUp || this.endsAt - Date.now() < WRAP_AT_MS)) return;
    this.dropSpec();
    const reply = this.replyText();
    const ctrl = new AbortController();
    const turn = this.ask(this.prompt(false, false, this.partial), ctrl.signal).catch(() => null);
    this.spec = { reply, turn, ctrl };
  }

  private dropSpec() {
    this.spec?.ctrl.abort();
    this.spec = null;
  }

  private saidMore() {
    this.generation++;
    this.thinking?.abort();
    this.thinking = null;
    this.dropSpec();
    this.clearTimers();
    if (this.replyText()) this.patienceTimer = setTimeout(() => void this.decide(true), STUCK_MS);
    if (this.interviewer !== 'listening') this.state('listening');
  }

  private clearTimers() {
    for (const t of [this.settleTimer, this.patienceTimer, this.nudgeTimer]) if (t) clearTimeout(t);
    this.settleTimer = this.patienceTimer = this.nudgeTimer = null;
  }

  private async nudge() {
    if (!this.listening || this.replyText() || this.meter?.heardVoice || this.nudged) return;
    this.nudged = true;
    this.listening = false;
    await this.say('Take your time. Would you like me to repeat the question?');
    // The answer's clock keeps running from the question, not from the nudge.
    const meter = this.meter;
    this.listen();
    this.meter = meter;
  }

  // ---- deciding ----------------------------------------------------------------------------------

  /**
   * Asks the interviewer model what happens next. `force` treats the reply as finished (the candidate
   * said so, or went quiet after an unfinished-sounding answer). `next` asks for a question with no
   * reply to judge (after a reconnect).
   */
  private async decide(force: boolean, next?: 'next', spec?: { turn: Promise<Turn | null>; ctrl: AbortController }) {
    if (this.closed || this.finishing || !['greeting', 'confirm', 'interview'].includes(this.phase)) return;
    const reply = this.replyText();
    if (!next && !reply) return;
    this.clearTimers();
    const generation = ++this.generation;
    this.thinking?.abort();
    const ctrl = spec?.ctrl ?? new AbortController();
    this.thinking = ctrl;
    this.state('thinking');

    if (this.phase === 'interview' && !next && (this.timeUp || this.endsAt - Date.now() < WRAP_AT_MS)) {
      this.recordReply();
      return this.wrapUp();
    }

    let turn: Turn;
    try {
      turn = (spec && (await spec.turn)) || (await this.ask(this.prompt(force, Boolean(next)), ctrl.signal));
    } catch (err) {
      if (ctrl.signal.aborted || this.closed) return;
      this.deps.log.warn({ err: (err as Error).message }, 'interviewer turn failed');
      try {
        // One more try before giving up on the interview.
        turn = await this.ask(this.prompt(force, Boolean(next)), ctrl.signal);
      } catch (err2) {
        if (ctrl.signal.aborted || this.closed) return;
        this.deps.log.error({ err: (err2 as Error).message }, 'interviewer unavailable');
        if (this.phase !== 'interview') return this.act(FALLBACK[this.phase as 'greeting' | 'confirm']);
        this.deps.send({ type: 'error', code: 'interviewer', message: 'The interviewer is unavailable right now, so the interview is ending.' });
        this.recordReply();
        return this.end();
      }
    }
    if (generation !== this.generation || this.closed) return;
    this.thinking = null;

    if (!turn.answer_complete && !force && !next) {
      this.state('listening');
      this.patienceTimer = setTimeout(() => void this.decide(true), PATIENCE_MS);
      return;
    }
    await this.act(turn);
  }

  private async ask(prompt: string, signal: AbortSignal) {
    return interviewerTurn({ model: this.deps.model, context: this.deps.context, prompt, signal });
  }

  private async act(turn: Turn) {
    const say = turn.say.trim();
    switch (this.phase) {
      case 'greeting':
        this.setPhase('confirm');
        await this.say(say || `Glad to hear it. This will be a ${this.session.durationMinutes}-minute round about your resume. Shall we start?`);
        return this.listen();
      case 'confirm':
        if (turn.action === 'start' || turn.action === 'ask') {
          if (!say) return this.listen();
          this.setPhase('interview');
          await this.deps.store.start();
          this.session.startedAt = new Date().toISOString();
          this.startClock((this.session.durationMinutes ?? 10) * 60_000);
          await this.addQuestion(say, turn);
          await this.say(say);
          return this.listen();
        }
        await this.say(say || 'No problem. Just tell me when you are ready to begin.');
        return this.listen();
      case 'interview':
        if (turn.action === 'wrap_up') {
          this.recordReply();
          return this.wrapUp(say);
        }
        if (turn.action === 'reply') {
          // A repeat or a clarification: the same question stays open.
          await this.say(say || `Sure. ${this.lastQuestion ?? ''}`);
          return this.listen();
        }
        this.recordReply();
        if (this.timeUp) return this.wrapUp();
        await this.addQuestion(say, turn);
        await this.say(say);
        return this.listen();
    }
  }

  /** `pending` is what the candidate is saying now, before the recogniser has settled it. */
  private prompt(force: boolean, next: boolean, pending?: string) {
    const round = ROUND_TYPES.find((r) => r.id === this.session.roundType);
    const difficulty = PRACTICE_DIFFICULTIES.find((d) => d.id === this.session.difficulty);
    const name = firstName(this.deps.candidateName);
    const minutesLeft = this.phase === 'interview' ? Math.max(0, Math.round((this.endsAt - Date.now()) / 6_000) / 10) : null;
    const setup = [
      '<interview_setup>',
      `Round: ${round?.label ?? this.session.roundType}${round ? ` (${round.hint})` : ''}`,
      `Difficulty: ${difficulty?.label ?? this.session.difficulty}${difficulty ? ` (${difficulty.hint})` : ''}`,
      `Length: ${this.session.durationMinutes} minutes`,
      name && `Candidate's first name: ${name}`,
      minutesLeft !== null && `Minutes left: ${minutesLeft}`,
      this.phase === 'interview' && `Questions asked so far: ${this.session.questions.length}`,
      '</interview_setup>',
    ].filter(Boolean);
    const convo = [...this.lines.slice(-40), ...(pending ? [{ role: 'candidate' as const, text: pending }] : [])]
      .map((l) => `${l.role === 'interviewer' ? 'Interviewer' : 'Candidate'}: ${l.text}`)
      .join('\n');

    let task: string;
    if (this.phase === 'greeting') {
      task = `The candidate just replied to your greeting. Respond naturally in a few words (if they asked how you are, answer briefly), say in one sentence that this is a ${this.session.durationMinutes}-minute ${round?.label.toLowerCase() ?? ''} round with questions about their resume, then ask if they're ready to start. Use action "reply" and answer_complete true.`;
    } else if (this.phase === 'confirm') {
      task = `You asked whether they're ready to start. If they agreed in any words (yes, sure, ready, let's go, okay, haan, chalo…), use action "start": say a short transition ("Great, let's begin.") followed by your first question, an opener suited to the round and anchored in their resume. If they want a moment or asked something, use action "reply": answer briefly and ask them to tell you when they're ready.`;
    } else if (next) {
      task = 'The candidate has just rejoined after a break. Use action "ask" with your next question (no acknowledgement of a previous answer).';
    } else {
      const last = minutesLeft !== null && minutesLeft < 2.5 ? ' Time is nearly up: make this the last question, and keep it short.' : '';
      task = `The candidate is answering your last question. ${force ? 'Treat their answer as finished: answer_complete true.' : 'First decide whether they have finished.'} If they have, use action "ask" with a brief neutral acknowledgement and your next question or a follow-up, or action "reply" if they asked you to repeat or clarify.${last}`;
    }
    return `${setup.join('\n')}\n\n<conversation>\n${convo}\n</conversation>\n\n<task>\n${task}\n</task>`;
  }

  private rebuildLines() {
    this.lines = [];
    this.session.questions.forEach((q, n) => {
      this.lines.push({ role: 'interviewer', text: q.question });
      const a = this.session.answers[n];
      if (a && !a.skipped) this.lines.push({ role: 'candidate', text: a.text });
    });
  }

  private openQuestionIndex() {
    const n = this.session.questions.length - 1;
    return n >= 0 && !this.session.answers[n] ? n : null;
  }

  private async addQuestion(text: string, turn: Turn) {
    const kind: PracticeQuestionKind = this.session.questions.length === 0 ? 'opener' : turn.question_kind;
    const q: PracticeQuestion = { question: text, kind, lookingFor: turn.looking_for.trim() };
    this.session.questions.push(q);
    this.session.answers.push(null);
    this.session.questionCount = this.session.questions.length;
    this.lastQuestion = text;
    this.nudged = false;
    await this.deps.store.addQuestion(q).catch((err) => this.deps.log.error({ err }, 'could not save practice question'));
  }

  /** Saves the reply as the answer to the open question, with how it was delivered. */
  private recordReply() {
    const index = this.openQuestionIndex();
    const text = this.replyText();
    this.listening = false;
    if (index === null || !text) return;
    const copilot = this.copilotAnswer && this.copilotAnswer.at >= this.lineEndedAt - HEARD_EARLY_MS ? this.copilotAnswer.text : null;
    const answer: PracticeAnswer = this.typed
      ? { text, mode: 'text', durationMs: this.meter?.elapsedMs ?? 0, skipped: false, ...speechStats(text, 0, 'text') }
      : this.meter!.finish(text, copilot);
    this.session.answers[index] = answer;
    this.session.answered = this.session.answers.filter((a) => a && !a.skipped).length;
    this.parts = [];
    this.partial = '';
    void this.deps.store.setAnswer(index, answer).catch((err) => this.deps.log.error({ err }, 'could not save practice answer'));
  }

  // ---- the clock and the end ---------------------------------------------------------------------

  private startClock(leftMs: number) {
    this.since = Date.now();
    this.endsAt = Date.now() + leftMs;
    this.deps.send({ type: 'clock', endsAt: this.endsAt, serverTime: Date.now() });
    this.tick = setInterval(() => void this.recordTime(), TICK_MS);
    this.endTimer = setTimeout(() => this.onTimeUp(), leftMs);
  }

  /** Records interview time since the last tick, and spends it from the user's minutes. */
  private async recordTime() {
    if (!this.since) return;
    const seconds = Math.floor((Date.now() - this.since) / 1000);
    if (seconds <= 0) return;
    this.since += seconds * 1000;
    this.session.seconds += seconds;
    try {
      await this.deps.store.addSeconds(seconds);
      // With the desktop app connected, its own session is already spending minutes: don't charge twice.
      if (onlineUserIds().has(this.deps.userId)) return;
      const trial = await chargeMinutes(this.deps.userId, seconds);
      if (this.closed) return;
      this.deps.send({ type: 'minutes', secondsLeft: trial ? minutesLeft(trial) : null });
      if (trial && minutesLeft(trial) <= 0 && !this.timeUp) {
        this.deps.send({ type: 'error', code: 'no_minutes', message: 'You are out of session minutes, so the interview is ending.' });
        this.onTimeUp();
      }
    } catch (err) {
      this.deps.log.warn({ err }, 'could not record practice time');
    }
  }

  /** Time's up: let a candidate who is mid-answer finish (briefly), otherwise close now. */
  private onTimeUp() {
    if (this.timeUp || this.closed) return;
    this.timeUp = true;
    if (this.listening && !this.replyText() && !this.meter?.heardVoice) {
      void this.wrapUp();
      return;
    }
    // Mid-answer, or the interviewer is thinking or speaking: the next decision wraps up. Cap the wait.
    this.endTimer = setTimeout(() => {
      if (this.finishing || this.closed || this.phase !== 'interview') return;
      this.recordReply();
      void this.wrapUp();
    }, PRACTICE_LIMITS.overtimeMs);
  }

  private async wrapUp(say?: string) {
    if (this.phase === 'closing' || this.phase === 'ended' || this.closed) return;
    this.setPhase('closing');
    this.listening = false;
    this.clearTimers();
    this.thinking?.abort();
    const name = firstName(this.deps.candidateName);
    await this.say(
      say ||
        `That's all the time we have${name ? `, ${name}` : ''}. Thank you, I enjoyed talking with you. Your feedback report is being prepared right now.`,
    );
    await this.end();
  }

  private async end() {
    if (this.finishing) return;
    this.finishing = true;
    this.listening = false;
    this.clearTimers();
    if (this.tick) clearInterval(this.tick);
    if (this.endTimer) clearTimeout(this.endTimer);
    await this.recordTime();
    this.since = 0;
    this.state('idle');
    this.setPhase('ended');
    try {
      if (this.openQuestionIndex() !== null) {
        this.session.questions.pop();
        this.session.answers.pop();
        await this.deps.store.dropLastQuestion();
      }
      const session = await this.deps.store.finish(this.session.seconds);
      this.deps.send({ type: 'session', session });
    } catch (err) {
      this.deps.log.error({ err }, 'could not finish practice session');
      this.deps.send({ type: 'error', code: 'finish', message: 'Your answers are saved, but the review could not start. Try again from Practice.' });
    }
    this.close();
    this.deps.close();
  }

  // ---- status ------------------------------------------------------------------------------------

  private setPhase(phase: PracticePhase) {
    this.phase = phase;
    this.deps.send({ type: 'state', phase, interviewer: this.interviewer });
  }

  private state(s: InterviewerState) {
    if (this.interviewer === s) return;
    this.interviewer = s;
    this.deps.send({ type: 'state', phase: this.phase, interviewer: s });
  }

  // ---- the desktop app ---------------------------------------------------------------------------

  private onDesktop(e: LiveEvent) {
    if (this.closed) return;
    const before = JSON.stringify(this.desktop);
    if (e.kind === 'open' || e.kind === 'close') {
      this.desktop.connected = onlineUserIds().has(this.deps.userId);
      if (!this.desktop.connected) this.desktop.hearing = false;
    } else {
      const m = e.message;
      const since = () => (this.lineEndedAt ? Math.max(0, Date.now() - this.lineEndedAt) : null);
      if (m.type === 'listening') this.desktop.hearing = m.sources.interviewer === 'up';
      else if (m.type === 'transcript' && m.source === 'interviewer' && m.final) {
        this.desktop.heard = { text: m.text, afterMs: since() };
        this.desktop.answerAfterMs = null;
      } else if (m.type === 'question') this.desktopTurns.set(m.turnId, { text: m.text, answer: '', firstAt: null });
      else if (m.type === 'token') {
        const t = this.desktopTurns.get(m.turnId);
        if (t) {
          if (t.firstAt === null) {
            t.firstAt = Date.now();
            this.desktop.answerAfterMs = since();
          }
          t.answer += m.delta;
          this.copilotAnswer = { text: t.answer, at: t.firstAt };
        }
      } else if ((m.type === 'done' || m.type === 'error') && m.turnId) {
        this.desktopTurns.delete(m.turnId);
      }
    }
    if (JSON.stringify(this.desktop) !== before) this.deps.send({ type: 'desktop', desktop: { ...this.desktop } });
  }

  /** The current state, for a newly connected room. */
  hello() {
    this.deps.send({ type: 'desktop', desktop: { ...this.desktop } });
  }
}

/** Seconds of minutes left for the user, or null when their plan isn't metered. */
export async function secondsLeft(userId: string) {
  const t = await trialBalance(userId);
  return t ? minutesLeft(t) : null;
}
