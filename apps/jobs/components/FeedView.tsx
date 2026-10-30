'use client';
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  Bookmark, ChevronLeft, ChevronRight, FileText, MapPin, Search, Send, SlidersHorizontal, Sparkles, Target, TrendingUp,
} from 'lucide-react';
import {
  LISTING_LIMITS, type ApplicationStatus, type FeedFacets, type FeedFilters, type FeedPage, type FeedView as View,
} from '@parakeet/shared';
import { FilterBar, SortMenu } from './Filters';
import { JobCard, JobCardSkeleton } from './JobCard';
import { JobDetail } from './JobDetail';
import { ResumeUploadButton } from './ResumeUpload';
import { WebResults } from './WebResults';
import { Spinner } from './ui';
import { api } from '@/lib/api';
import { activeFilterCount, filterParams, readFilters } from '@/lib/filters';
import { useJobs } from '@/lib/jobs';

const COPY: Record<View, { title: string; subtitle: string; empty: string }> = {
  recommended: {
    title: 'Recommended for you',
    subtitle: 'Good matches for your resume, newest first.',
    empty: 'No good matches right now. Widen your roles or locations in your preferences.',
  },
  top: {
    title: 'Top matches',
    subtitle: 'The roles that fit your experience best.',
    empty: 'No strong matches right now. New jobs arrive every 30 minutes.',
  },
  all: {
    title: 'All jobs',
    subtitle: 'Every open role on Friday Jobs, with your match where there is one.',
    empty: 'No jobs match this search. Try a broader keyword or another location.',
  },
  saved: {
    title: 'Saved jobs',
    subtitle: 'Roles you bookmarked to come back to.',
    empty: 'Nothing saved yet. Tap Save on any job to keep it here.',
  },
  applied: {
    title: 'Applied',
    subtitle: 'Track every application from applied to offer.',
    empty: 'No applications yet. When you apply to a job, mark it applied to track it here.',
  },
};

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

function useWide() {
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1280px)');
    setWide(mq.matches);
    const onChange = () => setWide(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return wide;
}

/** Recommended and Top: a personal overview above the list. */
function Overview({ view }: { view: View }) {
  const { summary, email } = useJobs();
  const name = (summary?.profile.name ?? email.split('@')[0]).split(/\s+/)[0];
  const c = summary?.counts;
  const tiles = [
    { href: '/recommended', label: 'Matches for you', value: c?.recommended, icon: Sparkles, wash: 'from-emerald-500/10', color: 'text-emerald-700', on: view === 'recommended' },
    { href: '/top', label: 'Strong matches', value: c?.top, icon: Target, wash: 'from-cyan-500/10', color: 'text-cyan-700', on: view === 'top' },
    { href: '/recommended?posted=7', label: 'New this week', value: c?.newThisWeek, icon: TrendingUp, wash: 'from-violet-500/10', color: 'text-violet-700', on: false },
    { href: '/applied', label: 'Applied', value: c?.applied, icon: Send, wash: 'from-amber-500/10', color: 'text-amber-700', on: false },
  ];

  return (
    <div className="relative overflow-hidden rounded-3xl border border-line bg-surface p-6 shadow-[var(--shadow-card)] sm:p-7">
      <div className="hero-wash pointer-events-none absolute inset-0 opacity-80" />
      <div className="relative flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-medium text-muted">
            {greeting()}, {name}
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-[28px]">{COPY[view].title}</h1>
          {summary?.profile.headline && (
            <p className="mt-1.5 max-w-xl truncate text-sm text-muted">
              Matched to <span className="text-fg">{summary.profile.headline}</span>
            </p>
          )}
        </div>
        <Link href="/profile" className="btn btn-secondary !py-2 text-sm">
          <SlidersHorizontal size={15} /> Preferences
        </Link>
      </div>
      <div className="relative mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map(({ href, label, value, icon: Icon, wash, color, on }) => (
          <Link
            key={label}
            href={href}
            className={`group rounded-2xl border bg-gradient-to-br to-transparent p-4 transition ${wash} ${
              on ? 'border-brand/40 ring-4 ring-brand/[0.07]' : 'border-line hover:border-line-strong'
            }`}
          >
            <span className={`grid size-8 place-items-center rounded-lg bg-white shadow-[var(--shadow-card)] ${color}`}>
              <Icon size={16} />
            </span>
            <p className="mt-3 text-2xl font-semibold tracking-tight tabular-nums">{value ?? '–'}</p>
            <p className="text-xs font-medium text-muted">{label}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}

/** A fixed slice of a view, e.g. Remote jobs: All jobs with the workplace pinned to remote. */
interface Preset {
  filters: Partial<FeedFilters>;
  title: string;
  subtitle: string;
}

function Feed({ view, preset }: { view: View; preset?: Preset }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { summary, reload } = useJobs();
  const [data, setData] = useState<FeedPage | null>(null);
  const [facets, setFacets] = useState<FeedFacets | null>(null);
  const [error, setError] = useState<string | null>(null);
  const wide = useWide();

  const paramString = params.toString();
  const filters = useMemo(() => ({ ...readFilters(new URLSearchParams(paramString)), ...preset?.filters }), [paramString, preset]);
  const page = Math.min(Math.max(1, Number(params.get('page')) || 1), LISTING_LIMITS.maxPage);
  const selected = params.get('job');
  const matched = view === 'recommended' || view === 'top';
  const tracked = view === 'saved' || view === 'applied';
  const copy = preset ? { ...COPY[view], ...preset } : COPY[view];
  const sort = filters.sort ?? (view === 'top' ? 'match' : 'newest');

  const setParams = useCallback(
    (changes: Record<string, string | null>, resetPage = true) => {
      const next = new URLSearchParams(params);
      for (const [k, v] of Object.entries(changes)) (v ? next.set(k, v) : next.delete(k));
      if (resetPage) next.delete('page');
      router.replace(`${pathname}${next.size ? `?${next}` : ''}`, { scroll: false });
    },
    [params, pathname, router],
  );
  const setFilters = (change: Partial<FeedFilters>) => {
    const next = filterParams({ ...filters, ...change });
    // Pinned filters live in the page, not the URL.
    for (const k of Object.keys(preset?.filters ?? {})) delete next[k];
    setParams({ ...next, job: null });
  };

  // The query string the API takes: the URL's filters, without the open job and page.
  const filterQuery = useMemo(() => {
    const query = new URLSearchParams({ view });
    for (const [k, v] of Object.entries(filterParams(filters))) {
      if (v && (!tracked || k === 'q')) query.set(k, v);
    }
    return query.toString();
  }, [filters, view, tracked]);

  const load = useCallback(async () => {
    try {
      setData(await api<FeedPage>(`/v1/job-feed?${filterQuery}${page > 1 ? `&page=${page}` : ''}`));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [filterQuery, page]);

  // Reload when the search changes, and when fresh matches land.
  useEffect(() => {
    setData(null);
    load();
  }, [load, summary?.matchedAt]);

  useEffect(() => {
    if (tracked) return;
    let cancelled = false;
    api<FeedFacets>(`/v1/job-feed/facets?${filterQuery}`).then((f) => !cancelled && setFacets(f), () => {});
    return () => {
      cancelled = true;
    };
  }, [filterQuery, tracked, summary?.matchedAt]);

  const onStatus = (id: string, status: ApplicationStatus | null) => {
    setData((d) => (d ? { ...d, items: d.items.map((i) => (i.id === id ? { ...i, status } : i)) } : d));
    reload();
  };
  const toggleSave = async (id: string, saved: boolean) => {
    onStatus(id, saved ? null : 'saved');
    await api(`/v1/job-feed/${id}/status`, { method: 'PUT', body: JSON.stringify({ status: saved ? null : 'saved' }) }).catch(() => load());
  };

  const noResume = summary && summary.profile.resumeStatus === null && !summary.preferences.roles.length;
  const analysing = summary?.profile.resumeStatus === 'parsing' || (matched && summary?.matching && !data?.items.length);
  const lastPage = data ? Math.min(Math.ceil(data.total / data.pageSize), LISTING_LIMITS.maxPage) : 1;
  const selectedItem = data?.items.find((i) => i.id === selected);
  const filtered = Boolean(filters.q || filters.location || activeFilterCount(filters));
  const closeDetail = () => setParams({ job: null }, false);
  // Wide screens show the job beside the list; narrower ones as a sheet over it.
  const detail = selected && (
    <JobDetail key={selected} id={selected} fallback={selectedItem} onClose={closeDetail} onStatus={onStatus} />
  );

  return (
    <div className="flex min-h-screen">
      <div className={`min-w-0 flex-1 ${selected && wide ? 'max-w-[680px] 2xl:max-w-[760px]' : ''}`}>
        <div className="mx-auto max-w-5xl px-4 pt-6 pb-16 sm:px-8 sm:pt-8">
          {matched ? (
            <Overview view={view} />
          ) : (
            <header>
              <h1 className="text-2xl font-semibold tracking-tight sm:text-[28px]">{copy.title}</h1>
              <p className="mt-1 text-muted">{copy.subtitle}</p>
            </header>
          )}

          <div className="sticky top-[57px] z-10 -mx-4 mt-6 bg-bg/85 px-4 pt-2 pb-3 backdrop-blur-md sm:-mx-8 sm:px-8 lg:top-0">
            <form
              key={`${filters.q}|${filters.location}`}
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                setFilters({ q: String(f.get('q') ?? '').trim(), location: String(f.get('location') ?? '').trim() });
              }}
              className="flex flex-col gap-1.5 rounded-2xl border border-line bg-surface p-1.5 shadow-[var(--shadow-card)] sm:flex-row sm:items-center"
            >
              <label className="relative flex-1">
                <Search size={17} className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-faint" />
                <input
                  name="q"
                  defaultValue={filters.q}
                  placeholder={tracked ? 'Search your jobs' : 'Job title, skill or company'}
                  className="w-full rounded-xl bg-transparent py-2.5 pr-3 pl-10 text-[15px] outline-none placeholder:text-faint focus:bg-surface-2/60"
                />
              </label>
              {!tracked && (
                <>
                  <span className="hidden h-6 w-px bg-line sm:block" />
                  <label className="relative flex-1">
                    <MapPin size={17} className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-faint" />
                    <input
                      name="location"
                      defaultValue={filters.location}
                      placeholder="City, country or remote"
                      className="w-full rounded-xl bg-transparent py-2.5 pr-3 pl-10 text-[15px] outline-none placeholder:text-faint focus:bg-surface-2/60"
                    />
                  </label>
                </>
              )}
              <button className="btn btn-primary !px-5">Search</button>
            </form>
            {!tracked && (
              <div className="mt-3">
                <FilterBar filters={filters} facets={facets} onChange={setFilters} showMatch={view !== 'top'} hide={Object.keys(preset?.filters ?? {})} />
              </div>
            )}
          </div>

          {matched && summary && !noResume && !summary.preferences.locations.length && (
            <div className="mt-3 flex items-center gap-3 rounded-xl border border-cyan-600/15 bg-cyan-50/60 px-4 py-3 text-sm">
              <MapPin size={16} className="shrink-0 text-cyan-700" />
              <p className="flex-1 text-muted">
                <span className="font-medium text-fg">Showing jobs everywhere.</span> Add the cities you&rsquo;d work in to see
                jobs near you.
              </p>
              <Link href="/profile" className="font-medium whitespace-nowrap text-cyan-700 hover:underline">
                Set locations
              </Link>
            </div>
          )}

          <div className="mt-3">
            {matched && noResume ? (
              <div className="rounded-2xl border border-line bg-surface p-8 text-center shadow-[var(--shadow-card)] sm:p-12">
                <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-gradient-to-br from-emerald-50 to-cyan-50 text-brand">
                  <FileText size={26} />
                </span>
                <h2 className="mt-5 text-xl font-semibold">Add your resume to get matched</h2>
                <p className="mx-auto mt-2 max-w-md text-muted">
                  Friday reads your skills, titles and experience, then ranks every job by how well it fits you. It&rsquo;s the
                  same resume Friday AI uses in your interviews.
                </p>
                <div className="mt-6 flex justify-center">
                  <ResumeUploadButton />
                </div>
                <p className="mt-4 text-xs text-faint">PDF, DOCX or TXT, up to 5 MB</p>
              </div>
            ) : analysing ? (
              <div>
                <div className="mb-4 flex items-center gap-3 rounded-xl border border-brand/15 bg-brand/5 px-4 py-3 text-sm">
                  <Sparkles size={16} className="shrink-0 text-brand" />
                  <p className="flex-1">
                    <span className="font-medium">
                      {summary?.profile.resumeStatus === 'parsing' ? 'Reading your resume…' : 'Finding your matches…'}
                    </span>{' '}
                    <span className="text-muted">This takes a few seconds.</span>
                  </p>
                  <Spinner className="text-brand" />
                </div>
                <div className="grid gap-3">
                  {Array.from({ length: 4 }, (_, i) => (
                    <JobCardSkeleton key={i} />
                  ))}
                </div>
              </div>
            ) : error ? (
              <p className="rounded-xl border border-danger/20 bg-danger/5 px-4 py-3 text-sm text-danger">
                Couldn&rsquo;t load jobs: {error}
              </p>
            ) : (
              <>
                <div className="mb-3 flex min-h-9 items-center justify-between gap-3">
                  <p className="text-sm text-muted">
                    {data ? (
                      <>
                        <span className="font-semibold text-fg tabular-nums">{data.total.toLocaleString('en-IN')}</span>{' '}
                        {data.total === 1 ? 'job' : 'jobs'}
                        {filtered && ' match your filters'}
                      </>
                    ) : (
                      <span className="skeleton inline-block h-4 w-24 align-middle" />
                    )}
                  </p>
                  {!tracked && <SortMenu sort={sort} onChange={(s) => setFilters({ sort: s })} />}
                </div>

                {!data ? (
                  <div className="grid gap-3">
                    {Array.from({ length: 5 }, (_, i) => (
                      <JobCardSkeleton key={i} />
                    ))}
                  </div>
                ) : data.items.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-line-strong bg-surface/60 px-6 py-14 text-center">
                    <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-surface-2 text-faint">
                      {tracked ? view === 'saved' ? <Bookmark size={22} /> : <Send size={22} /> : <Search size={22} />}
                    </span>
                    <p className="mx-auto mt-4 max-w-sm text-muted">{filtered ? 'No jobs match these filters. Try removing one.' : copy.empty}</p>
                  </div>
                ) : (
                  <>
                    <div className="grid gap-3">
                      {data.items.map((job) => (
                        <JobCard
                          key={job.id}
                          job={job}
                          selected={job.id === selected}
                          onSelect={() => setParams({ job: job.id }, false)}
                          onToggleSave={() => toggleSave(job.id, job.status === 'saved')}
                        />
                      ))}
                    </div>
                    {lastPage > 1 && (
                      <nav className="mt-8 flex items-center justify-center gap-3 text-sm" aria-label="Pages">
                        <button
                          disabled={page <= 1}
                          onClick={() => setParams({ page: String(page - 1), job: null }, false)}
                          className="btn btn-secondary"
                        >
                          <ChevronLeft size={16} /> Previous
                        </button>
                        <span className="text-muted tabular-nums">
                          Page {page} of {lastPage}
                        </span>
                        <button
                          disabled={page >= lastPage}
                          onClick={() => setParams({ page: String(page + 1), job: null }, false)}
                          className="btn btn-secondary"
                        >
                          Next <ChevronRight size={16} />
                        </button>
                      </nav>
                    )}
                  </>
                )}
                {view === 'all' && filters.q && data && (data.items.length === 0 || page >= lastPage) && (
                  <WebResults
                    key={`${filters.q}|${filters.location}`}
                    q={filters.q}
                    location={filters.location}
                    internship={Boolean(filters.type?.includes('internship') || filters.level?.includes(0))}
                  />
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {selected &&
        (wide ? (
          <aside className="sticky top-0 h-screen min-w-0 flex-1 border-l border-line bg-surface">{detail}</aside>
        ) : (
          <div className="fixed inset-0 z-40">
            <div className="absolute inset-0 bg-ink/30 backdrop-blur-sm" onClick={closeDetail} />
            <div className="absolute inset-y-0 right-0 w-full max-w-2xl bg-surface shadow-2xl">{detail}</div>
          </div>
        ))}
    </div>
  );
}

export function FeedView({ view, preset }: { view: View; preset?: Preset }) {
  return (
    <Suspense>
      <Feed view={view} preset={preset} />
    </Suspense>
  );
}
