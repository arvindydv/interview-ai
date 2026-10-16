// Admin console API (/admin/*), used by apps/admin. Authenticated with an admin token from POST /admin/login.

import type { TrialBalance } from './api.js';

export type UserStatus = 'active' | 'suspended';
export type TurnStatus = 'done' | 'error' | 'cancelled' | 'blocked';

export interface AdminSession {
  token: string;
  email: string;
  expiresAt: string;
}

/** Runtime settings, enforced by the Edge API. */
export interface AppSettings {
  /** Live answers are refused with `maintenanceMessage` while on. */
  maintenanceMode: boolean;
  maintenanceMessage: string;
  /** Questions per user per UTC day, by plan. 0 or missing = unlimited. */
  dailyQuestionLimits: Record<string, number>;
  /** Override LLM_FAST_MODEL / LLM_VISION_MODEL without a redeploy. Empty = use env. */
  fastModel: string;
  visionModel: string;
}

export const DEFAULT_SETTINGS: AppSettings = {
  maintenanceMode: false,
  maintenanceMessage: 'Parakeet is down for maintenance. Please try again in a few minutes.',
  dailyQuestionLimits: { free: 0 },
  fastModel: '',
  visionModel: '',
};

export interface DayPoint {
  /** YYYY-MM-DD (UTC) */
  day: string;
  value: number;
}

export interface Breakdown {
  label: string;
  value: number;
}

export interface AdminOverview {
  kpis: {
    totalUsers: number;
    newUsers7d: number;
    newUsersPrev7d: number;
    activeToday: number;
    active7d: number;
    active30d: number;
    liveNow: number;
    questionsToday: number;
    questions7d: number;
    questionsPrev7d: number;
    tokensIn30d: number;
    tokensOut30d: number;
    avgTtftMs7d: number | null;
    errorRate7d: number;
    suspendedUsers: number;
  };
  series: {
    signups: DayPoint[];
    questions: DayPoint[];
    activeUsers: DayPoint[];
  };
  breakdowns: {
    plans: Breakdown[];
    os: Breakdown[];
    fields: Breakdown[];
    rounds: Breakdown[];
    models: Breakdown[];
    turnStatus: Breakdown[];
  };
  funnel: Breakdown[];
}

export interface AdminUserRow {
  id: string;
  email: string;
  authProvider: string;
  plan: string;
  status: UserStatus;
  createdAt: string;
  lastActiveAt: string | null;
  lastSignInAt: string | null;
  devices: number;
  questions: number;
  hasResume: boolean;
  online: boolean;
}

export interface Paged<T> {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface AdminDevice {
  id: string;
  os: string;
  osVersion: string | null;
  appVersion: string | null;
  lastSeen: string;
}

export interface AdminLiveSession {
  id: string;
  clientSessionId: string;
  connectedAt: string;
  disconnectedAt: string | null;
  turns: number;
  /** Metered session time, and how much of it came out of the free trial. */
  seconds: number;
  trialSeconds: number;
}

export interface AdminTurn {
  id: string;
  userId: string;
  userEmail: string;
  liveSessionId: string | null;
  question: string;
  /** Truncated in list views; full in GET /admin/activity/:id. */
  answer: string;
  imageCount: number;
  field: string;
  company: string;
  role: string;
  hasResume: boolean;
  model: string | null;
  tier: string | null;
  status: TurnStatus;
  errorCode: string | null;
  tokensIn: number;
  tokensOut: number;
  ttftMs: number | null;
  durationMs: number | null;
  createdAt: string;
}

export interface AdminInterviewRow {
  id: string;
  userId: string;
  userEmail: string;
  field: string;
  company: string;
  role: string;
  roundType: string;
  jdChars: number;
  createdAt: string;
  updatedAt: string;
}

export interface AdminUserDetail {
  user: AdminUserRow & {
    adminNote: string;
    emailConfirmedAt: string | null;
  };
  stats: {
    questions: number;
    questions7d: number;
    tokensIn: number;
    tokensOut: number;
    sessions: number;
    avgTtftMs: number | null;
    questionsToday: number;
    /** Metered live session time, all time / last 7 days. */
    sessionSeconds: number;
    sessionSeconds7d: number;
  };
  /** Free-trial balance; shown whatever the plan, so admins can see what a paid user had used. */
  trial: TrialBalance;
  /** Live session minutes per day (30d), to one decimal. */
  minutes: DayPoint[];
  devices: AdminDevice[];
  resume: {
    id: string;
    fileName: string;
    status: string;
    error: string | null;
    charCount: number;
    profile: unknown;
    createdAt: string;
  } | null;
  interviews: AdminInterviewRow[];
  sessions: AdminLiveSession[];
  turns: AdminTurn[];
  activity: DayPoint[];
}

export interface QueueStats {
  name: string;
  counts: Record<string, number>;
  failed: { id: string; name: string; failedReason: string; attemptsMade: number; timestamp: number }[];
}

export interface AdminSystem {
  health: { ok: boolean; version: string; checks: Record<string, { ok: boolean; latencyMs?: number; error?: string }> };
  queues: QueueStats[];
  liveConnections: number;
  llmConfigured: boolean;
  models: { fast: string; vision: string };
}

export interface AuditEntry {
  id: number;
  adminEmail: string;
  action: string;
  target: string | null;
  details: Record<string, unknown>;
  createdAt: string;
}
