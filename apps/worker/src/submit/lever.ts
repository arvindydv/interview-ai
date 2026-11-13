import { answerOf, classifyStatus, first, guarded, parseSecret, request } from './http.js';
import type { AtsConnector, SubmitResult } from './types.js';

// Lever Postings API: POST https://api.lever.co/v0/postings/{site}/{postingId}?key={API_KEY}
// (EU accounts: api.eu.lever.co; set {"apiKey": "...", "region": "eu"} as the credential).
// Verified 2026-11-13 against https://github.com/lever/postings-api ("Apply to a job posting"):
// - the employer's API key (Super Admin, Settings → Integrations → API) as ?key=
// - multipart/form-data is the only way to send a resume file
// - name and email required; phone, org, urls[...], comments; consent[...] optional
// - success: 200 {ok: true, applicationId}; errors: {ok: false, error}
// - 429 above 2 application POSTs a second: retry, queue, or send people to the hosted form
// - custom posting questions are NOT exposed through the API, so a form with required custom
//   questions can't be sent this way (unsupported_form → the next channel)
// - no idempotency key; candidates are merged by email.

const KNOWN = new Set(['name', 'email', 'phone', 'org', 'comments', 'urls[LinkedIn]', 'urls[GitHub]', 'urls[Portfolio]', 'urls[Twitter]', 'urls[Other]']);

export const lever: AtsConnector = {
  provider: 'lever',
  // 2/s documented; stay under it.
  minIntervalMs: 600,
  timeoutMs: 60_000,
  submit: (task, files, secret, opts) =>
    guarded(async (): Promise<SubmitResult> => {
      const { apiKey, region } = parseSecret(secret) as { apiKey: string; region?: string };
      const unsupported = task.form
        .filter((q) => q.required && q.kind !== 'resume' && q.kind !== 'eeo' && !KNOWN.has(q.key) && q.key !== 'location')
        .map((q) => q.label);
      if (unsupported.length) {
        return { outcome: 'failed', code: 'unsupported_form', httpStatus: null, retryable: false, message: `Lever's API doesn't take custom questions: ${unsupported.slice(0, 5).join('; ')}` };
      }
      const c = task.candidate;
      const fd = new FormData();
      fd.append('name', first(answerOf(task.answers, 'name')) || `${c.firstName} ${c.lastName}`.trim());
      fd.append('email', first(answerOf(task.answers, 'email')) || c.email);
      const phone = first(answerOf(task.answers, 'phone')) || c.phone;
      if (phone) fd.append('phone', phone);
      const org = first(answerOf(task.answers, 'org'));
      if (org) fd.append('org', org);
      const urls: Record<string, string> = {
        LinkedIn: first(answerOf(task.answers, 'urls[LinkedIn]')) || c.linkedin,
        GitHub: first(answerOf(task.answers, 'urls[GitHub]')) || c.github,
        Portfolio: first(answerOf(task.answers, 'urls[Portfolio]')) || c.portfolio,
        Other: first(answerOf(task.answers, 'urls[Other]')) || c.website,
      };
      for (const [k, v] of Object.entries(urls)) if (v) fd.append(`urls[${k}]`, v);
      const comments = first(answerOf(task.answers, 'comments'));
      if (comments) fd.append('comments', comments);
      fd.append('resume', new Blob([new Uint8Array(files.resume.data)], { type: files.resume.mime }), files.resume.name);

      const host = region === 'eu' ? 'https://api.eu.lever.co' : 'https://api.lever.co';
      const url = `${host}/v0/postings/${encodeURIComponent(task.board)}/${encodeURIComponent(task.externalId)}?key=${encodeURIComponent(apiKey)}`;
      const res = await request(url, { method: 'POST', body: fd }, { ...opts, timeoutMs: opts.timeoutMs ?? lever.timeoutMs });
      const body = res.json as { ok?: boolean; applicationId?: string; error?: string } | null;
      if (res.status >= 200 && res.status < 300 && body?.ok !== false) {
        if (!body?.applicationId) return { outcome: 'uncertain', httpStatus: res.status, message: 'Lever answered OK without an applicationId' };
        return { outcome: 'submitted', externalId: body.applicationId, httpStatus: res.status, evidence: `Lever applicationId ${body.applicationId}` };
      }
      return classifyStatus(res.status < 300 ? { ...res, status: 400 } : res, body?.error ?? res.text, task.form);
    }),
};
