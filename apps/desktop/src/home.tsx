import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AppWindow, Briefcase, Camera, Check, ChevronsUpDown, ClipboardList, Copy, EyeOff, Flag, Home as HomeIcon, Keyboard, LogOut,
  MessageSquare, PanelTopOpen, Pencil, Play, Plus, Power, RefreshCw, SendHorizontal, Sparkles, Square,
  Zap,
} from 'lucide-react';
import { ROUND_TYPES, freeTrialMessage, type FreeTrialStatus, type HealthReport, type Interview, type Me } from '@parakeet/shared';
import type { AudioStatus, LiveStatus, SourceStatus } from './types';
import { parakeet as p } from './bridge';
import { useLiveAnswer } from './useLiveAnswer';
import { renderMarkdown } from './overlay/markdown';
import { canReport } from './report';
import { ReportForm } from './reportForm';
import { Kbd, LogoMark, Panel, Spinner, StatusDot } from './ui';
import { Prepare } from './prepare';
import { useInterviewContext, type InterviewContextState } from './useInterviewContext';
import { clock, useElapsed, useMe, useTrial, type TrialState } from './useSession';
import './overlay/overlay.css';

const isMac = p.platform === 'darwin';
const MOD = isMac ? '⌘' : 'Ctrl';
const rise = (i: number) => ({ '--i': i }) as React.CSSProperties;
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** One question typical of each field's interviews. */
const FIELD_QUESTIONS: Record<string, string> = {
  'Teaching & education': 'How do you handle a disruptive student in class?',
  'Finance & accounting': 'Walk me through the three financial statements.',
  'HR & recruiting': 'How would you handle a conflict between two employees?',
  'Sales & marketing': 'How do you handle a customer who says your price is too high?',
  'Healthcare & nursing': 'How do you handle a patient who refuses treatment?',
  'Software & IT': 'How would you design a URL shortener?',
  'Data & analytics': 'How would you measure the success of a new feature?',
  Engineering: 'How do you make sure a project stays on schedule and within budget?',
  'Design & creative': 'Walk me through your design process for a recent project.',
  'Operations & supply chain': 'How would you reduce delivery delays in a warehouse?',
  'Customer service': 'How do you deal with an angry customer?',
  Banking: 'How would you convince a customer to open an account with us?',
  Legal: 'How do you manage several urgent deadlines at once?',
  'Government & public sector': 'Why do you want to serve in the public sector?',
  'Consulting & management': 'How would you estimate the market size for electric scooters in India?',
  'Internship / campus': 'Tell me about a project from your studies that you’re proud of.',
};

/** Practice questions, personalised to the interview once one is set up. Works for any profession. */
function sampleQuestions(interview: Interview | null) {
  const role = interview?.role;
  const company = interview?.company;
  return [
    'Tell me about yourself.',
    role ? `Why are you a good fit for this ${role} role?` : 'What are your greatest strengths?',
    FIELD_QUESTIONS[interview?.field ?? ''] ?? 'Tell me about a challenge you faced at work and how you handled it.',
    company ? `Why do you want to work at ${company}?` : 'Where do you see yourself in five years?',
  ];
}

const HOTKEYS = [
  { icon: EyeOff, label: 'Show or hide the overlay', keys: [MOD, '\\'] },
  { icon: Sparkles, label: 'Answer the latest question', keys: [MOD, '↵'] },
  { icon: Camera, label: 'Screenshot and solve', keys: [MOD, '⇧', '↵'] },
  { icon: MessageSquare, label: 'Open chat', keys: [MOD, '⇧', 'Space'] },
  { icon: AppWindow, label: 'Reopen this window after closing it', keys: [MOD, isMac ? '⌥' : 'Alt', 'F'] },
];

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

/** Closes when clicking outside or pressing Escape. */
function useDismiss<T extends HTMLElement>(open: boolean, close: () => void) {
  const ref = useRef<T>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && close();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, close]);
  return ref;
}

function Keys({ keys }: { keys: string[] }) {
  return (
    <span className="flex items-center gap-1">
      {keys.map((k) => (
        <Kbd key={k}>{k}</Kbd>
      ))}
    </span>
  );
}

// ---- sidebar --------------------------------------------------------------------------------------

/** The signed-in account at the foot of the sidebar; opens upwards. */
function AccountMenu({ email, me }: { email: string; me: Me | null }) {
  const [open, setOpen] = useState(false);
  const ref = useDismiss<HTMLDivElement>(open, () => setOpen(false));
  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2.5 rounded-lg p-2 text-left transition hover:bg-white/[0.04]"
      >
        <span className="bg-brand-gradient grid size-7 shrink-0 place-items-center rounded-full text-xs font-semibold text-bg uppercase">
          {email[0]}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium">{email.split('@')[0]}</span>
          <span className="block truncate text-[11px] text-faint capitalize">{me ? `${me.plan} plan` : email}</span>
        </span>
        <ChevronsUpDown size={14} className="shrink-0 text-faint" />
      </button>
      {open && (
        <div className="pop-in absolute bottom-full left-0 z-50 mb-2 w-64 rounded-xl border border-line-strong bg-surface p-1.5 shadow-2xl shadow-black/60 [transform-origin:bottom_left]">
          <div className="px-3 py-2.5">
            <p className="truncate text-sm font-medium">{email}</p>
            <p className="mt-1 flex items-center gap-2 text-xs text-muted">
              {me ? (
                <>
                  <span className="rounded-full bg-brand/10 px-2 py-0.5 font-medium text-brand capitalize ring-1 ring-brand/25">
                    {me.plan} plan
                  </span>
                  <span className="capitalize">via {me.authProvider}</span>
                </>
              ) : (
                'Loading account…'
              )}
            </p>
          </div>
          <div className="my-1 h-px bg-line" />
          <button
            onClick={() => p.auth.signOut()}
            className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-muted transition hover:bg-white/5 hover:text-fg"
          >
            <LogOut size={15} /> Sign out
          </button>
          <button
            onClick={() => p.app.quit()}
            className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-muted transition hover:bg-white/5 hover:text-fg"
          >
            <Power size={15} /> Quit Friday AI
          </button>
        </div>
      )}
    </div>
  );
}

/** Session minutes in the sidebar: what's left, or why no free minutes were granted. */
function MinutesMeter({ trial, status }: { trial: TrialState | null; status?: FreeTrialStatus }) {
  if (!trial) return null;
  const { totalSeconds, leftSeconds } = trial;
  // No free minutes were granted to this account (one trial per computer and email): say why.
  const refused = totalSeconds === 0 && status && status !== 'granted' ? freeTrialMessage(status) : null;
  const pct = totalSeconds ? (leftSeconds / totalSeconds) * 100 : 0;
  const low = leftSeconds > 0 && pct <= 20;
  return (
    <div className="rounded-xl border border-line bg-white/[0.02] p-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[11px] font-medium tracking-wide text-faint uppercase">Minutes</span>
        {!refused && (
          <span className={`text-xs tabular-nums ${leftSeconds === 0 ? 'text-danger' : low ? 'text-warn' : 'text-muted'}`}>
            <span className="font-semibold text-fg">{Math.ceil(leftSeconds / 60)}</span> / {Math.round(totalSeconds / 60)} left
          </span>
        )}
      </div>
      {refused ? (
        <p className="mt-1.5 text-[11px] leading-relaxed text-muted">{refused}</p>
      ) : (
        <>
          <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/[0.06]">
            <div
              className={`h-full rounded-full transition-[width] duration-1000 ${low ? 'bg-warn' : 'bg-brand-gradient'}`}
              style={{ width: `${pct}%` }}
            />
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-faint">
            {leftSeconds === 0 ? 'Used up. Get more minutes on the website.' : 'Counted only while a session runs.'}
          </p>
        </>
      )}
    </div>
  );
}

// ---- session ----------------------------------------------------------------------------------------

/** Which audio sources are being transcribed, while a session runs. */
function useAudioStatus(live: boolean) {
  const [audio, setAudio] = useState<AudioStatus | null>(null);
  useEffect(() => {
    if (!live) return setAudio(null);
    p.audio.status().then(setAudio, () => {});
    return p.audio.onStatus(setAudio);
  }, [live]);
  return audio;
}

function Stat({ label, value, hint, tone }: { label: string; value: React.ReactNode; hint?: React.ReactNode; tone?: 'warn' | 'danger' }) {
  return (
    <div className="min-w-0 px-5 py-4">
      <p className="text-[11px] font-medium tracking-wide text-faint uppercase">{label}</p>
      <p
        className={`mt-1 truncate text-xl font-semibold tracking-tight tabular-nums ${
          tone === 'danger' ? 'text-danger' : tone === 'warn' ? 'text-warn' : ''
        }`}
      >
        {value}
      </p>
      {hint && <p className="mt-0.5 truncate text-xs text-muted">{hint}</p>}
    </div>
  );
}

const sourceLabel: Record<SourceStatus['state'], string> = { off: 'Off', starting: 'Starting…', on: 'On', error: 'Error' };

function SourceChip({ name, source }: { name: string; source?: SourceStatus }) {
  const state = source?.enabled ? source.state : 'off';
  const dot = { on: 'bg-brand', starting: 'bg-warn', error: 'bg-danger', off: 'bg-faint' }[state];
  return (
    <span className="flex items-center gap-1.5" title={source?.error ?? undefined}>
      <span className={`size-1.5 rounded-full ${dot}`} />
      <span className="text-fg">{name}</span>
      <span className="text-muted">{sourceLabel[state]}</span>
    </span>
  );
}

/** One item of the interview context: done, or a button to add it. */
function ReadinessItem({ done, label, detail, onAdd }: { done: boolean; label: string; detail: string; onAdd: () => void }) {
  return (
    <li className="flex min-w-0 items-start gap-3 px-5 py-4">
      <span
        className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded-full ring-1 ${
          done ? 'bg-brand/15 text-brand ring-brand/30' : 'text-faint ring-line-strong'
        }`}
      >
        {done ? <Check size={11} strokeWidth={3} /> : <Plus size={11} strokeWidth={2.5} />}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium">{label}</span>
        {done ? (
          <span className="block truncate text-xs text-muted">{detail}</span>
        ) : (
          <button onClick={onAdd} className="text-xs text-brand hover:underline">
            Add
          </button>
        )}
      </span>
    </li>
  );
}

const latencyLabel = (ms: number) => (ms < 100 ? 'Excellent connection' : ms < 250 ? 'Good connection' : 'Slow connection');

/**
 * The one place to run an interview: what it's for, its state, the main action and, while live,
 * the numbers that matter (time, minutes, latency, what's being heard).
 */
function SessionCard({
  status,
  elapsed,
  trial,
  ctx,
  onPrepare,
}: {
  status: LiveStatus;
  elapsed: string | null;
  trial: TrialState | null;
  ctx: InterviewContextState;
  onPrepare: () => void;
}) {
  const live = status.state === 'connected';
  const pending = status.state === 'connecting' || status.state === 'reconnecting';
  const prepared = ctx.strength !== 'none';
  const audio = useAudioStatus(live);
  const outOfMinutes = trial?.leftSeconds === 0;

  const i = ctx.interview;
  const target = [i?.role, i?.company].filter(Boolean).join(' · ') || i?.field || '';
  const round = ROUND_TYPES.find((r) => r.id === i?.roundType && r.id !== 'general')?.label;

  const title = live ? 'Session is live' : pending ? (status.state === 'reconnecting' ? 'Reconnecting…' : 'Connecting…') : 'Ready when you are';
  const body = live
    ? `Join your call and press ${MOD} \\ to show the overlay. This window steps aside while it's open.`
    : pending
      ? 'Setting up a secure live session. This usually takes a second.'
      : 'Start a few minutes before your call. Friday AI listens for questions and answers on a private overlay.';

  const lowMinutes = trial !== null && trial.leftSeconds <= 120;
  const rtt = status.rttMs;

  return (
    <section
      className={`rise-in relative overflow-hidden rounded-2xl border bg-surface/70 transition-colors duration-500 ${
        live ? 'border-brand/30' : 'border-line'
      }`}
      style={rise(0)}
    >
      {/* A thin brand line along the top edge while live. */}
      <div
        className={`bg-brand-gradient absolute inset-x-0 top-0 h-px transition-opacity duration-500 ${live ? 'opacity-100' : 'opacity-0'}`}
        aria-hidden
      />
      <div className="flex flex-wrap items-start gap-x-6 gap-y-5 p-6">
        <div className="min-w-0 flex-1 basis-80">
          <p className="flex items-center gap-2 text-xs font-medium text-muted">
            <StatusDot state={status.state} />
            {live ? (
              <span className="text-brand">
                Live <span className="font-mono tabular-nums">{elapsed}</span>
              </span>
            ) : pending ? (
              <span className="text-warn">Connecting</span>
            ) : (
              'Not in a session'
            )}
          </p>
          <h2 key={title} className="rise-in mt-2 text-2xl font-semibold tracking-[-0.025em]">
            {title}
          </h2>
          <p className="mt-1.5 max-w-xl text-sm leading-relaxed text-muted">{body}</p>
          {target && (
            <button
              onClick={onPrepare}
              className="group mt-3 inline-flex max-w-full items-center gap-2 text-sm text-fg transition hover:text-brand"
              title="Edit interview"
            >
              <Briefcase size={14} className="shrink-0 text-muted group-hover:text-brand" />
              <span className="truncate font-medium">{target}</span>
              {round && <span className="shrink-0 text-muted">· {round}</span>}
              <Pencil size={12} className="shrink-0 text-faint opacity-0 transition group-hover:opacity-100" />
            </button>
          )}
          {status.error && !live && <p className="mt-3 text-sm text-danger">{status.error}</p>}
          {!live && outOfMinutes && (
            <p className="mt-3 text-sm text-warn">Your minutes are used up. Get more on the website to start a session.</p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {status.state === 'disconnected' ? (
            <>
              {!prepared && ctx.loaded && (
                <button onClick={onPrepare} className="btn btn-secondary px-4 py-2.5">
                  <ClipboardList size={15} /> Prepare first
                </button>
              )}
              <button onClick={() => p.live.connect()} className="btn btn-primary btn-shine px-5 py-2.5">
                <Play size={14} fill="currentColor" /> Start session
              </button>
            </>
          ) : (
            <>
              <button onClick={() => p.live.disconnect()} className="btn btn-secondary px-4 py-2.5">
                <Square size={12} fill="currentColor" /> End
              </button>
              <button onClick={() => p.overlay.show()} disabled={!live} className="btn btn-primary btn-shine px-5 py-2.5">
                {pending ? <Spinner /> : <PanelTopOpen size={16} />} Show overlay
              </button>
            </>
          )}
        </div>
      </div>

      {live || pending ? (
        <div className="grid grid-cols-2 divide-line border-t border-line @2xl:grid-cols-4 @2xl:divide-x">
          <Stat label="Session time" value={elapsed ?? '00:00'} hint={pending ? 'Reconnecting keeps the clock' : 'Since you started'} />
          <Stat
            label="Minutes left"
            value={trial ? clock(trial.leftSeconds) : 'Unlimited'}
            hint={trial ? 'Counting down while live' : 'On your plan'}
            tone={trial ? (trial.leftSeconds === 0 ? 'danger' : lowMinutes ? 'warn' : undefined) : undefined}
          />
          <Stat
            label="Latency"
            value={rtt !== null ? `${rtt} ms` : '—'}
            hint={rtt !== null ? latencyLabel(rtt) : 'Measuring…'}
            tone={rtt !== null && rtt >= 250 ? 'warn' : undefined}
          />
          <div className="min-w-0 px-5 py-4">
            <p className="text-[11px] font-medium tracking-wide text-faint uppercase">Listening</p>
            <div className="mt-2 space-y-1 text-xs">
              <SourceChip name="Interviewer" source={audio?.interviewer} />
              <SourceChip name="Your mic" source={audio?.you} />
            </div>
            <p className="mt-1 truncate text-xs text-muted">{audio?.autoAnswer === false ? 'Auto-answer off' : 'Auto-answer on'}</p>
          </div>
        </div>
      ) : (
        ctx.loaded && (
          <div className="border-t border-line">
            <div className="flex items-center justify-between px-5 pt-4">
              <p className="text-[11px] font-medium tracking-wide text-faint uppercase">Interview context</p>
              <button onClick={onPrepare} className="text-xs text-muted transition hover:text-fg">
                {ctx.strength === 'strong' ? 'Edit' : 'Complete setup'} →
              </button>
            </div>
            <ul className="grid @2xl:grid-cols-3">
              <ReadinessItem done={ctx.hasResume} label="Resume" detail={ctx.resume?.fileName ?? ''} onAdd={onPrepare} />
              <ReadinessItem done={ctx.hasTarget} label="Role & company" detail={target} onAdd={onPrepare} />
              <ReadinessItem
                done={ctx.hasJobDescription}
                label="Job description"
                detail="Answers use its must-haves"
                onAdd={onPrepare}
              />
            </ul>
          </div>
        )
      )}
    </section>
  );
}

// ---- warm-up --------------------------------------------------------------------------------------

function WarmUp({ live, ctx, style }: { live: boolean; ctx: InterviewContextState; style?: React.CSSProperties }) {
  const { answer, error, startTurn } = useLiveAnswer();
  const [question, setQuestion] = useState('');
  const [asked, setAsked] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  /** The answer whose "Report response" form is open; a new answer closes it. */
  const [reportFor, setReportFor] = useState<string | null>(null);
  const reportable = answer && { ...answer, question: asked ?? '' };
  const html = useMemo(() => (answer ? renderMarkdown(answer.text, !answer.done) : ''), [answer]);
  const streaming = !!answer && !answer.done;

  const ask = async (text: string) => {
    const q = text.trim();
    if (!q) return;
    if (!live) {
      setQuestion(q);
      return;
    }
    setAsked(q);
    setQuestion('');
    startTurn(await p.live.ask(q));
  };

  // Copy buttons inside rendered code blocks.
  const onAnswerClick = (e: React.MouseEvent) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-copy-code]');
    const code = btn?.closest('.pk-code')?.querySelector('code')?.textContent;
    if (!btn || !code) return;
    p.app.copy(code).then(() => {
      btn.setAttribute('data-copied', '');
      setTimeout(() => btn.removeAttribute('data-copied'), 1500);
    });
  };

  return (
    <Panel
      title="Warm up"
      icon={Sparkles}
      description={
        ctx.hasResume
          ? 'Ask a practice question and see how Friday AI answers with your own experience.'
          : 'Ask a practice question and see how answers will look in your interview.'
      }
      className="rise-in flex flex-col"
      style={style}
      action={
        answer?.ttftMs !== undefined && (
          <span className="flex items-center gap-1 rounded-full bg-brand/10 px-2.5 py-1 text-xs font-medium text-brand ring-1 ring-brand/25">
            <Zap size={12} /> {answer.ttftMs} ms to first word
          </span>
        )
      }
    >
      <div className="flex flex-wrap gap-2">
        {sampleQuestions(ctx.interview).map((q) => (
          <button
            key={q}
            onClick={() => ask(q)}
            className="rounded-lg bg-white/[0.03] px-3 py-1.5 text-left text-xs text-muted ring-1 ring-line transition hover:bg-white/[0.06] hover:text-fg"
          >
            {q}
          </button>
        ))}
      </div>

      <form
        className="mt-4 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (live) ask(question);
          else p.live.connect();
        }}
      >
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          className="input"
          placeholder="Or type your own question…"
        />
        {live ? (
          <button disabled={!question.trim()} className="btn btn-primary !px-4" title="Ask">
            <SendHorizontal size={16} />
          </button>
        ) : (
          <button className="btn btn-secondary shrink-0">
            <Play size={14} fill="currentColor" /> Start session to ask
          </button>
        )}
      </form>

      {error && <p className="mt-3 text-sm text-danger">{error}</p>}

      {answer ? (
        <div className="pop-in mt-4 flex min-h-0 flex-1 flex-col rounded-xl border border-brand/20 bg-bg/70 shadow-glow">
          <div className="flex items-center gap-2 border-b border-line px-4 py-2.5 text-xs">
            <Sparkles size={13} className="shrink-0 text-brand" />
            <span className="truncate text-muted">{asked}</span>
            <div className="ml-auto flex shrink-0 items-center gap-1">
              {streaming ? (
                <button onClick={() => p.live.cancel(answer.turnId)} className="btn btn-ghost !px-2 !py-1 text-xs">
                  <Square size={11} fill="currentColor" /> Stop
                </button>
              ) : (
                <button
                  onClick={() =>
                    p.app.copy(answer.text).then(() => {
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1500);
                    })
                  }
                  className="btn btn-ghost !px-2 !py-1 text-xs"
                >
                  {copied ? <Check size={12} className="text-brand" /> : <Copy size={12} />} {copied ? 'Copied' : 'Copy'}
                </button>
              )}
              {canReport(reportable) && (
                <button
                  onClick={() => setReportFor((id) => (id === answer.turnId ? null : answer.turnId))}
                  title="Report response"
                  className={`btn btn-ghost !px-2 !py-1 text-xs ${reportFor === answer.turnId ? '!text-danger' : ''}`}
                >
                  <Flag size={12} /> Report
                </button>
              )}
            </div>
          </div>
          {reportFor === answer.turnId && canReport(reportable) && (
            <div className="border-b border-line px-4 py-3">
              <ReportForm answer={reportable} onClose={() => setReportFor(null)} />
            </div>
          )}
          <div className="pk-md overflow-y-auto px-4 py-3" onClick={onAnswerClick}>
            <div dangerouslySetInnerHTML={{ __html: html }} />
            {streaming && <span className="inline-block h-4 w-[3px] translate-y-0.5 animate-caret bg-brand" />}
          </div>
        </div>
      ) : (
        <div className="mt-4 grid flex-1 place-items-center rounded-xl border border-dashed border-line py-10 text-center">
          <div>
            <MessageSquare size={18} className="mx-auto text-faint" />
            <p className="mt-2 text-xs text-muted">
              {live ? 'Pick a question above to see an answer stream in.' : 'Answers appear here once a session is running.'}
            </p>
          </div>
        </div>
      )}
    </Panel>
  );
}

// ---- side panels ----------------------------------------------------------------------------------

function Hotkeys({ style }: { style?: React.CSSProperties }) {
  return (
    <Panel title="Hotkeys" icon={Keyboard} description="Work from any app, even with your meeting in focus." className="rise-in" style={style}>
      <ul className="-mx-2 divide-y divide-line">
        {HOTKEYS.map(({ icon: Icon, label, keys }) => (
          <li key={label} className="flex items-center gap-3 px-2 py-2.5">
            <Icon size={14} className="shrink-0 text-faint" />
            <span className="flex-1 text-[13px]">{label}</span>
            <Keys keys={keys} />
          </li>
        ))}
      </ul>
      {p.platform === 'linux' && (
        <p className="mt-3 text-xs leading-relaxed text-faint">On Wayland, global hotkeys may be blocked; use the buttons instead.</p>
      )}
    </Panel>
  );
}

function SystemStatus() {
  const [health, setHealth] = useState<HealthReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const ref = useDismiss<HTMLDivElement>(open, () => setOpen(false));
  const load = () => {
    setError(null);
    p.api.health().then(setHealth, (e) => setError(errorText(e)));
  };
  useEffect(load, []);

  const ok = health?.ok && !error;
  const label = error ? "Can't reach Friday AI" : !health ? 'Checking services…' : ok ? 'All systems normal' : 'Some services are degraded';

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-muted transition hover:bg-white/[0.04] hover:text-fg"
      >
        <span className={`size-1.5 rounded-full ${!health && !error ? 'bg-faint' : ok ? 'bg-brand' : 'bg-danger'}`} />
        {label}
      </button>
      {open && (
        <div className="pop-in absolute bottom-full left-0 z-50 mb-2 w-72 rounded-xl border border-line-strong bg-surface p-3 shadow-2xl shadow-black/60 [transform-origin:bottom_left]">
          <div className="mb-2 flex items-center justify-between">
            <span className="eyebrow">Services</span>
            <button onClick={load} className="btn btn-ghost !p-1" title="Check again">
              <RefreshCw size={13} />
            </button>
          </div>
          {error && <p className="text-xs text-danger">{error}</p>}
          {health && (
            <ul className="divide-y divide-line">
              {Object.entries(health.checks).map(([n, c]) => (
                <li key={n} className="flex items-center gap-2.5 py-1.5 text-xs">
                  <span className={`size-1.5 rounded-full ${c.ok ? 'bg-brand' : 'bg-danger'}`} />
                  <span className="capitalize">{n}</span>
                  <span className="ml-auto font-mono text-muted">{c.ok ? `${c.latencyMs} ms` : c.error}</span>
                </li>
              ))}
            </ul>
          )}
          {health && <p className="mt-2 text-[11px] text-faint">API v{health.version}</p>}
        </div>
      )}
    </div>
  );
}

// ---- page -----------------------------------------------------------------------------------------

export function Home({ email }: { email: string }) {
  const [status, setStatus] = useState<LiveStatus>({ state: 'disconnected', sessionId: null, rttMs: null });
  const live = status.state === 'connected';
  const me = useMe(status.state !== 'disconnected');
  const elapsed = useElapsed(status);
  const trial = useTrial(me, live);
  const ctx = useInterviewContext();
  const [view, setView] = useState<'home' | 'prepare'>('home');
  const mainRef = useRef<HTMLElement>(null);

  /** After preparing: start the live session (if needed) and bring up the overlay for the call. */
  const startInterview = async () => {
    if ((await p.live.status()).state === 'disconnected') await p.live.connect();
    await p.overlay.show();
    setView('home');
  };
  // Each tab starts at the top (the scroll container is shared between them).
  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0 });
  }, [view]);
  const first = email.split('@')[0].split(/[._+-]/)[0];
  const name = first.charAt(0).toUpperCase() + first.slice(1);

  useEffect(() => {
    p.live.status().then(setStatus);
    return p.live.onStatus(setStatus);
  }, []);

  const tabs = [
    { id: 'home' as const, label: 'Home', icon: HomeIcon, hint: null },
    { id: 'prepare' as const, label: 'Prepare', icon: ClipboardList, hint: ctx.loaded && ctx.strength !== 'strong' ? 'Add more context' : null },
  ];

  return (
    <div className="flex h-full">
      <aside className="flex w-56 shrink-0 flex-col border-r border-line bg-surface/40">
        <div className="flex h-14 items-center gap-2.5 px-4">
          <LogoMark size={24} />
          <span className="font-semibold tracking-tight">Friday AI</span>
        </div>

        <nav className="space-y-0.5 px-2.5 pt-2">
          {tabs.map(({ id, label, icon: Icon, hint }) => (
            <button
              key={id}
              onClick={() => setView(id)}
              aria-current={view === id ? 'page' : undefined}
              title={hint ?? undefined}
              className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition ${
                view === id ? 'bg-white/[0.07] font-medium text-fg' : 'text-muted hover:bg-white/[0.03] hover:text-fg'
              }`}
            >
              <Icon size={15} className={view === id ? 'text-brand' : ''} /> {label}
              {hint && <span className="ml-auto size-1.5 rounded-full bg-brand" aria-hidden />}
            </button>
          ))}
        </nav>

        <div className="mx-2.5 mt-4 border-t border-line pt-4">
          <p className="px-2.5 text-[11px] font-medium tracking-wide text-faint uppercase">Session</p>
          <button
            onClick={() => (live ? p.overlay.toggle() : setView('home'))}
            className="mt-1.5 flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm text-muted transition hover:bg-white/[0.03] hover:text-fg"
            title={live ? `Show or hide the overlay (${MOD} \\)` : undefined}
          >
            <StatusDot state={status.state} />
            <span className="min-w-0 flex-1 truncate">
              {live ? 'Live' : status.state === 'disconnected' ? 'Not started' : 'Connecting…'}
            </span>
            {elapsed && <span className="font-mono text-xs tabular-nums">{elapsed}</span>}
          </button>
        </div>

        <div className="mt-auto space-y-2 p-2.5">
          <MinutesMeter trial={trial} status={me?.trialStatus} />
          <SystemStatus />
          <div className="border-t border-line pt-2">
            <AccountMenu email={email} me={me} />
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line px-6">
          <h1 className="text-sm font-semibold">{view === 'home' ? `${greeting()}, ${name}` : 'Prepare'}</h1>
          <div className="ml-auto flex items-center gap-2">
            <button onClick={() => p.overlay.toggle()} className="btn btn-ghost !py-1.5 text-sm" title={`Show or hide the overlay (${MOD} \\)`}>
              <PanelTopOpen size={15} /> Overlay <Kbd>{`${MOD} \\`}</Kbd>
            </button>
          </div>
        </header>

        <main ref={mainRef} className="@container flex-1 overflow-y-auto">
          {view === 'prepare' ? (
            <div key="prepare" className="mx-auto max-w-5xl px-6 pt-6">
              <Prepare ctx={ctx} onDone={startInterview} />
            </div>
          ) : (
            <div key="home" className="mx-auto max-w-6xl space-y-5 p-6">
              <SessionCard status={status} elapsed={elapsed} trial={trial} ctx={ctx} onPrepare={() => setView('prepare')} />
              <div className="grid items-start gap-5 @4xl:grid-cols-[minmax(0,1fr)_20rem]">
                <WarmUp live={live} ctx={ctx} style={rise(1)} />
                <Hotkeys style={rise(2)} />
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
