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

/** Post-interview summary (spec G2). */
export interface SessionDebrief {
  overview: string;
  topics: string[];
  weakSpots: { topic: string; why: string; study: string }[];
  thankYouEmail: { subject: string; body: string };
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
