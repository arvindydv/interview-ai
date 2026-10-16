'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Activity, Check, Cpu, FileText, GraduationCap, History, LayoutDashboard, LogOut, Mic, Plus,
  RefreshCw, Settings, User,
} from 'lucide-react';
import type { HealthReport, Me, PingJobResult } from '@parakeet/shared';
import { api, API_URL } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import { Logo, LogoMark } from '@/components/Logo';
import { Card, Dot, Pill, Spinner } from '@/components/ui';
import { DownloadButtons } from '@/components/DownloadButtons';

type Result<T> = { state: 'idle' } | { state: 'loading' } | { state: 'ok'; data: T } | { state: 'error'; error: string };

function useResult<T>(initial: Result<T>['state'] = 'loading') {
  const [r, setR] = useState<Result<T>>({ state: initial } as Result<T>);
  const run = (p: Promise<T>) => {
    setR({ state: 'loading' });
    p.then((data) => setR({ state: 'ok', data })).catch((e) => setR({ state: 'error', error: e.message }));
  };
  return [r, run] as const;
}

const nav = [
  { icon: LayoutDashboard, label: 'Overview', active: true },
  { icon: Mic, label: 'Interviews' },
  { icon: FileText, label: 'Resume' },
  { icon: GraduationCap, label: 'Practice' },
  { icon: History, label: 'History' },
  { icon: Settings, label: 'Settings' },
];

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

export default function Dashboard() {
  const router = useRouter();
  const [email, setEmail] = useState<string | null>(null);
  const [me, loadMe] = useResult<Me>();
  const [health, loadHealth] = useResult<HealthReport>();
  const [job, runJob] = useResult<PingJobResult>('idle');

  const refreshHealth = () => loadHealth(fetch(`${API_URL}/health`).then((r) => r.json()));

  useEffect(() => {
    supabase()
      .auth.getSession()
      .then(({ data }) => {
        if (!data.session) return router.replace('/login');
        setEmail(data.session.user.email ?? '');
        loadMe(api<Me>('/v1/me'));
        refreshHealth();
      });
    const { data } = supabase().auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') router.replace('/login');
    });
    return () => data.subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (email === null) {
    return (
      <div className="grid min-h-screen place-items-center">
        <LogoMark size={40} />
      </div>
    );
  }

  const name = email.split('@')[0];
  const checklist = [
    { label: 'Create your account', done: true },
    { label: 'Install the desktop app', done: false },
    { label: 'Upload your resume', done: false },
    { label: 'Set up your first interview', done: false },
  ];
  const doneCount = checklist.filter((c) => c.done).length;

  return (
    <div className="flex min-h-screen">
      {/* sidebar */}
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-line bg-surface/50 p-4 md:flex">
        <div className="px-2 py-1.5">
          <Logo href="/dashboard" />
        </div>
        <nav className="mt-8 space-y-1">
          {nav.map(({ icon: Icon, label, active }) => (
            <button
              key={label}
              disabled={!active}
              className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm transition ${
                active ? 'bg-white/[0.06] font-medium text-fg ring-1 ring-line' : 'text-muted hover:bg-white/[0.03]'
              } disabled:cursor-default`}
            >
              <Icon size={17} className={active ? 'text-brand' : ''} />
              {label}
              {!active && <span className="ml-auto text-[10px] uppercase tracking-wide text-faint">Soon</span>}
            </button>
          ))}
        </nav>

        <div className="mt-auto rounded-xl border border-line bg-surface p-3">
          <div className="flex items-center gap-3">
            <span className="grid size-9 place-items-center rounded-full bg-brand-gradient text-sm font-semibold uppercase text-bg">
              {name[0]}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{name}</p>
              <p className="truncate text-xs text-muted">{email}</p>
            </div>
          </div>
          <button onClick={() => supabase().auth.signOut()} className="btn btn-ghost mt-3 w-full !justify-start !px-2 !py-1.5">
            <LogOut size={15} /> Sign out
          </button>
        </div>
      </aside>

      {/* main */}
      <main className="min-w-0 flex-1">
        <div className="flex items-center justify-between border-b border-line px-4 py-3 md:hidden">
          <Logo href="/dashboard" />
          <button onClick={() => supabase().auth.signOut()} className="btn btn-ghost !px-2"><LogOut size={17} /></button>
        </div>

        <div className="mx-auto max-w-5xl space-y-6 px-4 py-8 sm:px-8 sm:py-10">
          <header className="flex flex-wrap items-end justify-between gap-4 animate-fade-up">
            <div>
              <p className="text-sm text-muted">{greeting()},</p>
              <h1 className="mt-1 text-3xl font-semibold tracking-tight capitalize">{name.split(/[._+-]/)[0]}</h1>
            </div>
            <button disabled className="btn btn-primary" title="Coming soon">
              <Plus size={16} /> New interview
            </button>
          </header>

          {/* download banner */}
          <section className="relative overflow-hidden rounded-[var(--radius-card)] border border-brand/20 p-6 sm:p-8">
            <div className="absolute inset-0 -z-10 bg-surface" />
            <div className="absolute -top-24 -right-24 -z-10 size-96 glow" />
            <div className="flex flex-col gap-6 sm:flex-row sm:items-center">
              <div className="flex-1">
                <Pill tone="ok">Step 2 of 4</Pill>
                <h2 className="mt-3 text-xl font-semibold">Install Parakeet for desktop</h2>
                <p className="mt-1 max-w-lg text-sm text-muted">
                  The desktop app listens to your call and shows answers on a private overlay. Available for Windows, macOS
                  and Linux. Sign in once with this account.
                </p>
              </div>
              <DownloadButtons />
            </div>
          </section>

          <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
            <Card title="Getting started" icon={Check} action={<span className="text-xs text-muted">{doneCount}/{checklist.length}</span>}>
              <div className="mb-4 h-1.5 overflow-hidden rounded-full bg-white/5">
                <div className="h-full rounded-full bg-brand-gradient" style={{ width: `${(doneCount / checklist.length) * 100}%` }} />
              </div>
              <ul className="space-y-1">
                {checklist.map((c) => (
                  <li key={c.label} className="flex items-center gap-3 rounded-lg px-2 py-2.5 text-sm hover:bg-white/[0.03]">
                    <span
                      className={`grid size-5 place-items-center rounded-full ring-1 ${
                        c.done ? 'bg-brand text-bg ring-brand' : 'ring-line-strong'
                      }`}
                    >
                      {c.done && <Check size={12} strokeWidth={3} />}
                    </span>
                    <span className={c.done ? 'text-muted line-through' : ''}>{c.label}</span>
                  </li>
                ))}
              </ul>
            </Card>

            <Card title="Account" icon={User}>
              {me.state === 'loading' && <Spinner className="text-muted" />}
              {me.state === 'error' && <p className="text-sm text-danger">{me.error}</p>}
              {me.state === 'ok' && (
                <dl className="space-y-3 text-sm">
                  <div className="flex justify-between gap-4"><dt className="text-muted">Plan</dt><dd><Pill tone="ok">{me.data.plan}</Pill></dd></div>
                  <div className="flex justify-between gap-4"><dt className="text-muted">Sign-in</dt><dd className="capitalize">{me.data.authProvider}</dd></div>
                  <div className="flex justify-between gap-4"><dt className="text-muted">Member since</dt><dd>{new Date(me.data.createdAt).toLocaleDateString()}</dd></div>
                  <div className="flex justify-between gap-4"><dt className="text-muted">User ID</dt><dd className="truncate font-mono text-xs text-muted">{me.data.id.slice(0, 18)}…</dd></div>
                </dl>
              )}
            </Card>
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            <Card
              title="System status"
              icon={Activity}
              action={<button onClick={refreshHealth} className="btn btn-ghost !p-1.5" aria-label="Refresh"><RefreshCw size={15} /></button>}
            >
              {health.state === 'loading' && <Spinner className="text-muted" />}
              {health.state === 'error' && <p className="text-sm text-danger">API unreachable: {health.error}</p>}
              {health.state === 'ok' && (
                <ul className="divide-y divide-line">
                  {Object.entries(health.data.checks).map(([name, c]) => (
                    <li key={name} className="flex items-center gap-3 py-2.5 text-sm first:pt-0 last:pb-0">
                      <Dot tone={c.ok ? 'ok' : 'bad'} />
                      <span className="capitalize">{name}</span>
                      <span className="ml-auto font-mono text-xs text-muted">{c.ok ? `${c.latencyMs} ms` : c.error}</span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-4 truncate text-xs text-faint">{API_URL}</p>
            </Card>

            <Card title="Background worker" icon={Cpu}>
              <p className="text-sm text-muted">Send a job through Redis to the worker and back.</p>
              <button
                onClick={() => runJob(api<PingJobResult>('/v1/jobs/ping', { method: 'POST' }))}
                disabled={job.state === 'loading'}
                className="btn btn-secondary mt-4"
              >
                {job.state === 'loading' ? <Spinner /> : 'Send ping job'}
              </button>
              {job.state === 'ok' && (
                <p className="mt-4 flex items-center gap-2 text-sm text-brand">
                  <Check size={15} /> Job #{job.data.jobId} processed by {job.data.result.processedBy} in {job.data.result.queuedMs} ms
                </p>
              )}
              {job.state === 'error' && <p className="mt-4 text-sm text-danger">{job.error}</p>}
            </Card>
          </div>
        </div>
      </main>
    </div>
  );
}
