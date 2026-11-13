import { answerOf, basicAuth, classifyStatus, guarded, norm, parseSecret, request } from './http.js';
import type { AtsConnector, SubmitResult } from './types.js';

// Ashby: POST https://api.ashbyhq.com/applicationForm.submit
// Verified 2026-11-13 against https://developers.ashbyhq.com/reference/applicationformsubmit and
// https://developers.ashbyhq.com/docs/creating-a-custom-careers-page:
// - HTTP Basic with the employer's API key; needs the candidatesWrite permission
// - body: jobPostingId, applicationForm.fieldSubmissions [{path, value}], allowSubmissionForUnpublishedJobPosting
// - multipart/form-data: applicationForm is a JSON-encoded string; a File field's value names another
//   part holding the file (any unique string, e.g. "resume_1")
// - success: {success: true, results: {submittedFormInstance: {id, …}}}; failure: {success: false, errors: [{message}]}
//   (an error can come back with HTTP 200, so the body decides). No applicationId in the response.
// - rate limits and idempotency: not documented.
// Select values: Ashby takes the option's value; they come from jobPosting.info (authenticated, read-only).

const API = 'https://api.ashbyhq.com';

interface AshbyFieldDef { path: string; type: string; selectableValues?: { label: string; value: string }[] | null }

async function optionValues(postingId: string, apiKey: string, f: typeof fetch | undefined, timeoutMs: number) {
  const out = new Map<string, { type: string; values: Map<string, string> }>();
  const res = await request(`${API}/jobPosting.info`, {
    method: 'POST',
    headers: { authorization: basicAuth(apiKey), 'content-type': 'application/json' },
    body: JSON.stringify({ jobPostingId: postingId, expandApplicationFormDefinition: true }),
  }, { idempotencyKey: '', fetch: f, timeoutMs });
  const body = res.json as { success?: boolean; results?: { applicationFormDefinition?: { sections?: { fields?: { field: AshbyFieldDef }[] }[] } } } | null;
  for (const s of body?.results?.applicationFormDefinition?.sections ?? []) {
    for (const { field } of s.fields ?? []) {
      out.set(field.path, { type: field.type, values: new Map((field.selectableValues ?? []).map((v) => [norm(v.label), v.value])) });
    }
  }
  return out;
}

export const ashby: AtsConnector = {
  provider: 'ashby',
  minIntervalMs: 1000,
  timeoutMs: 60_000,
  submit: (task, files, secret, opts) =>
    guarded(async (): Promise<SubmitResult> => {
      const timeoutMs = opts.timeoutMs ?? ashby.timeoutMs;
      const { apiKey } = parseSecret(secret);
      const defs = await optionValues(task.externalId, apiKey, opts.fetch, timeoutMs).catch(() => new Map<string, { type: string; values: Map<string, string> }>());
      const fd = new FormData();
      const submissions: { path: string; value: unknown }[] = [];
      const unsupported: string[] = [];
      const c = task.candidate;
      for (const q of task.form) {
        if (q.kind === 'eeo') continue;
        if (q.type === 'file') {
          const file = q.kind === 'resume' ? files.resume : /cover/i.test(q.label) ? files.coverLetter : null;
          if (file) {
            const part = q.kind === 'resume' ? 'resume_1' : 'cover_letter_1';
            fd.append(part, new Blob([new Uint8Array(file.data)], { type: file.mime }), file.name);
            submissions.push({ path: q.key, value: part });
          } else if (q.required) unsupported.push(q.label);
          continue;
        }
        let value = answerOf(task.answers, q.key);
        if (value === null) {
          if (q.key === '_systemfield_name') value = `${c.firstName} ${c.lastName}`.trim();
          else if (q.key === '_systemfield_email') value = c.email;
          else continue;
        }
        const def = defs.get(q.key);
        const toValue = (label: string) => (def?.values.size ? def.values.get(norm(label)) : label);
        if (q.type === 'checkbox' || def?.type === 'Boolean') {
          submissions.push({ path: q.key, value: /^(yes|true)$/i.test(String(Array.isArray(value) ? value[0] : value)) });
        } else if (q.type === 'multiselect') {
          const vals = (Array.isArray(value) ? value : [value]).map(toValue);
          if (vals.some((v) => v === undefined)) unsupported.push(q.label);
          else submissions.push({ path: q.key, value: vals });
        } else if (q.type === 'select') {
          const v = toValue(Array.isArray(value) ? value[0] : value);
          if (v === undefined) unsupported.push(q.label);
          else submissions.push({ path: q.key, value: v });
        } else if (q.type === 'number') {
          submissions.push({ path: q.key, value: Number(Array.isArray(value) ? value[0] : value) });
        } else {
          submissions.push({ path: q.key, value: Array.isArray(value) ? value.join(', ') : value });
        }
      }
      if (unsupported.length) {
        return { outcome: 'failed', code: 'unsupported_form', httpStatus: null, retryable: false, message: `Couldn’t map for Ashby’s API: ${[...new Set(unsupported)].slice(0, 5).join('; ')}` };
      }
      fd.append('jobPostingId', task.externalId);
      // Never to an unpublished posting: the job is gone.
      fd.append('allowSubmissionForUnpublishedJobPosting', 'false');
      fd.append('applicationForm', JSON.stringify({ fieldSubmissions: submissions }));
      const res = await request(`${API}/applicationForm.submit`, {
        method: 'POST',
        headers: { authorization: basicAuth(apiKey), 'idempotency-key': opts.idempotencyKey },
        body: fd,
      }, { ...opts, timeoutMs });
      const body = res.json as { success?: boolean; results?: { submittedFormInstance?: { id?: string } }; errors?: ({ message?: string } | string)[] } | null;
      if (res.status >= 200 && res.status < 300) {
        if (body?.success === true) {
          const id = body.results?.submittedFormInstance?.id ?? null;
          return { outcome: 'submitted', externalId: id, httpStatus: res.status, evidence: `Ashby accepted the application${id ? ` (form instance ${id})` : ''}` };
        }
        const message = (body?.errors ?? []).map((e) => (typeof e === 'string' ? e : e.message ?? '')).join('; ') || 'Ashby said the submission did not succeed';
        if (/unpublished|not found|no longer|closed/i.test(message)) return { outcome: 'failed', code: 'closed', httpStatus: res.status, retryable: false, message };
        if (/permission|unauthori[sz]ed|forbidden|api key/i.test(message)) return { outcome: 'failed', code: 'auth', httpStatus: res.status, retryable: false, message };
        return classifyStatus({ ...res, status: 400 }, message, task.form);
      }
      return classifyStatus(res, (body?.errors ?? []).map((e) => (typeof e === 'string' ? e : e.message ?? '')).join('; ') || res.text, task.form);
    }),
};
