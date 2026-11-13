import type { FormQuestion } from '@parakeet/shared';
import { answerOf, classifyStatus, first, guarded, norm, parseSecret, request, type HttpResponse } from './http.js';
import type { AtsConnector, SubmissionTask, SubmitResult } from './types.js';

// Workable SPI v3: POST https://{subdomain}.workable.com/spi/v3/jobs/{shortcode}/candidates
// Verified 2026-11-13 against https://workable.readme.io/reference/job-candidates-create,
// https://workable.readme.io/reference/job-questions and https://workable.readme.io/reference/rate-limits:
// - Authorization: Bearer <token>; scope w_candidates (and r_jobs to read the job's questions).
// - Body {candidate, sourced}; sourced=false means the candidate applied (Workable sends its own
//   "thank you for applying" email), which is what happened here, so false.
// - candidate: firstname + lastname (or name), email required; phone, address, headline, summary,
//   cover_letter; resume as {name, data(base64)} or resume_url; social_profiles [{type, url}];
//   education_entries / experience_entries; answers [{question_key, …}] by question type: body
//   (free_text, short_text ≤ 128 chars), checked (boolean), choices [choice ids] (multiple_choice,
//   dropdown), date (ISO 8601), value (numeric), file {name, data}.
// - GET /jobs/{shortcode}/questions: [{id, body, type, required, choices: [{id, body}]}] (the example
//   wraps it in {questions}; both are read).
// - 201 {status: "created", candidate: {id, …}}; 401 {error}; 404 {error}; 422 {error,
//   validation_errors: {field: [msg]}}, e.g. "Validation failed: Email candidate already exists".
// - Rate limit per client per 10 s: account tokens 10, OAuth and partner tokens 50. 429 above it.
//   Every response carries X-Rate-Limit-Limit / -Remaining / -Reset ("timestamp of the next interval").
// Not confirmed by the docs (so handled defensively): whether "already exists" is per job or per
// account (both are treated as a duplicate application, never resent); the unit of X-Rate-Limit-Reset
// (epoch seconds, epoch ms or a date are all accepted); whether the public apply-form field ids our
// forms use (apply.workable.com/api/v1/jobs/{shortcode}/form) equal the SPI question ids (matched by id,
// then by question text; anything unmatched that is required → unsupported_form, the next channel);
// any idempotency key (none documented).
//
// Credential: the employer's token as a bare string when its Workable subdomain equals the board name
// (job_sources.board, the apply.workable.com/{board} account), else JSON {"apiKey", "subdomain"}.

/** Our form keys Workable takes as candidate fields, not answers. */
const STANDARD = new Set(['firstname', 'lastname', 'name', 'email', 'phone', 'address', 'headline', 'summary', 'cover_letter', 'resume']);

interface WkQuestion {
  id: string;
  body: string;
  type: string;
  required?: boolean;
  single_answer?: boolean;
  choices?: { id: string; body: string }[];
}

/** X-Rate-Limit-Reset → ms from now: epoch seconds, epoch ms or an HTTP date. */
export function workableResetMs(headers: Headers, now = Date.now()): number | null {
  const v = headers.get('x-rate-limit-reset');
  if (!v) return null;
  const n = Number(v);
  const at = Number.isFinite(n) ? (n > 1e12 ? n : n * 1000) : Date.parse(v);
  if (!Number.isFinite(at)) return null;
  return Math.min(Math.max(at - now, 1000), 10 * 60_000);
}

function wkApi(secret: string, board: string) {
  const { apiKey, subdomain } = parseSecret(secret) as { apiKey: string; subdomain?: string };
  const sub = (subdomain ?? board).toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]*$/.test(sub)) throw new Error('Invalid Workable subdomain in the credential');
  return { apiKey, base: `https://${sub}.workable.com/spi/v3` };
}

/** Builds the SPI candidate from our prepared answers. Unmappable required questions are listed. */
export function buildWorkableCandidate(task: SubmissionTask, files: Parameters<AtsConnector['submit']>[1], questions: WkQuestion[]) {
  const c = task.candidate;
  const a = (key: string) => first(answerOf(task.answers, key));
  const unsupported: string[] = [];
  const candidate: Record<string, unknown> = {
    firstname: a('firstname') || c.firstName,
    lastname: a('lastname') || c.lastName,
    email: a('email') || c.email,
  };
  const optional: Record<string, string> = {
    phone: a('phone') || c.phone,
    address: a('address') || [c.city, c.country].filter(Boolean).join(', '),
    headline: a('headline'),
    summary: a('summary'),
    cover_letter: a('cover_letter'),
  };
  for (const [k, v] of Object.entries(optional)) if (v) candidate[k] = v;
  candidate.resume = { name: files.resume.name, data: files.resume.data.toString('base64') };
  const social = [
    ['linkedin', c.linkedin],
    ['github', c.github],
  ].filter(([, url]) => url).map(([type, url]) => ({ type, url }));
  if (social.length) candidate.social_profiles = social;

  const byId = new Map(questions.map((q) => [q.id, q]));
  const byText = new Map(questions.map((q) => [norm(q.body), q]));
  const answers: Record<string, unknown>[] = [];
  for (const q of task.form as FormQuestion[]) {
    if (q.kind === 'eeo' || q.kind === 'resume' || STANDARD.has(q.key)) continue;
    // Education/experience groups ("education.school"): not sent through this API.
    if (q.key.includes('.')) {
      if (q.required) unsupported.push(q.label);
      continue;
    }
    const value = answerOf(task.answers, q.key);
    const empty = value === null || (Array.isArray(value) && !value.length) || (!Array.isArray(value) && !value.trim());
    const wq = byId.get(q.key) ?? byText.get(norm(q.label));
    if (!wq) {
      if (q.required) unsupported.push(q.label);
      continue;
    }
    if (empty) {
      if (q.required || wq.required) unsupported.push(q.label);
      continue;
    }
    const answer: Record<string, unknown> = { question_key: wq.id };
    switch (wq.type) {
      case 'boolean':
        answer.checked = /^(yes|true|1)$/i.test(first(value));
        break;
      case 'multiple_choice':
      case 'dropdown': {
        const labels = Array.isArray(value) ? value : [value];
        const ids = labels.map((l) => wq.choices?.find((ch) => norm(ch.body) === norm(l))?.id);
        if (ids.some((id) => !id)) {
          unsupported.push(q.label);
          continue;
        }
        answer.choices = wq.type === 'dropdown' || wq.single_answer ? ids.slice(0, 1) : ids;
        break;
      }
      case 'numeric': {
        const n = Number(first(value).replace(/,/g, '.').replace(/[^\d.-]/g, ''));
        if (!Number.isFinite(n)) {
          unsupported.push(q.label);
          continue;
        }
        answer.value = n;
        break;
      }
      case 'date':
        answer.date = first(value);
        break;
      case 'file':
        if (/cover/i.test(q.label) && files.coverLetter) answer.file = { name: files.coverLetter.name, data: files.coverLetter.data.toString('base64') };
        else {
          if (q.required) unsupported.push(q.label);
          continue;
        }
        break;
      case 'short_text':
        answer.body = first(value).slice(0, 128);
        break;
      default:
        answer.body = Array.isArray(value) ? value.join(', ') : value;
    }
    answers.push(answer);
  }
  if (answers.length) candidate.answers = answers;
  return { candidate, unsupported: [...new Set(unsupported)] };
}

function validationMessage(res: HttpResponse) {
  const body = res.json as { error?: string; validation_errors?: Record<string, string[]> } | null;
  const fields = body?.validation_errors ? Object.entries(body.validation_errors).map(([k, v]) => `${k}: ${v.join(', ')}`).join('; ') : '';
  return [body?.error, fields].filter(Boolean).join(' — ') || res.text;
}

export const workable: AtsConnector = {
  provider: 'workable',
  // Account tokens: 10 requests per 10 s, and each application is two (questions, then the candidate).
  minIntervalMs: 2_000,
  maxConcurrent: 2,
  timeoutMs: 60_000,
  submit: (task, files, secret, opts) =>
    guarded(async (): Promise<SubmitResult> => {
      const timeoutMs = opts.timeoutMs ?? workable.timeoutMs;
      const { apiKey, base } = wkApi(secret, task.board);
      const headers = { authorization: `Bearer ${apiKey}`, accept: 'application/json' };
      const job = `${base}/jobs/${encodeURIComponent(task.externalId)}`;
      const rateLimited = (res: HttpResponse): SubmitResult => {
        const r = classifyStatus(res, validationMessage(res), task.form);
        const reset = workableResetMs(res.headers);
        return r.outcome === 'failed' && !res.headers.get('retry-after') && reset !== null ? { ...r, retryAfterMs: reset } : r;
      };

      // The job's questions (read-only), to turn our answers into Workable's question keys and choice ids.
      let questions: WkQuestion[] = [];
      const custom = task.form.some((q) => q.kind !== 'eeo' && q.kind !== 'resume' && !STANDARD.has(q.key));
      if (custom) {
        // Nothing has been sent yet: any failure here is safe to retry, never "uncertain".
        let res: HttpResponse;
        try {
          res = await request(`${job}/questions`, { method: 'GET', headers }, { ...opts, idempotencyKey: '', timeoutMs });
        } catch (err) {
          return { outcome: 'failed', code: 'network', httpStatus: null, retryable: true, message: `Reading the job's questions failed: ${(err as Error).message}` };
        }
        if (res.status !== 200) {
          const r = rateLimited(res);
          return r.outcome === 'uncertain' ? { outcome: 'failed', code: 'server', httpStatus: res.status, retryable: true, message: r.message } : r;
        }
        const body = res.json as WkQuestion[] | { questions?: WkQuestion[] } | null;
        questions = Array.isArray(body) ? body : (body?.questions ?? []);
      }
      const { candidate, unsupported } = buildWorkableCandidate(task, files, questions);
      if (unsupported.length) {
        return { outcome: 'failed', code: 'unsupported_form', httpStatus: null, retryable: false, message: `Workable's API can't carry: ${unsupported.slice(0, 5).join('; ')}` };
      }
      const res = await request(`${job}/candidates`, {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json', 'idempotency-key': opts.idempotencyKey },
        body: JSON.stringify({ sourced: false, candidate }),
      }, { ...opts, timeoutMs });
      if (res.status >= 200 && res.status < 300) {
        const id = (res.json as { candidate?: { id?: string } } | null)?.candidate?.id;
        if (!id) return { outcome: 'uncertain', httpStatus: res.status, message: `Workable answered HTTP ${res.status} without a candidate id` };
        return { outcome: 'submitted', externalId: String(id), httpStatus: res.status, evidence: `Workable candidate ${id} created` };
      }
      return rateLimited(res);
    }),
};
