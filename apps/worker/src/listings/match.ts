// Scores how well a listing fits a candidate. The scoring itself lives in @parakeet/shared (matching.ts)
// so the API and the jobs site explain scores with the same code; this adapts listing rows to it.

import {
  extractRequirements, scoreMatch, type JobRequirements, type MatchCandidateProfile, type MatchConfig, type MatchExplanation,
  type Workplace,
} from '@parakeet/shared';

export { levelFit, titleFit, titleTokens } from '@parakeet/shared';

export interface ListingForMatch {
  id: string;
  title: string;
  description: string;
  level: number;
  location: string;
  workplace: Workplace | null;
  salary: string | null;
  employment_type: string | null;
  posted_at: Date | null;
  eligibility: string | null;
  agency: boolean;
}

/** Points off for recruitment agencies' postings, so employers hiring directly come first. */
export const AGENCY_PENALTY = 10;

export const requirementsOf = (l: ListingForMatch): JobRequirements =>
  extractRequirements(l.title, l.description, l.salary, l.employment_type, l.workplace, l.location);

export function matchListing(
  candidate: MatchCandidateProfile,
  l: ListingForMatch,
  req: JobRequirements,
  config: MatchConfig,
  now = new Date(),
): MatchExplanation {
  const m = scoreMatch(
    candidate,
    req,
    { title: l.title, description: l.description, level: l.level, location: l.location, workplace: l.workplace, postedAt: l.posted_at, eligibility: l.eligibility, now },
    config,
  );
  if (!l.agency) return m;
  return { ...m, score: Math.max(0, m.score - AGENCY_PENALTY), gaps: [...m.gaps, 'Posted by a recruitment agency.'].slice(0, 6) };
}
