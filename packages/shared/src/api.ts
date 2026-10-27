// REST shapes shared by the Edge API, web app and desktop app.

import { FREE_MINUTES } from './billing.js';

export interface Me {
  id: string;
  email: string;
  authProvider: string;
  plan: string;
  /** When a paid plan ends (it doesn't renew). Null when the plan has no end date. */
  planExpiresAt: string | null;
  createdAt: string;
  /** Metered live session time (free trial plus bought minutes). Null when the plan isn't metered. */
  trial: TrialBalance | null;
  /** Whether this account got the free trial minutes, and if not, why. */
  trialStatus: FreeTrialStatus;
}

/**
 * The free trial is granted once per person: when the desktop app first signs in on a computer that
 * hasn't had one, from a real (not temporary) email that hasn't had one either.
 */
export type FreeTrialStatus =
  | 'pending'
  | 'granted'
  | 'device_used'
  | 'email_used'
  | 'disposable_email'
  | 'network_limit'
  | 'no_device_id';

/** Why there are no free minutes, for people; null when the trial was granted. */
export function freeTrialMessage(status: FreeTrialStatus): string | null {
  switch (status) {
    case 'granted':
      return null;
    case 'pending':
      return `Install the desktop app and sign in to unlock your ${FREE_MINUTES} free minutes.`;
    case 'device_used':
      return 'This computer has already used a free trial. Buy minutes or a plan to keep going.';
    case 'email_used':
      return 'This email address has already used a free trial. Buy minutes or a plan to keep going.';
    case 'disposable_email':
      return 'Free minutes need a permanent email address, not a temporary inbox. Buy minutes or a plan, or sign up with your own email.';
    case 'network_limit':
      return 'Too many free trials have been claimed from your network recently. Buy minutes or a plan, or try again later.';
    case 'no_device_id':
      return `We couldn't verify this computer for the free trial. Sign in to the desktop app on another computer, or buy minutes.`;
  }
}

export interface EmailCheck {
  ok: boolean;
  /** Why the address can't be used, for people. */
  message?: string;
}

/** Metered live session time, in seconds: the free trial plus any minute packs bought. */
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

/** "7 of 10 min left" / "No minutes left" */
export function trialLeft(trial: TrialBalance) {
  const left = Math.max(trial.totalSeconds - trial.usedSeconds, 0);
  if (left === 0) return 'No minutes left';
  return `${Math.ceil(left / 60)} of ${Math.round(trial.totalSeconds / 60)} min left`;
}
