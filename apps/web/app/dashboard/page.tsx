'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Activity, Check, CreditCard, RefreshCw, User } from 'lucide-react';
import { planLabel, trialLeft, type HealthReport, type Me } from '@parakeet/shared';
import { api, API_URL } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import { AppShell } from '@/components/AppShell';
import { LogoMark } from '@/components/Logo';
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

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

export default function Dashboard() {
  const router = useRouter();
  const [email, setEmail] = useState<string | null>(null);
  const [me, loadMe] = useResult<Me>();
  const [health, loadHealth] = useResult<HealthReport>();

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
      if (event === 'SIGNED_OUT') router.replace('/');
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
    <AppShell email={email}>
      <div className="mx-auto max-w-5xl space-y-6 px-4 py-8 sm:px-8 sm:py-10">
        <header className="flex flex-wrap items-end justify-between gap-4 animate-fade-up">
          <div>
            <p className="text-sm text-muted">{greeting()},</p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight capitalize">{name.split(/[._+-]/)[0]}</h1>
          </div>
        </header>

        {/* download banner */}
        <section className="relative overflow-hidden rounded-[var(--radius-card)] border border-brand/20 p-6 sm:p-8">
          <div className="absolute inset-0 -z-10 bg-surface" />
          <div className="absolute -top-24 -right-24 -z-10 size-96 glow" />
          <div className="flex flex-col gap-6 sm:flex-row sm:items-center">
            <div className="flex-1">
              <Pill tone="ok">Step 2 of 4</Pill>
              <h2 className="mt-3 text-xl font-semibold">Install Friday AI for desktop</h2>
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

          <Card
            title="Account"
            icon={User}
            action={
              <Link href="/billing" className="btn btn-secondary !px-3 !py-1.5 text-xs">
                <CreditCard size={14} /> {me.state === 'ok' && me.data.plan !== 'free' ? 'Billing' : 'Upgrade'}
              </Link>
            }
          >
            {me.state === 'loading' && <Spinner className="text-muted" />}
            {me.state === 'error' && <p className="text-sm text-danger">{me.error}</p>}
            {me.state === 'ok' && (
              <dl className="space-y-3 text-sm">
                <div className="flex justify-between gap-4"><dt className="text-muted">Plan</dt><dd><Pill tone="ok">{planLabel(me.data.plan)}</Pill></dd></div>
                {me.data.planExpiresAt && (
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted">Active until</dt>
                    <dd>{new Date(me.data.planExpiresAt).toLocaleDateString()}</dd>
                  </div>
                )}
                {me.data.trial && (
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted">Session minutes</dt>
                    <dd>{trialLeft(me.data.trial)}</dd>
                  </div>
                )}
                <div className="flex justify-between gap-4"><dt className="text-muted">Sign-in</dt><dd className="capitalize">{me.data.authProvider}</dd></div>
                <div className="flex justify-between gap-4"><dt className="text-muted">Member since</dt><dd>{new Date(me.data.createdAt).toLocaleDateString()}</dd></div>
                <div className="flex justify-between gap-4"><dt className="text-muted">User ID</dt><dd className="truncate font-mono text-xs text-muted">{me.data.id.slice(0, 18)}…</dd></div>
              </dl>
            )}
          </Card>
        </div>

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
        </Card>
      </div>
    </AppShell>
  );
}
