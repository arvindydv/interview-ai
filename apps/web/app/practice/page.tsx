'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowRight, BarChart3, ChevronRight, Download, Flame, GraduationCap, Mic, MoreHorizontal, Play, Target, Timer, Trash2, Trophy,
} from 'lucide-react';
import {
  FREE_MINUTES, NO_MINUTES_ERROR, PRACTICE_DIFFICULTIES, freeTrialMessage, type FreeTrialStatus, PRACTICE_LENGTHS, type InterviewSummary, type Me, type PracticeDifficulty, type PracticeLength,
  type PracticeSession, type PracticeSetup, type PracticeSummary, type RoundType,
} from '@parakeet/shared';
import { ApiError, api } from '@/lib/api';
import { useRequireSession } from '@/lib/useSession';
import { interviewTitle, relative, roundLabel, roundsFor } from '@/lib/interviews';
import { formatLeft, scoreLabel, scoreTone, secondsLeft } from '@/lib/practice';
import { AppShell } from '@/components/AppShell';
import { LogoMark } from '@/components/Logo';
import { Spinner } from '@/components/ui';
import { ConfirmDialog, Menu, Toaster, toast } from '@/components/overlay';
import { Monogram } from '@/components/interviews/parts';
import { ScoreTrend } from '@/components/practice/charts';

const errorText = (e: unknown) => (e instanceof ApiError ? e.message : 'Something went wrong. Try again.');

/** Roughly two minutes per question, including thinking time. */
const minutesFor = (n: number) => n * 2;

export default function PracticePage() {
  const email = useRequireSession();
  const router = useRouter();
  const [sessions, setSessions] = useState<PracticeSummary[] | null>(null);
  const [interviews, setInterviews] = useState<InterviewSummary[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [setup, setSetup] = useState<PracticeSetup | null>(null);
  const [starting, setStarting] = useState(false);
  const [deleting, setDeleting] = useState<PracticeSummary | null>(null);
  // Seconds of session minutes left; null = unlimited plan; undefined = still loading.
  const [left, setLeft] = useState<number | null | undefined>(undefined);
  const [trialStatus, setTrialStatus] = useState<FreeTrialStatus>('granted');

  const load = () =>
    api<{ sessions: PracticeSummary[] }>('/v1/practice').then(
      (r) => {
        setSessions(r.sessions);
        setLoadError(null);
      },
      (e) => setLoadError(errorText(e)),
    );

  useEffect(() => {
    if (!email) return;
    load();
    // If the balance can't be read, let the server decide when the session starts.
    api<Me>('/v1/me').then(
      (me) => {
        setLeft(secondsLeft(me.trial));
        setTrialStatus(me.trialStatus);
      },
      () => setLeft(null),
    );
    api<{ interviews: InterviewSummary[] }>('/v1/interviews').then(
      ({ interviews }) => {
        setInterviews(interviews);
        const active = interviews.find((i) => i.active);
        setSetup({ interviewId: active?.id ?? null, roundType: active?.roundType ?? 'general', difficulty: 'standard', questionCount: 5 });
      },
      () => setSetup({ interviewId: null, roundType: 'general', difficulty: 'standard', questionCount: 5 }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [email]);

  const start = async () => {
    if (!setup) return;
    setStarting(true);
    try {
      const r = await api<{ session: PracticeSession }>('/v1/practice', { method: 'POST', body: JSON.stringify(setup) });
      router.push(`/practice/${r.session.id}`);
    } catch (e) {
      if (e instanceof ApiError && e.status === 402) {
        toast(e.message, { tone: 'bad' });
        router.push(`/pricing?${new URLSearchParams({ from: 'practice', reason: NO_MINUTES_ERROR })}`);
        return;
      }
      toast(errorText(e), { tone: 'bad' });
      setStarting(false);
    }
  };

  const remove = async () => {
    if (!deleting) return;
    try {
      await api(`/v1/practice/${deleting.id}`, { method: 'DELETE' });
      setSessions((s) => s?.filter((x) => x.id !== deleting.id) ?? s);
      toast('Session deleted.');
    } catch (e) {
      toast(errorText(e), { tone: 'bad' });
    }
    setDeleting(null);
  };

  if (!email) {
    return (
      <div className="grid min-h-screen place-items-center">
        <LogoMark size={40} />
      </div>
    );
  }

  const scored = (sessions ?? []).filter((s) => s.status === 'scored' && s.score !== null);
  const unfinished = (sessions ?? []).find((s) => s.status === 'ready');

  return (
    <AppShell email={email}>
      <div className="mx-auto max-w-5xl space-y-6 px-4 py-8 sm:px-8 sm:py-10">
        <header className="animate-fade-up">
          <p className="eyebrow">Workspace</p>
          <h1 className="mt-1.5 text-3xl font-semibold tracking-tight">Practice</h1>
          <p className="mt-1.5 max-w-xl text-sm text-muted">
            Mock interviews with an AI interviewer who knows the role and your resume. Answer out loud, then get scores, honest
            feedback and a stronger version of every answer.
          </p>
        </header>

        {unfinished && (
          <Link
            href={`/practice/${unfinished.id}`}
            className="flex items-center gap-3 rounded-xl border border-brand-2/30 bg-brand-2/[0.06] px-4 py-3 text-sm transition hover:bg-brand-2/10 animate-fade-up"
          >
            <Play size={16} className="shrink-0 text-brand-2" />
            <span className="min-w-0 flex-1">
              <span className="font-medium">Continue your session</span>
              <span className="text-muted">
                {' '}
                · {unfinished.title} · {unfinished.answered} of {unfinished.questionCount} answered
              </span>
            </span>
            <ChevronRight size={16} className="text-muted" />
          </Link>
        )}

        <SetupCard setup={setup} setSetup={setSetup} interviews={interviews} starting={starting} onStart={start} left={left} trialStatus={trialStatus} />

        {loadError && !sessions && (
          <div className="glass flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-card)] p-5 text-sm">
            <p className="text-danger">Couldn&apos;t load your practice history: {loadError}</p>
            <button onClick={load} className="btn btn-secondary !py-1.5">Try again</button>
          </div>
        )}

        {scored.length > 0 && <Progress scored={scored} />}

        {sessions && sessions.length > 0 && (
          <section className="glass rounded-[var(--radius-card)] p-5 sm:p-6 animate-fade-up">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <GraduationCap size={16} className="text-brand" /> History
            </h2>
            <ul className="divide-y divide-line">
              {sessions.map((s) => (
                <li key={s.id} className="group relative flex items-center gap-3 py-3 first:pt-1 last:pb-1">
                  <Link href={`/practice/${s.id}`} className="absolute inset-0" aria-label={`Open ${s.title}`} />
                  <Monogram name={s.title} size={36} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium group-hover:text-brand">{s.title}</p>
                    <p className="truncate text-xs text-muted">
                      {roundLabel(s.roundType)} · {PRACTICE_DIFFICULTIES.find((d) => d.id === s.difficulty)?.label} ·{' '}
                      {relative(s.createdAt)}
                    </p>
                  </div>
                  <StatusBadge session={s} />
                  <div className="relative z-10">
                    <Menu
                      label="Session actions"
                      trigger={<MoreHorizontal size={16} />}
                      items={[{ label: 'Delete', icon: Trash2, danger: true, onSelect: () => setDeleting(s) }]}
                    />
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      <ConfirmDialog
        open={Boolean(deleting)}
        title="Delete this practice session?"
        text="Its answers, scores and feedback will be removed."
        confirmLabel="Delete"
        danger
        onConfirm={remove}
        onCancel={() => setDeleting(null)}
      />
      <Toaster />
    </AppShell>
  );
}

function StatusBadge({ session: s }: { session: PracticeSummary }) {
  if (s.status === 'scored' && s.score !== null) {
    return (
      <span className="text-right">
        <span className={`block text-lg font-semibold tabular-nums ${scoreTone(s.score)}`}>{s.score}</span>
        <span className="block text-[11px] text-faint">{scoreLabel(s.score)}</span>
      </span>
    );
  }
  const map = {
    planning: ['Preparing', 'text-brand-2'],
    ready: [`${s.answered}/${s.questionCount} answered`, 'text-brand-2'],
    scoring: ['Scoring', 'text-brand-2'],
    failed: ['Needs retry', 'text-warn'],
    scored: ['', ''],
  } as const;
  const [label, tone] = map[s.status];
  return <span className={`text-xs ${tone}`}>{label}</span>;
}

// ---- setup ---------------------------------------------------------------------------------------

function SetupCard({
  setup,
  setSetup,
  interviews,
  starting,
  onStart,
  left,
  trialStatus,
}: {
  setup: PracticeSetup | null;
  setSetup: (s: PracticeSetup) => void;
  interviews: InterviewSummary[];
  starting: boolean;
  onStart: () => void;
  left: number | null | undefined;
  trialStatus: FreeTrialStatus;
}) {
  const interview = interviews.find((i) => i.id === setup?.interviewId) ?? null;
  const rounds = useMemo(() => roundsFor(interview?.field ?? '', setup?.roundType), [interview, setup?.roundType]);
  const pickInterview = (id: string) => {
    if (!setup) return;
    const next = interviews.find((i) => i.id === id) ?? null;
    setSetup({ ...setup, interviewId: next?.id ?? null, roundType: next?.roundType ?? setup.roundType });
  };

  return (
    <section className="relative overflow-hidden rounded-[var(--radius-card)] border border-line animate-fade-up">
      <div className="absolute inset-0 -z-10 bg-surface" />
      <div className="absolute -top-32 -right-24 -z-10 size-[30rem] glow opacity-70" />
      <div className="p-6 sm:p-7">
        <div className="flex items-start gap-4">
          <span className="relative grid size-12 shrink-0 place-items-center rounded-2xl bg-brand/10 text-brand ring-1 ring-brand/25">
            <span className="ripple absolute inset-0 rounded-2xl ring-1 ring-brand/40" />
            <Mic size={22} />
          </span>
          <div>
            <h2 className="text-lg font-semibold tracking-tight">Start a mock interview</h2>
            <p className="mt-0.5 text-sm text-muted">The interviewer asks; you answer out loud or by typing. Feedback in about a minute.</p>
          </div>
        </div>

        {!setup ? (
          <div className="grid h-40 place-items-center">
            <Spinner className="text-muted" />
          </div>
        ) : (
          <div className="mt-6 grid gap-5">
            <Row label="Practise for">
              <select
                value={setup.interviewId ?? ''}
                onChange={(e) => pickInterview(e.target.value)}
                className="input !py-2.5 sm:max-w-md"
                aria-label="Interview to practise for"
              >
                <option value="">General practice (no specific role)</option>
                {interviews.map((i) => (
                  <option key={i.id} value={i.id}>
                    {interviewTitle(i)}
                    {i.company && i.role ? ` · ${i.company}` : ''}
                    {i.active ? ' (active)' : ''}
                  </option>
                ))}
              </select>
              {interviews.length === 0 && (
                <p className="mt-1.5 text-xs text-muted">
                  <Link href="/interviews/new" className="text-brand hover:underline">Add an interview</Link> to get questions for
                  your exact role.
                </p>
              )}
            </Row>

            <Row label="Round">
              <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Round">
                {rounds.map((r) => (
                  <Chip key={r.id} on={setup.roundType === r.id} onClick={() => setSetup({ ...setup, roundType: r.id as RoundType })}>
                    {r.label}
                  </Chip>
                ))}
              </div>
            </Row>

            <div className="grid gap-5 sm:grid-cols-[1fr_auto]">
              <Row label="Difficulty">
                <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Difficulty">
                  {PRACTICE_DIFFICULTIES.map((d) => {
                    const on = setup.difficulty === d.id;
                    return (
                      <button
                        key={d.id}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        onClick={() => setSetup({ ...setup, difficulty: d.id as PracticeDifficulty })}
                        className={`rounded-xl border p-3 text-left transition ${
                          on ? 'border-brand/50 bg-brand/[0.07]' : 'border-line bg-bg/40 hover:border-line-strong'
                        }`}
                      >
                        <span className="flex items-center gap-1.5 text-sm font-medium">
                          {d.id === 'tough' && <Flame size={13} className="text-warn" />}
                          {d.label}
                        </span>
                        <span className="mt-0.5 block text-[11px] leading-snug text-muted">{d.hint}</span>
                      </button>
                    );
                  })}
                </div>
              </Row>
              <Row label="Questions">
                <div className="flex gap-1.5" role="radiogroup" aria-label="Number of questions">
                  {PRACTICE_LENGTHS.map((n) => {
                    const on = setup.questionCount === n;
                    return (
                      <button
                        key={n}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        onClick={() => setSetup({ ...setup, questionCount: n as PracticeLength })}
                        className={`w-16 rounded-xl border px-2 py-3 text-center transition ${
                          on ? 'border-brand/50 bg-brand/[0.07]' : 'border-line bg-bg/40 hover:border-line-strong'
                        }`}
                      >
                        <span className="block text-sm font-semibold tabular-nums">{n}</span>
                        <span className="block text-[11px] text-muted">~{minutesFor(n)} min</span>
                      </button>
                    );
                  })}
                </div>
              </Row>
            </div>

            {left === 0 && trialStatus === 'pending' ? (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-brand/30 bg-brand/[0.06] px-4 py-3">
                <p className="flex items-center gap-2 text-sm">
                  <Download size={16} className="shrink-0 text-brand" />
                  <span>
                    <span className="font-medium text-brand">Unlock your {FREE_MINUTES} free minutes.</span>{' '}
                    <span className="text-muted">Install the desktop app and sign in once. One free trial per person.</span>
                  </span>
                </p>
                <div className="flex gap-2">
                  <Link href="/pricing?from=practice" className="btn btn-ghost !py-2 text-sm">
                    Buy minutes
                  </Link>
                  <Link href="/#download" className="btn btn-primary !py-2">
                    <Download size={15} /> Get the app
                  </Link>
                </div>
              </div>
            ) : left === 0 ? (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-warn/30 bg-warn/[0.06] px-4 py-3">
                <p className="flex items-center gap-2 text-sm">
                  <Timer size={16} className="shrink-0 text-warn" />
                  <span>
                    <span className="font-medium text-warn">You&apos;re out of session minutes.</span>{' '}
                    <span className="text-muted">
                      {trialStatus !== 'granted' ? freeTrialMessage(trialStatus) : 'Practice uses the same minutes as live interviews.'}
                    </span>
                  </span>
                </p>
                <Link href="/pricing?from=practice" className="btn btn-primary !py-2">
                  Get more minutes <ArrowRight size={15} />
                </Link>
              </div>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-5">
                <p className="text-xs text-muted">
                  {left === undefined || left === null ? (
                    <>Tip: speak your answers. It&apos;s the closest thing to the real interview, and you get pace and filler-word feedback.</>
                  ) : (
                    <span className="flex items-center gap-1.5">
                      <Timer size={13} className={left < minutesFor(setup.questionCount) * 60 ? 'text-warn' : 'text-brand'} />
                      Uses your session minutes while you answer.{' '}
                      <span className={left < minutesFor(setup.questionCount) * 60 ? 'text-warn' : 'text-fg'}>{formatLeft(left)} left</span>
                      {left < minutesFor(setup.questionCount) * 60 && (
                        <>
                          , which may not cover {setup.questionCount} questions.{' '}
                          <Link href="/pricing?from=practice" className="text-brand hover:underline">Get more</Link>
                        </>
                      )}
                    </span>
                  )}
                </p>
                <button onClick={onStart} disabled={starting || left === undefined} className="btn btn-primary btn-shine">
                  {starting ? <Spinner className="!size-4" /> : <Play size={16} />} Start interview
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-2 text-xs font-medium text-muted">{label}</p>
      {children}
    </div>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      onClick={onClick}
      className={`rounded-full px-3 py-1.5 text-xs font-medium ring-1 transition ${
        on ? 'bg-brand/15 text-brand ring-brand/40' : 'text-muted ring-line hover:bg-white/5 hover:text-fg'
      }`}
    >
      {children}
    </button>
  );
}

// ---- progress ------------------------------------------------------------------------------------

function Progress({ scored }: { scored: PracticeSummary[] }) {
  const ordered = [...scored].reverse();
  const recent = ordered.slice(-5);
  const avg = Math.round(recent.reduce((n, s) => n + s.score!, 0) / recent.length);
  const best = Math.max(...scored.map((s) => s.score!));
  const first = ordered[0].score!;
  const change = ordered.length > 1 ? ordered[ordered.length - 1].score! - first : null;
  const tiles = [
    { icon: BarChart3, label: 'Average (last 5)', value: avg, note: scoreLabel(avg) },
    { icon: Trophy, label: 'Best score', value: best, note: `of ${scored.length} scored` },
    {
      icon: Target,
      label: 'Since your first',
      value: change === null ? '–' : `${change >= 0 ? '+' : ''}${change}`,
      note: change === null ? 'Practise again to see' : change >= 0 ? 'points up' : 'points down',
    },
    {
      icon: Mic,
      label: 'Questions answered',
      value: scored.reduce((n, s) => n + s.answered, 0),
      note: `in ${scored.length} session${scored.length === 1 ? '' : 's'}`,
    },
  ];
  return (
    <section className="space-y-3">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map(({ icon: Icon, label, value, note }, n) => (
          <div key={label} className="glass rounded-2xl p-4 animate-fade-up" style={{ animationDelay: `${n * 50}ms` }}>
            <p className="flex items-center gap-2 text-xs text-muted">
              <Icon size={14} className="text-brand" /> {label}
            </p>
            <p className="mt-2 text-2xl font-semibold tracking-tight tabular-nums">{value}</p>
            <p className="mt-0.5 truncate text-xs text-faint">{note}</p>
          </div>
        ))}
      </div>
      {ordered.length > 1 && (
        <div className="glass rounded-[var(--radius-card)] p-5 sm:p-6 animate-fade-up">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold">Readiness trend</h2>
            <span className="text-xs text-muted">Score per session, out of 100</span>
          </div>
          <ScoreTrend points={ordered.slice(-20).map((s) => ({ id: s.id, score: s.score!, date: s.completedAt ?? s.createdAt, title: s.title }))} />
        </div>
      )}
    </section>
  );
}
