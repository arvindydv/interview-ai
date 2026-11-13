import type { Config } from './config.js';

// Answers application questions from your own config: plain facts (phone, CTC, notice period…), years
// per skill, and your own answers (config.answers). Nothing is invented: a question these don't cover
// returns null, and the job is skipped with the question listed so you can add an answer.

export interface Question {
  label: string;
  kind: 'text' | 'number' | 'textarea' | 'select' | 'radio' | 'checkbox';
  /** Choices, for select and radio. */
  options?: string[];
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

/** A skill name reduced for comparison: "React.js", "ReactJS" and "react" are the same skill. */
export const canonSkill = (s: string) => {
  const c = s.toLowerCase().replace(/\.js\b|js\b/g, '').replace(/[^a-z0-9+#]/g, '');
  return SKILL_ALIASES[c] ?? c;
};
const SKILL_ALIASES: Record<string, string> = {
  golang: 'go', postgres: 'postgresql', k8s: 'kubernetes', '': '', ts: 'typescript', amazonwebservices: 'aws',
  machinelearning: 'ml', springboot: 'spring', reactnative: 'reactnative', gcp: 'googlecloud', googlecloudplatform: 'googlecloud',
};

/** The skill a question asks about, as written in skillYears; or the asked-about words when the resume doesn't list it. */
function skillIn(question: string, config: Config): string | null {
  const keys = new Map(Object.keys(config.skillYears).map((k) => [canonSkill(k), k]));
  const words = norm(question).replace(/[?,()/:]/g, ' ').split(' ').filter(Boolean);
  // Longest phrases first: "spring boot" before "spring".
  for (let n = 3; n >= 1; n--) {
    for (let i = 0; i + n <= words.length; i++) {
      const key = keys.get(canonSkill(words.slice(i, i + n).join(' ')));
      if (key) return key;
    }
  }
  // "…experience do you have with Golang?": the thing named at the end, unless it's a general field.
  const m = /\b(?:in|with|on|using|of) ([a-z0-9.+#\- ]{1,30}?)\s*\??$/.exec(norm(question).replace(/[()]/g, ''));
  if (!m || GENERAL.test(m[1])) return null;
  return m[1].trim();
}

/** Fields that mean overall experience, not a skill: "in software development", "in this role". */
const GENERAL = /^(total|overall|the industry|industry|it|software|software development|software engineering|development|engineering|tech|technology|this (field|role|domain|industry)|a similar role|similar roles?|professional|years?|(total |relevant |professional |work |it )?experience)$/;

const YES = 'Yes';
const NO = 'No';

/** Your answer to a question, as text (pickOption matches it to a select or radio). Null when unknown. */
export function answerFor(q: Question, config: Config): string | null {
  const label = norm(q.label);
  const p = config.profile;

  for (const [pattern, answer] of Object.entries(config.answers)) {
    try {
      if (new RegExp(pattern, 'i').test(q.label)) return answer;
    } catch {
      // A bad pattern in the config is ignored.
    }
  }

  // Equal opportunity questions: decline when the form allows it.
  if (/\b(gender|sex|race|ethnicity|veteran|disabilit|pronoun|caste|religion)\b/.test(label)) {
    const decline = q.options?.find((o) => /prefer not|decline|don.t wish|do not wish|not to (say|disclose|answer)/i.test(o));
    return decline ?? null;
  }

  if (/first name/.test(label)) return p.firstName;
  if (/last name|surname|family name/.test(label)) return p.lastName;
  if (/full name|^name\b|your name/.test(label)) return `${p.firstName} ${p.lastName}`.trim();
  if (/e-?mail/.test(label)) return p.email;
  if (/country code|phone country/.test(label)) return p.phoneCountry;
  if (/mobile|phone|contact number/.test(label)) return p.phone;
  if (/linkedin/.test(label)) return p.linkedinUrl || null;
  if (/github/.test(label)) return p.githubUrl || null;
  if (/portfolio|website|personal site/.test(label)) return p.portfolioUrl || p.githubUrl || null;
  if (/current (company|employer|organi[sz]ation)/.test(label)) return p.currentCompany || null;
  if (/current (title|designation|role|position)|job title/.test(label)) return p.currentTitle || null;
  if (/notice period|joining time|how soon can you join|earliest (start|joining)/.test(label)) {
    if (q.kind === 'number') return String(/month/.test(label) ? Math.ceil(p.noticePeriodDays / 30) : p.noticePeriodDays);
    if (q.options) return `${p.noticePeriodDays} days`;
    return p.noticePeriodDays === 0 ? 'Immediate' : `${p.noticePeriodDays} days`;
  }
  if (/\b(current|present)\b.*\b(ctc|salary|compensation|package)\b|\bctc\b.*\bcurrent\b/.test(label)) return ctc(p.currentCtcLpa, label, q);
  if (/\b(expected|desired)\b.*\b(ctc|salary|compensation|package)\b|\bsalary expectation/.test(label)) return ctc(p.expectedCtcLpa, label, q);
  if (/(current|present) (city|location)|where are you (based|located)|^city$|^location/.test(label)) return p.city || null;
  if (/relocat/.test(label)) return p.willingToRelocate ? YES : NO;
  if (/sponsor/.test(label)) return p.needsSponsorship ? YES : NO;
  if (/(authori[sz]ed|eligible|legally|right) to work/.test(label) && /india/.test(label)) return p.authorizedToWorkInIndia ? YES : NO;
  if (/hybrid|on-?site|work from (the )?office|commut/.test(label) && /(comfortable|willing|able|okay|ok)/.test(label)) {
    return p.comfortableWithHybridOrOnsite ? YES : NO;
  }
  if (/highest (level of )?(education|qualification)|degree/.test(label) && q.kind !== 'radio') return p.highestEducation || null;
  if (/(completed|have) (a |the )?(bachelor|graduat)/.test(label)) return /bachelor|master|phd|b\.?tech|graduat/i.test(p.highestEducation) ? YES : NO;
  if (/(completed|have) (a |the )?master/.test(label)) return /master|m\.?tech|mba|phd/i.test(p.highestEducation) ? YES : NO;

  if (/years?|yrs/.test(label) && /experience|exp\b|worked/.test(label)) {
    if (/total|overall|professional|relevant|work experience|it experience/.test(label) && !skillIn(q.label, config)) {
      return String(config.totalExperienceYears);
    }
    const skill = skillIn(q.label, config);
    if (!skill) return String(config.totalExperienceYears);
    return String(config.skillYears[skill] ?? config.skillDefault);
  }
  // "Do you have experience with Kafka?"
  if (/^(do|have) you (have )?(any )?(hands-on |working |prior )?experience/.test(label)) {
    const skill = skillIn(q.label, config);
    if (skill) return (config.skillYears[skill] ?? config.skillDefault) > 0 ? YES : NO;
  }
  return null;
}

function ctc(lpa: number, label: string, q: Question): string | null {
  if (!lpa) return null;
  if (q.options) return `${lpa}`;
  if (/lakh|lac|lpa|\bl\b/.test(label)) return String(lpa);
  if (/inr|rupees|₹|per annum|annual|yearly|\bpa\b/.test(label) || q.kind === 'number') return String(Math.round(lpa * 100_000));
  return `${lpa} LPA`;
}

const numbersIn = (s: string) => [...s.matchAll(/\d+(\.\d+)?/g)].map((m) => Number(m[0]));

/**
 * The option that says what `answer` says: the same words, the same yes/no, or for a number the range
 * it falls in ("3-5 years", "15 days or less", "More than 10"). Null when none fits.
 */
export function pickOption(answer: string, options: string[]): string | null {
  const a = norm(answer);
  const real = options.filter((o) => o.trim() && !/^(select|choose|please select|--)/i.test(o.trim()));
  const exact = real.find((o) => norm(o) === a);
  if (exact) return exact;
  if (a === 'yes' || a === 'no') return real.find((o) => norm(o).startsWith(a)) ?? null;
  const starts = real.find((o) => norm(o).startsWith(a) || a.startsWith(norm(o)));
  if (starts) return starts;
  const n = numbersIn(a)[0];
  if (n !== undefined) {
    for (const o of real) {
      const s = norm(o);
      const nums = numbersIn(s);
      if (/immediate/.test(s) && n === 0) return o;
      if (nums.length >= 2 && n >= nums[0] && n <= nums[1]) return o;
      if (nums.length === 1 && /less than|under|below|or less|upto|up to|within/.test(s) && n <= nums[0]) return o;
      if (nums.length === 1 && /more than|over|above|\+|or more/.test(s) && n >= nums[0]) return o;
      if (nums.length === 1 && nums[0] === n) return o;
    }
  }
  return real.find((o) => norm(o).includes(a) || (a.length > 3 && a.includes(norm(o)))) ?? null;
}
