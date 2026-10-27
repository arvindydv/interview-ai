// Practice mode (spec F1–F3): mock interviews with an AI interviewer, scoring and a debrief.

import type { RoundType } from './profile.js';

export type PracticeDifficulty = 'warmup' | 'standard' | 'tough';

export const PRACTICE_DIFFICULTIES: { id: PracticeDifficulty; label: string; hint: string }[] = [
  { id: 'warmup', label: 'Warm-up', hint: 'Common questions, friendly tone' },
  { id: 'standard', label: 'Standard', hint: 'Like a typical real round' },
  { id: 'tough', label: 'Tough', hint: 'Probing, specific, senior-level' },
];

/** Questions per session the candidate can pick. */
export const PRACTICE_LENGTHS = [3, 5, 8] as const;
export type PracticeLength = (typeof PRACTICE_LENGTHS)[number];

export const PRACTICE_LIMITS = {
  /** Sessions a user can start per day (UTC); each one costs two model calls. */
  perDay: 10,
  maxAnswerChars: 6_000,
  maxAnswerMs: 15 * 60_000,
} as const;

/** HTTP 402 body when a free-plan user has no session minutes left; practice uses the same minutes as live sessions. */
export const NO_MINUTES_ERROR = 'no_minutes';
export const NO_MINUTES_MESSAGE = 'You are out of session minutes. Buy more minutes or get a plan to keep practising.';

/**
 * planning → ready (answering) → scoring → scored. `failed` when planning or scoring couldn't finish;
 * it can be retried.
 */
export type PracticeStatus = 'planning' | 'ready' | 'scoring' | 'scored' | 'failed';

export type PracticeQuestionKind = 'opener' | 'behavioral' | 'role' | 'situational' | 'closing';

export interface PracticeQuestion {
  question: string;
  kind: PracticeQuestionKind;
  /** What a strong answer covers; shown after the session, never while answering. */
  lookingFor: string;
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
}

export interface PracticeAnswerInput {
  text: string;
  mode: 'voice' | 'text';
  durationMs: number;
  skipped: boolean;
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
}

export const PRACTICE_SCORE_LABELS: { key: keyof PracticeScores; label: string }[] = [
  { key: 'relevance', label: 'Relevance' },
  { key: 'structure', label: 'Structure' },
  { key: 'specificity', label: 'Specificity' },
  { key: 'clarity', label: 'Clarity' },
];

export interface PracticeFeedback {
  /** Each 0–10. All zero for a skipped question. */
  scores: PracticeScores;
  /** A few words, e.g. "Strong story, weak ending". */
  verdict: string;
  feedback: string;
  /** How the candidate could have answered, in their own voice and from their own resume. */
  betterAnswer: string;
}

export interface PracticeResult {
  /** 0–100. */
  score: number;
  summary: string;
  strengths: string[];
  improvements: string[];
  questions: PracticeFeedback[];
}

export interface PracticeSetup {
  /** The interview to practise for; null for general practice. */
  interviewId: string | null;
  roundType: RoundType;
  difficulty: PracticeDifficulty;
  questionCount: PracticeLength;
}

export interface PracticeSummary {
  id: string;
  interviewId: string | null;
  /** e.g. "Maths Teacher · Delhi Public School", fixed when the session starts. */
  title: string;
  roundType: RoundType;
  difficulty: PracticeDifficulty;
  questionCount: number;
  answered: number;
  status: PracticeStatus;
  score: number | null;
  createdAt: string;
  completedAt: string | null;
}

export interface PracticeSession extends PracticeSummary {
  /** Session minutes this practice has used (time spent answering, measured by the server). */
  seconds: number;
  error: string | null;
  questions: PracticeQuestion[];
  /** One per question; null until answered. */
  answers: (PracticeAnswer | null)[];
  result: PracticeResult | null;
}

const FILLERS = ['um', 'umm', 'uh', 'uhh', 'erm', 'hmm', 'you know', 'i mean', 'basically', 'actually', 'literally', 'kind of', 'sort of'];

/** Word count, speaking pace and filler words for an answer (spec F2). */
export function speechStats(text: string, durationMs: number, mode: PracticeAnswer['mode']) {
  const lower = ` ${text.toLowerCase().replace(/[^\p{L}\p{N}'\s]/gu, ' ').replace(/\s+/g, ' ')} `;
  const words = lower.trim() ? lower.trim().split(' ').length : 0;
  const fillers = FILLERS.map((word) => ({ word, count: lower.match(new RegExp(`(?<= )${word}(?= )`, 'g'))?.length ?? 0 })).filter(
    (f) => f.count > 0,
  );
  const minutes = durationMs / 60_000;
  const wpm = mode === 'voice' && minutes >= 0.1 && words > 0 ? Math.round(words / minutes) : null;
  return { words, wpm, fillers };
}
