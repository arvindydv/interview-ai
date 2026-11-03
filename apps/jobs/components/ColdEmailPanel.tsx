'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertCircle, ArrowUpRight, CheckCircle2, FileText, Mail, RotateCcw, Send, Upload } from 'lucide-react';
import { COLD_EMAIL_LIMITS, type ColdEmail, type ColdEmailContact, type GmailStatus } from '@parakeet/shared';
import { Spinner, matchTone } from './ui';
import { api, ApiError } from '@/lib/api';
import { GMAIL_RESULT, connectGmail, gmailStatus } from '@/lib/gmail';
import { useJobs } from '@/lib/jobs';
import { timeAgo } from '@/lib/format';

const POLL_MS = 3000;
/** Edits survive the trip to Google and back when the candidate connects Gmail mid-email. */
const draftKey = (id: string) => `cold-email-draft:${id}`;

type Edits = { to: string; subject: string; body: string };

const SOURCE_LABEL: Record<ColdEmailContact['source'], string> = {
  posting: 'From the job posting',
  finder: 'Found by Friday',
  user: 'Added by you',
};

function ContactChip({ c, active, onPick }: { c: ColdEmailContact; active: boolean; onPick: () => void }) {
  return (
    <button
      type="button"
      onClick={onPick}
      className={`rounded-xl border px-3 py-2 text-left text-xs transition ${active ? 'border-sky-400 bg-white ring-2 ring-sky-200' : 'border-line bg-white/70 hover:border-line-strong'}`}
    >
      <span className="block font-medium text-fg">{c.name ?? c.email}</span>
      <span className="block text-muted">
        {[c.name ? c.email : null, c.position].filter(Boolean).join(' · ')}
      </span>
      <span className="mt-0.5 block text-faint">
        {SOURCE_LABEL[c.source]}
        {c.confidence !== null && ` · ${c.confidence}% sure`}
      </span>
    </button>
  );
}

/**
 * "Cold email the hiring team" for one job: one click writes the email (recruiter's address, subject,
 * body, the resume tailored to this job attached), and one more sends it from the candidate's Gmail.
 */
export function ColdEmailPanel({ id, company, score }: { id: string; company: string; score: number | null }) {
  const { summary } = useJobs();
  const [email, setEmail] = useState<ColdEmail | null | undefined>(undefined);
  const [gmail, setGmail] = useState<GmailStatus | null>(null);
  const [edits, setEdits] = useState<Edits | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'draft' | 'send' | 'connect' | null>(null);
  const [connected, setConnected] = useState<string | null>(null);
  /** Bumped to poll again after a failed request. */
  const [retry, setRetry] = useState(0);

  const load = useCallback(async () => {
    try {
      const { email } = await api<{ email: ColdEmail | null }>(`/v1/job-feed/${id}/cold-email`);
      setEmail(email);
      if (email?.status === 'ready') {
        let saved: Edits | null = null;
        try {
          saved = JSON.parse(sessionStorage.getItem(draftKey(id)) ?? 'null');
        } catch {}
        setEdits((cur) => cur ?? saved ?? { to: email.to ?? '', subject: email.subject, body: email.body });
      }
      setError(null);
    } catch (e) {
      setError((e as Error).message);
      // Keep polling through a dropped request.
      setTimeout(() => setRetry((n) => n + 1), POLL_MS);
    }
  }, [id]);

  useEffect(() => {
    setEmail(undefined);
    setEdits(null);
    setError(null);
    load();
    gmailStatus().then(
      ({ status, result }) => {
        setGmail(status);
        if (result) setConnected(result);
      },
      () => setGmail(null),
    );
  }, [load]);

  // A draft that's been writing for longer than this was lost (e.g. a server restart): offer to write it again.
  const stale = email?.status === 'drafting' && Date.now() - new Date(email.updatedAt).getTime() > COLD_EMAIL_LIMITS.draftingSeconds * 1000;

  useEffect(() => {
    if (email?.status !== 'drafting' || stale) return;
    const t = setTimeout(load, POLL_MS);
    return () => clearTimeout(t);
  }, [email, stale, load, retry]);

  async function write() {
    setBusy('draft');
    setError(null);
    setEdits(null);
    try {
      sessionStorage.removeItem(draftKey(id));
    } catch {}
    try {
      setEmail((await api<{ email: ColdEmail }>(`/v1/job-feed/${id}/cold-email`, { method: 'POST' })).email);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't start writing the email. Try again.");
    } finally {
      setBusy(null);
    }
  }

  async function connect() {
    setBusy('connect');
    setError(null);
    try {
      if (edits) sessionStorage.setItem(draftKey(id), JSON.stringify(edits));
    } catch {}
    try {
      await connectGmail(window.location.pathname + window.location.search);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't connect Gmail. Try again.");
      setBusy(null);
    }
  }

  async function send() {
    if (!edits) return;
    setBusy('send');
    setError(null);
    try {
      const { email } = await api<{ email: ColdEmail }>(`/v1/job-feed/${id}/cold-email/send`, {
        method: 'POST',
        body: JSON.stringify(edits),
      });
      setEmail(email);
      setGmail((g) => (g ? { ...g, sentToday: g.sentToday + 1 } : g));
      try {
        sessionStorage.removeItem(draftKey(id));
      } catch {}
    } catch (e) {
      if (e instanceof ApiError && /no longer has access/.test(e.message)) setGmail((g) => (g ? { ...g, email: null } : g));
      setError(e instanceof ApiError ? e.message : "Couldn't send the email. Try again.");
    } finally {
      setBusy(null);
    }
  }

  const resumeStatus = summary?.profile.resumeStatus ?? null;
  const tone = score !== null ? matchTone(score) : null;
  const set = (patch: Partial<Edits>) => setEdits((e) => (e ? { ...e, ...patch } : e));

  return (
    <section className="rounded-2xl border border-sky-200/70 bg-sky-50/50 p-4">
      <div className="flex gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-sky-100 text-sky-700">
          <Mail size={17} />
        </span>
        <div className="min-w-0 flex-1 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-medium">Cold email the hiring team</p>
            {tone && (
              <span className="rounded-full border border-line bg-white px-2 py-0.5 text-xs font-semibold tabular-nums" style={{ color: tone.color }}>
                {score}% match
              </span>
            )}
          </div>
          <p className="mt-0.5 text-muted">
            Friday finds {company}&rsquo;s recruiter, writes a short email from your resume and attaches your resume tailored to
            this job. It&rsquo;s sent from your own Gmail, so replies come straight to you.
          </p>

          {email === undefined && !error ? (
            <div className="mt-3 skeleton h-8 w-44" />
          ) : resumeStatus === null ? (
            <Link href="/profile" className="btn btn-secondary mt-3 !py-1.5 !text-xs">
              <Upload size={14} /> Upload your resume first
            </Link>
          ) : email?.status === 'drafting' && !stale ? (
            <p className="mt-3 flex items-center gap-2 font-medium text-sky-700">
              <Spinner /> Finding the recruiter, tailoring your resume and writing your email… about a minute
            </p>
          ) : email?.status === 'sent' ? (
            <div className="mt-3 rounded-xl border border-emerald-200 bg-white px-3 py-2.5">
              <p className="flex items-center gap-1.5 font-medium text-emerald-700">
                <CheckCircle2 size={15} /> Sent to {email.toName ? `${email.toName} (${email.to})` : email.to}
                {email.sentAt && <span className="font-normal text-muted">· {timeAgo(email.sentAt)}</span>}
              </p>
              <p className="mt-1 truncate text-xs text-muted">{email.subject}</p>
              {email.gmailUrl && (
                <a href={email.gmailUrl} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-fg underline underline-offset-2">
                  Open in Gmail <ArrowUpRight size={12} />
                </a>
              )}
            </div>
          ) : email?.status === 'ready' && edits ? (
            <div className="mt-3 space-y-3">
              <div>
                <label className="text-xs font-semibold tracking-wider text-faint uppercase" htmlFor={`ce-to-${id}`}>
                  To
                </label>
                {email.contacts.length > 0 && (
                  <div className="mt-1.5 grid gap-2 sm:grid-cols-2">
                    {email.contacts.slice(0, 4).map((c) => (
                      <ContactChip key={c.email} c={c} active={edits.to === c.email} onPick={() => set({ to: c.email })} />
                    ))}
                  </div>
                )}
                <input
                  id={`ce-to-${id}`}
                  type="email"
                  value={edits.to}
                  onChange={(e) => set({ to: e.target.value })}
                  placeholder="recruiter@company.com"
                  className="input mt-2 !py-2 text-sm"
                />
                {email.contacts.length === 0 && (
                  <p className="mt-1 text-xs text-muted">
                    We couldn&rsquo;t find an address for {company}. Paste the recruiter&rsquo;s or hiring manager&rsquo;s email
                    from LinkedIn or their careers page.
                  </p>
                )}
              </div>
              <div>
                <label className="text-xs font-semibold tracking-wider text-faint uppercase" htmlFor={`ce-subject-${id}`}>
                  Subject
                </label>
                <input
                  id={`ce-subject-${id}`}
                  value={edits.subject}
                  maxLength={200}
                  onChange={(e) => set({ subject: e.target.value })}
                  className="input mt-1.5 !py-2 text-sm"
                />
              </div>
              <div>
                <label className="text-xs font-semibold tracking-wider text-faint uppercase" htmlFor={`ce-body-${id}`}>
                  Message
                </label>
                <textarea
                  id={`ce-body-${id}`}
                  value={edits.body}
                  maxLength={5000}
                  rows={11}
                  onChange={(e) => set({ body: e.target.value })}
                  className="input mt-1.5 text-sm leading-relaxed"
                />
              </div>
              {email.attachment ? (
                <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-white px-3 py-2 text-xs">
                  <FileText size={14} className="text-faint" />
                  <span className="min-w-0 flex-1 truncate font-medium">{email.attachment}</span>
                  <span className={email.attachmentTailored ? 'text-brand' : 'text-warn'}>
                    {email.attachmentTailored ? 'Tailored to this job' : 'Your resume as uploaded (tailoring didn’t work)'}
                  </span>
                  {email.attachmentTailored && (
                    <Link href={`/resume/${id}`} className="font-medium underline underline-offset-2">
                      View
                    </Link>
                  )}
                </div>
              ) : (
                <p className="text-xs text-warn">
                  No resume file to attach.{' '}
                  <Link href="/profile" className="font-medium underline underline-offset-2">
                    Upload it as a PDF or Word file
                  </Link>
                  .
                </p>
              )}

              <div className="flex flex-wrap items-center gap-2">
                {gmail?.email ? (
                  <button disabled={busy !== null || !edits.to || !email.attachment} onClick={send} className="btn btn-brand !py-1.5 !text-xs">
                    {busy === 'send' ? <Spinner /> : <Send size={14} />} Send from {gmail.email}
                  </button>
                ) : gmail?.available ? (
                  <button disabled={busy !== null} onClick={connect} className="btn btn-brand !py-1.5 !text-xs">
                    {busy === 'connect' ? <Spinner /> : <Mail size={14} />} Connect Gmail to send
                  </button>
                ) : (
                  <p className="text-xs text-muted">Sending from Gmail isn&rsquo;t available yet.</p>
                )}
                <button disabled={busy !== null} onClick={write} className="btn btn-ghost !py-1.5 !text-xs">
                  {busy === 'draft' ? <Spinner /> : <RotateCcw size={14} />} Write again
                </button>
                {gmail?.email && (
                  <span className="ml-auto text-xs text-faint tabular-nums">
                    {gmail.sentToday}/{gmail.dailyLimit} sent today
                  </span>
                )}
              </div>
              {!gmail?.email && gmail?.available && (
                <p className="text-xs text-faint">Friday only asks to send email for you. It can&rsquo;t read your inbox.</p>
              )}
            </div>
          ) : (
            <div className="mt-3 space-y-2">
              {stale && <p className="text-xs text-warn">Writing this email didn&rsquo;t finish. Try again.</p>}
              {email?.status === 'failed' && email.error && (
                <p className="flex items-center gap-1.5 text-xs text-danger">
                  <AlertCircle size={13} /> {email.error}
                </p>
              )}
              {resumeStatus === 'parsing' && <p className="text-xs text-muted">Your resume is still being analysed.</p>}
              <button disabled={busy !== null || resumeStatus === 'parsing'} onClick={write} className="btn btn-brand !py-1.5 !text-xs">
                {busy === 'draft' ? <Spinner /> : <Mail size={14} />} {email?.status === 'failed' || stale ? 'Try again' : 'Write my cold email'}
              </button>
            </div>
          )}
          {connected && GMAIL_RESULT[connected] && (
            <p className={`mt-2 text-xs ${GMAIL_RESULT[connected].ok ? 'text-emerald-700' : 'text-warn'}`}>{GMAIL_RESULT[connected].text}</p>
          )}
          {error && <p className="mt-2 text-xs text-danger">{error}</p>}
        </div>
      </div>
    </section>
  );
}
