import { WORKPLACE_LABELS, type ListingSummary } from '@parakeet/shared';

/** "today", "3d ago", "5w ago", "4mo ago". */
export function postedAgo(iso: string | null): string | null {
  if (!iso) return null;
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days < 1) return 'today';
  if (days < 14) return `${days}d ago`;
  if (days < 60) return `${Math.floor(days / 7)}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

/** "just now", "12 min ago", "3 h ago", then the posted-style days. */
export function timeAgo(iso: string): string {
  const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)} h ago`;
  return postedAgo(iso)!;
}

/** Short facts shown under a listing's title. Internal department codes ("SW Eng - Core-670") are left out. */
export function listingFacts(l: ListingSummary): string[] {
  const department = l.department && !/\d{2,}/.test(l.department) ? l.department : null;
  return [l.workplace && WORKPLACE_LABELS[l.workplace], l.employmentType, department].filter((f): f is string => !!f);
}
