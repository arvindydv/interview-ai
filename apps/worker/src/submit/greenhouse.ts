import type { FormQuestion } from '@parakeet/shared';
import { answerOf, basicAuth, classifyStatus, first, guarded, norm, parseSecret, request } from './http.js';
import type { AtsConnector, SubmissionTask, SubmitResult } from './types.js';

// Greenhouse Job Board API: POST https://boards-api.greenhouse.io/v1/boards/{board}/jobs/{id}
// Verified 2026-11-13 against https://docs.greenhouse.io/job-board.html ("Submit an application"):
// - HTTP Basic with the employer's Job Board API key as the username, no password.
// - multipart/form-data (used here: files go in directly) or JSON.
// - first_name, last_name, email required; phone, location; resume / cover_letter files;
//   custom questions as question_{id}; multi-value as question_{id}[] in multipart; selects take the
//   answer option's value (id), not its label.
// - "Validation for required fields must be done on the client side"; attachments pdf/doc/docx/txt/rtf.
// Not documented there (so not relied on): the success body, error codes, rate limits, idempotency.
// Any 2xx counts as accepted; the option ids come from the public read-only GET ?questions=true.

const API = 'https://boards-api.greenhouse.io/v1/boards';

/** Keys on our form that are UI-only (we add them, or they need Greenhouse's own ids). */
const EDUCATION = /^(school|degree|discipline|start-month|start-year|end-month|end-year)--\d+$/;
const SKIP = new Set(['country']);

interface GhQuestion {
  required: boolean;
  label: string;
  fields: { name: string; type: string; values?: { label: string; value: number | string }[] }[];
}

/** label → value for every select field, from the public posting (read-only). */
async function optionValues(task: SubmissionTask, f: typeof fetch | undefined, timeoutMs: number) {
  const out = new Map<string, Map<string, string>>();
  const res = await request(`${API}/${encodeURIComponent(task.board)}/jobs/${encodeURIComponent(task.externalId)}?questions=true`, { method: 'GET' }, {
    idempotencyKey: '', fetch: f, timeoutMs,
  });
  if (res.status === 404) return null;
  const body = res.json as { questions?: GhQuestion[]; location_questions?: GhQuestion[] } | null;
  for (const q of [...(body?.questions ?? []), ...(body?.location_questions ?? [])]) {
    for (const field of q.fields) {
      if (field.values?.length) out.set(field.name, new Map(field.values.map((v) => [norm(v.label), String(v.value)])));
    }
  }
  return out;
}

export function buildGreenhouseForm(task: SubmissionTask, files: Parameters<AtsConnector['submit']>[1], options: Map<string, Map<string, string>>) {
  const fd = new FormData();
  const unsupported: string[] = [];
  const c = task.candidate;
  const std: Record<string, string> = {
    first_name: first(answerOf(task.answers, 'first_name')) || c.firstName,
    last_name: first(answerOf(task.answers, 'last_name')) || c.lastName,
    email: first(answerOf(task.answers, 'email')) || c.email,
    phone: first(answerOf(task.answers, 'phone')) || c.phone,
  };
  for (const [k, v] of Object.entries(std)) if (v) fd.append(k, v);
  fd.append('resume', new Blob([new Uint8Array(files.resume.data)], { type: files.resume.mime }), files.resume.name);

  for (const q of task.form as FormQuestion[]) {
    if (q.kind === 'eeo' || q.kind === 'resume' || q.key in std || SKIP.has(q.key)) continue;
    const value = answerOf(task.answers, q.key);
    if (EDUCATION.test(q.key)) {
      if (q.required) unsupported.push(q.label);
      continue;
    }
    if (q.type === 'file') {
      if (q.key === 'cover_letter' || /cover/i.test(q.label)) {
        if (files.coverLetter) fd.append(q.key, new Blob([new Uint8Array(files.coverLetter.data)], { type: files.coverLetter.mime }), files.coverLetter.name);
        else if (q.required) unsupported.push(q.label);
      } else if (q.required) unsupported.push(q.label);
      continue;
    }
    if (value === null || (Array.isArray(value) && !value.length)) continue;
    const map = options.get(q.key) ?? options.get(q.key.replace(/\[\]$/, ''));
    const toValue = (label: string) => (map ? map.get(norm(label)) : label);
    if (q.type === 'multiselect') {
      const name = q.key.endsWith('[]') ? q.key : `${q.key}[]`;
      for (const label of Array.isArray(value) ? value : [value]) {
        const v = toValue(label);
        if (v === undefined) unsupported.push(q.label);
        else fd.append(name, v);
      }
    } else {
      const v = q.type === 'select' || q.type === 'checkbox' ? toValue(first(value)) : first(value);
      if (v === undefined) unsupported.push(q.label);
      else fd.append(q.key, v);
    }
  }
  return { fd, unsupported: [...new Set(unsupported)] };
}

export const greenhouse: AtsConnector = {
  provider: 'greenhouse',
  minIntervalMs: 1000,
  timeoutMs: 60_000,
  submit: (task, files, secret, opts) =>
    guarded(async (): Promise<SubmitResult> => {
      const timeoutMs = opts.timeoutMs ?? greenhouse.timeoutMs;
      const { apiKey } = parseSecret(secret);
      const options = await optionValues(task, opts.fetch, timeoutMs).catch(() => new Map<string, Map<string, string>>());
      if (!options) return { outcome: 'failed', code: 'closed', httpStatus: 404, retryable: false, message: 'The posting is no longer on the board.' };
      const { fd, unsupported } = buildGreenhouseForm(task, files, options);
      if (unsupported.length) {
        return { outcome: 'failed', code: 'unsupported_form', httpStatus: null, retryable: false, message: `Greenhouse's API can't carry: ${unsupported.slice(0, 5).join('; ')}` };
      }
      const res = await request(`${API}/${encodeURIComponent(task.board)}/jobs/${encodeURIComponent(task.externalId)}`, {
        method: 'POST',
        headers: { authorization: basicAuth(apiKey), 'idempotency-key': opts.idempotencyKey },
        body: fd,
      }, { ...opts, timeoutMs });
      if (res.status >= 200 && res.status < 300) {
        const body = res.json as { id?: number | string; application_id?: number | string; success?: string; error?: string } | null;
        if (body?.error) return classifyStatus({ ...res, status: 400 }, body.error, task.form);
        const id = body?.application_id ?? body?.id ?? null;
        return { outcome: 'submitted', externalId: id === null ? null : String(id), httpStatus: res.status, evidence: `Greenhouse accepted the application (HTTP ${res.status})` };
      }
      const err = res.json as { error?: string; message?: string; errors?: unknown } | null;
      return classifyStatus(res, err?.error ?? err?.message ?? (err?.errors ? JSON.stringify(err.errors) : res.text), task.form);
    }),
};
