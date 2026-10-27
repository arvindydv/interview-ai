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

export interface Interview extends InterviewInput {
  id: string;
  updatedAt: string;
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
} as const;

export const RESUME_TYPES: Record<string, 'pdf' | 'docx' | 'text'> = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'text/plain': 'text',
  'text/markdown': 'text',
};
