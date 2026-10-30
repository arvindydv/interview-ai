// Scores how well a listing fits a candidate, from their resume profile and job preferences. Cheap
// and deterministic, so every user's matches can be recomputed after each sync: title fit (is this
// the kind of job they do?), how many of their skills the posting mentions, and seniority fit.

export interface MatchProfile {
  /** Target titles: the user's chosen roles, else their recent job titles. */
  roles: string[];
  /** Most relevant first. */
  skills: string[];
  years: number | null;
}

export interface MatchCandidate {
  title: string;
  description: string;
  /** Seniority from the title (job_listings.level): 0 intern … 2 mid … 5 director and above. */
  level: number;
}

export interface MatchResult {
  score: number;
  titleScore: number;
  skillScore: number;
  levelScore: number;
  matchedSkills: string[];
}

// Words that say nothing about the kind of job, or only its level (scored separately).
const TITLE_NOISE = new Set(
  'a an and at for in of on the to with i ii iii iv v senior sr junior jr staff principal lead associate intern internship trainee new grad graduate entry level mid remote hybrid onsite india us usa uk emea apac contract full time part'.split(' '),
);

/** Lowercased title words, with common spelling variants folded together. */
export function titleTokens(title: string): string[] {
  const t = title
    .toLowerCase()
    .replace(/\b(front|back)[\s-]+end\b/g, '$1end')
    .replace(/\bfull[\s-]+stack\b/g, 'fullstack')
    .replace(/\b(sde|swe)\b/g, 'software engineer')
    .replace(/\bdev(eloper)?s?\b/g, 'engineer')
    .replace(/\bengineers\b/g, 'engineer')
    .replace(/\bml\b/g, 'machine learning');
  return [...new Set(t.split(/[^a-z0-9+#]+/).filter((w) => w && !TITLE_NOISE.has(w)))];
}

/**
 * 1 when the listing title is the same kind of job as one of the roles. The role's last word (its
 * job family: engineer, designer, manager, teacher…) carries most of the weight.
 */
export function titleFit(roles: string[], listingTitle: string): number {
  const listing = new Set(titleTokens(listingTitle));
  let best = 0;
  for (const role of roles) {
    const tokens = titleTokens(role);
    if (!tokens.length) continue;
    const head = tokens[tokens.length - 1];
    const rest = tokens.slice(0, -1);
    const restFit = rest.length ? rest.filter((w) => listing.has(w)).length / rest.length : 1;
    const fit = listing.has(head) ? 0.6 + 0.4 * restFit : 0.25 * restFit;
    best = Math.max(best, fit);
  }
  return best;
}

/** Ways a skill is written in postings: "React.js" also as "React" and "ReactJS". */
function skillVariants(skill: string): string[] {
  const s = skill.toLowerCase().trim();
  const parts = s.includes('/') ? s.split('/').map((p) => p.trim()) : [];
  const variants = [s, s.replace(/\.js$/, ''), s.replace(/\.js$/, 'js'), ...parts];
  // One- and two-letter skills ("C", "Go", "R") match too much ordinary text to count.
  return [...new Set(variants)].filter((v) => v.length > 2 || /[+#]/.test(v));
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function skillMatchers(skills: string[]) {
  return skills.map((name) => ({
    name,
    re: skillVariants(name).length
      ? new RegExp(`(?:^|[^a-z0-9+#])(?:${skillVariants(name).map(escapeRe).join('|')})(?![a-z0-9+#])`)
      : null,
  }));
}

/** Levels that fit this much experience; unknown experience fits anything moderately. */
export function levelFit(years: number | null, level: number): number {
  if (years === null) return 0.7;
  const [lo, hi] = years < 1 ? [0, 1] : years < 3 ? [1, 2] : years < 6 ? [2, 3] : years < 10 ? [3, 4] : [4, 5];
  if (level >= lo && level <= hi) return 1;
  return level === lo - 1 || level === hi + 1 ? 0.5 : 0;
}

export function createMatcher(profile: MatchProfile) {
  const skills = skillMatchers(profile.skills.slice(0, 30));
  // Top skills count fully, the long tail half; eight weighted hits is a full skills score.
  const weightOf = (i: number) => (i < 10 ? 1 : 0.5);
  const fullAt = Math.min(8, skills.reduce((sum, _, i) => sum + weightOf(i), 0));

  return (c: MatchCandidate): MatchResult => {
    const text = `${c.title}\n${c.description}`.toLowerCase();
    const matchedSkills: string[] = [];
    let weight = 0;
    skills.forEach((s, i) => {
      if (s.re?.test(text)) {
        matchedSkills.push(s.name);
        weight += weightOf(i);
      }
    });
    const title = profile.roles.length ? titleFit(profile.roles, c.title) : 0.5;
    const skill = fullAt ? Math.min(1, weight / fullAt) : 0;
    const level = levelFit(profile.years, c.level);
    let score = 0.45 * title + 0.35 * skill + 0.2 * level;
    // A different kind of job isn't a good match however many skills overlap.
    if (title < 0.3) score *= 0.6;
    const pct = (n: number) => Math.round(n * 100);
    return { score: pct(score), titleScore: pct(title), skillScore: pct(skill), levelScore: pct(level), matchedSkills };
  };
}
