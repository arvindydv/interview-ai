// REST shapes shared by the Edge API, web app and desktop app.

export interface Me {
  id: string;
  email: string;
  authProvider: string;
  plan: string;
  createdAt: string;
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
