import {
  INTERVIEW_STAGES, ROUND_TYPES, SOFTWARE_FIELDS, type Interview, type InterviewInput, type InterviewStage, type Resume,
  type RoundType,
} from '@parakeet/shared';

export const roundLabel = (id: RoundType) => ROUND_TYPES.find((r) => r.id === id)?.label ?? id;
export const stageLabel = (id: InterviewStage) => INTERVIEW_STAGES.find((s) => s.id === id)?.label ?? id;

export const STAGE_TONE: Record<InterviewStage, string> = {
  preparing: 'bg-brand-2/10 text-brand-2 ring-brand-2/25',
  done: 'bg-accent/10 text-accent ring-accent/25',
  offer: 'bg-brand/10 text-brand ring-brand/25',
  rejected: 'bg-white/5 text-muted ring-line',
  withdrawn: 'bg-white/5 text-faint ring-line',
};

export const isClosed = (stage: InterviewStage) => stage === 'rejected' || stage === 'withdrawn';

/** Rounds offered for a field: coding and system design only for software fields (or if already picked). */
export const roundsFor = (field: string, current?: RoundType) =>
  ROUND_TYPES.filter((r) => !r.softwareOnly || SOFTWARE_FIELDS.includes(field) || r.id === current);

export function interviewTitle(i: Pick<Interview, 'role' | 'company' | 'field'>) {
  return i.role || i.company || i.field || 'Untitled interview';
}

export function interviewSubtitle(i: Pick<Interview, 'role' | 'company' | 'field'>) {
  if (i.role && i.company) return i.company;
  if (i.role || i.company) return i.field;
  return '';
}

// ---- readiness -----------------------------------------------------------------------------------

export interface ReadinessItem {
  key: string;
  label: string;
  hint: string;
  done: boolean;
  weight: number;
}

/** A job description shorter than this is probably just a title, not the posting. */
export const MIN_USEFUL_JD = 300;

/** How much Friday knows for this interview, which is what decides how tailored live answers are. */
export function readiness(i: InterviewInput, resume: Resume | null | undefined) {
  const items: ReadinessItem[] = [
    {
      key: 'resume',
      label: 'Resume',
      hint: resume?.status === 'parsing' ? 'Being analysed…' : 'Answers use your real projects and numbers',
      done: Boolean(resume && resume.status !== 'failed'),
      weight: 30,
    },
    {
      key: 'jd',
      label: 'Job description',
      hint: 'Answers match what they are hiring for',
      done: i.jobDescription.trim().length >= MIN_USEFUL_JD,
      weight: 30,
    },
    {
      key: 'role',
      label: 'Role and organisation',
      hint: 'Answers speak to this exact position',
      done: Boolean(i.role.trim() && i.company.trim()),
      weight: 20,
    },
    { key: 'field', label: 'Field', hint: 'Sets the vocabulary answers use', done: Boolean(i.field.trim()), weight: 10 },
    {
      key: 'style',
      label: 'Answer style',
      hint: 'Answers sound the way you speak',
      done: Boolean(i.instructions.trim()),
      weight: 10,
    },
  ];
  const score = items.reduce((n, it) => n + (it.done ? it.weight : 0), 0);
  return { score, items };
}

// ---- dates ---------------------------------------------------------------------------------------

const DAY = 86_400_000;

/** "in 3 days", "tomorrow", "2 hours ago"… */
export function relative(iso: string, now = Date.now(), style: Intl.RelativeTimeFormatStyle = 'long') {
  const diff = new Date(iso).getTime() - now;
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto', style });
  const abs = Math.abs(diff);
  if (abs < 60_000) return diff >= 0 ? 'in a moment' : 'just now';
  if (abs < 3_600_000) return rtf.format(Math.round(diff / 60_000), 'minute');
  if (abs < DAY) return rtf.format(Math.round(diff / 3_600_000), 'hour');
  if (abs < 30 * DAY) return rtf.format(Math.round(diff / DAY), 'day');
  if (abs < 365 * DAY) return rtf.format(Math.round(diff / (30 * DAY)), 'month');
  return rtf.format(Math.round(diff / (365 * DAY)), 'year');
}

export const formatWhen = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

export const isUpcoming = (i: Pick<Interview, 'scheduledAt' | 'stage'>, now = Date.now()) =>
  Boolean(i.scheduledAt && new Date(i.scheduledAt).getTime() > now - 2 * 3_600_000 && i.stage === 'preparing');

/** ISO → value for <input type="datetime-local"> in the viewer's time zone. */
export function toLocalInput(iso: string | null) {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export const fromLocalInput = (value: string) => (value ? new Date(value).toISOString() : null);

// ---- monogram ------------------------------------------------------------------------------------

const MONOGRAM_GRADIENTS = [
  'from-emerald-400 to-cyan-400',
  'from-cyan-400 to-violet-400',
  'from-violet-400 to-fuchsia-400',
  'from-amber-300 to-rose-400',
  'from-sky-400 to-indigo-400',
  'from-lime-300 to-emerald-400',
];

/** Initials and a stable gradient for an organisation, so each interview is recognisable at a glance. */
export function monogram(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const initials = (words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? '?').slice(0, 2)).toUpperCase();
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return { initials, gradient: MONOGRAM_GRADIENTS[h % MONOGRAM_GRADIENTS.length] };
}
