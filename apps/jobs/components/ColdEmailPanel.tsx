'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertCircle, ArrowUpRight, Check, CheckCircle2, FileText, Mail, Plus, RotateCcw, Send, Upload } from 'lucide-react';
import { COLD_EMAIL_LIMITS, type ColdEmail, type ColdEmailContact, type ColdEmailSendResult, type GmailStatus } from '@parakeet/shared';
import { Spinner, matchTone } from './ui';
import { api, ApiError } from '@/lib/api';
import { GMAIL_RESULT, connectGmail, gmailStatus } from '@/lib/gmail';
import { useJobs } from '@/lib/jobs';
import { timeAgo } from '@/lib/format';

const POLL_MS = 3000;
/** Edits survive the trip to Google and back when the candidate connects Gmail mid-email. */
const draftKey = (id: string) => `cold-email-draft:${id}`;

type Edits = { to: string[]; subject: string; body: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const SOURCE_LABEL: Record<ColdEmailContact['source'], string> = {
  posting: 'From the job posting',
  website: 'On the company’s website',
  finder: 'Found by Friday',
  guess: 'Guess, not verified',
  user: 'Added by you',
};

function ContactChip({ c, active, sent, onPick }: { c: ColdEmailContact; active: boolean; sent: boolean; onPick: () => void }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={active || sent}
      disabled={sent}
      onClick={onPick}
      className={`flex gap-2.5 rounded-xl border px-3 py-2 text-left text-xs transition ${
        sent ? 'cursor-default border-emerald-200 bg-emerald-50/60' : active ? 'border-sky-400 bg-white ring-2 ring-sky-200' : 'border-line bg-white/70 hover:border-line-strong'
      }`}
    >
      <span
        className={`mt-0.5 grid size-4 shrink-0 place-items-center rounded border ${
          sent ? 'border-emerald-500 bg-emerald-500 text-white' : active ? 'border-sky-500 bg-sky-500 text-white' : 'border-line-strong bg-white'
        }`}
      >
        {(active || sent) && <Check size={11} strokeWidth={3} />}
      </span>
      <span className="min-w-0">
      <span className="block font-medium text-fg">{c.name ?? c.email}</span>
      <span className="block text-muted">
        {[c.name ? c.email : null, c.position].filter(Boolean).join(' · ')}
      </span>
      <span className={`mt-0.5 block ${c.source === 'guess' ? 'font-medium text-warn' : 'text-faint'}`}>
        {sent ? 'Sent' : SOURCE_LABEL[c.source]}
        {!sent && c.confidence !== null && ` · ${c.confidence}% sure`}
      </span>
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
  /** An address the candidate is typing, and the ones they've added. */
  const [adding, setAdding] = useState('');
  const [added, setAdded] = useState<ColdEmailContact[]>([]);
  /** Who didn't get the last send, and why. */
  const [notSent, setNotSent] = useState<ColdEmailSendResult['results']>([]);
  /** Bumped to poll again after a failed request. */
  const [retry, setRetry] = useState(0);

  const load = useCallback(async () => {
    try {
      const { email } = await api<{ email: ColdEmail | null }>(`/v1/job-feed/${id}/cold-email`);
      setEmail(email);
      if (email?.status === 'ready' || email?.status === 'sent') {
        let saved: (Omit<Edits, 'to'> & { to: string | string[] }) | null = null;
        try {
          saved = JSON.parse(sessionStorage.getItem(draftKey(id)) ?? 'null');
        } catch {}
        const already = new Set(email.sends.filter((x) => x.status !== 'failed').map((x) => x.to));
        // The draft's recipient is ticked to start with, unless they've already been sent it.
        const start = email.status === 'ready' && email.to && !already.has(email.to) ? [email.to] : [];
        setEdits(
          (cur) =>
            cur ??
            (saved ? { ...saved, to: (Array.isArray(saved.to) ? saved.to : [saved.to]).filter(Boolean) } : null) ?? {
              to: start,
              subject: email.subject,
              body: email.body,
            },
        );
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
    if (!edits?.to.length) return;
    setBusy('send');
    setError(null);
    setNotSent([]);
    try {
      const { email, results } = await api<ColdEmailSendResult>(`/v1/job-feed/${id}/cold-email/send`, {
        method: 'POST',
        body: JSON.stringify(edits),
      });
      setEmail(email);
      const sent = results.filter((r) => r.status === 'sent').length;
      setGmail((g) => (g ? { ...g, sentToday: g.sentToday + sent } : g));
      setNotSent(results.filter((r) => r.status !== 'sent'));
      setEdits((e) => (e ? { ...e, to: [] } : e));
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
  const toggle = (address: string) =>
    setEdits((e) => (e ? { ...e, to: e.to.includes(address) ? e.to.filter((a) => a !== address) : [...e.to, address] } : e));

  const sentTo = new Set((email?.sends ?? []).filter((x) => x.status !== 'failed').map((x) => x.to));
  const contacts = [...(email?.contacts ?? []), ...added.filter((a) => !email?.contacts.some((c) => c.email === a.email))];
  const left = gmail ? Math.max(0, gmail.dailyLimit - gmail.sentToday) : COLD_EMAIL_LIMITS.sendsPerDay;
  const max = Math.min(COLD_EMAIL_LIMITS.recipientsPerJob, left);
  const found = contacts.filter((c) => c.source !== 'guess' && !sentTo.has(c.email));
  const selected = edits?.to ?? [];
  const nameOf = (address: string) => contacts.find((c) => c.email === address)?.name?.split(' ')[0] ?? null;

  function addAddress() {
    const address = adding.trim().toLowerCase();
    if (!EMAIL_RE.test(address)) return setError('Enter a valid email address.');
    setError(null);
    if (!contacts.some((c) => c.email === address)) {
      setAdded((a) => [...a, { email: address, name: null, position: null, source: 'user', confidence: null }]);
    }
    if (!selected.includes(address) && !sentTo.has(address)) set({ to: [...selected, address] });
    setAdding('');
  }

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
          ) : (email?.status === 'ready' || email?.status === 'sent') && edits ? (
            <div className="mt-3 space-y-3">
              {email.sends.length > 0 && (
                <div className="rounded-xl border border-emerald-200 bg-white px-3 py-2.5">
                  <p className="flex items-center gap-1.5 font-medium text-emerald-700">
                    <CheckCircle2 size={15} /> Sent to {email.sends.filter((x) => x.status === 'sent').length} of the hiring team
                  </p>
                  <ul className="mt-1.5 space-y-1 text-xs">
                    {email.sends.map((x) => (
                      <li key={x.to} className="flex flex-wrap items-center gap-x-2">
                        <span className="font-medium">{x.toName ?? x.to}</span>
                        {x.toName && <span className="text-muted">{x.to}</span>}
                        <span className={x.status === 'sent' ? 'text-faint' : x.status === 'failed' ? 'text-danger' : 'text-warn'}>
                          {x.status === 'sent' ? (x.sentAt ? timeAgo(x.sentAt) : 'sent') : x.status === 'failed' ? x.error ?? 'Not sent' : 'Sending…'}
                        </span>
                        {x.gmailUrl && (
                          <a href={x.gmailUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 text-fg underline underline-offset-2">
                            Gmail <ArrowUpRight size={11} />
                          </a>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <div>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <label className="text-xs font-semibold tracking-wider text-faint uppercase" htmlFor={`ce-to-${id}`}>
                    {email.sends.length ? 'Send to more people' : 'To'}
                  </label>
                  {found.length > 1 && (
                    <button
                      type="button"
                      onClick={() => set({ to: found.slice(0, max).map((c) => c.email) })}
                      className="text-xs font-medium text-sky-700 hover:underline"
                    >
                      Select all found ({Math.min(found.length, max)})
                    </button>
                  )}
                </div>
                {contacts.length > 0 && (
                  <div className="mt-1.5 grid gap-2 sm:grid-cols-2">
                    {contacts.slice(0, 8).map((c) => (
                      <ContactChip key={c.email} c={c} sent={sentTo.has(c.email)} active={selected.includes(c.email)} onPick={() => toggle(c.email)} />
                    ))}
                  </div>
                )}
                <div className="mt-2 flex gap-2">
                  <input
                    id={`ce-to-${id}`}
                    type="email"
                    value={adding}
                    onChange={(e) => setAdding(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addAddress())}
                    placeholder="Add another address, e.g. recruiter@company.com"
                    className="input !py-2 text-sm"
                  />
                  <button type="button" onClick={addAddress} disabled={!adding.trim()} className="btn btn-secondary !py-1.5 !text-xs">
                    <Plus size={14} /> Add
                  </button>
                </div>
                {selected.length > 1 && (
                  <p className="mt-1 text-xs text-muted">
                    Each person gets their own email, starting &ldquo;Hi {nameOf(selected[0]) ?? `${company} team`},&rdquo;, &ldquo;Hi{' '}
                    {nameOf(selected[1]) ?? `${company} team`},&rdquo; and so on. Nobody sees who else got it.
                  </p>
                )}
                {selected.length > max && (
                  <p className="mt-1 text-xs text-warn">
                    {left < COLD_EMAIL_LIMITS.recipientsPerJob
                      ? `You have ${left} email${left === 1 ? '' : 's'} left today.`
                      : `Choose at most ${COLD_EMAIL_LIMITS.recipientsPerJob} people for one job.`}
                  </p>
                )}
                {email.contacts.some((c) => c.source === 'guess') && (
                  <p className="mt-1 text-xs text-warn">
                    These are common hiring inboxes at {company}&rsquo;s domain, not addresses we found. They may not exist.
                  </p>
                )}
                {email.contacts.every((c) => c.source === 'guess') && (
                  <p className="mt-1 text-xs text-muted">
                    We couldn&rsquo;t find an address for {company}. Paste the recruiter&rsquo;s or hiring manager&rsquo;s email:{' '}
                    <a
                      href={`https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(`${company} recruiter`)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-medium text-fg underline underline-offset-2"
                    >
                      find {company}&rsquo;s recruiters on LinkedIn
                    </a>
                    {' · '}
                    <a
                      href={`https://www.google.com/search?q=${encodeURIComponent(`${company} recruiter OR "talent acquisition" email`)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-medium text-fg underline underline-offset-2"
                    >
                      search Google
                    </a>
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
                  <button
                    disabled={busy !== null || !selected.length || selected.length > max || !email.attachment}
                    onClick={send}
                    className="btn btn-brand !py-1.5 !text-xs"
                  >
                    {busy === 'send' ? <Spinner /> : <Send size={14} />}{' '}
                    {selected.length > 1 ? `Send to ${selected.length} people` : selected.length === 1 ? `Send to ${nameOf(selected[0]) ?? selected[0]}` : 'Choose who to send to'}
                  </button>
                ) : gmail?.available ? (
                  <button disabled={busy !== null} onClick={connect} className="btn btn-brand !py-1.5 !text-xs">
                    {busy === 'connect' ? <Spinner /> : <Mail size={14} />} Connect Gmail to send
                  </button>
                ) : (
                  <p className="text-xs text-muted">Sending from Gmail isn&rsquo;t available yet.</p>
                )}
                {email.status === 'ready' && (
                  <button disabled={busy !== null} onClick={write} className="btn btn-ghost !py-1.5 !text-xs">
                    {busy === 'draft' ? <Spinner /> : <RotateCcw size={14} />} Write again
                  </button>
                )}
                {gmail?.email && (
                  <span className="ml-auto text-xs text-faint tabular-nums">
                    {gmail.sentToday}/{gmail.dailyLimit} sent today
                  </span>
                )}
              </div>
              {gmail?.email && <p className="text-xs text-faint">Sent from {gmail.email}, one email at a time.</p>}
              {!gmail?.email && gmail?.available && (
                <p className="text-xs text-faint">Friday only asks to send email for you. It can&rsquo;t read your inbox.</p>
              )}
              {notSent.length > 0 && (
                <ul className="space-y-0.5 text-xs text-warn">
                  {notSent.map((r) => (
                    <li key={r.to}>
                      Not sent to {r.to}: {r.message}
                    </li>
                  ))}
                </ul>
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
