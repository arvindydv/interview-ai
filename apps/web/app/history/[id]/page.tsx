'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import {
  AlertTriangle, ArrowLeft, BookOpen, Clock, Copy, Image as ImageIcon, Mail, MessageSquareText, MoreHorizontal, RefreshCw,
  Sparkles, Trash2,
} from 'lucide-react';
import type { HistorySession, HistoryTurn } from '@parakeet/shared';
import { ApiError, api } from '@/lib/api';
import { useRequireSession } from '@/lib/useSession';
import { formatDuration } from '@/lib/practice';
import { AppShell } from '@/components/AppShell';
import { LogoMark } from '@/components/Logo';
import { Spinner } from '@/components/ui';
import { ConfirmDialog, Menu, Toaster, toast } from '@/components/overlay';

const POLL_MS = 2500;
const errorText = (e: unknown) => (e instanceof ApiError ? e.message : 'Something went wrong. Try again.');

const copy = (text: string, what = 'Copied.') =>
  navigator.clipboard.writeText(text).then(
    () => toast(what),
    () => toast('Couldn’t copy. Select the text instead.', { tone: 'bad' }),
  );

export default function HistorySessionPage() {
  const email = useRequireSession();
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const [session, setSession] = useState<HistorySession | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);

  const load = useCallback(
    () =>
      api<{ session: HistorySession }>(`/v1/history/${id}`).then(
        (r) => setSession(r.session),
        (e) => setLoadError(e instanceof ApiError && e.status === 404 ? 'not_found' : errorText(e)),
      ),
    [id],
  );

  useEffect(() => {
    if (email) load();
  }, [email, load]);

  const pending = session?.summaryStatus === 'pending';
  useEffect(() => {
    if (!pending) return;
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [pending, load]);

  // Arriving from a search result: bring that question into view.
  useEffect(() => {
    if (!session || !location.hash.startsWith('#turn-')) return;
    const el = document.getElementById(location.hash.slice(1));
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el?.animate([{ boxShadow: '0 0 0 2px rgb(52 211 153 / 0.6)' }, { boxShadow: '0 0 0 2px transparent' }], { duration: 2000, easing: 'ease-out' });
  }, [session?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const summarise = async () => {
    try {
      await api(`/v1/history/${id}/summary`, { method: 'POST' });
      setSession((s) => (s ? { ...s, summaryStatus: 'pending' } : s));
    } catch (e) {
      toast(errorText(e), { tone: 'bad' });
    }
  };

  const remove = async () => {
    try {
      await api(`/v1/history/${id}`, { method: 'DELETE' });
      router.replace('/history');
    } catch (e) {
      toast(errorText(e), { tone: 'bad' });
      setConfirm(false);
    }
  };

  if (!email) {
    return (
      <div className="grid min-h-screen place-items-center">
        <LogoMark size={40} />
      </div>
    );
  }

  const started = session ? new Date(session.startedAt) : null;
  const transcript = session?.turns
    .filter((t) => t.question)
    .map((t) => `Q: ${t.question}\n\nA: ${t.answer}`)
    .join('\n\n---\n\n');

  return (
    <AppShell email={email}>
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-8 sm:py-10">
        <Link href="/history" className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted transition hover:text-fg">
          <ArrowLeft size={15} /> History
        </Link>

        {loadError ? (
          <div className="grid place-items-center py-20 text-center">
            <p className="text-lg font-semibold">{loadError === 'not_found' ? 'Session not found' : 'Couldn’t load this session'}</p>
            <p className="mt-1 text-sm text-muted">{loadError === 'not_found' ? 'It may have been deleted.' : loadError}</p>
          </div>
        ) : !session || !started ? (
          <div className="grid place-items-center py-32">
            <Spinner className="text-muted" />
          </div>
        ) : (
          <div className="space-y-6">
            <header className="flex flex-wrap items-start justify-between gap-4 animate-fade-up">
              <div>
                <h1 className="text-2xl font-semibold tracking-tight">
                  {started.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}
                </h1>
                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-muted">
                  <span className="flex items-center gap-1.5">
                    <Clock size={14} />
                    {started.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })} · {formatDuration(session.seconds * 1000)}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <MessageSquareText size={14} /> {session.questions} question{session.questions === 1 ? '' : 's'}
                  </span>
                  {session.interviews.map((i) => (
                    <span key={i} className="rounded-full bg-white/5 px-2.5 py-0.5 text-xs ring-1 ring-line">
                      {i}
                    </span>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                {transcript && (
                  <button onClick={() => copy(transcript, 'Transcript copied.')} className="btn btn-secondary !px-3 !py-2 text-xs">
                    <Copy size={14} /> Copy transcript
                  </button>
                )}
                <Menu
                  label="Session actions"
                  trigger={<MoreHorizontal size={18} />}
                  items={[{ label: 'Delete session', icon: Trash2, danger: true, onSelect: () => setConfirm(true) }]}
                />
              </div>
            </header>

            {!session.textCleared && session.questions > 0 && <Summary session={session} onRequest={summarise} />}

            {session.textCleared ? (
              <div className="glass rounded-[var(--radius-card)] px-6 py-12 text-center">
                <p className="font-medium">The questions and answers from this session were deleted</p>
                <p className="mt-1 text-sm text-muted">
                  That&apos;s your <Link href="/settings#privacy" className="text-brand hover:underline">history setting</Link>. Usage
                  time is kept for billing.
                </p>
              </div>
            ) : (
              <section>
                <h2 className="mb-3 text-sm font-semibold">Transcript</h2>
                <ol className="space-y-3">
                  {session.turns.map((t, n) => (
                    <Turn key={t.id} t={t} n={n} startedAt={started.getTime()} />
                  ))}
                </ol>
              </section>
            )}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={confirm}
        title="Delete this session?"
        text="Its questions, answers and summary are deleted. Your usage and minutes are not affected."
        confirmLabel="Delete"
        danger
        onConfirm={remove}
        onCancel={() => setConfirm(false)}
      />
      <Toaster />
    </AppShell>
  );
}

function Turn({ t, n, startedAt }: { t: HistoryTurn; n: number; startedAt: number }) {
  const offset = Math.max(0, new Date(t.createdAt).getTime() - startedAt);
  return (
    <li id={`turn-${t.id}`} className="scroll-mt-24 rounded-2xl border border-line bg-surface/50 p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-md bg-white/5 text-[11px] font-semibold text-muted tabular-nums ring-1 ring-line">
          {n + 1}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-faint">
            <span className="tabular-nums">+{formatDuration(offset)}</span>
            {t.imageCount > 0 && (
              <span className="flex items-center gap-1">
                <ImageIcon size={11} /> {t.imageCount} screenshot{t.imageCount === 1 ? '' : 's'}
              </span>
            )}
            {t.status !== 'done' && (
              <span className={t.status === 'error' ? 'text-danger' : 'text-warn'}>{t.status === 'error' ? 'Failed' : 'Stopped early'}</span>
            )}
          </div>
          <p className="mt-1 font-medium">{t.question || <span className="text-muted italic">Screenshot question</span>}</p>
          {t.answer && (
            <div className="group relative mt-3 rounded-xl border border-line bg-bg/40 p-3.5">
              <p className="mb-1 flex items-center gap-1.5 text-[11px] font-medium text-brand">
                <Sparkles size={11} /> Friday suggested
              </p>
              <p className="text-sm leading-relaxed whitespace-pre-wrap text-fg/85">{t.answer}</p>
              <button
                onClick={() => copy(t.answer)}
                aria-label="Copy answer"
                className="absolute top-2.5 right-2.5 rounded-md p-1.5 text-faint opacity-0 transition group-hover:opacity-100 hover:bg-white/5 hover:text-fg focus:opacity-100"
              >
                <Copy size={13} />
              </button>
            </div>
          )}
        </div>
      </div>
    </li>
  );
}

function Summary({ session, onRequest }: { session: HistorySession; onRequest: () => void }) {
  const s = session.summary;
  if (session.summaryStatus === 'pending') {
    return (
      <section className="glass flex items-center gap-4 rounded-[var(--radius-card)] p-5" aria-live="polite">
        <Spinner className="text-brand" />
        <div>
          <p className="text-sm font-semibold">Writing your summary…</p>
          <p className="text-xs text-muted">Topics covered, what to revise, and a thank-you email. Usually under a minute.</p>
        </div>
      </section>
    );
  }
  if (!s) {
    return (
      <section className="relative overflow-hidden rounded-[var(--radius-card)] border border-line p-5 sm:p-6 animate-fade-up">
        <div className="absolute inset-0 -z-10 bg-surface" />
        <div className="absolute -top-24 -right-24 -z-10 size-80 glow opacity-70" />
        <div className="flex flex-wrap items-center gap-4">
          <span className="grid size-10 place-items-center rounded-xl bg-brand/10 text-brand ring-1 ring-brand/25">
            <Sparkles size={18} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-semibold">Post-interview summary</p>
            <p className="text-sm text-muted">
              {session.summaryStatus === 'failed'
                ? 'The last attempt didn’t finish. Try again.'
                : 'What was covered, the topics to revise before the next round, and a thank-you email ready to send.'}
            </p>
          </div>
          <button onClick={onRequest} className="btn btn-primary !py-2">
            {session.summaryStatus === 'failed' ? <RefreshCw size={15} /> : <Sparkles size={15} />}
            {session.summaryStatus === 'failed' ? 'Try again' : 'Summarise'}
          </button>
        </div>
      </section>
    );
  }
  const mailto = `mailto:?${new URLSearchParams({ subject: s.thankYouEmail.subject, body: s.thankYouEmail.body }).toString().replace(/\+/g, '%20')}`;
  return (
    <section className="space-y-4 animate-fade-up">
      <div className="glass rounded-[var(--radius-card)] p-5 sm:p-6">
        <p className="flex items-center gap-2 text-sm font-semibold">
          <Sparkles size={15} className="text-brand" /> Summary
        </p>
        <p className="mt-2 text-sm leading-relaxed text-fg/85">{s.overview}</p>
        {s.topics.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-1.5">
            {s.topics.map((t) => (
              <span key={t} className="rounded-full bg-white/[0.04] px-2.5 py-1 text-xs text-muted ring-1 ring-line">
                {t}
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <div className="glass rounded-[var(--radius-card)] p-5 sm:p-6">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <BookOpen size={15} className="text-warn" /> Revise before the next round
          </p>
          <ul className="mt-3 space-y-3">
            {s.weakSpots.map((w) => (
              <li key={w.topic} className="rounded-xl border border-line bg-bg/40 p-3">
                <p className="flex items-center gap-1.5 text-sm font-medium">
                  <AlertTriangle size={13} className="text-warn" /> {w.topic}
                </p>
                <p className="mt-1 text-xs leading-relaxed text-muted">{w.why}</p>
                <p className="mt-1.5 text-xs leading-relaxed">
                  <span className="text-faint">Study: </span>
                  {w.study}
                </p>
              </li>
            ))}
          </ul>
        </div>
        <div className="glass rounded-[var(--radius-card)] p-5 sm:p-6">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <Mail size={15} className="text-brand" /> Thank-you email
          </p>
          <div className="mt-3 rounded-xl border border-line bg-bg/40 p-3.5">
            <p className="text-xs text-faint">Subject</p>
            <p className="text-sm font-medium">{s.thankYouEmail.subject}</p>
            <p className="mt-3 text-sm leading-relaxed whitespace-pre-wrap text-fg/85">{s.thankYouEmail.body}</p>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button onClick={() => copy(`${s.thankYouEmail.subject}\n\n${s.thankYouEmail.body}`, 'Email copied.')} className="btn btn-secondary !px-3 !py-2 text-xs">
              <Copy size={14} /> Copy
            </button>
            <a href={mailto} className="btn btn-ghost !px-3 !py-2 text-xs">
              <Mail size={14} /> Open in email app
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
