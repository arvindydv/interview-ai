// Practice mode (spec F1–F3): live, spoken mock interviews with an AI interviewer, then a debrief that
// scores the answers and how confidently they were said.

import type { RoundType } from './profile.js';

export type PracticeDifficulty = 'warmup' | 'standard' | 'tough';

export const PRACTICE_DIFFICULTIES: { id: PracticeDifficulty; label: string; hint: string }[] = [
  { id: 'warmup', label: 'Warm-up', hint: 'Common questions, friendly tone' },
  { id: 'standard', label: 'Standard', hint: 'Like a typical real round' },
  { id: 'tough', label: 'Tough', hint: 'Probing, specific, senior-level' },
];

/** Interview lengths the candidate can pick, in minutes. The number of questions follows from the time. */
export const PRACTICE_DURATIONS = [5, 10, 15, 20, 30] as const;
export type PracticeDuration = (typeof PRACTICE_DURATIONS)[number];

export const PRACTICE_LIMITS = {
  /** Sessions a user can start per day (UTC), to bound model and speech costs. */
  perDay: 10,
  /** A typed answer (when the microphone isn't available). */
  maxAnswerChars: 6_000,
  /** After the time is up, a candidate mid-answer may finish for up to this long. */
  overtimeMs: 45_000,
} as const;

/** HTTP 402 body when a free-plan user has no session minutes left; practice uses the same minutes as live sessions. */
export const NO_MINUTES_ERROR = 'no_minutes';
export const NO_MINUTES_MESSAGE = 'You are out of session minutes. Buy more minutes or get a plan to keep practising.';

/** HTTP 409 body when the user has no resume: the interviewer asks only about the candidate's resume. */
export const NO_RESUME_ERROR = 'no_resume';

/**
 * ready (live interview, before and during) → scoring → scored. `failed` when scoring couldn't finish;
 * it can be retried. `planning` only appears on sessions from before live practice.
 */
export type PracticeStatus = 'planning' | 'ready' | 'scoring' | 'scored' | 'failed';

export type PracticeQuestionKind = 'opener' | 'behavioral' | 'role' | 'situational' | 'follow_up' | 'closing';

export interface PracticeQuestion {
  question: string;
  kind: PracticeQuestionKind;
  /** What a strong answer covers; shown after the session, never while answering. */
  lookingFor: string;
}

/** How an answer was said, measured from the candidate's audio and transcript (spoken answers only). */
export interface PracticeDelivery {
  /** From the end of the question to the first word. */
  thinkMs: number;
  /** Time with voice in it. */
  speakingMs: number;
  /** Silences of 2 s or more after the candidate started answering. */
  longPauses: number;
  longestPauseMs: number;
  /** Share of the answer (first to last word) that was silence, 0–1. */
  pauseRatio: number;
  /** How much the speaking pace changed through the answer (coefficient of variation, 0 = metronome). */
  paceVariation: number | null;
  /** How much the loudness changed while speaking (coefficient of variation); low reads as flat. */
  volumeVariation: number | null;
  /** Hedging phrases ("I think maybe", "I guess", "not sure"). */
  hedges: { word: string; count: number }[];
  /** Repeated words and false starts ("I I", "the the"). */
  restarts: number;
  /** Mean speech-recognition confidence, 0–1; low often means mumbling or trailing off. */
  clarity: number | null;
  /**
   * Share of the answer's word sequences that match the answer the Friday desktop app showed for this
   * question, 0–1. Null when the desktop app wasn't answering along.
   */
  copilotOverlap: number | null;
  /** 0–1, from the signals above: how much the answer sounded read out rather than spoken. */
  readingLikelihood: number;
  /** 0–10, from the signals above; the debrief's confidence score has the final say. */
  confidenceHint: number;
}

export interface PracticeAnswer {
  text: string;
  mode: 'voice' | 'text';
  durationMs: number;
  skipped: boolean;
  words: number;
  /** Speaking pace; only for spoken answers. */
  wpm: number | null;
  fillers: { word: string; count: number }[];
  /** Spoken answers in live practice only. */
  delivery?: PracticeDelivery;
}

export interface PracticeScores {
  /** Did it answer the question that was asked. */
  relevance: number;
  /** A clear shape: point first, or a complete STAR story for behavioural questions. */
  structure: number;
  /** Concrete examples, names and numbers instead of generalities. */
  specificity: number;
  /** Easy to follow when heard out loud. */
  clarity: number;
  /** Sounded sure of themselves: steady, direct, owned the answer, not read out. Live practice only. */
  confidence?: number;
}

export const PRACTICE_SCORE_LABELS: { key: keyof PracticeScores; label: string }[] = [
  { key: 'confidence', label: 'Confidence' },
  { key: 'relevance', label: 'Relevance' },
  { key: 'structure', label: 'Structure' },
  { key: 'specificity', label: 'Specificity' },
  { key: 'clarity', label: 'Clarity' },
];

export type ReadingVerdict = 'natural' | 'possibly_reading' | 'likely_reading';

export interface PracticeFeedback {
  /** Each 0–10. All zero for a skipped question. */
  scores: PracticeScores;
  /** A few words, e.g. "Strong story, weak ending". */
  verdict: string;
  feedback: string;
  /** How it was said: confidence, pace, pauses, hedging. Live practice only. */
  delivery?: string;
  reading?: ReadingVerdict;
  /** How the candidate could have answered, in their own voice and from their own resume. */
  betterAnswer: string;
}

/** The debrief's verdict on how the candidate came across. Live practice only. */
export interface PracticeConfidence {
  /** 0–10. */
  score: number;
  summary: string;
  reading: ReadingVerdict;
  /** Why the reading verdict, in a sentence; empty when it sounded natural. */
  readingEvidence: string;
  /** Specific things to do to sound more confident, most important first. */
  tips: string[];
}

export interface PracticeResult {
  /** 0–100; shown out of 10. */
  score: number;
  summary: string;
  strengths: string[];
  improvements: string[];
  questions: PracticeFeedback[];
  confidence?: PracticeConfidence;
}

export interface PracticeSetup {
  /** The interview to practise for; null for general practice. */
  interviewId: string | null;
  roundType: RoundType;
  difficulty: PracticeDifficulty;
  durationMinutes: PracticeDuration;
}

export interface PracticeSummary {
  id: string;
  interviewId: string | null;
  /** e.g. "Maths Teacher · Delhi Public School", fixed when the session starts. */
  title: string;
  roundType: RoundType;
  difficulty: PracticeDifficulty;
  /** Null for sessions from before live practice. */
  durationMinutes: number | null;
  /** Questions asked so far. */
  questionCount: number;
  answered: number;
  status: PracticeStatus;
  /** 0–100. */
  score: number | null;
  createdAt: string;
  /** When the candidate said they were ready and the clock started. */
  startedAt: string | null;
  completedAt: string | null;
}

export interface PracticeSession extends PracticeSummary {
  /** Interview time used so far (and session minutes spent on it). */
  seconds: number;
  error: string | null;
  questions: PracticeQuestion[];
  /** One per question; null until answered. */
  answers: (PracticeAnswer | null)[];
  result: PracticeResult | null;
}

/** A 0–100 score out of 10, e.g. 72 → "7.2". */
export const scoreOutOf10 = (score: number) => (Math.round(score) / 10).toFixed(1);

// ---- the live interview: WS /v1/practice/:id/live ------------------------------------------------
//
// The browser sends its microphone as binary frames of raw PCM in AUDIO_FORMAT (no source byte), and
// zeros while the interviewer is speaking, so the interviewer's own voice is never taken for an answer.
// The server runs the interview: it decides what the interviewer says and sends it as a `say` message.
// When `audio` is true, the spoken line follows as binary frames of raw PCM in INTERVIEWER_AUDIO,
// streamed as it is synthesised so playback starts at once, then `audio_end`. The browser reports
// `said` when it has finished playing a line.

/** The interviewer's voice on the wire. */
export const INTERVIEWER_AUDIO = { encoding: 'linear16', sampleRate: 24000, channels: 1 } as const;

export type PracticePhase = 'lobby' | 'greeting' | 'confirm' | 'interview' | 'closing' | 'ended';

/** What the interviewer is doing, for the room's status line. */
export type InterviewerState = 'idle' | 'thinking' | 'speaking' | 'listening';

/** The Friday desktop app, as seen from the practice room (same account, same server). */
export interface DesktopStatus {
  connected: boolean;
  /** Transcribing the interviewer's audio (system sound). */
  hearing: boolean;
  /** The last interviewer line the desktop app heard, and how long after this room finished saying it. */
  heard: { text: string; afterMs: number | null } | null;
  /** How long after the line ended the desktop app's answer started appearing. */
  answerAfterMs: number | null;
}

export type PracticeClientMessage =
  /** First message: the user's access token (browsers can't set headers on a WebSocket). */
  | { type: 'auth'; token: string; /** Local hour 0–23, for "good morning". */ hour: number }
  /** The candidate pressed Join (a click, so the browser lets the page play sound). */
  | { type: 'join' }
  | { type: 'said'; id: string }
  /** "I've finished my answer": don't wait for the silence. */
  | { type: 'done' }
  | { type: 'repeat' }
  /** A typed answer, when there's no microphone. */
  | { type: 'text'; text: string }
  /** Plays a sample question so the candidate can check the desktop app hears it. */
  | { type: 'test' }
  | { type: 'end' };

export type PracticeServerMessage =
  | { type: 'ready'; stt: boolean; tts: boolean; session: PracticeSession }
  | { type: 'say'; id: string; text: string; audio: boolean; test?: boolean }
  /** The last audio frame of line `id` has been sent. */
  | { type: 'audio_end'; id: string }
  | { type: 'state'; phase: PracticePhase; interviewer: InterviewerState }
  /** The candidate's words as they're recognised; `final` once a phrase is settled. */
  | { type: 'transcript'; text: string; final: boolean }
  /** The interview clock started (or resumed); ends at `endsAt` (server time, ms). */
  | { type: 'clock'; endsAt: number; serverTime: number }
  | { type: 'session'; session: PracticeSession }
  | { type: 'minutes'; secondsLeft: number | null }
  | { type: 'desktop'; desktop: DesktopStatus }
  | { type: 'error'; code: string; message: string };

const FILLERS = ['um', 'umm', 'uh', 'uhh', 'erm', 'hmm', 'you know', 'i mean', 'basically', 'actually', 'literally', 'kind of', 'sort of'];
const HEDGES = ['i think', 'i guess', 'maybe', 'probably', 'not sure', 'i believe', 'perhaps', 'somewhat', 'more or less', 'i suppose'];

const normalised = (text: string) => ` ${text.toLowerCase().replace(/[’‘]/g, "'").replace(/[^\p{L}\p{N}'\s]/gu, ' ').replace(/\s+/g, ' ')} `;

const countPhrases = (lower: string, phrases: string[]) =>
  phrases
    .map((word) => ({ word, count: lower.match(new RegExp(`(?<= )${word}(?= )`, 'g'))?.length ?? 0 }))
    .filter((f) => f.count > 0);

/** Word count, speaking pace and filler words for an answer (spec F2). */
export function speechStats(text: string, durationMs: number, mode: PracticeAnswer['mode']) {
  const lower = normalised(text);
  const words = lower.trim() ? lower.trim().split(' ').length : 0;
  const fillers = countPhrases(lower, FILLERS);
  const minutes = durationMs / 60_000;
  const wpm = mode === 'voice' && minutes >= 0.1 && words > 0 ? Math.round(words / minutes) : null;
  return { words, wpm, fillers };
}

/** Hedging phrases and false starts ("I I went", "the the"), which make an answer sound unsure. */
export function hesitationStats(text: string) {
  const lower = normalised(text);
  const hedges = countPhrases(lower, HEDGES);
  const words = lower.trim().split(' ');
  let restarts = 0;
  for (let i = 1; i < words.length; i++) if (words[i] && words[i] === words[i - 1] && words[i].length < 8) restarts++;
  return { hedges, restarts };
}
