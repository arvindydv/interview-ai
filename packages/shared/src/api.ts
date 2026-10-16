// REST shapes shared by the Edge API, web app and desktop app.

export interface Me {
  id: string;
  email: string;
  authProvider: string;
  plan: string;
  createdAt: string;
  /** Free-trial live session time. Null when the plan isn't metered. */
  trial: TrialBalance | null;
}

/** Free-trial live session time, in seconds. */
export interface TrialBalance {
  totalSeconds: number;
  usedSeconds: number;
}

export interface DeviceRegistration {
  deviceKey: string;
  os: string;
  osVersion?: string;
  appVersion?: string;
}

export interface HealthReport {
  ok: boolean;
  version: string;
  checks: Record<string, { ok: boolean; latencyMs?: number; error?: string }>;
}

export interface PingJobResult {
  jobId: string;
  result: { pong: true; processedBy: string; queuedMs: number };
}

/** "7 of 10 min left" / "Trial used up" */
export function trialLeft(trial: TrialBalance) {
  const left = Math.max(trial.totalSeconds - trial.usedSeconds, 0);
  if (left === 0) return 'Trial used up';
  return `${Math.ceil(left / 60)} of ${Math.round(trial.totalSeconds / 60)} min left`;
}
