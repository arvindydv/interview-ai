'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, ArrowUpRight, Ban, BadgeCheck, Bot, CheckCircle2, Download, FilePlus2, Play, Plug, ShieldAlert, Unplug, UserCheck } from 'lucide-react';
import {
  BOT_LIMITS, BOT_PLATFORM_LABELS, BOT_PLATFORMS,
  type BotApplication, type BotApplicationPage, type BotPlatform, type BotPlatformStatus, type JobBotSettings, type JobBotState,
} from '@parakeet/shared';
import { Spinner } from '@/components/ui';
import { api, apiFile, ApiError } from '@/lib/api';
import { timeAgo } from '@/lib/format';

// The platform bot: applies for the user on LinkedIn, Naukri and Indeed in the background (the worker
// runs a headless Chrome signed in as them). Here: connect each site once, set limits and searches,
// answer the questions it couldn't, and see every application it sent.

const STATUS: Record<BotPlatformStatus['status'], { label: string; className: string }> = {
  connected: { label: 'Connected', className: 'text-emerald-700 bg-emerald-50 border-emerald-200' },
  disconnected: { label: 'Not connected', className: 'text-muted bg-surface-2 border-line' },
  needs_verification: { label: 'Needs you', className: 'text-amber-800 bg-amber-50 border-amber-200' },
  connecting: { label: 'Signing in…', className: 'text-sky-700 bg-sky-50 border-sky-200' },
  access_restricted: { label: 'Blocked by site', className: 'text-danger bg-danger/5 border-danger/20' },
};
const OUTCOME_LABEL: Record<string, string> = {
  applied: 'Applied', skipped: 'Skipped', needs_answer: 'Needs your answer', failed: 'Failed', already_applied: 'Already applied', external: 'Company site',
  assisted: 'Ready for you',
};

/** How we know it was submitted: the site's confirmation, or the candidate's word. */
function Evidence({ a }: { a: BotApplication }) {
  if (a.evidence === 'verified') {
    return <span className="inline-flex items-center gap-1 text-xs text-emerald-700" title="The site confirmed the application"><BadgeCheck size={13} /> Verified</span>;
  }
  if (a.evidence === 'user_reported') {
    return <span className="inline-flex items-center gap-1 text-xs text-muted" title="You applied on the site and confirmed it"><UserCheck size={13} /> You confirmed</span>;
  }
  return null;
}

async function downloadResume(a: BotApplication) {
  const blob = await apiFile(`/v1/job-bot/applications/${a.id}/resume`);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${a.company} - ${a.title}.${blob.type.includes('pdf') ? 'pdf' : 'docx'}`.replace(/[\\/:*?"<>|]/g, '');
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * Jobs the bot can't apply to (Naukri refuses it; any site you find yourself): paste the job, Friday
 * tailors your resume for it, you apply on the site, then confirm here.
 */
function AssistedApply({ onChange, refreshKey }: { onChange: () => void; refreshKey: number }) {
  const [form, setForm] = useState({ platform: 'naukri' as BotPlatform, url: '', title: '', company: '', description: '' });
  const [items, setItems] = useState<BotApplication[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    api<BotApplicationPage>('/v1/job-bot/applications?outcome=assisted').then((p) => setItems(p.items), (e) => setError(errMessage(e, 'Couldn’t load.')));
  }, []);
  useEffect(load, [load, refreshKey]);
  // While a resume is being tailored, check back.
  useEffect(() => {
    if (!items?.some((i) => i.tailorStatus === 'tailoring')) return;
    const t = setTimeout(load, 5000);
    return () => clearTimeout(t);
  }, [items, load]);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy('add');
    setError(null);
    try {
      await api('/v1/job-bot/assisted', { method: 'POST', body: JSON.stringify(form) });
      setForm({ ...form, url: '', title: '', company: '', description: '' });
      load();
    } catch (err) {
      setError(errMessage(err, 'Couldn’t add the job.'));
    } finally {
      setBusy(null);
    }
  };
  const act = async (id: string, fn: () => Promise<unknown>) => {
    setBusy(id);
    setError(null);
    try {
      await fn();
      load();
      onChange();
    } catch (err) {
      setError(errMessage(err, 'Something went wrong.'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="card mt-4 p-4">
      <p className="flex items-center gap-2 font-medium"><FilePlus2 size={16} /> Assisted Apply</p>
      <p className="text-xs text-muted">
        For jobs the bot can&rsquo;t apply to, like Naukri, which blocks it. Paste a job you found: Friday tailors your resume for it, you apply on
        the site with that resume, then mark it applied here. Naukri&rsquo;s own auto-apply is Naukri Neo, part of Naukri360 Pro.
      </p>
      <form onSubmit={add} className="mt-3 grid gap-2 sm:grid-cols-4">
        <select value={form.platform} onChange={(e) => setForm({ ...form, platform: e.target.value as BotPlatform })} className="input">
          {BOT_PLATFORMS.map((p) => <option key={p} value={p}>{BOT_PLATFORM_LABELS[p]}</option>)}
        </select>
        <input required value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="Job link (https://…)" className="input sm:col-span-3" />
        <input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Job title" className="input sm:col-span-2" />
        <input required value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} placeholder="Company" className="input sm:col-span-2" />
        <textarea required minLength={150} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={4} placeholder="Paste the full job description" className="input sm:col-span-4 !text-sm" />
        <div className="flex justify-end sm:col-span-4">
          <button disabled={busy === 'add'} className="btn btn-brand !text-xs">{busy === 'add' ? <Spinner /> : 'Tailor my resume for this job'}</button>
        </div>
      </form>
      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
      {items && items.length > 0 && (
        <ul className="mt-3 divide-y divide-line">
          {items.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-2 py-3 text-sm">
              <p className="min-w-0 flex-1">
                <span className="font-medium">{a.title}</span> <span className="text-muted">· {a.company} · {BOT_PLATFORM_LABELS[a.platform]}</span>
                <span className="block text-xs text-muted">
                  {a.tailorStatus === 'tailoring' ? 'Tailoring your resume…' : a.tailorStatus === 'failed' ? 'Tailoring failed; apply with your usual resume' : 'Resume ready: apply on the site, then mark it applied'}
                </span>
              </p>
              {a.tailorStatus === 'ready' && (
                <button disabled={busy !== null} onClick={() => act(`dl-${a.id}`, () => downloadResume(a))} className="btn btn-ghost !text-xs">
                  <Download size={13} /> Resume
                </button>
              )}
              <a href={a.url} target="_blank" rel="noopener noreferrer" className="btn btn-ghost !text-xs">Open job <ArrowUpRight size={13} /></a>
              <button disabled={busy !== null} onClick={() => act(a.id, () => api(`/v1/job-bot/applications/${a.id}/submitted`, { method: 'POST' }))} className="btn btn-brand !text-xs">
                {busy === a.id ? <Spinner /> : 'I applied'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const errMessage = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);

function PlatformCard({ p, settings, onSettings, onChange }: { p: BotPlatformStatus; settings: JobBotSettings; onSettings: (s: JobBotSettings) => void; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cfg = settings.platforms[p.platform];
  const act = async (method: 'POST' | 'DELETE') => {
    setBusy(true);
    setError(null);
    try {
      await api(`/v1/job-bot/connect/${p.platform}`, { method });
      onChange();
    } catch (e) {
      setError(errMessage(e, 'Something went wrong. Try again.'));
    } finally {
      setBusy(false);
    }
  };
  const set = (patch: Partial<typeof cfg>) => onSettings({ ...settings, platforms: { ...settings.platforms, [p.platform]: { ...cfg, ...patch } } });

  return (
    <div className="card flex flex-col gap-3 p-4">
      <div className="flex items-center gap-2">
        <p className="font-semibold">{BOT_PLATFORM_LABELS[p.platform]}</p>
        <span className={`ml-auto rounded-full border px-2 py-0.5 text-xs font-medium ${STATUS[p.status].className}`}>{STATUS[p.status].label}</span>
      </div>
      <p className="text-sm text-muted">
        <span className="text-2xl font-semibold tabular-nums text-fg">{p.appliedToday}</span> / {cfg.enabled ? cfg.dailyLimit : 0} today ·{' '}
        {p.appliedTotal} in all{p.lastRunAt ? ` · ran ${timeAgo(p.lastRunAt)}` : ''}
      </p>
      {p.message && <p className={`text-xs ${p.status === 'needs_verification' ? 'text-amber-800' : 'text-muted'}`}>{p.message}</p>}
      {error && <p className="text-xs text-danger">{error}</p>}
      <div className="flex flex-wrap items-center gap-2">
        {p.status === 'access_restricted' ? (
          <span className="inline-flex items-center gap-1 text-xs text-danger"><Ban size={13} /> Use Assisted Apply below</span>
        ) : p.status === 'connected' ? (
          <button disabled={busy} onClick={() => act('DELETE')} className="btn btn-ghost !text-xs">
            {busy ? <Spinner /> : <Unplug size={14} />} Pause
          </button>
        ) : (
          <button disabled={busy || p.status === 'connecting'} onClick={() => act('POST')} className="btn btn-brand !text-xs">
            {busy || p.status === 'connecting' ? <Spinner /> : p.status === 'needs_verification' ? <ShieldAlert size={14} /> : <Plug size={14} />}{' '}
            {p.status === 'needs_verification' ? 'Verify' : 'Connect'}
          </button>
        )}
        <label className="ml-auto flex items-center gap-2 text-xs text-muted">
          <input type="checkbox" checked={cfg.enabled} onChange={(e) => set({ enabled: e.target.checked })} /> Apply here
        </label>
        <input
          type="number"
          min={0}
          max={BOT_LIMITS.maxPerDay}
          value={cfg.dailyLimit}
          onChange={(e) => set({ dailyLimit: Math.max(0, Math.min(BOT_LIMITS.maxPerDay, Number(e.target.value) || 0)) })}
          className="input !w-20 !py-1.5"
          aria-label={`${BOT_PLATFORM_LABELS[p.platform]} applications a day`}
        />
        <span className="text-xs text-muted">a day</span>
      </div>
    </div>
  );
}

function QuestionRow({ question, jobs, onSaved }: { question: string; jobs: number; onSaved: () => void }) {
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api('/v1/job-bot/answers', { method: 'POST', body: JSON.stringify({ question, answer }) });
      onSaved();
    } catch (e) {
      setError(errMessage(e, 'Couldn’t save. Try again.'));
      setBusy(false);
    }
  };
  return (
    <li className="flex flex-wrap items-center gap-2 py-3">
      <p className="min-w-0 flex-1 text-sm">
        {question} <span className="text-xs text-muted">· {jobs} job{jobs === 1 ? '' : 's'}</span>
      </p>
      <input value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="Your answer" className="input !w-56 !py-1.5" />
      <button disabled={!answer.trim() || busy} onClick={save} className="btn btn-brand !text-xs">
        {busy ? <Spinner /> : 'Save'}
      </button>
      {error && <p className="w-full text-xs text-danger">{error}</p>}
    </li>
  );
}

function Applications({ refreshKey }: { refreshKey: number }) {
  const [platform, setPlatform] = useState<BotPlatform | ''>('');
  const [outcome, setOutcome] = useState<'applied' | 'skipped'>('applied');
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<BotApplicationPage | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams({ outcome, page: String(page), ...(platform ? { platform } : {}), ...(query ? { q: query } : {}) });
    api<BotApplicationPage>(`/v1/job-bot/applications?${params}`).then(setData, (e) => setError(errMessage(e, 'Couldn’t load applications.')));
  }, [platform, outcome, query, page, refreshKey]);

  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  return (
    <section className="mt-8">
      <div className="card p-5 text-center">
        <p className="flex items-center justify-center gap-2 text-xl font-semibold sm:text-2xl">
          <CheckCircle2 className="text-emerald-600" /> Found
          <span className="rounded-full bg-brand px-3 text-white tabular-nums">{data?.total ?? '…'}</span>
          {outcome === 'applied' ? 'applied jobs' : 'skipped jobs'}
        </p>
        <p className="mt-1 text-sm text-muted">Latest first</p>
        <div className="mt-3 flex flex-wrap justify-center gap-2">
          {(['', ...BOT_PLATFORMS] as const).map((p) => (
            <button key={p || 'all'} onClick={() => { setPlatform(p); setPage(1); }} className={`rounded-full border px-3 py-1 text-xs ${platform === p ? 'border-brand bg-brand text-white' : 'border-line'}`}>
              {p ? BOT_PLATFORM_LABELS[p] : 'All'}
            </button>
          ))}
          <span className="mx-1 w-px bg-line" />
          {(['applied', 'skipped'] as const).map((o) => (
            <button key={o} onClick={() => { setOutcome(o); setPage(1); }} className={`rounded-full border px-3 py-1 text-xs ${outcome === o ? 'border-brand bg-brand text-white' : 'border-line'}`}>
              {o === 'applied' ? 'Applied' : 'Skipped'}
            </button>
          ))}
        </div>
        <form onSubmit={(e) => { e.preventDefault(); setQuery(q.trim()); setPage(1); }} className="mx-auto mt-4 flex max-w-lg gap-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by role or company name…" className="input flex-1" />
          <button className="btn btn-brand">Search</button>
        </form>
      </div>

      {error && <p className="mt-3 text-sm text-danger">{error}</p>}
      <div className="card mt-4 overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead>
            <tr className="border-b border-line text-xs text-muted">
              <th className="px-4 py-3 font-medium">#</th>
              <th className="px-4 py-3 font-medium">Position</th>
              <th className="px-4 py-3 font-medium">Company</th>
              <th className="px-4 py-3 font-medium">Platform</th>
              <th className="px-4 py-3 font-medium">{outcome === 'applied' ? 'Applied' : 'Why'}</th>
              <th className="px-4 py-3 font-medium">Job</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {!data ? (
              <tr><td colSpan={6} className="p-6"><div className="skeleton h-10" /></td></tr>
            ) : data.items.length === 0 ? (
              <tr><td colSpan={6} className="p-8 text-center text-muted">Nothing yet.</td></tr>
            ) : (
              data.items.map((a, i) => (
                <tr key={a.id}>
                  <td className="px-4 py-3 tabular-nums text-muted">{(data.page - 1) * data.pageSize + i + 1}</td>
                  <td className="px-4 py-3">
                    <p className="font-medium">{a.title || 'Untitled'}</p>
                    {a.location && <p className="text-xs text-muted">{a.location}</p>}
                  </td>
                  <td className="px-4 py-3">{a.company}</td>
                  <td className="px-4 py-3">{BOT_PLATFORM_LABELS[a.platform]}</td>
                  <td className="px-4 py-3 text-xs text-muted">
                    {a.outcome === 'applied' ? (
                      <span className="flex flex-col gap-0.5">
                        {new Date(a.at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                        <Evidence a={a} />
                      </span>
                    ) : (
                      <span title={a.detail ?? ''}>{OUTCOME_LABEL[a.outcome]}{a.detail ? ` · ${a.detail.slice(0, 80)}` : ''}</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className="flex gap-1">
                      <a href={a.url} target="_blank" rel="noopener noreferrer" className="btn btn-ghost !text-xs">
                        View <ArrowUpRight size={13} />
                      </a>
                      {a.tailorStatus === 'ready' && (
                        <button onClick={() => downloadResume(a).catch(() => {})} className="btn btn-ghost !text-xs" aria-label="Download the resume used">
                          <Download size={13} />
                        </button>
                      )}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        {pages > 1 && (
          <div className="flex items-center justify-center gap-3 p-3 text-sm">
            <button disabled={page <= 1} onClick={() => setPage(page - 1)} className="btn btn-ghost !text-xs">← Prev</button>
            <span className="text-muted">Page {page} of {pages}</span>
            <button disabled={page >= pages} onClick={() => setPage(page + 1)} className="btn btn-ghost !text-xs">Next →</button>
          </div>
        )}
      </div>
    </section>
  );
}

export default function BotPage() {
  const [state, setState] = useState<JobBotState | null>(null);
  const [settings, setSettings] = useState<JobBotSettings | null>(null);
  const [dirty, setDirty] = useState(false);
  const [searchesText, setSearchesText] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const load = useCallback(() => {
    api<JobBotState>('/v1/job-bot').then(
      (s) => {
        setState(s);
        setSettings((cur) => (dirty && cur ? cur : s.settings));
        if (!dirty) setSearchesText(s.settings.searches.map((x) => `${x.keywords} — ${x.location}`).join('\n'));
      },
      (e) => setError(errMessage(e, 'Couldn’t load the bot.')),
    );
  }, [dirty]);
  useEffect(load, [load]);
  // While signing in or running, keep the status fresh.
  useEffect(() => {
    if (!state?.running && !state?.platforms.some((p) => p.status === 'connecting')) return;
    const t = setInterval(() => {
      load();
      setRefreshKey((k) => k + 1);
    }, 5000);
    return () => clearInterval(t);
  }, [state, load]);

  const change = (s: JobBotSettings) => {
    setSettings(s);
    setDirty(true);
  };
  const save = async (next = settings) => {
    if (!next) return;
    setBusy('save');
    setError(null);
    const searches = searchesText
      .split('\n')
      .map((l) => l.split(/\s+[—–-]\s+|,\s*/))
      .filter(([k]) => k?.trim())
      .map(([keywords, location]) => ({ keywords: keywords.trim(), location: (location ?? 'India').trim() || 'India' }))
      .slice(0, BOT_LIMITS.maxSearches);
    try {
      await api('/v1/job-bot/settings', { method: 'PUT', body: JSON.stringify({ ...next, searches }) });
      setDirty(false);
      load();
    } catch (e) {
      setError(errMessage(e, 'Couldn’t save. Check the searches and limits.'));
    } finally {
      setBusy(null);
    }
  };
  const runNow = async () => {
    setBusy('run');
    setError(null);
    try {
      await api('/v1/job-bot/run', { method: 'POST' });
      load();
    } catch (e) {
      setError(errMessage(e, 'Couldn’t start a run.'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mx-auto max-w-5xl px-4 pt-8 pb-16 sm:px-8">
      <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight sm:text-[28px]">
        <Bot /> LinkedIn, Naukri &amp; Indeed bot
      </h1>
      <p className="mt-1 text-muted">
        Applies for you in the background with your resume and Application Profile, up to your daily limit on each site. Nothing opens on
        your screen except the one-time sign-in.
      </p>

      {error && <p className="mt-4 text-sm text-danger">{error}</p>}
      {!state || !settings ? (
        <div className="mt-6 grid gap-3 sm:grid-cols-3">{[0, 1, 2].map((i) => <div key={i} className="skeleton h-40" />)}</div>
      ) : !state.available ? (
        <div className="card mt-6 p-6 text-sm text-muted">The platform bot isn&rsquo;t enabled for this account.</div>
      ) : (
        <>
          {state.missing.length > 0 && (
            <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <p className="flex items-center gap-2 font-medium"><AlertTriangle size={16} /> Before the bot can apply:</p>
              <ul className="mt-1 list-disc pl-6">{state.missing.map((m) => <li key={m}>{m}</li>)}</ul>
              <Link href="/auto-apply" className="mt-1 inline-block underline">Open the Application Profile</Link>
            </div>
          )}

          <div className="card mt-6 flex flex-wrap items-center gap-3 p-4">
            <label className="flex items-center gap-2 font-medium">
              <input type="checkbox" checked={settings.enabled} onChange={(e) => { const next = { ...settings, enabled: e.target.checked }; change(next); save(next); }} />
              Apply automatically
            </label>
            <span className="text-sm text-muted">every two hours, 9 am – 9 pm</span>
            <button disabled={busy !== null || state.running} onClick={runNow} className="btn btn-brand ml-auto !text-xs">
              {state.running ? <><Spinner /> Running…</> : <><Play size={14} /> Run now</>}
            </button>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            {state.platforms.map((p) => (
              <PlatformCard key={p.platform} p={p} settings={settings} onSettings={change} onChange={load} />
            ))}
          </div>

          <div className="card mt-4 grid gap-4 p-4 sm:grid-cols-2">
            <div>
              <p className="text-sm font-medium">Searches</p>
              <p className="text-xs text-muted">One per line: role — city. Empty uses your job preferences: {state.effectiveSearches.map((s) => `${s.keywords} (${s.location})`).join(', ') || 'none yet'}.</p>
              <textarea value={searchesText} onChange={(e) => { setSearchesText(e.target.value); setDirty(true); }} rows={4} className="input mt-2 font-mono !text-xs" placeholder={'backend developer — Bengaluru\nnode.js developer — India'} />
            </div>
            <div className="space-y-3">
              <label className="block text-sm font-medium">
                Jobs posted within
                <select value={settings.postedWithinDays} onChange={(e) => change({ ...settings, postedWithinDays: Number(e.target.value) as 1 | 3 | 7 })} className="input mt-1">
                  <option value={1}>24 hours</option>
                  <option value={3}>3 days</option>
                  <option value={7}>7 days</option>
                </select>
              </label>
              <label className="block text-sm font-medium">
                Skip titles containing
                <input value={settings.skipTitles.join(', ')} onChange={(e) => change({ ...settings, skipTitles: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })} className="input mt-1" />
              </label>
              <label className="block text-sm font-medium">
                Skip companies
                <input value={settings.skipCompanies.join(', ')} onChange={(e) => change({ ...settings, skipCompanies: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })} className="input mt-1" />
              </label>
            </div>
            <div className="sm:col-span-2 flex justify-end">
              <button disabled={!dirty || busy !== null} onClick={() => save()} className="btn btn-brand !text-xs">{busy === 'save' ? <Spinner /> : 'Save settings'}</button>
            </div>
          </div>

          {state.questions.length > 0 && (
            <div className="card mt-4 p-4">
              <p className="font-medium">Questions the bot couldn&rsquo;t answer ({state.questions.length})</p>
              <p className="text-xs text-muted">Those jobs were held back. Answer once and the bot applies to them next run (Auto Apply uses your answers too). It never makes these up.</p>
              <ul className="divide-y divide-line">
                {state.questions.map((q) => (
                  <QuestionRow key={q.question} question={q.question} jobs={q.jobs} onSaved={load} />
                ))}
              </ul>
            </div>
          )}

          <AssistedApply onChange={() => setRefreshKey((k) => k + 1)} refreshKey={refreshKey} />

          <Applications refreshKey={refreshKey} />

          <p className="mt-6 text-xs text-muted">
            Applying with automation goes against LinkedIn, Naukri and Indeed&rsquo;s user agreements, and they can restrict accounts they
            suspect. The bot keeps to your daily limits, never solves CAPTCHAs, and stops a site to let you verify when it asks.
          </p>
        </>
      )}
    </div>
  );
}
