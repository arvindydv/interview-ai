// History and data controls (spec G1–G3): past live sessions, post-interview summaries, retention.

export type HistoryRetention = 'off' | '7d' | '30d' | '90d' | 'forever';

export const HISTORY_RETENTIONS: { id: HistoryRetention; label: string; hint: string; days: number | null }[] = [
  { id: 'off', label: 'Don’t save', hint: 'No questions or answers are stored. Only usage time is kept, for billing.', days: 0 },
  { id: '7d', label: '7 days', hint: 'Questions and answers are deleted after a week.', days: 7 },
  { id: '30d', label: '30 days', hint: 'Questions and answers are deleted after a month.', days: 30 },
  { id: '90d', label: '90 days', hint: 'Questions and answers are deleted after three months.', days: 90 },
  { id: 'forever', label: 'Until I delete them', hint: 'Keep everything, so you can search and review old interviews.', days: null },
];

export interface HistorySessionSummary {
  id: string;
  startedAt: string;
  endedAt: string | null;
  /** Metered time. */
  seconds: number;
  questions: number;
  /** Interviews the questions were answered for, e.g. "Backend Engineer · Stripe". */
  interviews: string[];
  /** The first question asked, if its text is still kept. */
  preview: string;
  /** Questions were asked, but their text has been deleted under the retention setting. */
  textCleared: boolean;
  summaryStatus: 'pending' | 'ready' | 'failed' | null;
}

export interface HistoryTurn {
  id: string;
  question: string;
  answer: string;
  status: 'done' | 'error' | 'cancelled';
  imageCount: number;
  createdAt: string;
}

/** One recognised line of a live session's conversation, kept for the feedback after it. */
export interface TranscriptLine {
  source: 'interviewer' | 'you';
  text: string;
  at: string;
}

/** How the candidate answered, judged from their own words. Only when the desktop app heard their microphone. */
export interface InterviewPerformance {
  /** 0–10. */
  score: number;
  summary: string;
  strengths: string[];
  improvements: string[];
  /** One per question asked (the session's turns with question text, in order). */
  answers: {
    /** 1-based, in that order. */
    question: number;
    /** False when their answer isn't in the transcript (microphone off, or nothing recognised). */
    heard: boolean;
    /** The gist of what they said, in a sentence. */
    said: string;
    /** 0–10; 0 when not heard. */
    score: number;
    feedback: string;
  }[];
}

/** Post-interview feedback (spec G2), written automatically when a desktop interview ends. */
export interface SessionDebrief {
  overview: string;
  topics: string[];
  weakSpots: { topic: string; why: string; study: string }[];
  thankYouEmail: { subject: string; body: string };
  performance?: InterviewPerformance;
}

/** Questions a desktop session needs before its feedback is written by itself (fewer is a test, not an interview). */
export const AUTO_DEBRIEF_MIN_QUESTIONS = 2;

/** A report's file name from its date: "12_oct_interview.pdf". `timeZone` defaults to the local one. */
export function reportFileName(date: Date | string, kind: 'interview' | 'practice', timeZone?: string) {
  const parts = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone }).formatToParts(new Date(date));
  const day = parts.find((p) => p.type === 'day')?.value ?? '';
  const month = (parts.find((p) => p.type === 'month')?.value ?? '').toLowerCase().slice(0, 3);
  return `${day}_${month}_${kind}.pdf`;
}

export interface HistorySession extends HistorySessionSummary {
  turns: HistoryTurn[];
  summary: SessionDebrief | null;
}

export interface HistoryPage {
  sessions: HistorySessionSummary[];
  /** Pass as `before` for the next page; null on the last page. */
  next: string | null;
  retention: HistoryRetention;
}

export interface HistorySearchHit {
  turnId: string;
  sessionId: string;
  createdAt: string;
  /** Text with matches wrapped in \u0002…\u0003, for the client to highlight safely. */
  question: string;
  answer: string;
}

export const SEARCH_MARK = { start: '\u0002', end: '\u0003' } as const;

export interface DeviceInfo {
  id: string;
  os: string;
  osVersion: string | null;
  appVersion: string | null;
  lastSeen: string;
}

export interface AccountSettings {
  historyRetention: HistoryRetention;
  devices: DeviceInfo[];
}
