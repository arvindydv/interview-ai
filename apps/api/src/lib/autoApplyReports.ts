import type { FastifyBaseLogger } from 'fastify';
import { verifySubmission, type AutoApplyChannels, type AutoApplyProvider, type AutoApplyReason, type AutoApplyReport, type FormQuestion } from '@parakeet/shared';
import { sql } from './db.js';
import { queueAutoApply } from './queues.js';

// What a job board said about one Auto Apply submission, recorded the same way whoever sent it: the
// Friday extension in the user's browser (routes/autoApply.ts) or Friday's servers (routes/applier.ts).
//
// Never twice: once the submit button was pressed, an application never goes back to Prepared. Unless
// the job board confirmed it or showed the form again with fields to fix, it waits as "unverified" for
// the user to confirm.

/** Submission attempts before an application is marked Failed. */
const MAX_SUBMIT_ATTEMPTS = 3;
/** A browser seen this recently is taken to be running the extension, so Friday's servers hand work to it. */
const BROWSER_ACTIVE_DAYS = 3;

export type SubmittedVia = 'browser' | 'cloud' | 'user';

export interface ReportedApplication {
  id: string;
  user_id: string;
  provider: AutoApplyProvider;
  listing_id: string | null;
  form: FormQuestion[] | null;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export async function event(applicationId: string, userId: string, kind: string, message: string, detail?: unknown) {
  await sql`
    insert into public.auto_apply_events (application_id, user_id, kind, message, detail)
    values (${applicationId}, ${userId}, ${kind}, ${message}, ${detail === undefined ? null : sql.json(detail as never)})`;
}

/** A submitted application shows in the user's Applied list. */
export async function markApplied(userId: string, listingId: string | null) {
  if (!listingId) return;
  await sql`
    insert into public.job_applications (user_id, listing_id, title, company, location, apply_url, status, applied_at)
    select ${userId}, l.id, l.title, l.company, l.location, l.apply_url, 'applied', now()
    from public.job_listings l where l.id = ${listingId}
    on conflict (user_id, listing_id) do update set
      status = case when job_applications.status = 'saved' then 'applied' else job_applications.status end,
      applied_at = coalesce(job_applications.applied_at, now()), updated_at = now()`;
}

/** Whether the user has a browser running the Friday extension to hand an application to. */
async function hasBrowser(userId: string) {
  const [row] = await sql<{ n: number }[]>`
    select count(*)::int as n from public.auto_apply_devices
    where user_id = ${userId} and revoked_at is null and last_seen_at > now() - make_interval(days => ${BROWSER_ACTIVE_DAYS})`;
  return row.n > 0;
}

const UNVERIFIED = 'Sent, but we couldn’t see the job board’s confirmation. Check your email for one, then confirm it here.';

/**
 * Records a report. via: who sent it. clicked: the job board's submit button was pressed. claim: for
 * Friday's servers, the claim it holds; a report for a claim that lapsed changes nothing.
 * Returns the application's new status, or null when the claim had lapsed.
 */
export async function applyReport(
  app: ReportedApplication,
  report: AutoApplyReport,
  opts: { via: 'browser' | 'cloud'; clicked: boolean; claim?: string },
  log: FastifyBaseLogger,
): Promise<string | null> {
  const userId = app.user_id;
  const { evidence, unanswered, message } = report;
  const cloud = opts.via === 'cloud';
  const who = cloud ? 'Friday’s servers' : 'your browser';
  const notify = () => queueAutoApply('autoapply.notify', { userId }, log);
  const set = async (status: string, code: AutoApplyReason | null, reason: string | null, extra = sql``) => {
    const [row] = await sql<{ id: string }[]>`
      update public.auto_applications
      set status = ${status}, reason_code = ${code}, reason = ${reason}, claimed_by = null, claimed_at = null,
          evidence = ${evidence ? sql.json(evidence as never) : null}, updated_at = now() ${extra}
      where id = ${app.id} ${opts.claim ? sql`and claimed_by = ${opts.claim}` : sql``}
      returning id`;
    return Boolean(row);
  };
  const unverified = async (why: string) => {
    if (!(await set('pending', 'unverified', UNVERIFIED, sql`, submitted_via = ${opts.via}`))) return null;
    await event(app.id, userId, 'unverified', why, { url: evidence?.url, message, via: opts.via });
    await notify();
    return 'pending';
  };

  // Sent: counts only with the job board's confirmation.
  if (report.outcome === 'submitted') {
    if (verifySubmission(app.provider, evidence)) {
      if (!(await set('submitted', null, null, sql`, submitted_at = now(), submitted_via = ${opts.via}`))) return null;
      await event(app.id, userId, 'submitted', `Submitted by ${who}; the job board confirmed it`, { url: evidence!.url, via: opts.via });
      await markApplied(userId, app.listing_id);
      return 'submitted';
    }
    return unverified('No confirmation seen after submitting');
  }

  if (report.outcome === 'captcha' || report.outcome === 'login_required') {
    const what = report.outcome === 'captcha' ? 'a CAPTCHA check' : 'a sign-in';
    // Friday's servers stop before a check, so nothing was sent: the user's browser can do it.
    if (cloud && (await hasBrowser(userId))) {
      if (!(await set('prepared', null, null, sql`, needs_browser = true, submit_clicked_at = null`))) return null;
      await event(app.id, userId, 'handed_to_browser', `The job board asked Friday’s servers for ${what}; your browser will submit it`, { reason: report.outcome });
      return 'prepared';
    }
    const reason = cloud
      ? report.outcome === 'captcha'
        ? 'The job board asked for a CAPTCHA check. Connect the Friday extension to finish it in your browser, or apply yourself and confirm it here.'
        : 'The job board wants you to sign in before applying. Connect the Friday extension, or apply yourself and confirm it here.'
      : report.outcome === 'captcha'
        ? 'The job board asked for a CAPTCHA check. Open it in your browser to finish, or try again later.'
        : 'The job board wants you to sign in before applying.';
    if (!(await set('pending', report.outcome, reason, cloud ? sql`, needs_browser = true, submit_clicked_at = null` : sql``))) return null;
    await event(app.id, userId, report.outcome, message ?? reason, { via: opts.via });
    await notify();
    return 'pending';
  }

  if (report.outcome === 'needs_answers') {
    // The job board showed the form again with fields to fix: it doesn't have the application. Questions
    // the form we read didn't list are added to it, so the user can answer them and they're filled by label.
    const form = [...(app.form ?? [])];
    const keys: string[] = [];
    for (const label of (unanswered ?? []).map((l) => l.replace(/[*✱]\s*$/, '').trim()).filter(Boolean)) {
      const known = form.find((q) => norm(q.label) === norm(label));
      if (known) keys.push(known.key);
      else {
        const q: FormQuestion = { key: `extra:${norm(label).slice(0, 80)}`, label, type: 'text', required: true, options: [], kind: 'custom' };
        form.push(q);
        keys.push(q.key);
      }
    }
    const reason = `Needs your answer: ${(unanswered ?? []).slice(0, 3).join('; ') || 'a question on the form'}`;
    if (!(await set('pending', 'needs_answers', reason, sql`, missing = ${keys}, form = ${sql.json(form as never)}, submit_clicked_at = null`))) return null;
    await event(app.id, userId, 'needs_answers', 'The form had questions we couldn’t answer', { unanswered, via: opts.via });
    await notify();
    return 'pending';
  }

  // failed. After the submit button, the job board may still have it: never sent again.
  if (opts.clicked) return unverified(`Stopped after submitting: ${message ?? 'no confirmation'}`);
  const [{ n }] = await sql<{ n: number }[]>`
    select count(*)::int as n from public.auto_apply_events
    where application_id = ${app.id} and kind = 'submit_failed'
      -- Failures before the user's last Retry don't count.
      and id > coalesce((select max(id) from public.auto_apply_events where application_id = ${app.id} and kind = 'retry'), 0)`;
  if (n + 1 >= MAX_SUBMIT_ATTEMPTS) {
    if (!(await set('failed', 'submit_failed', `Couldn’t submit after ${MAX_SUBMIT_ATTEMPTS} tries${message ? `: ${message}` : ''}.`))) return null;
    await event(app.id, userId, 'submit_failed', message ?? 'Submitting failed', { url: evidence?.url, via: opts.via });
    return 'failed';
  }
  // Try others first: 30 minutes after the first failure, an hour after the second. After the servers
  // fail, the user's browser (when there is one) tries next.
  const browserNext = cloud ? await hasBrowser(userId) : null;
  const extra = sql`, retry_at = now() + make_interval(mins => ${30 * (n + 1)}), submit_clicked_at = null
    ${browserNext ? sql`, needs_browser = true` : sql``}`;
  if (!(await set('prepared', null, null, extra))) return null;
  await event(app.id, userId, 'submit_failed', `${cloud ? 'Friday’s servers' : 'Your browser'} couldn’t submit it: ${message ?? 'unknown error'}`, {
    url: evidence?.url,
    via: opts.via,
  });
  return 'prepared';
}

/** Who sent Auto Apply's applications in the last `days` days: one user's, or everyone's. */
export async function channelStats(days: number, userId?: string): Promise<AutoApplyChannels> {
  const mine = userId ? sql`and user_id = ${userId}` : sql``;
  const [[a], [e]] = await Promise.all([
    sql<{ cloud: number; browser: number; user: number; u_cloud: number; u_browser: number }[]>`
      select count(*) filter (where status = 'submitted' and submitted_via = 'cloud')::int as cloud,
             count(*) filter (where status = 'submitted' and coalesce(submitted_via, 'browser') = 'browser')::int as browser,
             count(*) filter (where status = 'submitted' and submitted_via = 'user')::int as "user",
             count(*) filter (where status = 'pending' and reason_code = 'unverified' and submitted_via = 'cloud')::int as u_cloud,
             count(*) filter (where status = 'pending' and reason_code = 'unverified' and coalesce(submitted_via, 'browser') = 'browser')::int as u_browser
      from public.auto_applications
      where updated_at >= now() - make_interval(days => ${days}) ${mine}`,
    sql<{ handed: number; waited: number; failures: number }[]>`
      select count(distinct application_id) filter (where kind = 'handed_to_browser')::int as handed,
             count(distinct application_id) filter (where kind in ('captcha', 'login_required') and detail->>'via' = 'cloud')::int as waited,
             count(*) filter (where kind = 'submit_failed' and detail->>'via' = 'cloud')::int as failures
      from public.auto_apply_events
      where created_at >= now() - make_interval(days => ${days}) ${mine}`,
  ]);
  const stopped = e.handed + e.waited;
  return {
    submitted: { cloud: a.cloud, browser: a.browser, user: a.user },
    unverified: { cloud: a.u_cloud, browser: a.u_browser },
    handedToBrowser: e.handed,
    waitedForUser: e.waited,
    cloudFailures: e.failures,
    cloudShare: a.cloud + stopped ? Math.round((a.cloud / (a.cloud + stopped)) * 1000) / 1000 : 0,
  };
}
