import { useEffect, useState } from 'react';
import type { Me, TrialBalance } from '@parakeet/shared';
import { parakeet as p } from './bridge';
import type { LiveStatus } from './types';

// Session timer and free-trial balance, shared by the main window and the overlay.

/** 754 → "12:34" */
export function clock(seconds: number) {
  const s = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/** Re-renders every second while `running`. */
function useNow(running: boolean) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!running) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [running]);
  return now;
}

/**
 * Session time ("04:12"), counted from when the session was started (kept by the main process, so
 * it survives reconnects and is the same in every window). Null when not in a session.
 */
export function useElapsed(status: LiveStatus) {
  const startedAt = status.state === 'disconnected' ? null : (status.startedAt ?? null);
  const now = useNow(startedAt !== null);
  return startedAt === null ? null : clock((now - startedAt) / 1000);
}

/** The signed-in account: fetched on open and again after each session, so the trial balance is exact. */
export function useMe(inSession: boolean) {
  const [me, setMe] = useState<Me | null>(null);
  useEffect(() => {
    if (!inSession) p.api.me().then(setMe, () => {});
  }, [inSession]);
  return me;
}

export interface TrialState {
  totalSeconds: number;
  leftSeconds: number;
}

/**
 * Free-trial time left (null when the plan isn't metered). The live session pushes the balance
 * every few seconds; between pushes it counts down locally so the number moves every second.
 */
export function useTrial(me: Me | null, live: boolean): TrialState | null {
  const [latest, setLatest] = useState<{ trial: TrialBalance | null; at: number } | null>(null);
  useEffect(() => {
    if (me) setLatest({ trial: me.trial, at: Date.now() });
  }, [me]);
  useEffect(
    () =>
      p.live.onMessage((m) => {
        if (m.type === 'trial') setLatest({ trial: m.trial, at: Date.now() });
      }),
    [],
  );
  const now = useNow(live);
  if (!latest?.trial) return null;
  const { totalSeconds, usedSeconds } = latest.trial;
  const sincePush = live ? Math.max(0, Math.floor((now - latest.at) / 1000)) : 0;
  return { totalSeconds, leftSeconds: Math.max(0, totalSeconds - usedSeconds - sincePush) };
}
