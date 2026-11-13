'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertCircle, BadgeCheck, CalendarDays, CalendarRange, ChevronDown, ChevronLeft, ChevronRight, CircleAlert, Download, ExternalLink,
  Hand, ListChecks, Search, UserCheck, XCircle,
} from 'lucide-react';
import {
  APPLY_CHANNEL_LABELS, profileQuestionFor,
  type AppliedJob, type AppliedJobStatus, type AppliedJobsPage, type AutoApplicationDetail, type FormQuestion,
} from '@parakeet/shared';
import { CompanyLogo, Spinner } from './ui';
import { api } from '@/lib/api';
import { timeAgo } from '@/lib/format';

// The Applied Jobs dashboard (GET /v1/applied-jobs). Only applications with evidence count as applied:
// "Verified" (the job board or its API confirmed it) or "You confirmed" (you told us you sent it).
// Queued, in-progress and failed applications are listed, never counted.

const PAGE_SIZE = 20;

const PLATFORM_LABELS: Record<string, string> = {
  greenhouse: 'Greenhouse', lever: 'Lever', ashby: 'Ashby', workable: 'Workable', smartrecruiters: 'SmartRecruiters', workday: 'Workday',
  teamtailor: 'Teamtailor', linkedin: 'LinkedIn', indeed: 'Indeed', naukri: 'Naukri', other: 'Other', keka: 'Keka', zohorecruit: 'Zoho Recruit',
  freshteam: 'Freshteam', himalayas: 'Himalayas', jobicy: 'Jobicy', remoteok: 'Remote OK', jooble: 'Jooble', jsearch: 'JSearch', adzuna: 'Adzuna',
};
const platformLabel = (p: string) => PLATFORM_LABELS[p] ?? p.charAt(0).toUpperCase() + p.slice(1);

const CHANNEL_LABELS: Record<AppliedJob['channel'], string> = { ...APPLY_CHANNEL_LABELS, manual: 'Added by you', bot: 'Platform bot (experimental)' };

const STATUS_FILTERS: { id: AppliedJobStatus | ''; label: string }[] = [
  { id: '', label: 'All (not skipped)' },
  { id: 'submitted', label: 'Applied' },
  { id: 'needs_action', label: 'Needs your action' },
  { id: 'in_progress', label: 'In progress' },
  { id: 'failed', label: 'Failed' },
  { id: 'skipped', label: 'Skipped' },
];

const STATUS_TONE: Record<AppliedJobStatus, string> = {
  submitted: 'bg-emerald-50 text-emerald-800',
  needs_action: 'bg-amber-50 text-amber-800',
  in_progress: 'bg-cyan-50 text-cyan-800',
  failed: 'bg-red-50 text-red-700',
  skipped: 'bg-surface-2 text-faint',
};
const STATUS_LABEL: Record<AppliedJobStatus, string> = {
  submitted: 'Applied', needs_action: 'Needs you', in_progress: 'In progress', failed: 'Failed', skipped: 'Skipped',
};

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

function EvidenceBadge({ job }: { job: AppliedJob }) {
  if (job.status !== 'submitted' || !job.evidence) {
    return <span className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${STATUS_TONE[job.status]}`}>{STATUS_LABEL[job.status]}</span>;
  }
  return job.evidence === 'verified' ? (
    <span title={job.evidenceDetail ?? 'Confirmed by the job board'} className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-1.5 py-0.5 text-[11px] font-semibold text-emerald-800">
      <BadgeCheck size={12} /> Verified
    </span>
  ) : (
    <span title={job.evidenceDetail ?? 'You confirmed you applied'} className="inline-flex items-center gap-1 rounded-md bg-violet-50 px-1.5 py-0.5 text-[11px] font-semibold text-violet-800">
      <UserCheck size={12} /> You confirmed
    </span>
  );
}

function Stat({ label, value, icon: Icon, tone }: { label: string; value: number | undefined; icon: typeof BadgeCheck; tone: string }) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-4">
      <span className={`grid size-8 place-items-center rounded-lg bg-surface-2 ${tone}`}>
        <Icon size={16} />
      </span>
      <p className="mt-3 text-2xl font-semibold tracking-tight tabular-nums">{value ?? '–'}</p>
      <p className="text-xs font-medium text-muted">{label}</p>
    </div>
  );
}

// ---- Needs your action ---------------------------------------------------------------------------

/** One answer per question, saved to the profile so every later form reuses it. */
function AnswerOnce({ job, onDone }: { job: AppliedJob; onDone: () => void }) {
  const [kind, rawId] = job.id.split(':') as ['auto' | 'bot', string];
  const [form, setForm] = useState<FormQuestion[] | null>(null);
  const [values, setValues] = useState<Record<string, string | string[]>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (kind !== 'auto') return;
    api<AutoApplicationDetail>(`/v1/auto-apply/applications/${rawId}`).then(
      (d) => setForm(d.missing.length ? d.missing : d.form.filter((q) => job.questions.some((x) => x.key === q.key))),
      () => setForm([]),
    );
    // Once per application; the question list comes with it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, rawId]);

  const questions: FormQuestion[] =
    kind === 'auto'
      ? (form ?? [])
      : job.questions.map((q) => ({ key: q.key, label: q.label, type: 'text', required: true, options: [], kind: 'custom' }));
  // Notice period, CTC, links, relocation…: answered once in the Application Profile, never per job.
  const inProfile = [...new Set(questions.map((q) => profileQuestionFor(q.label)).filter((q): q is string => q !== null))];
  const own = questions.filter((q) => !profileQuestionFor(q.label));

  async function save() {
    setBusy(true);
    setError(null);
    try {
      if (kind === 'auto') {
        await api(`/v1/auto-apply/applications/${rawId}/answers`, { method: 'POST', body: JSON.stringify({ answers: values }) });
      } else {
        for (const q of own) {
          const answer = String(values[q.key] ?? '').trim();
          if (answer) await api('/v1/job-bot/answers', { method: 'POST', body: JSON.stringify({ question: q.label, answer }) });
        }
      }
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (kind === 'auto' && !form) return <Spinner className="mt-3 text-faint" />;
  return (
    <div className="mt-3 space-y-3 rounded-xl border border-amber-200 bg-amber-50/40 p-3">
      {inProfile.length > 0 && (
        <p className="text-xs text-muted">
          Answer once in your{' '}
          <Link href="/auto-apply" className="font-medium text-brand underline underline-offset-2">
            Application Profile
          </Link>
          : {inProfile.join(', ')}.
        </p>
      )}
      {own.length > 0 && <p className="text-xs text-muted">Friday doesn’t guess these. Your answers are saved and reused for the same question on every form.</p>}
      {own.map((q) => (
        <label key={q.key} className="block text-sm">
          <span className="font-medium">{q.label}</span>
          <div className="mt-1.5">
            {q.options.length ? (
              <select value={(values[q.key] as string) ?? ''} onChange={(e) => setValues({ ...values, [q.key]: e.target.value })} className="input !py-2">
                <option value="" disabled>
                  Choose…
                </option>
                {q.options.map((o) => (
                  <option key={o}>{o}</option>
                ))}
              </select>
            ) : q.type === 'checkbox' ? (
              <select value={(values[q.key] as string) ?? ''} onChange={(e) => setValues({ ...values, [q.key]: e.target.value })} className="input !py-2">
                <option value="" disabled>
                  Choose…
                </option>
                <option>Yes</option>
                <option>No</option>
              </select>
            ) : (
              <input value={(values[q.key] as string) ?? ''} onChange={(e) => setValues({ ...values, [q.key]: e.target.value })} className="input !py-2" />
            )}
          </div>
        </label>
      ))}
      {error && <p className="text-xs text-danger">{error}</p>}
      {own.length > 0 && (
        <button onClick={save} disabled={busy} className="btn btn-brand !py-1.5 !text-xs">
          {busy ? <Spinner /> : 'Save answers'}
        </button>
      )}
    </div>
  );
}

function ActionCard({ job, onChange }: { job: AppliedJob; onChange: () => void }) {
  const [kind, rawId] = job.id.split(':') as ['auto' | 'bot', string];
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [answering, setAnswering] = useState(job.questions.length > 0);
  // The candidate can say they applied when Friday prepared it and they submit (assisted), or after a
  // CAPTCHA/sign-in/missing confirmation. Never for questions still unanswered.
  const canConfirm = job.questions.length === 0;

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      if (kind === 'auto') await api(`/v1/auto-apply/applications/${rawId}/confirm`, { method: 'POST' });
      else await api(`/v1/job-bot/applications/${rawId}/submitted`, { method: 'POST' });
      onChange();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="min-w-0 rounded-2xl border border-amber-200 bg-surface p-4">
      <div className="flex items-start gap-3">
        <CompanyLogo company={job.company} website={null} size={40} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{job.title}</p>
          <p className="truncate text-sm text-muted">
            {job.company} · {platformLabel(job.platform)} · {CHANNEL_LABELS[job.channel]}
          </p>
          {job.action && (
            <p className="mt-1.5 flex items-start gap-1.5 text-sm text-amber-800">
              <CircleAlert size={15} className="mt-0.5 shrink-0" /> {job.action}
            </p>
          )}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <a href={job.jobUrl} target="_blank" rel="noopener" className="btn btn-secondary !py-1.5 !text-xs">
          <ExternalLink size={13} /> Open job
        </a>
        {job.resumeUrl && (
          <a href={job.resumeUrl} className="btn btn-secondary !py-1.5 !text-xs">
            <Download size={13} /> Tailored resume
          </a>
        )}
        {job.questions.length > 0 && !answering && (
          <button onClick={() => setAnswering(true)} className="btn btn-brand !py-1.5 !text-xs">
            Answer {job.questions.length} question{job.questions.length > 1 ? 's' : ''}
          </button>
        )}
        {canConfirm && (
          <button onClick={confirm} disabled={busy} className="btn btn-brand !py-1.5 !text-xs">
            {busy ? <Spinner /> : 'I applied'}
          </button>
        )}
      </div>
      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
      {answering && job.questions.length > 0 && <AnswerOnce job={job} onDone={onChange} />}
    </li>
  );
}

// ---- The list ------------------------------------------------------------------------------------

function JobRow({ job }: { job: AppliedJob }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="border-b border-line last:border-0">
      <div className="grid grid-cols-[1fr_auto] items-center gap-3 px-4 py-3 md:grid-cols-[minmax(0,2.2fr)_minmax(0,1fr)_minmax(0,1.1fr)_7rem_auto]">
        <div className="flex min-w-0 items-center gap-3">
          <CompanyLogo company={job.company} website={null} size={36} />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{job.title}</p>
            <p className="truncate text-xs text-muted">
              {job.company}
              {job.location && ` · ${job.location}`}
              <span className="md:hidden"> · {platformLabel(job.platform)}</span>
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-1.5 md:hidden">
              <EvidenceBadge job={job} />
              <span className="text-[11px] text-faint">{job.appliedAt ? fmtDate(job.appliedAt) : timeAgo(job.createdAt)}</span>
            </div>
          </div>
        </div>
        <div className="hidden min-w-0 text-xs md:block">
          <p className="truncate font-medium">{platformLabel(job.platform)}</p>
          <p className="truncate text-faint">{CHANNEL_LABELS[job.channel]}</p>
        </div>
        <div className="hidden md:block">
          <EvidenceBadge job={job} />
          {job.score !== null && <p className="mt-1 text-[11px] text-faint">Match {job.score}</p>}
        </div>
        <p className="hidden text-xs tabular-nums text-muted md:block">{job.appliedAt ? fmtDate(job.appliedAt) : '—'}</p>
        <div className="flex items-center justify-end gap-1">
          <a href={job.jobUrl} target="_blank" rel="noopener" title="Original job" className="btn btn-ghost !p-2">
            <ExternalLink size={15} />
          </a>
          {job.resumeUrl ? (
            <a href={job.resumeUrl} title="Download the exact resume sent" className="btn btn-ghost !p-2">
              <Download size={15} />
            </a>
          ) : (
            <span className="inline-block w-[31px]" />
          )}
          {(job.failure || job.evidenceDetail) && (
            <button onClick={() => setOpen(!open)} title="Details" className="btn btn-ghost !p-2">
              <ChevronDown size={15} className={open ? 'rotate-180 transition' : 'transition'} />
            </button>
          )}
        </div>
      </div>
      {open && (
        <div className="space-y-1 px-4 pb-3 text-xs md:pl-[3.75rem]">
          {job.evidenceDetail && (
            <p className="text-muted">
              <span className="font-medium text-fg">Evidence:</span> {job.evidenceDetail}
            </p>
          )}
          {job.failure && (
            <p className="flex items-start gap-1.5 text-red-700">
              <AlertCircle size={13} className="mt-0.5 shrink-0" />
              <span>
                <span className="font-mono">{job.failure.code}</span> — {job.failure.message}
                {job.failure.at && <span className="text-faint"> ({timeAgo(job.failure.at)})</span>}
              </span>
            </p>
          )}
        </div>
      )}
    </li>
  );
}

export function AppliedDashboard() {
  const [data, setData] = useState<AppliedJobsPage | null>(null);
  const [actions, setActions] = useState<AppliedJob[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<AppliedJobStatus | ''>('');
  const [platform, setPlatform] = useState('');
  const [channel, setChannel] = useState('');
  const [evidence, setEvidence] = useState('');
  const [page, setPage] = useState(1);

  // Search as you type, a moment after typing stops.
  useEffect(() => {
    const t = setTimeout(() => {
      setQuery(q.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  const params = useMemo(() => {
    const p = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
    if (query) p.set('q', query);
    if (status) p.set('status', status);
    if (platform) p.set('platform', platform);
    if (channel) p.set('channel', channel);
    if (evidence) p.set('evidence', evidence);
    return p.toString();
  }, [page, query, status, platform, channel, evidence]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [list, todo] = await Promise.all([
        api<AppliedJobsPage>(`/v1/applied-jobs?${params}`),
        api<AppliedJobsPage>('/v1/applied-jobs?status=needs_action&pageSize=50'),
      ]);
      setData(list);
      setActions(todo.items);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [params]);

  useEffect(() => {
    void load();
  }, [load]);

  const stats = data?.stats;
  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;
  const maxPlatform = Math.max(1, ...(stats?.byPlatform.map((p) => p.submitted) ?? [1]));
  const platformOptions = useMemo(
    () => [...new Set([...(stats?.byPlatform.map((p) => p.platform) ?? []), 'greenhouse', 'lever', 'ashby', 'linkedin', 'indeed', 'naukri'])],
    [stats],
  );
  const filtered = Boolean(query || status || platform || channel || evidence);

  return (
    <div className="mx-auto max-w-6xl min-w-0 space-y-6">
      <section className="relative overflow-hidden rounded-3xl border border-line bg-surface p-6 shadow-[var(--shadow-card)] sm:p-7">
        <div className="hero-wash pointer-events-none absolute inset-0 opacity-80" />
        <div className="relative flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-[28px]">
              Found <span className="tabular-nums">{stats?.total ?? '–'}</span> Applied Job{stats?.total === 1 ? '' : 's'}
            </h1>
            <p className="mt-1.5 max-w-2xl text-sm text-muted">
              Only applications with evidence count: <b className="font-medium text-fg">Verified</b> by the job board, or{' '}
              <b className="font-medium text-fg">You confirmed</b>. Queued, in-progress and failed ones are listed but never counted.
            </p>
          </div>
          <Link href="/applied/tracker" className="btn btn-secondary !py-2 text-sm">
            <ListChecks size={15} /> Interview tracker
          </Link>
        </div>
        <div className="relative mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Stat label="Applied today" value={stats?.today} icon={CalendarDays} tone="text-emerald-700" />
          <Stat label="This month" value={stats?.thisMonth} icon={CalendarRange} tone="text-cyan-700" />
          <Stat label="Verified" value={stats?.verified} icon={BadgeCheck} tone="text-emerald-700" />
          <Stat label="You confirmed" value={stats?.userConfirmed} icon={UserCheck} tone="text-violet-700" />
          <Stat label="Needs your action" value={stats?.needsAction} icon={Hand} tone="text-amber-700" />
          <Stat label="Failed" value={stats?.failed} icon={XCircle} tone="text-red-700" />
        </div>
      </section>

      {error && (
        <p className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertCircle size={16} /> {error}
        </p>
      )}

      {actions && actions.length > 0 && (
        <section>
          <h2 className="mb-3 flex items-center gap-2 text-base font-semibold">
            <Hand size={17} className="text-amber-700" /> Needs your action
            <span className="rounded-full bg-amber-100 px-2 text-xs font-semibold text-amber-800 tabular-nums">{actions.length}</span>
          </h2>
          <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {actions.map((job) => (
              <ActionCard key={job.id} job={job} onChange={load} />
            ))}
          </ul>
        </section>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_16rem]">
        <section className="min-w-0 rounded-2xl border border-line bg-surface">
          <div className="flex flex-wrap gap-2 border-b border-line p-3">
            <label className="relative min-w-[12rem] flex-1">
              <Search size={15} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-faint" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search job title or company" className="input !py-2 !pl-9" />
            </label>
            <select aria-label="Status" value={status} onChange={(e) => { setStatus(e.target.value as AppliedJobStatus | ''); setPage(1); }} className="input !w-auto !py-2">
              {STATUS_FILTERS.map((s) => (
                <option key={s.id} value={s.id}>{s.label}</option>
              ))}
            </select>
            <select aria-label="Source" value={platform} onChange={(e) => { setPlatform(e.target.value); setPage(1); }} className="input !w-auto !py-2">
              <option value="">All sources</option>
              {platformOptions.map((p) => (
                <option key={p} value={p}>{platformLabel(p)}</option>
              ))}
            </select>
            <select aria-label="Sent by" value={channel} onChange={(e) => { setChannel(e.target.value); setPage(1); }} className="input !w-auto !py-2">
              <option value="">Sent by: any</option>
              {Object.entries(CHANNEL_LABELS).map(([id, label]) => (
                <option key={id} value={id}>{label}</option>
              ))}
            </select>
            <select aria-label="Evidence" value={evidence} onChange={(e) => { setEvidence(e.target.value); setPage(1); }} className="input !w-auto !py-2">
              <option value="">Any evidence</option>
              <option value="verified">Verified</option>
              <option value="user_confirmed">You confirmed</option>
            </select>
          </div>

          <div className="hidden grid-cols-[minmax(0,2.2fr)_minmax(0,1fr)_minmax(0,1.1fr)_7rem_auto] gap-3 border-b border-line px-4 py-2 text-[11px] font-semibold tracking-wide text-faint uppercase md:grid">
            <span>Job</span>
            <span>Source</span>
            <span>Status</span>
            <span>Applied</span>
            <span className="w-[93px] text-right">Links</span>
          </div>

          {loading && !data ? (
            <div className="grid place-items-center py-16 text-faint">
              <Spinner />
            </div>
          ) : data && data.items.length ? (
            <ul className={loading ? 'opacity-60 transition' : ''}>
              {data.items.map((job) => (
                <JobRow key={job.id} job={job} />
              ))}
            </ul>
          ) : (
            <p className="px-4 py-16 text-center text-sm text-muted">
              {filtered ? 'No applications match these filters.' : 'No applications yet. Turn on Auto Apply, or use Assisted Apply for LinkedIn, Indeed and Naukri jobs.'}
            </p>
          )}

          {data && data.total > 0 && (
            <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-3 text-xs text-muted">
              <span className="tabular-nums">
                {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, data.total)} of {data.total}
              </span>
              <div className="flex items-center gap-1">
                <button disabled={page <= 1} onClick={() => setPage(page - 1)} className="btn btn-secondary !p-1.5 disabled:opacity-40" aria-label="Previous page">
                  <ChevronLeft size={15} />
                </button>
                <span className="px-2 tabular-nums">
                  Page {page} of {pages}
                </span>
                <button disabled={page >= pages} onClick={() => setPage(page + 1)} className="btn btn-secondary !p-1.5 disabled:opacity-40" aria-label="Next page">
                  <ChevronRight size={15} />
                </button>
              </div>
            </div>
          )}
        </section>

        <aside className="space-y-4">
          <section className="rounded-2xl border border-line bg-surface p-4">
            <h2 className="text-sm font-semibold">Applied by platform</h2>
            {stats && stats.byPlatform.length ? (
              <ul className="mt-3 space-y-2.5">
                {stats.byPlatform.map((p) => (
                  <li key={p.platform}>
                    <div className="flex justify-between text-xs">
                      <button onClick={() => { setPlatform(p.platform); setPage(1); }} className="font-medium hover:text-brand">
                        {platformLabel(p.platform)}
                      </button>
                      <span className="tabular-nums text-muted">{p.submitted}</span>
                    </div>
                    <div className="mt-1 h-1.5 rounded-full bg-surface-2">
                      <div className="h-full rounded-full bg-brand" style={{ width: `${(p.submitted / maxPlatform) * 100}%` }} />
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-xs text-muted">Confirmed applications appear here by platform.</p>
            )}
          </section>
          <section className="rounded-2xl border border-line bg-surface p-4 text-xs text-muted">
            <h2 className="text-sm font-semibold text-fg">In progress</h2>
            <p className="mt-1">
              <span className="font-semibold text-fg tabular-nums">{stats?.inProgress ?? '–'}</span> being prepared or submitted. They count once the
              job board confirms them.
            </p>
            <Link href="/auto-apply" className="mt-2 inline-block font-medium text-brand">
              Auto Apply settings →
            </Link>
          </section>
        </aside>
      </div>
    </div>
  );
}
