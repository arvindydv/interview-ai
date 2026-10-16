const compactFmt = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
const intFmt = new Intl.NumberFormat('en');

/** 1,284 / 12.9K / 4.2M */
export const compact = (n: number) => (Math.abs(n) < 10_000 ? intFmt.format(n) : compactFmt.format(n));
export const int = (n: number) => intFmt.format(n);
export const pct = (n: number) => `${(n * 100).toFixed(n > 0 && n < 0.1 ? 1 : 0)}%`;

export function ms(n: number | null | undefined) {
  if (n === null || n === undefined) return '–';
  return n < 1000 ? `${n} ms` : `${(n / 1000).toFixed(1)} s`;
}

export function dateTime(iso: string | null | undefined) {
  if (!iso) return '–';
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function date(iso: string | null | undefined) {
  if (!iso) return '–';
  return new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' });
}

const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

/** "3 min ago", "yesterday" */
export function ago(iso: string | null | undefined) {
  if (!iso) return 'never';
  const s = (new Date(iso).getTime() - Date.now()) / 1000;
  const abs = Math.abs(s);
  if (abs < 45) return 'just now';
  if (abs < 3600) return rtf.format(Math.round(s / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(s / 3600), 'hour');
  if (abs < 86400 * 30) return rtf.format(Math.round(s / 86400), 'day');
  return date(iso);
}

/** "Oct 16" from "2026-10-16" (UTC day keys). */
export function dayLabel(day: string) {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

/** Percent change vs a previous period, or null when there's no baseline. */
export function change(now: number, prev: number) {
  return prev === 0 ? null : (now - prev) / prev;
}
