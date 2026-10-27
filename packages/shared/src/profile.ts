// Interview context: the candidate's resume and the interview they're preparing for (spec A2–A4).

// Works for any job: teaching, finance, HR, healthcare, sales, government, software, campus hiring…

export type RoundType =
  | 'general'
  | 'behavioral'
  | 'technical'
  | 'case_study'
  | 'presentation'
  | 'coding'
  | 'system_design';

export const ROUND_TYPES: { id: RoundType; label: string; hint: string; softwareOnly?: boolean }[] = [
  { id: 'general', label: 'General / HR', hint: 'About you, motivation, strengths, salary' },
  { id: 'behavioral', label: 'Behavioral', hint: '"Tell me about a time…" questions' },
  { id: 'technical', label: 'Role knowledge', hint: 'Subject and technical questions for your field' },
  { id: 'case_study', label: 'Case / scenario', hint: '"What would you do if…", case studies' },
  { id: 'presentation', label: 'Demo / presentation', hint: 'Demo lesson, pitch, portfolio or presentation' },
  { id: 'coding', label: 'Coding', hint: 'Live coding problems', softwareOnly: true },
  { id: 'system_design', label: 'System design', hint: 'Architecture and design', softwareOnly: true },
];

/** Common fields, offered as quick picks. Any other field can be typed in. */
export const FIELDS = [
  'Teaching & education',
  'Finance & accounting',
  'HR & recruiting',
  'Sales & marketing',
  'Healthcare & nursing',
  'Software & IT',
  'Data & analytics',
  'Engineering',
  'Design & creative',
  'Operations & supply chain',
  'Customer service',
  'Banking',
  'Legal',
  'Government & public sector',
  'Consulting & management',
  'Internship / campus',
] as const;

/** Fields where coding and system-design rounds are offered. */
export const SOFTWARE_FIELDS: readonly string[] = ['Software & IT', 'Data & analytics'];

/** Structured profile extracted from a resume by the worker. Every field comes from the resume itself. */
export interface ResumeProfile {
  name: string | null;
  /** e.g. "Backend engineer, 6 years in payments" */
  headline: string | null;
  /** 2–3 sentences, first person, usable as a "tell me about yourself" opener. */
  summary: string;
  totalYearsExperience: number | null;
  skills: { name: string; years: number | null }[];
  experience: { company: string; title: string; period: string | null; highlights: string[] }[];
  /** Projects and key work: initiatives, programs, campaigns, audits, research, courses taught… */
  projects: { name: string; summary: string; tech: string[]; impact: string | null }[];
  education: { school: string; degree: string | null; year: string | null }[];
  /** Licences and certifications, e.g. B.Ed, CFA, SHRM-CP, AWS Solutions Architect. */
  certifications: string[];
  /** STAR stories built only from facts in the resume, for behavioral questions. */
  stories: { title: string; situation: string; action: string; result: string }[];
}

export type ResumeStatus = 'parsing' | 'ready' | 'failed';

export interface Resume {
  id: string;
  fileName: string;
  status: ResumeStatus;
  /** Why the structured analysis failed or was skipped; the full text is still used for answers. */
  error: string | null;
  charCount: number;
  profile: ResumeProfile | null;
  /** When the candidate last corrected the profile by hand; null when it is exactly as analysed. */
  profileEditedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ResumeUpload {
  fileName: string;
  mimeType: string;
  /** File contents, base64 without a data: prefix. */
  data: string;
}

export interface InterviewInput {
  /** Field or department, e.g. "Teaching & education" or anything the user types. */
  field: string;
  company: string;
  role: string;
  roundType: RoundType;
  jobDescription: string;
  /** The candidate's own instructions for how answers should sound, e.g. "Keep it short, definition then example". */
  instructions: string;
}

/** Where the candidate is with an interview. */
export type InterviewStage = 'preparing' | 'done' | 'offer' | 'rejected' | 'withdrawn';

export const INTERVIEW_STAGES: { id: InterviewStage; label: string }[] = [
  { id: 'preparing', label: 'Preparing' },
  { id: 'done', label: 'Interviewed' },
  { id: 'offer', label: 'Offer' },
  { id: 'rejected', label: 'Not selected' },
  { id: 'withdrawn', label: 'Withdrawn' },
];

export interface Interview extends InterviewInput {
  id: string;
  stage: InterviewStage;
  /** When the interview takes place, if the candidate has set it. */
  scheduledAt: string | null;
  /** The candidate's private notes; never sent to the model. */
  notes: string;
  /** The interview live answers use (the most recently activated one). */
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Live-answer activity for one interview. */
export interface InterviewStats {
  questions: number;
  sessions: number;
  lastUsedAt: string | null;
}

export interface InterviewSummary extends Interview {
  stats: InterviewStats;
}

export interface InterviewDetail extends InterviewSummary {
  /** Latest questions answered for this interview, newest first. */
  recentQuestions: { question: string; createdAt: string }[];
}

/** Create or edit an interview from the website; omitted keys keep their value on edit. */
export interface InterviewWrite extends Partial<InterviewInput> {
  stage?: InterviewStage;
  scheduledAt?: string | null;
  notes?: string;
}

export const PROFILE_LIMITS = {
  /** Resume file size before base64. */
  maxResumeBytes: 5 * 1024 * 1024,
  /** Extracted resume text kept (long CVs are trimmed). */
  maxResumeChars: 40_000,
  /** Below this, the file almost certainly has no text layer (e.g. a scanned PDF). */
  minResumeChars: 200,
  maxFieldChars: 80,
  maxCompanyChars: 120,
  maxRoleChars: 120,
  maxJobDescriptionChars: 20_000,
  maxInstructionsChars: 1_000,
  maxNotesChars: 5_000,
  /** Edited profile, as JSON. */
  maxProfileChars: 60_000,
  /** Interviews one user can keep. */
  maxInterviews: 100,
} as const;

/** Example organisation and title per field, so forms speak the user's language. */
export const FIELD_EXAMPLES: Record<string, [string, string]> = {
  'Teaching & education': ['Delhi Public School', 'Maths Teacher (Grades 9–12)'],
  'Finance & accounting': ['Deloitte', 'Financial Analyst'],
  'HR & recruiting': ['Infosys', 'HR Business Partner'],
  'Sales & marketing': ['HubSpot', 'Account Executive'],
  'Healthcare & nursing': ['Apollo Hospitals', 'Staff Nurse'],
  'Software & IT': ['Stripe', 'Backend Engineer'],
  'Data & analytics': ['Flipkart', 'Data Analyst'],
  Engineering: ['Larsen & Toubro', 'Site Engineer'],
  'Design & creative': ['Ogilvy', 'Graphic Designer'],
  'Operations & supply chain': ['Amazon', 'Operations Manager'],
  'Customer service': ['Airtel', 'Customer Support Lead'],
  Banking: ['HDFC Bank', 'Relationship Manager'],
  Legal: ['Khaitan & Co', 'Associate'],
  'Government & public sector': ['Ministry of Finance', 'Assistant Section Officer'],
  'Consulting & management': ['McKinsey', 'Business Analyst'],
  'Internship / campus': ['TCS', 'Graduate Trainee'],
};

/** One-tap starting points for answer instructions; each adds a line the user can then edit. */
export const INSTRUCTION_IDEAS = [
  'Keep answers short, under 60 words',
  'For "what is" questions: a short definition first, then an example',
  'Use very simple English',
  'Sound casual and friendly, not formal',
  'Always link answers to my own projects',
  'Give a little more detail and depth',
] as const;

export const RESUME_TYPES: Record<string, 'pdf' | 'docx' | 'text'> = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'text/plain': 'text',
  'text/markdown': 'text',
};

/** The structured profile as plain text, for model prompts. */
export function renderResumeProfile(p: ResumeProfile) {
  const lines: string[] = [];
  if (p.name) lines.push(`Name: ${p.name}`);
  if (p.headline) lines.push(`Headline: ${p.headline}`);
  if (p.totalYearsExperience !== null) lines.push(`Total experience: ${p.totalYearsExperience} years`);
  if (p.summary) lines.push(`Summary: ${p.summary}`);
  if (p.skills.length) {
    lines.push(`Skills: ${p.skills.map((s) => (s.years ? `${s.name} (${s.years} yrs)` : s.name)).join(', ')}`);
  }
  if (p.experience.length) {
    lines.push('Experience:');
    for (const e of p.experience) {
      lines.push(`- ${e.title}, ${e.company}${e.period ? ` (${e.period})` : ''}`);
      for (const h of e.highlights) lines.push(`  • ${h}`);
    }
  }
  if (p.projects.length) {
    lines.push('Projects:');
    for (const pr of p.projects) {
      const summary = /[.!?]$/.test(pr.summary) ? pr.summary : `${pr.summary}.`;
      lines.push(`- ${pr.name}: ${summary}${pr.tech.length ? ` Tools/skills: ${pr.tech.join(', ')}.` : ''}${pr.impact ? ` Impact: ${pr.impact}` : ''}`);
    }
  }
  // Profiles analysed before certifications existed don't have the key.
  if (p.certifications?.length) lines.push(`Certifications: ${p.certifications.join(', ')}`);
  if (p.education.length) {
    lines.push(`Education: ${p.education.map((e) => [e.degree, e.school, e.year].filter(Boolean).join(', ')).join('; ')}`);
  }
  if (p.stories.length) {
    lines.push('STAR stories (from the resume):');
    for (const s of p.stories) {
      lines.push(`- ${s.title}. Situation: ${s.situation} Action: ${s.action} Result: ${s.result}`);
    }
  }
  return lines.join('\n');
}
