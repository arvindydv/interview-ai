'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowRight, CalendarClock, Copy, MessageSquareText, MoreHorizontal, Pencil, Plus, Radio, Search, Sparkles, Trash2,
  Trophy, X,
} from 'lucide-react';
import { ROUND_TYPES, type InterviewStage, type InterviewSummary, type Resume } from '@parakeet/shared';
import { ApiError, api } from '@/lib/api';
import { useRequireSession } from '@/lib/useSession';
import {
  formatWhen, interviewSubtitle, interviewTitle, isClosed, isUpcoming, readiness, relative, roundLabel, stageLabel,
} from '@/lib/interviews';
import { AppShell } from '@/components/AppShell';
import { LogoMark } from '@/components/Logo';
import { ConfirmDialog, Menu, Toaster, toast } from '@/components/overlay';
import {
  ActiveBadge, Monogram, ReadinessBar, ReadinessList, ReadinessRing, StagePicker,
} from '@/components/interviews/parts';

type Filter = 'all' | 'upcoming' | 'preparing' | 'done' | 'offer' | 'closed';
type Sort = 'recent' | 'date';

const FILTERS: { id: Filter; label: string; match: (i: InterviewSummary, now: number) => boolean }[] = [
  { id: 'all', label: 'All', match: () => true },
  { id: 'upcoming', label: 'Upcoming', match: (i, now) => isUpcoming(i, now) },
  { id: 'preparing', label: 'Preparing', match: (i) => i.stage === 'preparing' },
  { id: 'done', label: 'Interviewed', match: (i) => i.stage === 'done' },
  { id: 'offer', label: 'Offers', match: (i) => i.stage === 'offer' },
  { id: 'closed', label: 'Closed', match: (i) => isClosed(i.stage) },
];

const plural = (n: number, word: string, prefix = '') => `${prefix}${n} ${word}${n === 1 ? '' : 's'}`;

const errorText = (e: unknown) => (e instanceof ApiError ? e.message : 'Something went wrong. Try again.');

const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName));

export default function InterviewsPage() {
  const email = useRequireSession();
  const router = useRouter();
  const [list, setList] = useState<InterviewSummary[] | null>(null);
  const [resume, setResume] = useState<Resume | null | undefined>(undefined);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [sort, setSort] = useState<Sort>('recent');
  const [query, setQuery] = useState('');
  const [deleting, setDeleting] = useState<InterviewSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const search = useRef<HTMLInputElement>(null);
  const [now] = useState(() => Date.now());

  const load = () =>
    api<{ interviews: InterviewSummary[] }>('/v1/interviews').then(
      (r) => {
        setList(r.interviews);
        setLoadError(null);
      },
      (e) => setLoadError(errorText(e)),
    );

  useEffect(() => {
    if (!email) return;
    load();
    // Readiness works without it; a missing resume just shows as a gap.
    api<{ resume: Resume | null }>('/v1/resume').then((r) => setResume(r.resume), () => setResume(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [email]);

  // N: new interview, /: search.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      if (e.key === 'n') {
        e.preventDefault();
        router.push('/interviews/new');
      } else if (e.key === '/') {
        e.preventDefault();
        search.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [router]);

  const active = list?.find((i) => i.active) ?? null;

  const shown = useMemo(() => {
    if (!list) return [];
    const q = query.trim().toLowerCase();
    const match = FILTERS.find((f) => f.id === filter)!.match;
    const out = list.filter(
      (i) => match(i, now) && (!q || [i.role, i.company, i.field].some((s) => s.toLowerCase().includes(q))),
    );
    if (sort === 'date') {
      const t = (i: InterviewSummary) => (i.scheduledAt ? new Date(i.scheduledAt).getTime() : Infinity);
      out.sort((a, b) => t(a) - t(b));
    }
    return out;
  }, [list, filter, sort, query, now]);

  const counts = useMemo(
    () => Object.fromEntries(FILTERS.map((f) => [f.id, list?.filter((i) => f.match(i, now)).length ?? 0])) as Record<Filter, number>,
    [list, now],
  );

  const patchLocal = (id: string, change: Partial<InterviewSummary>) =>
    setList((l) => l?.map((i) => (i.id === id ? { ...i, ...change } : i)) ?? l);

  const activate = async (i: InterviewSummary) => {
    try {
      await api(`/v1/interviews/${i.id}/activate`, { method: 'POST' });
      setList((l) => l?.map((x) => ({ ...x, active: x.id === i.id })) ?? l);
      toast(`${interviewTitle(i)} is now active. Your next live answer uses it.`);
    } catch (e) {
      toast(errorText(e), { tone: 'bad' });
    }
  };

  const setStage = async (i: InterviewSummary, stage: InterviewStage) => {
    const before = i.stage;
    patchLocal(i.id, { stage });
    try {
      await api(`/v1/interviews/${i.id}`, { method: 'PATCH', body: JSON.stringify({ stage }) });
      if (stage === 'offer') toast(`Congratulations on the offer from ${i.company || 'them'}! 🎉`);
      else toast(`Marked as ${stageLabel(stage).toLowerCase()}.`, { action: { label: 'Undo', run: () => setStage({ ...i, stage }, before) } });
    } catch (e) {
      patchLocal(i.id, { stage: before });
      toast(errorText(e), { tone: 'bad' });
    }
  };

  const duplicate = async (i: InterviewSummary) => {
    try {
      const r = await api<{ interview: InterviewSummary }>(`/v1/interviews/${i.id}/duplicate`, { method: 'POST' });
      router.push(`/interviews/${r.interview.id}?copied=1`);
    } catch (e) {
      toast(errorText(e), { tone: 'bad' });
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    setBusy(true);
    try {
      await api(`/v1/interviews/${deleting.id}`, { method: 'DELETE' });
      toast(`Deleted ${interviewTitle(deleting)}.`);
      setDeleting(null);
      // The active interview may have moved to another one.
      await load();
    } catch (e) {
      toast(errorText(e), { tone: 'bad' });
    } finally {
      setBusy(false);
    }
  };

  if (!email) {
    return (
      <div className="grid min-h-screen place-items-center">
        <LogoMark size={40} />
      </div>
    );
  }

  return (
    <AppShell email={email}>
      <div className="mx-auto max-w-5xl space-y-6 px-4 py-8 sm:px-8 sm:py-10">
        <header className="flex flex-wrap items-end justify-between gap-4 animate-fade-up">
          <div>
            <p className="eyebrow">Workspace</p>
            <h1 className="mt-1.5 text-3xl font-semibold tracking-tight">Interviews</h1>
            <p className="mt-1.5 max-w-xl text-sm text-muted">
              Every interview you&apos;re preparing for. Friday tailors live answers to the <span className="text-fg">active</span> one.
            </p>
          </div>
          {list && list.length > 0 && (
            <Link href="/interviews/new" className="btn btn-primary">
              <Plus size={16} /> New interview
              <kbd className="ml-1 hidden rounded border border-black/20 px-1.5 text-[10px] font-semibold opacity-60 sm:inline">N</kbd>
            </Link>
          )}
        </header>

        {loadError && !list && (
          <div className="glass flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-card)] p-5 text-sm">
            <p className="text-danger">Couldn&apos;t load your interviews: {loadError}</p>
            <button onClick={load} className="btn btn-secondary !py-1.5">Try again</button>
          </div>
        )}

        {!list && !loadError && <ListSkeleton />}

        {list && list.length === 0 && <EmptyState />}

        {list && list.length > 0 && (
          <>
            {active && <ActiveSpotlight interview={active} resume={resume} now={now} />}

            <PipelineStats list={list} now={now} />

            <div className="space-y-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1 sm:pb-0" role="tablist" aria-label="Filter interviews">
                  {FILTERS.map((f) => (
                    <button
                      key={f.id}
                      role="tab"
                      aria-selected={filter === f.id}
                      onClick={() => setFilter(f.id)}
                      className={`flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition ${
                        filter === f.id ? 'bg-white/[0.08] text-fg ring-1 ring-line-strong' : 'text-muted hover:bg-white/[0.04] hover:text-fg'
                      }`}
                    >
                      {f.label}
                      <span className={`text-xs tabular-nums ${filter === f.id ? 'text-muted' : 'text-faint'}`}>{counts[f.id]}</span>
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <label className="relative flex-1 sm:w-56 sm:flex-none">
                    <span className="sr-only">Search interviews</span>
                    <Search size={15} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-faint" />
                    <input
                      ref={search}
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      onKeyDown={(e) => e.key === 'Escape' && (setQuery(''), e.currentTarget.blur())}
                      placeholder="Search"
                      className="input !py-1.5 !pr-8 !pl-9 !text-sm"
                    />
                    {query ? (
                      <button onClick={() => setQuery('')} aria-label="Clear search" className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-0.5 text-faint hover:text-fg">
                        <X size={14} />
                      </button>
                    ) : (
                      <kbd className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 rounded border border-line-strong px-1.5 text-[10px] text-faint">/</kbd>
                    )}
                  </label>
                  <select
                    value={sort}
                    onChange={(e) => setSort(e.target.value as Sort)}
                    aria-label="Sort"
                    className="input !w-auto !py-1.5 !pr-8 !text-sm"
                  >
                    <option value="recent">Recently edited</option>
                    <option value="date">Interview date</option>
                  </select>
                </div>
              </div>

              {shown.length === 0 ? (
                <div className="glass grid place-items-center rounded-[var(--radius-card)] px-6 py-14 text-center">
                  <Search size={22} className="text-faint" />
                  <p className="mt-3 text-sm font-medium">No interviews match</p>
                  <p className="mt-1 text-sm text-muted">Try another filter or search.</p>
                  <button
                    onClick={() => {
                      setFilter('all');
                      setQuery('');
                    }}
                    className="btn btn-ghost mt-3 !py-1.5 text-brand"
                  >
                    Show all
                  </button>
                </div>
              ) : (
                <ul className="grid gap-3 md:grid-cols-2">
                  {shown.map((i, n) => (
                    <InterviewCard
                      key={i.id}
                      interview={i}
                      score={readiness(i, resume).score}
                      now={now}
                      index={n}
                      onActivate={() => activate(i)}
                      onStage={(s) => setStage(i, s)}
                      onDuplicate={() => duplicate(i)}
                      onDelete={() => setDeleting(i)}
                    />
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </div>

      <ConfirmDialog
        open={Boolean(deleting)}
        title="Delete this interview?"
        text={
          <>
            <span className="text-fg">{deleting && interviewTitle(deleting)}</span> and its job description, answer style and
            notes will be removed. Past questions stay in your history.
          </>
        }
        confirmLabel={busy ? 'Deleting…' : 'Delete'}
        danger
        busy={busy}
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />
      <Toaster />
    </AppShell>
  );
}

// ---- active interview ----------------------------------------------------------------------------

function ActiveSpotlight({ interview: i, resume, now }: { interview: InterviewSummary; resume: Resume | null | undefined; now: number }) {
  const router = useRouter();
  const { score, items } = readiness(i, resume);
  const gaps = items.filter((it) => !it.done);
  const subtitle = interviewSubtitle(i);
  return (
    <section className="conic-border relative overflow-hidden rounded-[var(--radius-card)] animate-fade-up">
      <div className="absolute inset-0 -z-10 bg-surface" />
      <div className="absolute -top-32 -right-24 -z-10 size-[28rem] glow opacity-80" />
      <div className="grid gap-6 p-6 sm:p-7 lg:grid-cols-[1fr_auto]">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <ActiveBadge />
            <span className="text-xs text-muted">Used for every live answer</span>
          </div>
          <div className="mt-4 flex items-center gap-4">
            <Monogram name={i.company || i.role || i.field} size={52} />
            <div className="min-w-0">
              <h2 className="truncate text-xl font-semibold tracking-tight">{interviewTitle(i)}</h2>
              <p className="truncate text-sm text-muted">
                {[subtitle, roundLabel(i.roundType)].filter(Boolean).join(' · ')}
              </p>
            </div>
          </div>

          <dl className="mt-5 flex flex-wrap gap-x-8 gap-y-3 text-sm">
            <div>
              <dt className="text-xs text-faint">Interview</dt>
              <dd className="mt-0.5">
                {i.scheduledAt ? (
                  <>
                    {formatWhen(i.scheduledAt)} <span className="text-brand">· {relative(i.scheduledAt, now)}</span>
                  </>
                ) : (
                  <Link href={`/interviews/${i.id}#schedule`} className="text-muted underline decoration-line-strong underline-offset-4 hover:text-fg">
                    Add date
                  </Link>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-faint">Questions answered</dt>
              <dd className="mt-0.5 tabular-nums">{i.stats.questions}</dd>
            </div>
            <div>
              <dt className="text-xs text-faint">Last used</dt>
              <dd className="mt-0.5">{i.stats.lastUsedAt ? relative(i.stats.lastUsedAt, now) : 'Not yet'}</dd>
            </div>
          </dl>

          <div className="mt-6 flex flex-wrap gap-2">
            <Link href={`/interviews/${i.id}`} className="btn btn-primary !py-2">
              <Pencil size={15} /> Edit details
            </Link>
            <Link href="/#download" className="btn btn-secondary !py-2">
              Get the desktop app <ArrowRight size={15} />
            </Link>
          </div>
        </div>

        <div className="flex gap-5 rounded-2xl border border-line bg-bg/40 p-4 lg:w-80">
          <ReadinessRing score={score} />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">{score === 100 ? 'Fully prepared' : 'Readiness'}</p>
            <p className="mt-0.5 text-xs text-muted">
              {score === 100
                ? 'Friday has everything it needs for tailored answers.'
                : `${gaps.length} thing${gaps.length === 1 ? '' : 's'} would make answers sharper.`}
            </p>
            {gaps.length > 0 && (
              <div className="-mx-2 mt-2">
                <ReadinessList
                  items={gaps.slice(0, 2)}
                  onFix={(key) => router.push(key === 'resume' ? '/resume' : `/interviews/${i.id}#${key}`)}
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

// ---- pipeline ------------------------------------------------------------------------------------

function PipelineStats({ list, now }: { list: InterviewSummary[]; now: number }) {
  const upcoming = list
    .filter((i) => isUpcoming(i, now))
    .sort((a, b) => new Date(a.scheduledAt!).getTime() - new Date(b.scheduledAt!).getTime());
  const next = upcoming.find((i) => new Date(i.scheduledAt!).getTime() > now);
  const tiles = [
    {
      icon: CalendarClock,
      label: 'Upcoming',
      value: upcoming.length,
      note: next ? `Next ${relative(next.scheduledAt!, now)}` : 'Nothing scheduled',
    },
    { icon: Sparkles, label: 'Preparing', value: list.filter((i) => i.stage === 'preparing').length, note: `${list.length} in total` },
    {
      icon: MessageSquareText,
      label: 'Questions answered',
      value: list.reduce((n, i) => n + i.stats.questions, 0),
      note: plural(list.reduce((n, i) => n + i.stats.sessions, 0), 'session', 'Across '),
    },
    {
      icon: Trophy,
      label: 'Offers',
      value: list.filter((i) => i.stage === 'offer').length,
      note: `${list.filter((i) => i.stage === 'done').length} awaiting result`,
    },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {tiles.map(({ icon: Icon, label, value, note }, n) => (
        <div key={label} className="glass rounded-2xl p-4 animate-fade-up" style={{ animationDelay: `${60 + n * 50}ms` }}>
          <div className="flex items-center gap-2 text-xs text-muted">
            <Icon size={14} className="text-brand" /> {label}
          </div>
          <p className="mt-2 text-2xl font-semibold tabular-nums tracking-tight">{value}</p>
          <p className="mt-0.5 truncate text-xs text-faint">{note}</p>
        </div>
      ))}
    </div>
  );
}

// ---- card ----------------------------------------------------------------------------------------

function InterviewCard({
  interview: i,
  score,
  now,
  index,
  onActivate,
  onStage,
  onDuplicate,
  onDelete,
}: {
  interview: InterviewSummary;
  score: number;
  now: number;
  index: number;
  onActivate: () => void;
  onStage: (s: InterviewStage) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const router = useRouter();
  const subtitle = interviewSubtitle(i);
  const upcoming = isUpcoming(i, now);
  return (
    <li
      className={`group relative flex flex-col rounded-2xl has-[[aria-expanded=true]]:z-30 border bg-surface/60 p-4 transition duration-200 hover:-translate-y-0.5 hover:border-line-strong hover:bg-surface-2/60 hover:shadow-xl hover:shadow-black/30 animate-fade-up ${
        i.active ? 'border-brand/30' : 'border-line'
      } ${isClosed(i.stage) ? 'opacity-70 hover:opacity-100' : ''}`}
      style={{ animationDelay: `${Math.min(index, 8) * 40}ms` }}
    >
      <Link href={`/interviews/${i.id}`} className="absolute inset-0 rounded-2xl" aria-label={`Open ${interviewTitle(i)}`} />
      <div className="flex items-start gap-3">
        <Monogram name={i.company || i.role || i.field} size={40} />
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-semibold">{interviewTitle(i)}</h3>
          <p className="truncate text-sm text-muted">{[subtitle, roundLabel(i.roundType)].filter(Boolean).join(' · ')}</p>
        </div>
        <div className="relative z-10 -mt-1 -mr-1">
          <Menu
            label="Interview actions"
            trigger={<MoreHorizontal size={18} />}
            items={[
              { label: 'Edit', icon: Pencil, onSelect: () => router.push(`/interviews/${i.id}`) },
              { label: i.active ? 'Active interview' : 'Make active', icon: Radio, onSelect: onActivate, disabled: i.active },
              { label: 'Duplicate for next round', icon: Copy, onSelect: onDuplicate },
              'divider',
              { label: 'Delete', icon: Trash2, onSelect: onDelete, danger: true },
            ]}
          />
        </div>
      </div>

      <div className="relative z-10 mt-3 flex flex-wrap items-center gap-2 self-start">
        <StagePicker stage={i.stage} onChange={onStage} />
        {i.active && <ActiveBadge />}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-line pt-3 text-xs text-muted">
        <span className="flex items-center gap-1.5">
          <CalendarClock size={13} className={upcoming ? 'text-brand' : 'text-faint'} />
          {i.scheduledAt ? (
            <>
              {formatWhen(i.scheduledAt)}
              {upcoming && <span className="text-brand">· {relative(i.scheduledAt, now)}</span>}
            </>
          ) : (
            <span className="text-faint">No date</span>
          )}
        </span>
        <span className="flex items-center gap-4">
          {i.stats.questions > 0 && (
            <span className="flex items-center gap-1.5" title="Questions answered">
              <MessageSquareText size={13} className="text-faint" /> {i.stats.questions}
            </span>
          )}
          <ReadinessBar score={score} />
        </span>
      </div>
    </li>
  );
}

// ---- empty and loading ---------------------------------------------------------------------------

function EmptyState() {
  const starters = ROUND_TYPES.filter((r) => !r.softwareOnly);
  return (
    <section className="relative overflow-hidden rounded-[var(--radius-card)] border border-line animate-fade-up">
      <div className="absolute inset-0 -z-10 bg-surface" />
      <div className="aurora -z-10 opacity-50">
        <span />
        <span />
        <span />
      </div>
      <div className="absolute inset-0 -z-10 bg-grid" />
      <div className="px-6 py-12 text-center sm:px-12 sm:py-16">
        <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-white/5 text-brand ring-1 ring-line-strong">
          <Sparkles size={24} />
        </span>
        <h2 className="mt-5 text-2xl font-semibold tracking-tight">Set up your first interview</h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted">
          Tell Friday the role, the organisation and the job description. Every live answer is then tailored to that
          interview, in your own words.
        </p>
        <Link href="/interviews/new" className="btn btn-primary btn-shine mt-6">
          <Plus size={16} /> New interview
        </Link>

        <p className="eyebrow mt-10">Or start from a round</p>
        <div className="mx-auto mt-3 grid max-w-3xl gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {starters.map((r) => (
            <Link
              key={r.id}
              href={`/interviews/new?round=${r.id}`}
              className="group rounded-xl border border-line bg-bg/50 p-3.5 text-left backdrop-blur transition hover:border-brand/30 hover:bg-white/[0.04]"
            >
              <span className="flex items-center justify-between text-sm font-medium">
                {r.label}
                <ArrowRight size={14} className="text-faint transition group-hover:translate-x-0.5 group-hover:text-brand" />
              </span>
              <span className="mt-0.5 block text-xs text-muted">{r.hint}</span>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

function ListSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading interviews">
      <div className="glass h-56 animate-pulse rounded-[var(--radius-card)]" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((n) => (
          <div key={n} className="glass h-24 animate-pulse rounded-2xl" />
        ))}
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {[0, 1, 2, 3].map((n) => (
          <div key={n} className="glass flex h-36 items-start gap-3 rounded-2xl p-4">
            <div className="size-10 animate-pulse rounded-xl bg-white/5" />
            <div className="flex-1 space-y-2 pt-1">
              <div className="h-3.5 w-2/3 animate-pulse rounded bg-white/5" />
              <div className="h-3 w-1/2 animate-pulse rounded bg-white/5" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
