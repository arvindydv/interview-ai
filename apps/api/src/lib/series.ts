import type { DayPoint } from '@parakeet/shared';

/** Days in the admin console's and partner dashboard's charts. */
export const SERIES_DAYS = 30;

/** Turns sparse per-day counts into a dense series ending today (UTC), zero-filled. */
export function fillDays(rows: { day: string; n: number }[], days = SERIES_DAYS): DayPoint[] {
  const byDay = new Map(rows.map((r) => [r.day, r.n]));
  const out: DayPoint[] = [];
  const today = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - i));
    const day = d.toISOString().slice(0, 10);
    out.push({ day, value: byDay.get(day) ?? 0 });
  }
  return out;
}
