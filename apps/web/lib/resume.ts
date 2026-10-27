import { PROFILE_LIMITS, RESUME_TYPES, type ResumeProfile, type ResumeUpload } from '@parakeet/shared';
import type { ReadinessItem } from '@/lib/interviews';

export const ACCEPT = '.pdf,.docx,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown';

const EXTENSIONS = ['pdf', 'docx', 'txt', 'md'];

/** Checks a picked file before uploading; returns why it can't be used, or null. */
export function fileProblem(file: File) {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (!RESUME_TYPES[file.type] && !EXTENSIONS.includes(ext)) {
    return ext === 'doc' ? 'Old .doc files aren’t supported. Save it as .docx or PDF and try again.' : 'Upload a PDF, DOCX or TXT file.';
  }
  if (file.size > PROFILE_LIMITS.maxResumeBytes) return 'Resumes can be up to 5 MB.';
  if (file.size === 0) return 'This file is empty.';
  return null;
}

export async function toUpload(file: File): Promise<ResumeUpload> {
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''));
    reader.onerror = () => reject(new Error('Could not read the file.'));
    reader.readAsDataURL(file);
  });
  return { fileName: file.name, mimeType: file.type, data };
}

export const formatBytes = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

const hasNumber = (s: string | null | undefined) => Boolean(s && /\d/.test(s));

/** How well the profile equips live answers: concrete numbers and stories make answers credible. */
export function profileStrength(p: ResumeProfile) {
  const metricLines = [...p.experience.flatMap((e) => e.highlights), ...p.projects.map((pr) => pr.impact)].filter(hasNumber).length;
  const items: ReadinessItem[] = [
    { key: 'summary', label: 'Introduction', hint: 'Your “tell me about yourself” opener', done: p.summary.trim().length >= 80, weight: 20 },
    { key: 'skills', label: 'At least 8 skills', hint: `${p.skills.length} so far`, done: p.skills.length >= 8, weight: 15 },
    {
      key: 'metrics',
      label: 'Results with numbers',
      hint: `${metricLines} of 3: numbers make answers credible`,
      done: metricLines >= 3,
      weight: 25,
    },
    { key: 'stories', label: 'At least 3 STAR stories', hint: `${p.stories.length} so far, for behavioural questions`, done: p.stories.length >= 3, weight: 25 },
    {
      key: 'education',
      label: 'Education or certifications',
      hint: 'Answers can cite your qualifications',
      done: p.education.length + (p.certifications?.length ?? 0) > 0,
      weight: 15,
    },
  ];
  return { score: items.reduce((n, it) => n + (it.done ? it.weight : 0), 0), items };
}

/** Profiles analysed before certifications existed don't have the key. */
export const normalize = (p: ResumeProfile): ResumeProfile => ({ ...p, certifications: p.certifications ?? [] });
