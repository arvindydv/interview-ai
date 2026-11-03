import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  COLD_EMAIL_LIMITS, senderName, type ColdEmail, type ColdEmailContact, type ColdEmailStatus, type GmailStatus,
} from '@parakeet/shared';
import { createHash, randomBytes } from 'node:crypto';
import { requireAuth } from '../lib/auth.js';
import { sql } from '../lib/db.js';
import { env } from '../env.js';
import {
  GMAIL_SEND_SCOPE, GmailRevokedError, GmailSendError, accessToken, authUrl, buildMime, encryptToken, exchangeCode,
  forgetAccessToken, gmailConfigured, revokeToken, sendGmail, signState, verifyState,
} from '../lib/gmail.js';
import { coldEmailQueue } from '../lib/queues.js';
import { redis } from '../lib/redis.js';
import { ensureUser } from '../lib/users.js';

// Friday Jobs cold email (packages/shared/src/coldEmail.ts): the worker writes the email
// (apps/worker/src/queues/coldEmail.ts), the candidate checks it, and Send mails it from their own Gmail
// with their resume tailored to the job attached.

interface Row {
  id: string;
  listing_id: string | null;
  title: string;
  company: string;
  status: ColdEmailStatus;
  contacts: ColdEmailContact[];
  to_email: string | null;
  to_name: string | null;
  subject: string;
  body: string;
  match_score: number | null;
  attachment: string | null;
  attachment_tailored: boolean;
  error: string | null;
  sent_at: Date | null;
  gmail_thread_id: string | null;
  updated_at: Date;
}

const COLUMNS = sql`
  c.id, c.listing_id, c.title, c.company, c.status, c.contacts, c.to_email, c.to_name, c.subject, c.body, c.match_score,
  c.error, c.sent_at, c.gmail_thread_id, c.updated_at,
  coalesce(t.file_name, r.file_name) as attachment, t.id is not null as attachment_tailored`;

/** The resume that goes with the email: the tailored one when it's ready, else the candidate's latest upload. */
const ATTACHMENT_JOINS = sql`
  left join public.tailored_resumes t on t.id = c.tailored_id and t.status = 'ready' and t.file is not null
  left join lateral (
    select file_name from public.resumes where user_id = c.user_id and file is not null order by created_at desc limit 1
  ) r on true`;

const toColdEmail = (r: Row): ColdEmail => ({
  id: r.id,
  listingId: r.listing_id,
  title: r.title,
  company: r.company,
  status: r.status,
  contacts: r.contacts,
  to: r.to_email,
  toName: r.to_name,
  subject: r.subject,
  body: r.body,
  matchScore: r.match_score,
  attachment: r.attachment,
  attachmentTailored: r.attachment_tailored,
  error: r.error,
  sentAt: r.sent_at?.toISOString() ?? null,
  gmailUrl: r.gmail_thread_id ? `https://mail.google.com/mail/u/0/#sent/${r.gmail_thread_id}` : null,
  updatedAt: r.updated_at.toISOString(),
});

const sendBody = z.object({
  to: z.email().max(254).transform((s) => s.trim().toLowerCase()),
  subject: z.string().trim().min(1).max(COLD_EMAIL_LIMITS.maxSubjectChars),
  body: z.string().trim().min(20).max(COLD_EMAIL_LIMITS.maxBodyChars),
});

/** A path on the jobs site, never another site (`//evil.com`, `/\\evil.com` and control characters resolve elsewhere). */
const jobsPath = (path: string) => {
  if (!/^\/(?![/\\])/.test(path) || /[\\\x00-\x1f\x7f]/.test(path)) return false;
  return new URL(path, env.JOBS_URL).origin === new URL(env.JOBS_URL).origin;
};

const connectBody = z.object({
  // Where to come back to, e.g. /recommended?job=…
  returnTo: z.string().max(500).refine(jobsPath).default('/cold-emails'),
});

const completeBody = z.object({ code: z.string().regex(/^[A-Za-z0-9_-]{20,64}$/) });

/** A connection Google approved, waiting for the signed-in candidate to claim it (POST /gmail/complete). */
interface PendingGmail {
  userId: string;
  email: string;
  refreshToken: string; // encrypted, base64
  scope: string;
}
const PENDING_TTL_S = 600;

const sentToday = async (userId: string) => {
  const [{ n }] = await sql<{ n: number }[]>`
    select count(*)::int as n from public.cold_emails where user_id = ${userId} and sent_at > now() - interval '1 day'`;
  return n;
};

/**
 * Google sends the candidate here after they allow (or refuse) Gmail access. It arrives without their
 * session, so nothing is connected yet: the approved tokens wait (ten minutes, encrypted) under a one-time
 * code, and the jobs site claims them with the signed-in candidate's session. Someone else's connect link
 * can't attach the victim's Gmail to the sender's account, as the victim's own session claims it.
 */
async function gmailCallbackRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { code?: string; state?: string; error?: string } }>('/v1/cold-email/gmail/callback', async (req, reply) => {
    const back = (path: string, params: Record<string, string>) => {
      const url = new URL(jobsPath(path) ? path : '/cold-emails', env.JOBS_URL);
      for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
      return reply.redirect(url.toString());
    };
    const state = req.query.state && gmailConfigured() ? verifyState(req.query.state) : null;
    // Each state is good for one trip to Google.
    const fresh = state && (await redis.set(`gmail:state:${createHash('sha256').update(req.query.state!).digest('hex')}`, '1', 'EX', PENDING_TTL_S, 'NX'));
    if (!state || !fresh) return back('/cold-emails', { gmail: 'expired' });
    if (req.query.error || !req.query.code) return back(state.returnTo, { gmail: 'cancelled' });
    try {
      const tokens = await exchangeCode(req.query.code);
      if (!tokens.scope.split(' ').includes(GMAIL_SEND_SCOPE)) return back(state.returnTo, { gmail: 'no_send' });
      if (!tokens.refresh_token || !tokens.email) return back(state.returnTo, { gmail: 'failed' });
      const code = randomBytes(24).toString('base64url');
      const pending: PendingGmail = {
        userId: state.userId,
        email: tokens.email.toLowerCase(),
        refreshToken: encryptToken(tokens.refresh_token).toString('base64'),
        scope: tokens.scope,
      };
      await redis.set(`gmail:pending:${code}`, JSON.stringify(pending), 'EX', PENDING_TTL_S);
      return back(state.returnTo, { gmail_code: code });
    } catch (err) {
      req.log.error({ err }, 'gmail connect failed');
      return back(state.returnTo, { gmail: 'failed' });
    }
  });
}

export default async function coldEmailRoutes(app: FastifyInstance) {
  await app.register(gmailCallbackRoutes);
  await app.register(async (app) => {
    app.addHook('preHandler', requireAuth);

    app.get('/v1/cold-email/gmail', async (req): Promise<GmailStatus> => {
      const [account] = await sql<{ email: string }[]>`select email from public.gmail_accounts where user_id = ${req.user.id}`;
      return {
        available: gmailConfigured(),
        email: account?.email ?? null,
        sentToday: await sentToday(req.user.id),
        dailyLimit: COLD_EMAIL_LIMITS.sendsPerDay,
      };
    });

    app.post('/v1/cold-email/gmail/connect', async (req, reply): Promise<{ url: string } | void> => {
      if (!gmailConfigured()) return reply.code(503).send({ error: 'unavailable', message: 'Sending from Gmail isn’t set up yet.' });
      const parsed = connectBody.safeParse(req.body ?? {});
      if (!parsed.success) return reply.code(400).send({ error: 'bad_request', message: 'Invalid return path.' });
      await ensureUser(req);
      return { url: authUrl(signState(req.user.id, parsed.data.returnTo), req.user.email) };
    });

    // Finishes connecting Gmail: only the Friday account that started the connection can claim it.
    app.post('/v1/cold-email/gmail/complete', async (req, reply): Promise<{ email: string } | void> => {
      const parsed = completeBody.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: 'bad_request', message: 'Invalid code.' });
      const raw = await redis.getdel(`gmail:pending:${parsed.data.code}`);
      if (!raw) return reply.code(410).send({ error: 'expired', message: 'That took too long. Connect Gmail again.' });
      const pending = JSON.parse(raw) as PendingGmail;
      if (pending.userId !== req.user.id) {
        req.log.warn('gmail connection claimed by a different account');
        return reply.code(403).send({ error: 'wrong_account', message: 'This Gmail connection was started from a different Friday account, so it wasn’t connected.' });
      }
      await sql`
        insert into public.gmail_accounts (user_id, email, refresh_token, scope)
        values (${req.user.id}, ${pending.email}, ${Buffer.from(pending.refreshToken, 'base64')}, ${pending.scope})
        on conflict (user_id) do update set
          email = excluded.email, refresh_token = excluded.refresh_token, scope = excluded.scope,
          connected_at = now(), updated_at = now()`;
      forgetAccessToken(req.user.id);
      return { email: pending.email };
    });

    app.delete('/v1/cold-email/gmail', async (req) => {
      const [account] = await sql<{ refresh_token: Buffer }[]>`
        delete from public.gmail_accounts where user_id = ${req.user.id} returning refresh_token`;
      forgetAccessToken(req.user.id);
      if (account && gmailConfigured()) {
        // Best effort: the account is disconnected here either way.
        await revokeToken(account.refresh_token).catch((err: Error) => req.log.warn({ err }, 'gmail revoke failed'));
      }
      return { ok: true };
    });

    app.get<{ Querystring: { page?: string } }>('/v1/cold-emails', async (req): Promise<{ items: ColdEmail[] }> => {
      const rows = await sql<Row[]>`
        select ${COLUMNS} from public.cold_emails c ${ATTACHMENT_JOINS}
        where c.user_id = ${req.user.id}
        order by coalesce(c.sent_at, c.updated_at) desc limit 200`;
      return { items: rows.map(toColdEmail) };
    });

    app.get<{ Params: { id: string } }>('/v1/job-feed/:id/cold-email', async (req, reply): Promise<{ email: ColdEmail | null } | void> => {
      if (!z.uuid().safeParse(req.params.id).success) return reply.notFound('No such job.');
      const [row] = await sql<Row[]>`
        select ${COLUMNS} from public.cold_emails c ${ATTACHMENT_JOINS}
        where c.user_id = ${req.user.id} and c.listing_id = ${req.params.id}`;
      return { email: row ? toColdEmail(row) : null };
    });

    // Writes (or rewrites) the email for this job. The client polls the GET above until it's ready.
    app.post<{ Params: { id: string } }>('/v1/job-feed/:id/cold-email', async (req, reply): Promise<{ email: ColdEmail } | void> => {
      if (!z.uuid().safeParse(req.params.id).success) return reply.notFound('No such job.');
      const userId = req.user.id;
      const [resume] = await sql<{ status: string }[]>`
        select status from public.resumes where user_id = ${userId} order by created_at desc limit 1`;
      if (!resume) return reply.code(409).send({ error: 'no_resume', message: 'Upload your resume first.' });
      if (resume.status === 'parsing') {
        return reply.code(409).send({ error: 'resume_parsing', message: 'Your resume is still being analysed. Try again in a moment.' });
      }
      const [listing] = await sql<{ title: string; company: string; closed: boolean }[]>`
        select title, company, closed_at is not null as closed from public.job_listings where id = ${req.params.id}`;
      if (!listing || listing.closed) return reply.notFound('This job is no longer available.');

      const [prev] = await sql<{ status: ColdEmailStatus; age_s: number }[]>`
        select status, extract(epoch from now() - updated_at)::int as age_s from public.cold_emails
        where user_id = ${userId} and listing_id = ${req.params.id}`;
      if (prev?.status === 'sent') return reply.code(409).send({ error: 'already_sent', message: 'You’ve already emailed about this job.' });
      if (prev?.status === 'drafting' && prev.age_s < COLD_EMAIL_LIMITS.draftingSeconds) {
        return reply.code(409).send({ error: 'conflict', message: 'Already writing this email.' });
      }
      if (prev && prev.age_s < COLD_EMAIL_LIMITS.retrySeconds) {
        return reply.code(429).send({ error: 'too_soon', message: 'Please wait a few seconds before writing it again.' });
      }
      // Every write counts, rewrites of the same job included: each is a model call.
      const day = `coldemail:drafts:${userId}:${new Date().toISOString().slice(0, 10)}`;
      const written = await redis.incr(day);
      if (written === 1) await redis.expire(day, 2 * 86400);
      if (written > COLD_EMAIL_LIMITS.draftsPerDay) {
        return reply.code(429).send({ error: 'rate_limited', message: `You can write ${COLD_EMAIL_LIMITS.draftsPerDay} cold emails a day. Try again tomorrow.` });
      }

      await ensureUser(req);
      const [created] = await sql<{ id: string }[]>`
        insert into public.cold_emails (user_id, listing_id, title, company)
        values (${userId}, ${req.params.id}, ${listing.title}, ${listing.company})
        on conflict (user_id, listing_id) do update set
          title = excluded.title, company = excluded.company, status = 'drafting', error = null, updated_at = now()
        returning id`;
      try {
        await coldEmailQueue.add('coldemail.draft', { coldEmailId: created.id }, { jobId: `coldemail-${created.id}-${Date.now()}` });
      } catch (err) {
        req.log.error({ err }, 'failed to enqueue cold email');
        await sql`update public.cold_emails set status = 'failed', error = 'Cold email is unavailable right now.', updated_at = now() where id = ${created.id}`;
      }
      const [row] = await sql<Row[]>`select ${COLUMNS} from public.cold_emails c ${ATTACHMENT_JOINS} where c.id = ${created.id}`;
      return { email: toColdEmail(row) };
    });

    // Sends the email, as the candidate edited it, from their Gmail with the resume attached.
    app.post<{ Params: { id: string } }>('/v1/job-feed/:id/cold-email/send', async (req, reply): Promise<{ email: ColdEmail } | void> => {
      const parsed = sendBody.safeParse(req.body);
      if (!z.uuid().safeParse(req.params.id).success) return reply.notFound('No such job.');
      if (!parsed.success) {
        return reply.code(400).send({ error: 'bad_request', message: parsed.error.issues.some((i) => i.path[0] === 'to') ? 'Enter a valid email address.' : 'Add a subject and a message.' });
      }
      const { to, subject, body } = parsed.data;
      const userId = req.user.id;
      if (!gmailConfigured()) return reply.code(503).send({ error: 'unavailable', message: 'Sending from Gmail isn’t set up yet.' });
      const [account] = await sql<{ email: string; refresh_token: Buffer }[]>`
        select email, refresh_token from public.gmail_accounts where user_id = ${userId}`;
      if (!account) return reply.code(409).send({ error: 'gmail_not_connected', message: 'Connect your Gmail to send.' });
      if (to === account.email) return reply.code(400).send({ error: 'bad_request', message: 'That’s your own address. Enter the recruiter’s.' });

      // Access first: if Gmail can't be reached or access is gone, nothing has been claimed or sent.
      let token: string;
      try {
        token = await accessToken(userId, account.refresh_token);
      } catch (err) {
        if (err instanceof GmailRevokedError) {
          await sql`delete from public.gmail_accounts where user_id = ${userId}`;
          return reply.code(409).send({ error: 'gmail_not_connected', message: 'Friday no longer has access to your Gmail. Connect it again to send.' });
        }
        req.log.error({ err }, 'gmail access token failed');
        return reply.code(502).send({ error: 'send_failed', message: 'We couldn’t reach Gmail. Nothing was sent; try again in a moment.' });
      }

      // Claims the send, under a per-user lock so the daily limit holds across parallel sends: a double
      // click, a second tab or a retry after a timeout can't send it twice.
      const claim = await sql.begin(async (tx) => {
        await tx`select pg_advisory_xact_lock(hashtext(${`coldemail:${userId}`}))`;
        const [{ n }] = await tx<{ n: number }[]>`
          select count(*)::int as n from public.cold_emails
          where user_id = ${userId} and (sent_at > now() - interval '1 day' or sending_at > now() - interval '5 minutes')`;
        if (n >= COLD_EMAIL_LIMITS.sendsPerDay) return 'limit' as const;
        const [row] = await tx<{ id: string }[]>`
          update public.cold_emails set sending_at = now(), updated_at = now()
          where user_id = ${userId} and listing_id = ${req.params.id} and status = 'ready' and sent_at is null
            and (sending_at is null or sending_at < now() - interval '5 minutes')
          returning id`;
        return row ?? null;
      });
      if (claim === 'limit') {
        return reply.code(429).send({ error: 'rate_limited', message: `You can send ${COLD_EMAIL_LIMITS.sendsPerDay} cold emails a day, so they keep landing in inboxes. Try again tomorrow.` });
      }
      const claimed = claim;
      if (!claimed) {
        const [cur] = await sql<{ status: ColdEmailStatus }[]>`
          select status from public.cold_emails where user_id = ${userId} and listing_id = ${req.params.id}`;
        const message = !cur ? 'Write the email first.' : cur.status === 'sent' ? 'This email has already been sent.' : cur.status === 'ready' ? 'Already sending this email.' : 'The email isn’t ready yet.';
        return reply.code(409).send({ error: 'conflict', message });
      }
      const release = () => sql`update public.cold_emails set sending_at = null where id = ${claimed.id}`;

      const [att] = await sql<{ file: Buffer | null; file_name: string | null; first: string | null; last: string | null; resume_name: string | null }[]>`
        select coalesce(t.file, r.file) as file, coalesce(t.file_name, r.file_name) as file_name, p.data->>'firstName' as first, p.data->>'lastName' as last, r.parsed_json->>'name' as resume_name
        from public.cold_emails c
        left join public.tailored_resumes t on t.id = c.tailored_id and t.status = 'ready' and t.file is not null
        left join lateral (
          select file, file_name, parsed_json from public.resumes where user_id = c.user_id and file is not null order by created_at desc limit 1
        ) r on true
        left join public.application_profiles p on p.user_id = c.user_id
        where c.id = ${claimed.id}`;
      if (!att?.file) {
        await release();
        return reply.code(409).send({ error: 'no_resume_file', message: 'Upload your resume as a PDF or Word file to attach it.' });
      }
      // DOCX is a zip ("PK"); everything else Friday keeps is a PDF.
      const docx = att.file[0] === 0x50 && att.file[1] === 0x4b;
      const mime = buildMime({
        fromName: senderName(att.first, att.last) || att.resume_name || '',
        fromEmail: account.email,
        to,
        subject,
        text: body,
        attachment: {
          name: att.file_name ?? `Resume.${docx ? 'docx' : 'pdf'}`,
          type: docx ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : 'application/pdf',
          data: att.file,
        },
      });

      let sent: { id: string; threadId: string };
      try {
        sent = await sendGmail(token, mime);
      } catch (err) {
        // Gmail turned it down (4xx): nothing went out. A 5xx or no answer at all may have sent it, so those
        // keep the claim for five minutes.
        if (err instanceof GmailSendError && err.status < 500) {
          await release();
          req.log.warn({ status: err.status, message: err.message }, 'gmail refused cold email');
          if (err.status === 401 || err.status === 403) forgetAccessToken(userId);
          return reply.code(502).send({ error: 'send_failed', message: `Gmail didn’t send it: ${err.message}` });
        }
        // No answer from Gmail: it may have gone out. The claim holds for five minutes so it isn't sent twice right away.
        req.log.error({ err }, 'cold email send failed');
        return reply.code(502).send({ error: 'send_failed', message: 'We couldn’t reach Gmail. Check your Sent folder before trying again in a few minutes.' });
      }

      // It went out: record it, retrying, as a row left 'ready' could be sent again once the claim expires.
      for (let attempt = 1; ; attempt++) {
        try {
          await sql`
            update public.cold_emails set
              status = 'sent', sent_at = now(), to_email = ${to},
              to_name = (select c->>'name' from jsonb_array_elements(contacts) c where c->>'email' = ${to} limit 1),
              subject = ${subject}, body = ${body}, gmail_message_id = ${sent.id}, gmail_thread_id = ${sent.threadId},
              error = null, updated_at = now()
            where id = ${claimed.id}`;
          break;
        } catch (err) {
          req.log.error({ err, attempt, gmailMessageId: sent.id }, 'recording a sent cold email failed');
          if (attempt >= 5) throw err;
          await new Promise((r) => setTimeout(r, 500 * attempt));
        }
      }
      // Track it with the candidate's other applications, without moving one that's already further along.
      await sql`
        insert into public.job_applications (user_id, listing_id, title, company, location, apply_url, status, applied_at)
        select ${userId}, l.id, l.title, l.company, l.location, l.apply_url, 'applied', now()
        from public.job_listings l where l.id = ${req.params.id}
        on conflict (user_id, listing_id) do update set
          status = case when job_applications.status = 'saved' then 'applied' else job_applications.status end,
          applied_at = coalesce(job_applications.applied_at, now()), updated_at = now()`;
      const [row] = await sql<Row[]>`select ${COLUMNS} from public.cold_emails c ${ATTACHMENT_JOINS} where c.id = ${claimed.id}`;
      return { email: toColdEmail(row) };
    });
  });
}
