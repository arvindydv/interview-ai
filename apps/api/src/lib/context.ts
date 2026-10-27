import { ROUND_TYPES, renderResumeProfile, type ResumeProfile, type RoundType } from '@parakeet/shared';
import { sql } from './db.js';

/** Resume text included verbatim alongside the structured profile, so no detail is lost. */
const MAX_RESUME_TEXT_IN_PROMPT = 15_000;

export interface InterviewContext {
  /** Rendered block placed after the fixed system prompt (the "Interview Pack", spec A4). */
  text: string;
  hasResume: boolean;
  hasJobDescription: boolean;
  /** The active interview, if the user has one. */
  interviewId: string | null;
  field: string;
  company: string;
  role: string;
}


/**
 * Loads the user's active interview and latest resume and renders them as one block.
 * Output is deterministic for unchanged data, so the provider's prompt cache keeps hitting across turns.
 * Returns null when the user hasn't prepared anything.
 */
export async function loadInterviewContext(userId: string): Promise<InterviewContext | null> {
  const [row] = await sql<
    {
      interview_id: string | null;
      field: string | null;
      company: string | null;
      role: string | null;
      round_type: RoundType | null;
      jd_text: string | null;
      instructions: string | null;
      resume_text: string | null;
      parsed_json: ResumeProfile | null;
    }[]
  >`
    select i.id as interview_id, i.field, i.company, i.role, i.round_type, i.jd_text, i.instructions, r.text as resume_text, r.parsed_json
    from (select 1) one
    left join lateral (
      select id, field, company, role, round_type, jd_text, instructions from public.interview_sessions
      where user_id = ${userId} order by active_at desc limit 1
    ) i on true
    left join lateral (
      select text, parsed_json from public.resumes
      where user_id = ${userId} order by created_at desc limit 1
    ) r on true`;

  const field = row?.field?.trim() ?? '';
  const company = row?.company?.trim() ?? '';
  const role = row?.role?.trim() ?? '';
  const jd = row?.jd_text?.trim() ?? '';
  const instructions = row?.instructions?.trim() ?? '';
  const resumeText = row?.resume_text ?? '';
  if (!field && !company && !role && !jd && !instructions && !resumeText) return null;

  const parts: (string | false | undefined)[] = [];
  if (field || company || role || jd) {
    const round = ROUND_TYPES.find((r) => r.id === row?.round_type)?.label;
    parts.push(
      '<target_interview>',
      field && `Field: ${field}`,
      company && `Organisation: ${company}`,
      role && `Role: ${role}`,
      round && `Round: ${round}`,
      jd && `Job description:\n${jd}`,
      '</target_interview>',
    );
  }
  if (resumeText) {
    if (row?.parsed_json) parts.push('<candidate_profile>', renderResumeProfile(row.parsed_json), '</candidate_profile>');
    parts.push('<resume_text>', resumeText.slice(0, MAX_RESUME_TEXT_IN_PROMPT), '</resume_text>');
  }

  const candidate = parts.length ? `<candidate_context>\n${parts.filter(Boolean).join('\n')}\n</candidate_context>` : '';
  // Kept outside <candidate_context>, whose embedded instructions the model is told to ignore.
  const preferences = instructions && `<answer_preferences>\n${instructions}\n</answer_preferences>`;
  return {
    text: [candidate, preferences].filter(Boolean).join('\n\n'),
    hasResume: Boolean(resumeText),
    hasJobDescription: Boolean(jd),
    interviewId: row?.interview_id ?? null,
    field,
    company,
    role,
  };
}
