'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowRight, Clock, Download, EyeOff, History as HistoryIcon, MessageSquareText, MoreHorizontal, Search, Settings2, Trash2,
  X,
} from 'lucide-react';
import {
  HISTORY_RETENTIONS, SEARCH_MARK, type HistoryPage, type HistoryRetention, type HistorySearchHit, type HistorySessionSummary,
} from '@parakeet/shared';
import { ApiError, api } from '@/lib/api';
import { useRequireSession } from '@/lib/useSession';
import { formatDuration } from '@/lib/practice';
import { AppShell } from '@/components/AppShell';
import { LogoMark } from '@/components/Logo';
import { Spinner } from '@/components/ui';
import { ConfirmDialog, Menu, Toaster, toast } from '@/components/overlay';

const errorText = (e: unknown) => (e instanceof ApiError ? e.message : 'Something went wrong. Try again.');

/** 4500 → "1h 15m" */
const hoursMinutes = (seconds: number) => {
  const m = Math.round(seconds / 60);
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`;
};

const time = (iso: string) => new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });

function dayLabel(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const days = Math.round((new Date(today.toDateString()).getTime() - new Date(d.toDateString()).getTime()) / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return d.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', ...(d.getFullYear() !== today.getFullYear() && { year: 'numeric' }) });
}

/** Renders server-marked search matches without HTML injection. */
function Highlighted({ text }: { text: string }) {
  const parts = text.split(new RegExp(`[${SEARCH_MARK.start}${SEARCH_MARK.end}]`));
  return (
    <>
      {parts.map((p, n) =>
        n % 2 ? (
          <mark key={n} className="rounded bg-brand/20 px-0.5 text-fg">
            {p}
          </mark>
        ) : (
          p
        ),
      )}
    </>
  );
}

export default function HistoryPageView() {
  const email = useRequireSession();
  const router = useRouter();
  const [page, setPage] = useState<HistoryPage | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<HistorySearchHit[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [confirm, setConfirm] = useState<HistorySessionSummary | 'all' | null>(null);
  const searchBox = useRef<HTMLInputElement>(null);

  const load = () =>
    api<HistoryPage>('/v1/history').then(
      (r) => {
        setPage(r);
        setLoadError(null);
      },
      (e) => setLoadError(errorText(e)),
    );

  useEffect(() => {
    if (email) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [email]);

  // Search as you type, a beat after the last key.
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setHits(null);
      return;
    }
    setSearching(true);
    const t = setTimeout(() => {
      api<{ hits: HistorySearchHit[] }>(`/v1/history/search?${new URLSearchParams({ q })}`).then(
        (r) => setHits(r.hits),
        (e) => toast(errorText(e), { tone: 'bad' }),
      ).finally(() => setSearching(false));
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && ['INPUT', 'TEXTAREA'].includes(e.target.tagName);
      if (e.key === '/' && !typing) {
        e.preventDefault();
        searchBox.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const loadMore = async () => {
    if (!page?.next) return;
    setMore(true);
    try {
      const r = await api<HistoryPage>(`/v1/history?${new URLSearchParams({ before: page.next })}`);
      setPage({ ...r, sessions: [...page.sessions, ...r.sessions] });
    } catch (e) {
      toast(errorText(e), { tone: 'bad' });
    }
    setMore(false);
  };

  const remove = async () => {
    if (!confirm) return;
    try {
      if (confirm === 'all') {
        await api('/v1/history', { method: 'DELETE' });
        setPage((p) => (p ? { ...p, sessions: [], next: null } : p));
        toast('All history deleted.');
      } else {
        await api(`/v1/history/${confirm.id}`, { method: 'DELETE' });
        setPage((p) => (p ? { ...p, sessions: p.sessions.filter((s) => s.id !== confirm.id) } : p));
        toast('Session deleted.');
      }
    } catch (e) {
      toast(errorText(e), { tone: 'bad' });
    }
    setConfirm(null);
  };

  const groups = useMemo(() => {
    const out: { day: string; sessions: HistorySessionSummary[] }[] = [];
    for (const s of page?.sessions ?? []) {
      const day = dayLabel(s.startedAt);
      if (out.at(-1)?.day === day) out.at(-1)!.sessions.push(s);
      else out.push({ day, sessions: [s] });
    }
    return out;
  }, [page]);

  if (!email) {
    return (
      <div className="grid min-h-screen place-items-center">
        <LogoMark size={40} />
      </div>
    );
  }

  const totals = page && {
    sessions: page.sessions.length,
    questions: page.sessions.reduce((n, s) => n + s.questions, 0),
    seconds: page.sessions.reduce((n, s) => n + s.seconds, 0),
  };

  return (
    <AppShell email={email}>
      <div className="mx-auto max-w-4xl space-y-6 px-4 py-8 sm:px-8 sm:py-10">
        <header className="flex flex-wrap items-end justify-between gap-4 animate-fade-up">
          <div>
            <p className="eyebrow">Workspace</p>
            <h1 className="mt-1.5 text-3xl font-semibold tracking-tight">History</h1>
            <p className="mt-1.5 max-w-xl text-sm text-muted">
              Every live interview Friday helped you with: the questions you were asked and the answers it suggested.
            </p>
          </div>
          {page && page.sessions.length > 0 && (
            <Menu
              label="History actions"
              trigger={<MoreHorizontal size={18} />}
              items={[
                { label: 'History settings', icon: Settings2, onSelect: () => router.push('/settings#privacy') },
                'divider',
                { label: 'Delete all history', icon: Trash2, danger: true, onSelect: () => setConfirm('all') },
              ]}
            />
          )}
        </header>

        {page && <RetentionNote retention={page.retention} />}

        {page && (page.sessions.length > 0 || query) && page.retention !== 'off' && (
          <label className="relative block animate-fade-up">
            <span className="sr-only">Search your interviews</span>
            <Search size={16} className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-faint" />
            <input
              ref={searchBox}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Escape' && setQuery('')}
              placeholder="Search every question and answer…"
              className="input !rounded-2xl !py-3 !pr-12 !pl-11"
            />
            {searching ? (
              <Spinner className="absolute top-1/2 right-4 -translate-y-1/2 !size-4 text-muted" />
            ) : query ? (
              <button onClick={() => setQuery('')} aria-label="Clear search" className="absolute top-1/2 right-3 -translate-y-1/2 rounded p-1 text-faint hover:text-fg">
                <X size={15} />
              </button>
            ) : (
              <kbd className="pointer-events-none absolute top-1/2 right-4 -translate-y-1/2 rounded border border-line-strong px-1.5 text-[10px] text-faint">/</kbd>
            )}
          </label>
        )}

        {loadError && !page && (
          <div className="glass flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-card)] p-5 text-sm">
            <p className="text-danger">Couldn&apos;t load your history: {loadError}</p>
            <button onClick={load} className="btn btn-secondary !py-1.5">Try again</button>
          </div>
        )}

        {!page && !loadError && (
          <div className="space-y-3">
            {[0, 1, 2].map((n) => (
              <div key={n} className="glass h-20 animate-pulse rounded-2xl" />
            ))}
          </div>
        )}

        {hits ? (
          <SearchResults hits={hits} query={query} />
        ) : (
          page && (
            <>
              {totals && totals.sessions > 0 && (
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { icon: HistoryIcon, label: 'Sessions', value: totals.sessions },
                    { icon: MessageSquareText, label: 'Questions', value: totals.questions },
                    { icon: Clock, label: 'Time', value: hoursMinutes(totals.seconds) },
                  ].map(({ icon: Icon, label, value }) => (
                    <div key={label} className="glass rounded-2xl p-4 animate-fade-up">
                      <p className="flex items-center gap-1.5 text-xs text-muted">
                        <Icon size={13} className="text-brand" /> {label}
                      </p>
                      <p className="mt-1.5 text-xl font-semibold tabular-nums">{value}</p>
                    </div>
                  ))}
                </div>
              )}

              {page.sessions.length === 0 ? (
                <Empty />
              ) : (
                <div className="space-y-6">
                  {groups.map((g) => (
                    <section key={g.day}>
                      <h2 className="eyebrow mb-2 px-1">{g.day}</h2>
                      <ul className="space-y-2">
                        {g.sessions.map((s) => (
                          <SessionRow key={s.id} s={s} onDelete={() => setConfirm(s)} />
                        ))}
                      </ul>
                    </section>
                  ))}
                  {page.next && (
                    <div className="flex justify-center">
                      <button onClick={loadMore} disabled={more} className="btn btn-secondary">
                        {more && <Spinner className="!size-4" />} Show older sessions
                      </button>
                    </div>
                  )}
                </div>
              )}
            </>
          )
        )}
      </div>

      <ConfirmDialog
        open={Boolean(confirm)}
        title={confirm === 'all' ? 'Delete all history?' : 'Delete this session?'}
        text={
          confirm === 'all'
            ? 'Every saved question, answer and summary is deleted. Your usage and minutes are not affected.'
            : 'Its questions, answers and summary are deleted. Your usage and minutes are not affected.'
        }
        confirmLabel="Delete"
        danger
        onConfirm={remove}
        onCancel={() => setConfirm(null)}
      />
      <Toaster />
    </AppShell>
  );
}

function RetentionNote({ retention }: { retention: HistoryRetention }) {
  const r = HISTORY_RETENTIONS.find((x) => x.id === retention)!;
  if (retention === 'off') {
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-white/[0.03] px-4 py-3 text-sm">
        <EyeOff size={16} className="shrink-0 text-muted" />
        <p className="min-w-0 flex-1 text-muted">
          <span className="text-fg">History is off.</span> New questions and answers aren&apos;t saved, so there&apos;s nothing to search or
          summarise.
        </p>
        <Link href="/settings#privacy" className="text-xs font-medium text-brand hover:underline">
          Turn on
        </Link>
      </div>
    );
  }
  return (
    <p className="flex items-center gap-2 px-1 text-xs text-muted">
      <Clock size={13} />
      {retention === 'forever' ? 'Saved until you delete it.' : `Questions and answers are kept for ${r.label}.`}
      <Link href="/settings#privacy" className="text-brand hover:underline">
        Change
      </Link>
    </p>
  );
}

function SessionRow({ s, onDelete }: { s: HistorySessionSummary; onDelete: () => void }) {
  return (
    <li className="group relative rounded-2xl border border-line bg-surface/50 p-4 transition hover:border-line-strong hover:bg-surface-2/50 has-[[aria-expanded=true]]:z-30">
      <Link href={`/history/${s.id}`} className="absolute inset-0 rounded-2xl" aria-label={`Open the session from ${dayLabel(s.startedAt)} at ${time(s.startedAt)}`} />
      <div className="flex items-start gap-4">
        <div className="w-16 shrink-0 pt-0.5">
          <p className="text-sm font-semibold tabular-nums">{time(s.startedAt)}</p>
          <p className="text-xs text-faint tabular-nums">{formatDuration(s.seconds * 1000)}</p>
        </div>
        <div className="min-w-0 flex-1">
          <p className={`line-clamp-1 text-sm ${s.preview ? '' : 'text-muted italic'}`}>
            {s.preview || (s.textCleared ? 'Text deleted under your history setting' : 'No questions asked')}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-muted">
            <span className="flex items-center gap-1">
              <MessageSquareText size={12} /> {s.questions} question{s.questions === 1 ? '' : 's'}
            </span>
            {s.interviews.slice(0, 2).map((i) => (
              <span key={i} className="rounded-full bg-white/5 px-2 py-0.5 ring-1 ring-line">
                {i}
              </span>
            ))}
            {s.summaryStatus === 'ready' && <span className="rounded-full bg-brand/10 px-2 py-0.5 text-brand ring-1 ring-brand/25">Summary</span>}
          </div>
        </div>
        <div className="relative z-10 -mt-1 -mr-1 opacity-60 transition group-hover:opacity-100">
          <Menu label="Session actions" trigger={<MoreHorizontal size={16} />} items={[{ label: 'Delete', icon: Trash2, danger: true, onSelect: onDelete }]} />
        </div>
      </div>
    </li>
  );
}

function SearchResults({ hits, query }: { hits: HistorySearchHit[]; query: string }) {
  if (!hits.length) {
    return (
      <div className="glass grid place-items-center rounded-[var(--radius-card)] px-6 py-14 text-center">
        <Search size={22} className="text-faint" />
        <p className="mt-3 text-sm font-medium">Nothing matches “{query.trim()}”</p>
        <p className="mt-1 text-sm text-muted">Try fewer or different words.</p>
      </div>
    );
  }
  return (
    <section>
      <p className="mb-2 px-1 text-xs text-muted">
        {hits.length}
        {hits.length === 50 ? '+' : ''} match{hits.length === 1 ? '' : 'es'}
      </p>
      <ul className="space-y-2">
        {hits.map((h) => (
          <li key={h.turnId}>
            <Link
              href={`/history/${h.sessionId}#turn-${h.turnId}`}
              className="group block rounded-2xl border border-line bg-surface/50 p-4 transition hover:border-line-strong hover:bg-surface-2/50"
            >
              <p className="text-[11px] text-faint">
                {dayLabel(h.createdAt)} · {time(h.createdAt)}
              </p>
              <p className="mt-1 text-sm font-medium">
                <Highlighted text={h.question} />
              </p>
              <p className="mt-1 line-clamp-2 text-sm text-muted">
                <Highlighted text={h.answer} />
              </p>
              <span className="mt-2 inline-flex items-center gap-1 text-xs text-brand opacity-0 transition group-hover:opacity-100">
                Open session <ArrowRight size={12} />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Empty() {
  return (
    <section className="relative overflow-hidden rounded-[var(--radius-card)] border border-line px-6 py-14 text-center animate-fade-up">
      <div className="absolute inset-0 -z-10 bg-surface" />
      <div className="absolute inset-0 -z-10 bg-grid" />
      <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-white/5 text-brand ring-1 ring-line-strong">
        <HistoryIcon size={24} />
      </span>
      <h2 className="mt-5 text-xl font-semibold tracking-tight">No interviews yet</h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted">
        When you use Friday in a live interview from the desktop app, the questions and answers show up here to review and
        search.
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        <Link href="/#download" className="btn btn-primary">
          <Download size={16} /> Get the desktop app
        </Link>
        <Link href="/practice" className="btn btn-secondary">
          Practise first
        </Link>
      </div>
    </section>
  );
}
