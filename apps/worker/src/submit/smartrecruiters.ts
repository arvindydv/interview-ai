import { answerOf, classifyStatus, first, guarded, parseSecret, request } from './http.js';
import type { AtsConnector, SubmitResult } from './types.js';

// SmartRecruiters Application API: POST https://api.smartrecruiters.com/postings/{uuid}/candidates
// Verified 2026-11-13 against https://developers.smartrecruiters.com/docs/application-api and
// https://developers.smartrecruiters.com/docs/partners-post-an-application:
// - every endpoint authenticated (X-SmartToken API key, or OAuth with scope candidate_applications_manage)
// - JSON: firstName, lastName, email required; phoneNumber, web {linkedIn, website}, resume and
//   attachments as {fileName, mimeType, fileContent (base64)} up to 2 MB; answers required only when
//   the posting has required screening questions; consentDecisions (missing keys default to false)
// - success: {id (candidate), applicationId, createdOn}
// - 8 concurrent requests, 429 above; use a request timeout of at least 128 s
// - error codes (incl. duplicates) are not documented.
// Screening questions: their answer format needs each question's field ids. When the posting's
// configuration has required questions, this connector does not guess: unsupported_form → next channel.
// Consent is not asserted on the candidate's behalf (consentDecisions omitted).

const API = 'https://api.smartrecruiters.com';
const MAX_FILE = 2 * 1024 * 1024;

export const smartrecruiters: AtsConnector = {
  provider: 'smartrecruiters',
  minIntervalMs: 250,
  // 8 concurrent documented; stay under it.
  maxConcurrent: 4,
  timeoutMs: 130_000,
  submit: (task, files, secret, opts) =>
    guarded(async (): Promise<SubmitResult> => {
      const timeoutMs = opts.timeoutMs ?? smartrecruiters.timeoutMs;
      const { apiKey } = parseSecret(secret);
      const headers = { 'x-smarttoken': apiKey, 'content-type': 'application/json', accept: 'application/json' };
      const posting = encodeURIComponent(task.externalId);

      const conf = await request(`${API}/postings/${posting}/configuration`, { method: 'GET', headers }, { idempotencyKey: '', fetch: opts.fetch, timeoutMs });
      if (conf.status === 404 || conf.status === 410) return { outcome: 'failed', code: 'closed', httpStatus: conf.status, retryable: false, message: 'Posting not found' };
      if (conf.status === 401 || conf.status === 403) return classifyStatus(conf, 'Configuration refused the credential', task.form);
      const questions = (conf.json as { questions?: { id: string; label?: string; required?: boolean }[] } | null)?.questions ?? [];
      const required = questions.filter((q) => q.required);
      if (required.length) {
        return { outcome: 'failed', code: 'unsupported_form', httpStatus: null, retryable: false, message: `Screening questions need the employer form: ${required.map((q) => q.label ?? q.id).slice(0, 5).join('; ')}` };
      }
      if (files.resume.data.length > MAX_FILE) {
        return { outcome: 'failed', code: 'unsupported_form', httpStatus: null, retryable: false, message: 'Resume is over SmartRecruiters’ 2 MB limit' };
      }

      const c = task.candidate;
      const body: Record<string, unknown> = {
        firstName: first(answerOf(task.answers, 'firstName')) || c.firstName,
        lastName: first(answerOf(task.answers, 'lastName')) || c.lastName,
        email: first(answerOf(task.answers, 'email')) || c.email,
        resume: { fileName: files.resume.name, mimeType: files.resume.mime, fileContent: files.resume.data.toString('base64') },
      };
      const phone = first(answerOf(task.answers, 'phone')) || c.phone;
      if (phone) body.phoneNumber = phone;
      const web: Record<string, string> = {};
      const linkedin = first(answerOf(task.answers, 'linkedin')) || c.linkedin;
      if (linkedin) web.linkedIn = linkedin;
      if (c.website || c.portfolio) web.website = c.website || c.portfolio;
      if (Object.keys(web).length) body.web = web;
      if (files.coverLetter && files.coverLetter.data.length <= MAX_FILE) {
        body.attachments = [{ fileName: files.coverLetter.name, mimeType: files.coverLetter.mime, fileContent: files.coverLetter.data.toString('base64') }];
      }

      const res = await request(`${API}/postings/${posting}/candidates`, {
        method: 'POST',
        headers: { ...headers, 'idempotency-key': opts.idempotencyKey },
        body: JSON.stringify(body),
      }, { ...opts, timeoutMs });
      const out = res.json as { id?: string; applicationId?: string; message?: string; errors?: { message?: string; code?: string }[] } | null;
      if (res.status >= 200 && res.status < 300) {
        const id = out?.applicationId ?? out?.id ?? null;
        if (!id) return { outcome: 'uncertain', httpStatus: res.status, message: 'SmartRecruiters answered OK without an id' };
        return { outcome: 'submitted', externalId: id, httpStatus: res.status, evidence: `SmartRecruiters application ${id}` };
      }
      return classifyStatus(res, out?.message ?? (out?.errors ?? []).map((e) => e.message ?? e.code).join('; ') ?? res.text, task.form);
    }),
};
