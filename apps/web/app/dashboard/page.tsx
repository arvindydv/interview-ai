'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ArrowRight, CalendarClock, Check, ChevronRight, CreditCard, FileText, GraduationCap, Mic, MessageSquareText, Plus,
  Sparkles, Target, Timer,
} from 'lucide-react';
import {
  freeTrialMessage, planLabel, scoreOutOf10, type AccountSettings, type HistoryPage, type InterviewSummary, type Me, type PracticeSummary,
  type Resume,
} from '@parakeet/shared';
import { api } from '@/lib/api';
import { useRequireSession } from '@/lib/useSession';
import { interviewSubtitle, interviewTitle, isClosed, isUpcoming, readiness, relative, roundLabel } from '@/lib/interviews';
import { formatLeft, scoreTone, secondsLeft } from '@/lib/practice';
import { AppShell } from '@/components/AppShell';
import { LogoMark } from '@/components/Logo';
import { Card, Pill } from '@/components/ui';
import { DownloadButtons } from '@/components/DownloadButtons';
import { MacInstallGuide } from '@/components/MacInstallGuide';
import { ActiveBadge, Monogram, ReadinessBar } from '@/components/interviews/parts';

interface Overview {
  me: Me | null;
  interviews: InterviewSummary[];
  resume: Resume | null;
  practice: PracticeSummary[];
  history: HistoryPage | null;
  settings: AccountSettings | null;
}

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

/** Each section degrades on its own: one failing endpoint shouldn't blank the whole overview. */
async function loadOverview(): Promise<Overview> {
  const [me, interviews, resume, practice, history, settings] = await Promise.allSettled([
    api<Me>('/v1/me'),
    api<{ interviews: InterviewSummary[] }>('/v1/interviews'),
    api<{ resume: Resume | null }>('/v1/resume'),
    api<{ sessions: PracticeSummary[] }>('/v1/practice'),
    api<HistoryPage>('/v1/history'),
    api<AccountSettings>('/v1/settings'),
  ]);
  const ok = <T,>(r: PromiseSettledResult<T>) => (r.status === 'fulfilled' ? r.value : null);
  return {
    me: ok(me),
    interviews: ok(interviews)?.interviews ?? [],
    resume: ok(resume)?.resume ?? null,
    practice: ok(practice)?.sessions ?? [],
    history: ok(history),
    settings: ok(settings),
  };
}

export default function Dashboard() {
  const email = useRequireSession();
  const [data, setData] = useState<Overview | null>(null);
  const [now] = useState(() => Date.now());

  useEffect(() => {
    if (email) loadOverview().then(setData);
  }, [email]);

  if (email === null) {
    return (
      <div className="grid min-h-screen place-items-center">
        <LogoMark size={40} />
      </div>
    );
  }

  const name = data?.resume?.profile?.name?.split(' ')[0] || email.split('@')[0].split(/[._+-]/)[0];
  const next = data ? nextInterview(data.interviews, now) : null;

  return (
    <AppShell email={email}>
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-8 sm:py-10">
        <header className="flex flex-wrap items-end justify-between gap-4 animate-fade-up">
          <div>
            <p className="text-sm text-muted">{greeting()},</p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight capitalize">{name}</h1>
            <p className="mt-1.5 text-sm text-muted">
              {next?.scheduledAt
                ? <>Your next interview, <span className="text-fg">{interviewTitle(next)}</span>, is {relative(next.scheduledAt, now)}.</>
                : 'Here’s where your interview prep stands.'}
            </p>
          </div>
          <div className="flex gap-2">
            <Link href="/practice" className="btn btn-secondary">
              <GraduationCap size={16} /> Practice
            </Link>
            <Link href="/interviews/new" className="btn btn-primary">
              <Plus size={16} /> New interview
            </Link>
          </div>
        </header>

        {!data ? (
          <OverviewSkeleton />
        ) : (
          <>
            <Setup data={data} />
            <Stats data={data} now={now} />
            <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
              <UpNext interviews={data.interviews} resume={data.resume} now={now} />
              <div className="space-y-6">
                <PlanCard me={data.me} />
                <ResumeCard resume={data.resume} now={now} />
              </div>
            </div>
            <RecentActivity practice={data.practice} history={data.history} now={now} />
          </>
        )}
      </div>
    </AppShell>
  );
}

/** The soonest scheduled interview still being prepared for, else the active one. */
function nextInterview(list: InterviewSummary[], now: number) {
  const upcoming = list
    .filter((i) => isUpcoming(i, now))
    .sort((a, b) => new Date(a.scheduledAt!).getTime() - new Date(b.scheduledAt!).getTime());
  return upcoming[0] ?? list.find((i) => i.active && !isClosed(i.stage)) ?? null;
}

// ---- setup ---------------------------------------------------------------------------------------

function Setup({ data }: { data: Overview }) {
  const desktop = Boolean(data.settings?.devices.length) || Boolean(data.history?.sessions.length);
  const steps = [
    { key: 'account', label: 'Create your account', hint: 'You’re signed in', done: true },
    { key: 'desktop', label: 'Install the desktop app', hint: 'Private overlay for live answers', done: desktop },
    { key: 'resume', label: 'Upload your resume', hint: 'Answers use your real experience', done: Boolean(data.resume) },
    { key: 'interview', label: 'Add your first interview', hint: 'Role, company and job description', done: data.interviews.length > 0 },
  ];
  const doneCount = steps.filter((s) => s.done).length;
  const current = steps.find((s) => !s.done);
  if (!current) return null;

  return (
    <section className="relative overflow-hidden rounded-[var(--radius-card)] border border-brand/20 animate-fade-up">
      <div className="absolute inset-0 -z-10 bg-surface" />
      <div className="absolute -top-28 -right-24 -z-10 size-96 glow opacity-70" />
      <div className="p-6 sm:p-7">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">Finish setting up Friday</h2>
            <p className="mt-0.5 text-sm text-muted">A few minutes now makes every live answer sound like you.</p>
          </div>
          <span className="text-sm tabular-nums text-muted">
            <span className="font-semibold text-fg">{doneCount}</span> of {steps.length} done
          </span>
        </div>
        <div className="mt-4 h-1 overflow-hidden rounded-full bg-white/[0.06]">
          <div className="h-full rounded-full bg-brand-gradient transition-all duration-700" style={{ width: `${(doneCount / steps.length) * 100}%` }} />
        </div>

        <ol className="mt-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {steps.map((s, n) => {
            const isCurrent = s.key === current.key;
            return (
              <li
                key={s.key}
                className={`flex items-start gap-3 rounded-xl p-3 ring-1 transition ${
                  isCurrent ? 'bg-brand/[0.06] ring-brand/30' : 'ring-line'
                }`}
              >
                <span
                  className={`grid size-6 shrink-0 place-items-center rounded-full text-xs font-semibold ring-1 ${
                    s.done ? 'bg-brand text-bg ring-brand' : isCurrent ? 'text-brand ring-brand/50' : 'text-faint ring-line-strong'
                  }`}
                >
                  {s.done ? <Check size={13} strokeWidth={3} /> : n + 1}
                </span>
                <div className="min-w-0">
                  <p className={`text-sm font-medium ${s.done ? 'text-muted' : ''}`}>{s.label}</p>
                  <p className="mt-0.5 text-xs text-faint">{s.hint}</p>
                </div>
              </li>
            );
          })}
        </ol>

        <div className="mt-5 flex flex-col gap-4 border-t border-line pt-5 sm:flex-row sm:items-center sm:justify-between">
          {current.key === 'desktop' && (
            <>
              <p className="max-w-md text-sm text-muted">
                The desktop app listens to your call and shows answers on an overlay only you can see. Sign in once with this account.
              </p>
              <div className="flex flex-col gap-3">
                <DownloadButtons />
                <MacInstallGuide compact />
              </div>
            </>
          )}
          {current.key === 'resume' && (
            <>
              <p className="max-w-md text-sm text-muted">Friday reads your resume so answers cite your own projects, results and numbers.</p>
              <Link href="/resume" className="btn btn-primary">
                <FileText size={16} /> Upload resume
              </Link>
            </>
          )}
          {current.key === 'interview' && (
            <>
              <p className="max-w-md text-sm text-muted">Tell Friday about the role so answers match what they’re hiring for.</p>
              <Link href="/interviews/new" className="btn btn-primary">
                <Plus size={16} /> Add interview
              </Link>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

// ---- stats ---------------------------------------------------------------------------------------

function Stats({ data, now }: { data: Overview; now: number }) {
  const left = secondsLeft(data.me?.trial);
  const total = data.me?.trial?.totalSeconds ?? 0;
  const upcoming = data.interviews.filter((i) => isUpcoming(i, now));
  const soonest = upcoming
    .map((i) => i.scheduledAt!)
    .filter((d) => new Date(d).getTime() > now)
    .sort()[0];
  const scored = data.practice.filter((p) => p.status === 'scored' && p.score !== null);
  const recentScores = scored.slice(0, 5).map((p) => p.score!);
  const avg = recentScores.length ? Math.round(recentScores.reduce((a, b) => a + b, 0) / recentScores.length) : null;
  const questions = data.interviews.reduce((n, i) => n + i.stats.questions, 0);

  const tiles = [
    {
      icon: Timer,
      label: 'Session time left',
      value: left === null ? 'Unlimited' : formatLeft(left),
      note: left === null ? `${planLabel(data.me?.plan ?? 'free')} plan` : `of ${Math.round(total / 60)} min`,
      bar: left === null || !total ? null : left / total,
    },
    {
      icon: CalendarClock,
      label: 'Upcoming interviews',
      value: upcoming.length,
      note: soonest ? `Next ${relative(soonest, now)}` : 'Nothing scheduled',
    },
    {
      icon: Target,
      label: 'Practice score',
      value: avg === null ? '—' : `${scoreOutOf10(avg)}/10`,
      valueClass: avg === null ? 'text-faint' : scoreTone(avg),
      note: scored.length ? `Average of last ${recentScores.length} rounds` : 'No practice rounds yet',
    },
    {
      icon: MessageSquareText,
      label: 'Questions answered',
      value: questions,
      note: questions ? 'Live, across your interviews' : 'Answered live on your calls',
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {tiles.map(({ icon: Icon, label, value, note, bar, valueClass }, n) => (
        <div key={label} className="glass rounded-2xl p-4 animate-fade-up" style={{ animationDelay: `${60 + n * 50}ms` }}>
          <div className="flex items-center gap-2 text-xs text-muted">
            <Icon size={14} className="text-brand" /> {label}
          </div>
          <p className={`mt-2 text-2xl font-semibold tabular-nums tracking-tight ${valueClass ?? ''}`}>{value}</p>
          {bar != null && (
            <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/[0.07]">
              <div className={`h-full rounded-full ${bar > 0.2 ? 'bg-brand-gradient' : 'bg-warn'}`} style={{ width: `${bar * 100}%` }} />
            </div>
          )}
          <p className="mt-1.5 truncate text-xs text-faint">{note}</p>
        </div>
      ))}
    </div>
  );
}

// ---- interviews ----------------------------------------------------------------------------------

function UpNext({ interviews, resume, now }: { interviews: InterviewSummary[]; resume: Resume | null; now: number }) {
  const open = interviews.filter((i) => !isClosed(i.stage) && i.stage !== 'offer');
  const time = (i: InterviewSummary) => (isUpcoming(i, now) ? new Date(i.scheduledAt!).getTime() : Infinity);
  const shown = [...open]
    .sort((a, b) => time(a) - time(b) || Number(b.active) - Number(a.active) || b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 4);

  return (
    <Card
      title="Your interviews"
      icon={Sparkles}
      action={
        interviews.length > 0 && (
          <Link href="/interviews" className="inline-flex items-center gap-1 text-xs text-muted hover:text-fg">
            View all <ChevronRight size={14} />
          </Link>
        )
      }
    >
      {shown.length === 0 ? (
        <div className="grid place-items-center rounded-xl border border-dashed border-line-strong px-6 py-10 text-center">
          <span className="grid size-11 place-items-center rounded-xl bg-white/5 text-brand ring-1 ring-line">
            <Plus size={20} />
          </span>
          <p className="mt-3 text-sm font-medium">{interviews.length ? 'No interviews in progress' : 'No interviews yet'}</p>
          <p className="mt-1 max-w-xs text-sm text-muted">
            Add the role and job description, and Friday tailors every answer to it.
          </p>
          <Link href="/interviews/new" className="btn btn-primary mt-4 !py-1.5">
            <Plus size={15} /> New interview
          </Link>
        </div>
      ) : (
        <ul className="-mx-2 divide-y divide-line">
          {shown.map((i) => {
            const subtitle = interviewSubtitle(i);
            return (
              <li key={i.id}>
                <Link href={`/interviews/${i.id}`} className="group flex items-center gap-3 rounded-lg px-2 py-3 transition hover:bg-white/[0.03]">
                  <Monogram name={i.company || i.role || i.field} size={38} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-medium">{interviewTitle(i)}</p>
                      {i.active && <ActiveBadge />}
                    </div>
                    <p className="truncate text-xs text-muted">{[subtitle, roundLabel(i.roundType)].filter(Boolean).join(' · ')}</p>
                  </div>
                  <div className="hidden shrink-0 flex-col items-end gap-1.5 sm:flex">
                    <span className={`text-xs ${isUpcoming(i, now) ? 'text-brand' : 'text-faint'}`}>
                      {isUpcoming(i, now) ? relative(i.scheduledAt!, now) : 'No date set'}
                    </span>
                    <ReadinessBar score={readiness(i, resume).score} />
                  </div>
                  <ChevronRight size={16} className="shrink-0 text-faint transition group-hover:translate-x-0.5 group-hover:text-fg" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

// ---- plan & resume -------------------------------------------------------------------------------

function PlanCard({ me }: { me: Me | null }) {
  if (!me) return null;
  const paid = me.plan !== 'free';
  const left = secondsLeft(me.trial);
  const notice = me.trial && me.trial.totalSeconds === 0 ? freeTrialMessage(me.trialStatus) : null;
  return (
    <Card
      title="Plan"
      icon={CreditCard}
      action={<Pill tone={paid ? 'ok' : 'neutral'}>{planLabel(me.plan)}</Pill>}
    >
      <p className="text-sm text-muted">
        {left === null
          ? 'Unlimited session time.'
          : left === 0
            ? 'You’re out of session time.'
            : <><span className="font-medium text-fg">{formatLeft(left)}</span> of session time left.</>}
        {me.planExpiresAt && <> Active until {new Date(me.planExpiresAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}.</>}
      </p>
      {notice && <p className="mt-3 rounded-lg bg-white/[0.03] px-3 py-2 text-xs text-muted">{notice}</p>}
      <Link href="/billing" className={`btn mt-4 w-full ${paid ? 'btn-secondary' : 'btn-primary'}`}>
        {paid ? 'Manage billing' : <>Upgrade for more time <ArrowRight size={15} /></>}
      </Link>
    </Card>
  );
}

function ResumeCard({ resume, now }: { resume: Resume | null; now: number }) {
  const status = !resume
    ? null
    : resume.status === 'parsing'
      ? <Pill tone="warn">Analysing</Pill>
      : resume.status === 'failed'
        ? <Pill tone="bad">Needs attention</Pill>
        : <Pill tone="ok">Ready</Pill>;
  return (
    <Card title="Resume" icon={FileText} action={status}>
      {resume ? (
        <Link href="/resume" className="group -mx-2 flex items-center gap-3 rounded-lg px-2 py-2 transition hover:bg-white/[0.03]">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{resume.profile?.headline || resume.fileName}</p>
            <p className="truncate text-xs text-muted">Updated {relative(resume.updatedAt, now)}</p>
          </div>
          <ChevronRight size={16} className="shrink-0 text-faint transition group-hover:translate-x-0.5 group-hover:text-fg" />
        </Link>
      ) : (
        <>
          <p className="text-sm text-muted">Upload it once and every answer draws on your real experience.</p>
          <Link href="/resume" className="btn btn-secondary mt-4 w-full">Upload resume</Link>
        </>
      )}
    </Card>
  );
}

// ---- activity ------------------------------------------------------------------------------------

type ActivityItem = { id: string; href: string; kind: 'live' | 'practice'; title: string; meta: string; at: string; score: number | null };

function RecentActivity({ practice, history, now }: { practice: PracticeSummary[]; history: HistoryPage | null; now: number }) {
  const items: ActivityItem[] = [
    ...(history?.sessions ?? []).map((s) => ({
      id: `l-${s.id}`,
      href: `/history/${s.id}`,
      kind: 'live' as const,
      title: s.interviews[0] ?? 'Live session',
      meta: `${s.questions} question${s.questions === 1 ? '' : 's'} · ${Math.max(1, Math.round(s.seconds / 60))} min`,
      at: s.startedAt,
      score: null,
    })),
    ...practice.map((p) => ({
      id: `p-${p.id}`,
      href: `/practice/${p.id}`,
      kind: 'practice' as const,
      title: p.title || 'Practice round',
      meta: `${roundLabel(p.roundType)} · ${p.durationMinutes ? `${p.durationMinutes} min · ` : ''}${p.answered} answered`,
      at: p.completedAt ?? p.createdAt,
      score: p.status === 'scored' ? p.score : null,
    })),
  ]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 6);

  return (
    <Card
      title="Recent activity"
      icon={Mic}
      action={
        items.length > 0 && (
          <Link href="/history" className="inline-flex items-center gap-1 text-xs text-muted hover:text-fg">
            History <ChevronRight size={14} />
          </Link>
        )
      }
    >
      {items.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted">
          Live sessions and practice rounds will show up here.{' '}
          <Link href="/practice" className="text-brand hover:underline">Try a practice round</Link>
        </p>
      ) : (
        <ul className="-mx-2 divide-y divide-line">
          {items.map((it) => (
            <li key={it.id}>
              <Link href={it.href} className="group flex items-center gap-3 rounded-lg px-2 py-3 transition hover:bg-white/[0.03]">
                <span
                  className={`grid size-9 shrink-0 place-items-center rounded-lg ring-1 ${
                    it.kind === 'live' ? 'bg-brand-2/10 text-brand-2 ring-brand-2/20' : 'bg-accent/10 text-accent ring-accent/20'
                  }`}
                >
                  {it.kind === 'live' ? <Mic size={16} /> : <GraduationCap size={16} />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{it.title}</p>
                  <p className="truncate text-xs text-muted">
                    {it.kind === 'live' ? 'Live interview' : 'Practice'} · {it.meta}
                  </p>
                </div>
                {it.score !== null && <span className={`text-sm font-semibold tabular-nums ${scoreTone(it.score)}`}>{scoreOutOf10(it.score)}</span>}
                <span className="hidden w-24 shrink-0 text-right text-xs text-faint sm:block">{relative(it.at, now)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function OverviewSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading overview">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((n) => (
          <div key={n} className="glass h-[104px] animate-pulse rounded-2xl" />
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <div className="glass h-72 animate-pulse rounded-[var(--radius-card)]" />
        <div className="glass h-72 animate-pulse rounded-[var(--radius-card)]" />
      </div>
    </div>
  );
}
