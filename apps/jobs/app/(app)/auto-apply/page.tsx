'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertCircle, ChevronDown, Puzzle, ShieldCheck, Zap } from 'lucide-react';
import {
  AUTO_APPLY_LIMITS, AUTO_APPLY_STATUS_LABELS, type AutoApplyOverview, type AutoApplySettings, type AutoApplyStatus,
} from '@parakeet/shared';
import { AutoApplyList, TABS } from '@/components/AutoApplyList';
import { AutoApplyProfile } from '@/components/AutoApplyProfile';
import { Spinner } from '@/components/ui';
import { api } from '@/lib/api';

const CONSENT = [
  'Friday may send job applications in my name to jobs that match my settings, with my tailored resume and the answers it prepares from my resume and application profile.',
  'Friday never makes up qualifications or personal details. Questions it can’t answer truthfully wait for me.',
  'Where a form requires it, Friday confirms I’ve read the employer’s privacy notice and that my details are accurate.',
  'Each application carries a cover letter Friday writes from my resume for that job.',
  'Applications are submitted from my own browser through the Friday extension. Friday doesn’t get past CAPTCHAs or other checks for me; when a job board asks for one, the application waits for me.',
  'I can turn Auto Apply off at any time.',
];

export default function AutoApplyPage() {
  const [data, setData] = useState<AutoApplyOverview | null>(null);
  const [tab, setTab] = useState<AutoApplyStatus>('pending');
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);

  const load = useCallback(async () => {
    const d = await api<AutoApplyOverview>('/v1/auto-apply');
    setData(d);
    if (d.blockers.some((b) => b.startsWith('Complete your application profile'))) setProfileOpen(true);
  }, []);
  useEffect(() => {
    load().catch((e) => setError((e as Error).message));
    // Links from the email open a tab: /auto-apply?status=pending
    const status = new URLSearchParams(location.search).get('status') as AutoApplyStatus | null;
    if (status && TABS.some((t) => t.id === status)) setTab(status);
  }, [load]);

  async function update(patch: Partial<AutoApplySettings> & { consent?: true }) {
    setBusy(true);
    setError(null);
    try {
      await api('/v1/auto-apply/settings', { method: 'PUT', body: JSON.stringify(patch) });
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!data) {
    return (
      <div className="grid min-h-[60vh] place-items-center">{error ? <p className="text-sm text-danger">{error}</p> : <Spinner className="text-muted" />}</div>
    );
  }
  const { settings, counts } = data;
  const needsConsent = !settings.consentedAt;
  const otherBlockers = data.blockers.filter((b) => !b.startsWith('Agree'));

  return (
    <div className="mx-auto max-w-4xl px-4 pt-8 pb-16 sm:px-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight sm:text-[28px]">
            <Zap size={24} className="text-violet-600" /> Auto Apply
          </h1>
          <p className="mt-1 text-muted">
            Every day Friday picks your best new matches, tailors your resume to each and fills in the application. It keeps
            going while your computer is off; your browser sends them when it&rsquo;s open.
          </p>
        </div>
        <button
          disabled={busy || (!settings.enabled && (otherBlockers.length > 0 || (needsConsent && !agree)))}
          onClick={() => update(settings.enabled ? { enabled: false } : { enabled: true, ...(needsConsent ? { consent: true } : {}) })}
          className={`btn ${settings.enabled ? 'btn-secondary' : 'btn-brand'}`}
        >
          {busy ? <Spinner /> : settings.enabled ? 'Turn off' : 'Turn on Auto Apply'}
        </button>
      </div>

      {error && <p className="mt-4 rounded-xl border border-danger/20 bg-danger/5 px-4 py-3 text-sm text-danger">{error}</p>}

      <section className="card mt-6 p-5 sm:p-6">
        <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
          <div>
            <p className="text-xs font-semibold tracking-wider text-faint uppercase">Status</p>
            <p className={`mt-1 font-semibold ${settings.enabled ? 'text-brand' : 'text-muted'}`}>{settings.enabled ? 'On' : 'Off'}</p>
          </div>
          <div>
            <p className="text-xs font-semibold tracking-wider text-faint uppercase">Today</p>
            <p className="mt-1 font-semibold tabular-nums">
              {data.today} / {settings.dailyLimit}
            </p>
          </div>
          <div>
            <p className="text-xs font-semibold tracking-wider text-faint uppercase">Submitted</p>
            <p className="mt-1 font-semibold tabular-nums">{counts.submitted}</p>
          </div>
          {data.needsYou > 0 && (
            <button onClick={() => setTab('pending')} className="ml-auto flex items-center gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800">
              <AlertCircle size={15} /> {data.needsYou} need{data.needsYou === 1 ? 's' : ''} you
            </button>
          )}
        </div>

        <div className="mt-6 grid gap-6 border-t border-line pt-5 sm:grid-cols-2">
          <label className="block">
            <span className="flex items-baseline justify-between text-sm font-medium">
              Minimum match <span className="tabular-nums text-brand">{settings.minScore}%</span>
            </span>
            <input
              type="range"
              min={AUTO_APPLY_LIMITS.minScore}
              max={AUTO_APPLY_LIMITS.maxScore}
              step={5}
              defaultValue={settings.minScore}
              onMouseUp={(e) => update({ minScore: Number((e.target as HTMLInputElement).value) })}
              onTouchEnd={(e) => update({ minScore: Number((e.target as HTMLInputElement).value) })}
              onKeyUp={(e) => update({ minScore: Number((e.target as HTMLInputElement).value) })}
              className="mt-2 w-full accent-emerald-600"
            />
            <span className="text-xs text-muted">Only jobs at least this good a match. Higher means fewer, better-fitting applications.</span>
          </label>
          <label className="block">
            <span className="text-sm font-medium">Applications a day</span>
            <input
              key={settings.dailyLimit}
              type="number"
              min={1}
              max={data.plan.dailyApplications}
              defaultValue={settings.dailyLimit}
              onBlur={(e) => {
                const v = Math.max(1, Math.min(data.plan.dailyApplications, Number(e.target.value) || 1));
                if (v !== settings.dailyLimit) update({ dailyLimit: v });
              }}
              className="input mt-1.5 block !w-32"
            />
            <span className="mt-1 block text-xs text-muted">
              Up to {data.plan.dailyApplications} on {data.plan.name}
              {data.plan.id !== 'premium' && (
                <>
                  {' '}(<Link href="/plans" className="underline underline-offset-2">more with a plan</Link>)
                </>
              )}
              . Resets at midnight ({settings.timezone}).
            </span>
          </label>
        </div>

        <div className="mt-6 border-t border-line pt-5">
          <p className="text-sm font-medium">Which jobs</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {([
              ['auto', 'Friday picks', 'Your best matches above the minimum, every day, up to your limit.'],
              ['review', 'I pick by swiping', 'Only jobs you swipe right on. Nothing is sent that you didn’t choose.'],
            ] as const).map(([mode, title, hint]) => (
              <button
                key={mode}
                onClick={() => update({ mode })}
                disabled={busy}
                className={`rounded-xl border p-3 text-left text-sm transition ${settings.mode === mode ? 'border-brand/50 bg-brand/5' : 'border-line-strong hover:border-line'}`}
              >
                <span className="font-medium">{title}</span>
                <span className="mt-0.5 block text-xs text-muted">{hint}</span>
              </button>
            ))}
          </div>
          {settings.mode === 'review' && (
            <Link href="/swipe" className="btn btn-secondary mt-3 !py-1.5 !text-xs">
              Open Swipe
            </Link>
          )}
        </div>

        {!settings.enabled && data.blockers.length > 0 && (
          <div className="mt-5 rounded-xl border border-line bg-surface-2/60 p-4 text-sm">
            <p className="font-medium">Before you turn it on</p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-muted">
              {data.blockers.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          </div>
        )}

        {needsConsent && (
          <div className="mt-5 rounded-xl border border-violet-200 bg-violet-50/50 p-4 text-sm">
            <p className="flex items-center gap-1.5 font-medium">
              <ShieldCheck size={16} className="text-violet-700" /> Applying in your name
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-muted">
              {CONSENT.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
            <label className="mt-3 flex items-center gap-2 font-medium">
              <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} /> I agree
            </label>
          </div>
        )}

        <div className="mt-5 flex items-start gap-3 rounded-xl border border-line p-4 text-sm">
          <Puzzle size={18} className="mt-0.5 shrink-0 text-faint" />
          <p className="text-muted">
            <span className="font-medium text-fg">Submitting needs the Friday extension for Chrome.</span> It sends your prepared
            applications whenever your browser is open, and stops for you if a job board asks for a CAPTCHA or a sign-in.
          </p>
        </div>
      </section>

      <section className="card mt-6">
        <button onClick={() => setProfileOpen(!profileOpen)} className="flex w-full items-center justify-between p-5 text-left sm:px-6">
          <div>
            <h2 className="font-semibold">Application profile</h2>
            <p className="text-sm text-muted">What forms ask that your resume doesn&rsquo;t say. Friday answers only from this and your resume.</p>
          </div>
          <ChevronDown size={18} className={`shrink-0 text-faint transition ${profileOpen ? 'rotate-180' : ''}`} />
        </button>
        {profileOpen && (
          <div className="border-t border-line p-5 sm:p-6">
            <AutoApplyProfile initial={data.profile} onSaved={() => load()} />
          </div>
        )}
      </section>

      <section className="card mt-6 overflow-hidden">
        <div className="flex gap-1 overflow-x-auto border-b border-line px-3 pt-3">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              title={t.hint}
              className={`shrink-0 rounded-t-lg border-b-2 px-3 pb-2.5 text-sm font-medium transition ${
                tab === t.id ? 'border-brand text-fg' : 'border-transparent text-muted hover:text-fg'
              }`}
            >
              {AUTO_APPLY_STATUS_LABELS[t.id]}
              <span className="ml-1.5 text-xs text-faint tabular-nums">{counts[t.id]}</span>
            </button>
          ))}
        </div>
        <p className="px-5 pt-3 text-xs text-muted">{TABS.find((t) => t.id === tab)?.hint}</p>
        <AutoApplyList status={tab} onChange={() => load()} />
      </section>
    </div>
  );
}
