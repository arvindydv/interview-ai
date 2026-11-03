import { randomUUID } from 'node:crypto';
import {
  PRACTICE_DIFFICULTIES, PRACTICE_LIMITS, ROUND_TYPES, speechStats,
  type DesktopStatus, type InterviewerState, type PracticeAnswer, type PracticePhase, type PracticeQuestion,
  type PracticeQuestionKind, type PracticeServerMessage, type PracticeSession, type RoundType,
} from '@parakeet/shared';
import { AnswerMeter } from './delivery.js';
import { ACKNOWLEDGEMENTS, interviewerTurn, type Turn } from './interviewer.js';
import { subscribeLive, type LiveEvent } from './liveEvents.js';
import { onlineUserIds } from './liveRegistry.js';
import { warmConnections } from './warm.js';
import { FluxStream, sttConfigured, type TurnInfo } from './stt.js';
import { chargeMinutes, minutesLeft, trialBalance } from './trial.js';
import { Speech, Voice, ttsConfigured } from './tts.js';

// One live practice interview (spec F1), driven from the server: the interviewer greets the
// candidate by name, checks they're ready, starts the clock, then asks questions from their resume
// one at a time, listening to each answer until the candidate has finished, until the time is up.
//
// The candidate's microphone streams here and goes through Deepgram Flux (turn detection), so the
// interviewer knows when a sentence ends; whether the *answer* has ended is the interviewer model's
// call, with a patience timer for long silences. Each spoken answer is also measured for delivery
// (lib/delivery.ts) for the confidence debrief.
//
// Response time: a model turn takes 0.6–1.5 s and the voice's first audio another 0.4 s, so anything
// that can be said before it's needed is prepared while the interviewer is still talking. The reply to
// the greeting and the first question (with their audio) are ready before the candidate says yes; an
// answer's turn, and its audio, start when the recogniser thinks the sentence has *probably* ended;
// and the acknowledgement that opens a turn is recorded in advance, so it plays at once while the
// question after it is synthesised.

/** After a sentence ends, wait this long for more before deciding the answer might be done. */
const SETTLE_MS = 150;
/**
 * The longest the recogniser waits in silence before ending the candidate's turn (its default here is
 * 2 s, which the candidate hears as lag). A pause mid-thought is still safe: the model judges whether
 * the answer is finished before the interviewer says anything.
 */
const EOT_TIMEOUT_MS = 800;
/** Quiet this long after speaking, the reply to what they've said so far starts being prepared. */
const PREPARE_AFTER_SILENCE_MS = 400;
/**
 * Quiet this long, the interviewer replies if the model judges the answer finished, without waiting
 * for the recogniser to confirm the end of the sentence (that confirmation reaches us 1.3–2.3 s after
 * the candidate stops: its own wait, plus the round trip to Deepgram). Measured on our side from the
 * microphone audio, so it has no network delay.
 */
const ACT_AFTER_SILENCE_MS = 800;
/**
 * In the interview, an answer is never taken as finished before the candidate has been quiet this
 * long: people pause to think mid-answer, and replying sooner cuts them off. However the end of the
 * answer was detected (our silence, the recogniser, the model), the interviewer waits for it. The reply
 * is prepared during the pause, so it can start as soon as the wait is over.
 */
const ANSWER_SILENCE_MS = 2_000;
/** If the microphone never sounds quiet (a noisy room), the interviewer stops waiting after this long. */
const QUIET_CAP_MS = 8_000;
/** A model turn that hasn't come back in this long is asked for again in parallel; the first answer wins. */
const HEDGE_MS = 1_000;
/** A question this soon after a quick acknowledgement drops its own. */
const ACKED_RECENTLY_MS = 8_000;
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
const NUDGE_LINE = 'Take your time. Would you like me to repeat the question?';

/** The candidate agreed to start, in any words, and asked nothing. */
const AGREED = /\b(yes|yeah|yep|yup|sure|ready|ok|okay|alright|all right|let'?s|go ahead|start|begin|absolutely|definitely|of course|haan|han|ji|chalo)\b/i;
const NOT_YET = /\b(no|not|wait|minute|moment|second|hold on|before|question|but|actually)\b|\?/i;
const agreed = (reply: string) => AGREED.test(reply) && !NOT_YET.test(reply);

/** Replies to "how are you", by what the candidate said. */
const ASKED_BACK = /\b(and you|about you|how are you|how're you|how you doing|yourself)\b/i;
const LOW = /\b(nervous|anxious|stressed|scared|tired|sick|not (so |too |very |that )?(good|great|well|fine))\b/i;
/** Acknowledgements the interviewer says the moment an answer ends, before the next question is ready. */
const QUICK_ACKS = ['Okay.', 'Got it.', 'Right.', 'Okay, thanks.', 'Got it, thanks.', 'Right, thanks.'];
/** An answer ending on one of these is mid-thought. */
const TRAILING = new Set(['and', 'so', 'because', 'but', 'or', 'like', 'um', 'uh', 'umm', 'the', 'a', 'an', 'to', 'of', 'with', 'that', 'which', 'then', 'also', 'if', 'when', 'for', 'in', 'on', 'is', 'was', 'we', 'i']);
/** The acknowledgement a line opens with, if any (longest first, so "Okay, thanks." beats "Okay."). */
const leadingAck = (text: string) =>
  [...ACKNOWLEDGEMENTS].sort((a, b) => b.length - a.length).find((a) => text === a || text.startsWith(`${a} `)) ?? null;

const GREETING_REPLIES = { askedBack: "I'm doing well, thanks for asking.", low: "That's completely normal. We'll keep it relaxed.", fine: 'Glad to hear it.' };

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

/** How the interviewer names each round out loud ("your technical interview"). */
const SPOKEN_ROUND: Record<RoundType, string> = {
  general: 'general', technical: 'technical', behavioral: 'behavioural', case_study: 'case study',
  presentation: 'presentation', coding: 'coding', system_design: 'system design',
};

const greetingTime = (hour: number) => (hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening');
const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? '';
const normalize = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/**
 * Whether two transcripts of the same reply say the same thing: the recogniser's final words often
 * differ from its early guess by a word or two ("design" / "designed"), which doesn't change what the
 * interviewer should say next. At most one word in ten may differ.
 */
export function sameReply(a: string, b: string) {
  const x = normalize(a).split(' ').filter(Boolean);
  const y = normalize(b).split(' ').filter(Boolean);
  if (!x.length || !y.length) return x.length === y.length;
  const allowed = Math.floor(Math.max(x.length, y.length) / 10);
  if (Math.abs(x.length - y.length) > allowed) return false;
  // Word-level edit distance.
  let prev = Array.from({ length: y.length + 1 }, (_, j) => j);
  for (let i = 1; i <= x.length; i++) {
    const row = [i];
    for (let j = 1; j <= y.length; j++) row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
    prev = row;
  }
  return prev[y.length] <= allowed;
}
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
  /** When the reply's sentence probably ended, and when that was confirmed; logged with the response time. */
  private timing = { eagerAt: 0, endAt: 0, predicted: false, early: false, acked: false };
  private lastAck: string | null = null;
  /** When the last quick acknowledgement was said: a question soon after it doesn't open with another. */
  private ackedAt = 0;
  /**
   * The turn (`epoch:index`) the recogniser is hearing speech in, with its words so far. Flux reports
   * the current turn index during silence too, so a turn only counts as under way once there are words.
   */
  private openTurn: string | null = null;
  private openText = '';
  /**
   * A turn already under way when the current listen began: its first `skip` words belong to the last
   * reply. Until the candidate's voice is heard again, all of its words do (the recogniser runs behind).
   */
  private stale: { key: string; skip: number } | null = null;
  /** A reply the model judged unfinished: not asked about again until the candidate says more. */
  private unfinished: string | null = null;
  /** The latest turn the recogniser has heard words in. */
  private turnKey: string | null = null;
  /**
   * Words taken as the end of the reply on our own silence, before the recogniser confirmed them, and
   * where they went: the reply (`part`, -1 once the reply was handed over), the conversation (`line`)
   * and the saved answer. The recogniser's final words replace them when they arrive.
   */
  private early: {
    key: string; text: string; part: number; line: number; answer: { index: number; parts: string[]; part: number } | null;
  } | null = null;
  /** Bumped whenever the candidate says more, so a decision made on an older transcript is dropped. */
  private generation = 0;
  private thinking: AbortController | null = null;
  /**
   * A decision started speculatively when the recogniser thought the candidate had *probably*
   * finished (EagerEndOfTurn). If the sentence ends as predicted, it's used at once instead of
   * waiting for the confirmed end and asking the model then.
   */
  private spec: { reply: string; turn: Promise<Turn | null>; parts: Promise<Speech[] | null>; ctrl: AbortController } | null = null;
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
  /** A decision waiting for the candidate to be quiet for ANSWER_SILENCE_MS (see quiet()). */
  private quietWait: { done: (ok: boolean) => void; fallback: NodeJS.Timeout } | null = null;

  // Lines prepared before they're needed (see the top of the file), each voice over its own socket so
  // recording ahead never holds up a line that's needed now.
  private voice: Voice | null = null;
  private recorder: Voice | null = null;
  private acks = new Map<string, Speech>();
  private prepared = new Map<string, Speech>();
  private opener: Promise<{ turn: Turn; parts: Speech[] | null } | null> | null = null;
  private openerCtrl: AbortController | null = null;
  /** Saves run one after another, so an answer is never written before its question; speech doesn't wait for them. */
  private saving: Promise<void> = Promise.resolve();

  constructor(private readonly deps: RoomDeps) {
    this.session = deps.session;
    this.desktop.connected = onlineUserIds().has(deps.userId);
    // Opened in the lobby, so they're connected by the time the candidate joins.
    if (ttsConfigured()) {
      this.voice = new Voice(deps.log);
      this.recorder = new Voice(deps.log);
    }
    this.unsubscribe = subscribeLive(deps.userId, (e) => this.onDesktop(e));
  }

  // ---- connection --------------------------------------------------------------------------------

  /** The candidate pressed Join: open the microphone stream and greet them (or welcome them back). */
  async join() {
    if (this.phase !== 'lobby' || this.closed) return;
    this.openFlux();
    warmConnections();
    this.warmer = setInterval(warmConnections, WARM_MS);
    if (this.session.startedAt) {
      this.prepareCommon();
      return this.resume();
    }
    this.setPhase('greeting');
    const name = firstName(this.deps.candidateName);
    const round = SPOKEN_ROUND[this.session.roundType] ?? 'practice';
    const target = this.session.title && this.session.title !== 'General practice' ? ` for ${this.session.title.replace(' · ', ' at ')}` : '';
    const greeting = `Hi${name ? ` ${name}` : ''}, good ${greetingTime(this.deps.hour)}! I'm Friday, and I'll be taking your ${round} interview today${target}. How are you doing?`;
    const parts = this.prepare(greeting);
    // The greeting goes first; the rest is prepared while it plays.
    void (parts?.[0].ready ?? Promise.resolve()).then(() => {
      if (this.closed) return;
      // What's needed first goes first: the recorder synthesises one line at a time.
      for (const lead of Object.values(GREETING_REPLIES)) this.keep(lead);
      this.keep(this.readyQuestion());
      this.prepareCommon();
    });
    await this.say(greeting, { parts });
    this.listen();
  }

  /** The acknowledgements and the nudge, recorded for the whole interview. */
  private prepareCommon() {
    if (!ttsConfigured()) return;
    for (const a of ACKNOWLEDGEMENTS) if (!this.acks.has(a)) this.acks.set(a, new Speech(a, this.deps.log, this.recorder));
    this.keep(NUDGE_LINE);
  }

  /** Records a fixed line now, to be said later (possibly more than once). */
  private keep(text: string) {
    if (ttsConfigured() && !this.prepared.has(text)) this.prepared.set(text, new Speech(text, this.deps.log, this.recorder));
  }

  private readyQuestion() {
    return `This is a ${this.session.durationMinutes}-minute ${SPOKEN_ROUND[this.session.roundType] ?? ''} round, with questions from your resume. Shall we begin?`;
  }

  /**
   * Starts synthesising `text`, as parts played back to back: a recorded acknowledgement at the start
   * (or a whole line recorded earlier) plays at once, while the rest is synthesised. Null without a voice.
   */
  private prepare(text: string): Speech[] | null {
    if (!ttsConfigured() || !text) return null;
    const kept = this.prepared.get(text);
    if (kept) return [kept];
    const ack = leadingAck(text);
    const recorded = ack && this.acks.get(ack);
    if (!recorded) return [new Speech(text, this.deps.log, this.voice)];
    const rest = text.slice(ack.length).trim();
    return rest ? [recorded, this.prepared.get(rest) ?? new Speech(rest, this.deps.log, this.voice)] : [recorded];
  }

  /** How long the candidate waited for the interviewer's voice after their sentence was confirmed finished. */
  private logResponseTime() {
    const { eagerAt, endAt, predicted, early, acked } = this.timing;
    if (!endAt) return;
    this.timing.endAt = 0;
    // With `early`, the end is our own silence threshold, not the recogniser's confirmation.
    this.deps.log.info(
      { phase: this.phase, afterEndMs: Date.now() - endAt, eagerToEndMs: eagerAt ? endAt - eagerAt : null, predicted, early, acked },
      'practice response time',
    );
  }

  /** Stops synthesising prepared parts that won't be said (recorded lines are kept). */
  private release(parts: Speech[] | null | undefined) {
    const kept = new Set([...this.acks.values(), ...this.prepared.values()]);
    for (const p of parts ?? []) if (!kept.has(p)) p.cancel();
  }

  /** Saves in order, without holding up the interview. */
  private persist(what: string, save: () => Promise<void>) {
    this.saving = this.saving.then(save).catch((err) => this.deps.log.error({ err }, `could not save practice ${what}`));
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
    if (!this.listening || !this.meter) return;
    this.meter.audio(pcm);
    const silent = this.meter.silentMs;
    if (this.quietWait) {
      if (silent >= ANSWER_SILENCE_MS) this.quietWait.done(true);
      // Still talking: the wait starts again from their next silence.
      else if (this.meter.heardVoice && silent === 0) this.quietWait.fallback.refresh();
    }
    // Quiet after speaking: they may have finished, so start on the reply now rather than when the
    // recogniser confirms it.
    if (silent < PREPARE_AFTER_SILENCE_MS || this.typed || this.thinking) return;
    const reply = this.replyText();
    if (!reply || (this.unfinished !== null && sameReply(this.unfinished, reply))) return;
    const predicted = this.spec && sameReply(this.spec.reply, reply);
    if (!predicted) this.speculate();
    const actAfter = this.phase === 'interview' ? ANSWER_SILENCE_MS : ACT_AFTER_SILENCE_MS;
    if (silent >= actAfter && (predicted || this.readyWithout(reply))) this.decideEarly();
  }

  /**
   * Resolves true once the candidate has been quiet for ANSWER_SILENCE_MS (at once if they already
   * have, or haven't been heard on the microphone at all), false if they carry on talking first.
   */
  private quiet(): Promise<boolean> {
    const meter = this.meter;
    if (this.typed || !meter?.heardVoice || meter.silentMs >= ANSWER_SILENCE_MS) return Promise.resolve(true);
    this.quietWait?.done(false);
    return new Promise((resolve) => {
      // Audio stops arriving (the tab is muted or gone): don't wait for frames that won't come.
      const fallback = setTimeout(() => wait.done(true), ANSWER_SILENCE_MS);
      const cap = setTimeout(() => wait.done(true), QUIET_CAP_MS);
      const wait = {
        fallback,
        done: (ok: boolean) => {
          if (this.quietWait !== wait) return;
          this.quietWait = null;
          clearTimeout(fallback);
          clearTimeout(cap);
          resolve(ok);
        },
      };
      this.quietWait = wait;
    });
  }

  /** Whether the reply to `reply` needs no model turn (the replies before the interview are prepared). */
  private readyWithout(reply: string) {
    return (this.phase === 'greeting' && this.greetingReply(reply) !== null) || (this.phase === 'confirm' && Boolean(this.opener) && agreed(reply));
  }

  /** Takes the reply as finished on our own silence (see ACT_AFTER_SILENCE_MS). */
  private decideEarly() {
    if (this.partial && this.turnKey) {
      this.parts.push(this.partial);
      this.lines.push({ role: 'candidate', text: this.partial });
      this.early = { key: this.turnKey, text: this.partial, part: this.parts.length - 1, line: this.lines.length - 1, answer: null };
      this.partial = '';
    }
    this.timing.endAt = Date.now();
    this.timing.early = true;
    const spec = this.spec;
    this.spec = null;
    const reply = this.replyText();
    // Sounds finished: acknowledge it at once, and ask the next question when it's ready.
    const words = normalize(reply).split(' ');
    const ack =
      this.phase === 'interview' && words.length >= 3 && !TRAILING.has(words[words.length - 1]) && !this.timeUp
        ? this.quickAck()
        : null;
    void this.decide(false, undefined, spec && sameReply(spec.reply, reply) ? spec : undefined, ack);
  }

  /** Says a recorded acknowledgement (not the last one used); resolves when it has played. Null without a voice. */
  private quickAck(): Promise<void> | null {
    const choices = QUICK_ACKS.filter((a) => this.acks.has(a) && a !== this.lastAck);
    const ack = choices[Math.floor(Math.random() * choices.length)];
    if (!ack) return null;
    this.lastAck = ack;
    this.ackedAt = Date.now();
    const speech = this.acks.get(ack)!;
    this.timing.acked = true;
    return this.say(ack, { parts: [speech] });
  }

  /** The recogniser's final words for a turn taken early replace the early words, in the reply, the conversation and the saved answer. */
  private settleEarly(final: string) {
    const e = this.early!;
    this.early = null;
    if (!final || normalize(final) === normalize(e.text)) return;
    if (this.lines[e.line]?.role === 'candidate') this.lines[e.line].text = final;
    if (e.part >= 0) this.parts[e.part] = final;
    const a = e.answer && this.session.answers[e.answer.index];
    if (!e.answer || !a) return;
    const parts = [...e.answer.parts];
    parts[e.answer.part] = final;
    const text = parts.join(' ').trim();
    const { words, fillers } = speechStats(text, a.durationMs, a.mode);
    const updated: PracticeAnswer = { ...a, text, words, fillers };
    const index = e.answer.index;
    this.session.answers[index] = updated;
    this.persist('answer', () => this.deps.store.setAnswer(index, updated));
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
    this.quietWait?.done(false);
    this.dropSpec();
    this.dropOpener();
    this.clearTimers();
    this.voice?.close();
    this.recorder?.close();
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

  /** Says a line and resolves once the browser has played it. `parts`: its audio, if already prepared. */
  private async say(text: string, opts: { test?: boolean; parts?: Speech[] | null } = {}) {
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
    const parts = opts.parts !== undefined ? opts.parts : this.prepare(text);
    const voiced = Boolean(parts && (await parts[0].ready));
    if (this.closed) return;
    if (voiced) {
      say(true);
      this.logResponseTime();
      for (const part of parts!) {
        await part.play((pcm) => !this.closed && this.deps.sendAudio(pcm));
        if (this.closed) return;
      }
      this.deps.send({ type: 'audio_end', id });
    } else {
      // Without the server's voice, the browser reads the line itself.
      this.release(parts);
      say(false);
    }
    await played;
    this.lineEndedAt = Date.now();
  }

  // ---- listening ---------------------------------------------------------------------------------

  private openFlux() {
    if (!sttConfigured() || this.flux) return;
    this.flux = new FluxStream({
      keyterms: this.deps.keyterms,
      eotTimeoutMs: EOT_TIMEOUT_MS,
      log: this.deps.log,
      onTurn: (turn, epoch) => this.onTurn(turn, epoch),
      onState: (state, error) => {
        if (state === 'down' && error) this.deps.send({ type: 'error', code: 'stt', message: error });
      },
    }).start();
  }

  /** Starts listening for the candidate's reply to what was just said. */
  private listen() {
    if (this.closed || this.phase === 'ended' || this.phase === 'closing') return;
    this.resetReply();
    // Words still being recognised from before this point belong to the last reply, not this one.
    this.stale = this.openTurn ? { key: this.openTurn, skip: wordCount(this.openText) } : null;
    this.timing = { eagerAt: 0, endAt: 0, predicted: false, early: false, acked: false };
    this.listening = true;
    this.state('listening');
    if (this.phase === 'interview' && !this.nudged) {
      this.nudgeTimer = setTimeout(() => void this.nudge(), NUDGE_MS);
    }
  }

  private resetReply() {
    if (this.early) this.early.part = -1;
    this.unfinished = null;
    this.parts = [];
    this.partial = '';
    this.typed = false;
    this.meter = new AnswerMeter();
    this.clearTimers();
  }

  private replyText() {
    return [...this.parts, this.partial].filter(Boolean).join(' ').trim();
  }

  private onTurn(turn: TurnInfo, epoch: number) {
    const key = `${epoch}:${turn.turn_index}`;
    let text = turn.transcript.trim();
    if (turn.event === 'EndOfTurn') {
      this.openTurn = null;
      this.openText = '';
    } else if (turn.event === 'StartOfTurn' || text) {
      if (this.openTurn !== key) this.openText = '';
      this.openTurn = key;
      if (text) this.openText = text;
    }
    if (text) this.turnKey = key;
    if (this.early?.key === key) {
      if (turn.event === 'EndOfTurn') {
        this.settleEarly(text);
        // Still listening (the model judged it unfinished): decide again on the final words.
        if (this.listening && !this.thinking && this.replyText()) {
          this.deps.send({ type: 'transcript', text: this.replyText(), final: true });
          this.settleTimer = setTimeout(() => void this.decide(false), SETTLE_MS);
        }
        return;
      }
      // They carried on in the same sentence: those words weren't the end after all.
      if (this.listening && this.early.part >= 0 && wordCount(text) > wordCount(this.early.text)) {
        this.parts.splice(this.early.part, 1);
        this.lines.splice(this.early.line, 1);
        this.early = null;
      }
    }
    if (!this.listening) return;
    if (this.stale?.key === key) {
      const words = text.split(/\s+/).filter(Boolean);
      if (!this.meter?.heardVoice) {
        this.stale.skip = Math.max(this.stale.skip, words.length);
        return;
      }
      // They've started answering in the same turn: only the words after the last reply's are theirs now.
      text = words.slice(this.stale.skip).join(' ');
      if (!text) return;
    }
    const grew = turn.event === 'Update' && text && wordCount(text) > wordCount(this.partial);
    if (turn.event === 'StartOfTurn' || turn.event === 'TurnResumed' || grew) {
      // They're (still) talking: whatever was being decided is out of date.
      this.saidMore();
    }
    if (turn.event === 'EagerEndOfTurn' && text) {
      this.timing.eagerAt = Date.now();
      this.partial = text;
      this.speculate();
    }
    if (turn.event === 'EndOfTurn') {
      this.timing.endAt = Date.now();
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
      if (spec && sameReply(spec.reply, reply)) void this.decide(false, undefined, spec);
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
    if (this.closed || this.finishing || !['confirm', 'interview'].includes(this.phase)) return;
    if (this.phase === 'interview' && (this.timeUp || this.endsAt - Date.now() < WRAP_AT_MS)) return;
    const reply = this.replyText();
    // A yes to "shall we begin" has its answer ready already.
    if (this.phase === 'confirm' && this.opener && agreed(reply)) return;
    this.dropSpec();
    const ctrl = new AbortController();
    const turn = this.ask(this.prompt(false, false, this.partial), ctrl.signal).catch(() => null);
    // Its voice too, so a prediction that comes true starts playing at once.
    const parts = turn.then((t) => (t?.answer_complete && t.say.trim() && !ctrl.signal.aborted ? this.prepare(t.say.trim()) : null));
    this.spec = { reply, turn, parts, ctrl };
  }

  private dropSpec() {
    const spec = this.spec;
    this.spec = null;
    if (!spec) return;
    spec.ctrl.abort();
    void spec.parts.then((p) => this.release(p));
  }

  /** Prepares the first question (and its voice) while the interviewer asks whether they're ready. */
  private prepareOpener() {
    this.dropOpener();
    const ctrl = new AbortController();
    this.openerCtrl = ctrl;
    this.opener = this.ask(this.prompt(true, false, undefined, true), ctrl.signal).then(
      (turn) => {
        const say = turn.say.trim();
        if (!say || ctrl.signal.aborted) return null;
        return { turn: { ...turn, answer_complete: true, action: 'start' as const }, parts: this.prepare(say) };
      },
      () => null,
    );
  }

  private dropOpener() {
    this.openerCtrl?.abort();
    void this.opener?.then((o) => this.release(o?.parts));
    this.opener = null;
    this.openerCtrl = null;
  }

  /** The prepared reply to what the candidate said to "how are you", or null if they said something that needs the model. */
  private greetingReply(reply: string) {
    const rest = reply.replace(/\b(how are you( doing)?|and you|about you|how're you|how you doing|yourself)\b\s*\??/gi, '');
    if (wordCount(reply) > 25 || rest.includes('?')) return null;
    const lead = ASKED_BACK.test(reply) ? GREETING_REPLIES.askedBack : LOW.test(reply) ? GREETING_REPLIES.low : GREETING_REPLIES.fine;
    const text = `${lead} ${this.readyQuestion()}`;
    const parts = ttsConfigured() ? [...(this.prepare(lead) ?? []), ...(this.prepare(this.readyQuestion()) ?? [])] : null;
    return { turn: { answer_complete: true, action: 'reply' as const, say: text, question_kind: 'opener' as const, looking_for: '' }, parts };
  }

  private saidMore() {
    this.quietWait?.done(false);
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
    await this.say(NUDGE_LINE);
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
  private async decide(
    force: boolean,
    next?: 'next',
    spec?: { turn: Promise<Turn | null>; parts: Promise<Speech[] | null>; ctrl: AbortController },
    /** An acknowledgement already being said for this reply (see decideEarly). */
    acking?: Promise<void> | null,
  ) {
    if (this.closed || this.finishing || !['greeting', 'confirm', 'interview'].includes(this.phase)) return;
    const reply = this.replyText();
    if (!next && !reply) return;
    this.clearTimers();
    const generation = ++this.generation;
    this.thinking?.abort();
    const ctrl = spec?.ctrl ?? new AbortController();
    this.thinking = ctrl;
    this.state('thinking');

    // Before the interview, the usual replies are ready already.
    if (this.phase === 'greeting' && !next) {
      const ready = this.greetingReply(reply);
      if (ready) {
        this.release(await spec?.parts);
        return this.act(ready.turn, ready.parts);
      }
    }
    if (this.phase === 'confirm' && !next && this.opener && agreed(reply)) {
      const opener = await this.opener;
      if (generation !== this.generation || this.closed) return;
      if (opener) {
        this.opener = null;
        return this.act(opener.turn, opener.parts);
      }
    }

    if (this.phase === 'interview' && !next && (this.timeUp || this.endsAt - Date.now() < WRAP_AT_MS)) {
      if (acking) await acking;
      // Nearly out of time, but not out: let them finish the answer first.
      if (!this.timeUp && !force && !(await this.quiet())) return;
      if (generation !== this.generation || this.closed) return;
      this.recordReply();
      return this.wrapUp();
    }

    let turn: Turn;
    let parts: Speech[] | null | undefined;
    try {
      const predicted = spec && (await spec.turn);
      this.timing.predicted = Boolean(predicted);
      if (predicted) parts = await spec.parts;
      turn = predicted || (await this.ask(this.prompt(force, Boolean(next)), ctrl.signal));
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
    if (acking) {
      // The question waits for the acknowledgement to finish playing.
      await acking;
      if (this.thinking === ctrl && !this.closed) this.state('thinking');
    }
    // However the end of the answer was spotted, the candidate gets their full pause first (still
    // "thinking", so the pause doesn't start a second decision).
    if (this.phase === 'interview' && !force && !next && turn.answer_complete && generation === this.generation && !(await this.quiet())) {
      this.release(parts);
      return;
    }
    if (generation !== this.generation || this.closed) {
      this.release(parts);
      return;
    }
    this.thinking = null;

    if (!turn.answer_complete && !force && !next) {
      this.unfinished = reply;
      this.release(parts);
      // The acknowledgement was a nod, then: keep listening to the same reply.
      if (acking) this.listening = true;
      this.state('listening');
      this.patienceTimer = setTimeout(() => void this.decide(true), PATIENCE_MS);
      return;
    }
    if (acking || Date.now() - this.ackedAt < ACKED_RECENTLY_MS) {
      // Already acknowledged: don't say it twice.
      const ack = leadingAck(turn.say.trim());
      if (ack && turn.say.trim().length > ack.length) {
        turn = { ...turn, say: turn.say.trim().slice(ack.length).trim() };
        if (parts && parts.length > 1 && this.acks.get(ack) === parts[0]) parts = parts.slice(1);
        else {
          this.release(parts);
          parts = undefined;
        }
      }
    }
    await this.act(turn, parts);
  }

  /**
   * One model turn, asked again in parallel if it's slow (the model's response time has a long tail) or
   * at once if it fails. The first answer wins.
   */
  private async ask(prompt: string, signal: AbortSignal) {
    const ctrls: AbortController[] = [];
    const attempt = () => {
      const ctrl = new AbortController();
      ctrls.push(ctrl);
      return interviewerTurn({ model: this.deps.model, context: this.deps.context, prompt, signal: AbortSignal.any([signal, ctrl.signal]) });
    };
    let hedge: NodeJS.Timeout | undefined;
    try {
      return await new Promise<Turn>((resolve, reject) => {
        let pending = 2;
        let backedUp = false;
        const backup = () => {
          if (backedUp) return;
          backedUp = true;
          clearTimeout(hedge);
          attempt().then(resolve, failed);
        };
        const failed = (err: unknown) => (--pending === 0 ? reject(err) : backup());
        attempt().then(resolve, failed);
        hedge = setTimeout(backup, HEDGE_MS);
      });
    } finally {
      clearTimeout(hedge);
      for (const ctrl of ctrls) ctrl.abort();
    }
  }

  /** `parts`: the voice for `turn.say`, if it was prepared. */
  private async act(turn: Turn, parts?: Speech[] | null) {
    const say = turn.say.trim();
    const speak = (text: string) => {
      if (text !== say) this.release(parts);
      return this.say(text, text === say && parts !== undefined ? { parts } : {});
    };
    switch (this.phase) {
      case 'greeting': {
        this.setPhase('confirm');
        const line = speak(say || `Glad to hear it. ${this.readyQuestion()}`);
        // The first question is written (and voiced) while this line plays.
        this.prepareOpener();
        await line;
        return this.listen();
      }
      case 'confirm':
        if (turn.action === 'start' || turn.action === 'ask') {
          if (!say) return this.listen();
          this.dropOpener();
          this.setPhase('interview');
          this.persist('start', () => this.deps.store.start());
          this.session.startedAt = new Date().toISOString();
          this.startClock((this.session.durationMinutes ?? 10) * 60_000);
          this.addQuestion(say, turn);
          await speak(say);
          return this.listen();
        }
        await speak(say || 'No problem. Just tell me when you are ready to begin.');
        // Whatever they asked, the opener prepared for a yes still fits.
        if (!this.opener) this.prepareOpener();
        return this.listen();
      case 'interview':
        if (turn.action === 'wrap_up') {
          this.release(parts);
          this.recordReply();
          return this.wrapUp(say);
        }
        if (turn.action === 'reply') {
          // A repeat or a clarification: the same question stays open.
          await speak(say || `Sure. ${this.lastQuestion ?? ''}`);
          return this.listen();
        }
        this.recordReply();
        if (this.timeUp) {
          this.release(parts);
          return this.wrapUp();
        }
        this.addQuestion(say, turn);
        await speak(say);
        return this.listen();
    }
  }

  /**
   * `pending` is what the candidate is saying now, before the recogniser has settled it. `opener`
   * asks for the first question ahead of the candidate saying they're ready.
   */
  private prompt(force: boolean, next: boolean, pending?: string, opener = false) {
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
    if (opener) {
      task = `You've asked whether they're ready to start, and they're about to say yes. Use action "start": say exactly "Great, let's begin." (no other acknowledgement) followed by your first question, an opener suited to the round and anchored in their resume.`;
    } else if (this.phase === 'greeting') {
      task = `The candidate just replied to your greeting. Respond naturally in a few words (if they asked how you are, answer briefly), say in one sentence that this is a ${this.session.durationMinutes}-minute ${SPOKEN_ROUND[this.session.roundType] ?? ''} round with questions about their resume, then ask if they're ready to start. Use action "reply" and answer_complete true.`;
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

  private addQuestion(text: string, turn: Turn) {
    const kind: PracticeQuestionKind = this.session.questions.length === 0 ? 'opener' : turn.question_kind;
    const q: PracticeQuestion = { question: text, kind, lookingFor: turn.looking_for.trim() };
    this.session.questions.push(q);
    this.session.answers.push(null);
    this.session.questionCount = this.session.questions.length;
    this.lastQuestion = text;
    this.nudged = false;
    this.persist('question', () => this.deps.store.addQuestion(q));
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
    if (this.early && this.early.part >= 0) this.early.answer = { index, parts: [...this.parts], part: this.early.part };
    this.parts = [];
    this.partial = '';
    this.persist('answer', () => this.deps.store.setAnswer(index, answer));
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
        this.persist('question', () => this.deps.store.dropLastQuestion());
      }
      await this.saving;
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
