import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, Briefcase, Camera, Check, ChevronDown, ClipboardList, Copy, EyeOff, Home as HomeIcon, Keyboard, LogOut,
  MessageSquare, PanelTopOpen, Pencil, Play, Power, RefreshCw, SendHorizontal, ShieldAlert, ShieldCheck, Sparkles, Square,
  Timer, Zap,
} from 'lucide-react';
import { ROUND_TYPES, trialLeft, type HealthReport, type Interview, type Me } from '@parakeet/shared';
import type { LiveStatus, Protection } from './types';
import { parakeet as p } from './bridge';
import { useLiveAnswer } from './useLiveAnswer';
import { renderMarkdown } from './overlay/markdown';
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

// ---- top bar --------------------------------------------------------------------------------------

function SessionPill({ status, elapsed }: { status: LiveStatus; elapsed: string | null }) {
  const label = {
    connected: 'Live',
    connecting: 'Connecting…',
    reconnecting: 'Reconnecting…',
    disconnected: 'Not in a session',
  }[status.state];
  return (
    <span
      className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium ring-1 transition ${
        status.state === 'connected'
          ? 'bg-brand/10 text-brand ring-brand/25'
          : status.state === 'disconnected'
            ? 'bg-white/[0.03] text-muted ring-line'
            : 'bg-warn/10 text-warn ring-warn/25'
      }`}
    >
      <StatusDot state={status.state} />
      {label}
      {elapsed && <span className="font-mono tabular-nums opacity-80">{elapsed}</span>}
    </span>
  );
}

function ProfileMenu({ email, me }: { email: string; me: Me | null }) {
  const [open, setOpen] = useState(false);
  const ref = useDismiss<HTMLDivElement>(open, () => setOpen(false));
  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex items-center gap-2 rounded-full py-1 pr-2 pl-1 ring-1 ring-line transition hover:bg-white/5"
      >
        <span className="bg-brand-gradient grid size-7 place-items-center rounded-full text-xs font-semibold text-bg uppercase">
          {email[0]}
        </span>
        <ChevronDown size={14} className={`text-muted transition ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="pop-in absolute top-full right-0 z-50 mt-2 w-64 rounded-xl border border-line-strong bg-surface p-1.5 shadow-2xl shadow-black/60">
          <div className="px-3 py-2.5">
            <p className="truncate text-sm font-medium">{email}</p>
            <p className="mt-1 flex items-center gap-2 text-xs text-muted">
              {me ? (
                <>
                  <span className="rounded-full bg-brand/10 px-2 py-0.5 font-medium text-brand capitalize ring-1 ring-brand/25">
                    {me.plan} plan
                  </span>
                  {me.trial && <span>{trialLeft(me.trial)}</span>}
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

// ---- session hero ---------------------------------------------------------------------------------

function Step({ n, title, state }: { n: number; title: string; state: 'done' | 'current' | 'todo' }) {
  return (
    <li className="flex items-center gap-3">
      <span
        className={`grid size-7 shrink-0 place-items-center rounded-full text-xs font-semibold ring-1 transition-all duration-500 ${
          state === 'done'
            ? 'bg-brand text-bg ring-brand'
            : state === 'current'
              ? 'bg-brand/15 text-brand ring-brand/50 shadow-[0_0_16px_-2px] shadow-brand/60'
              : 'bg-white/[0.03] text-faint ring-line'
        }`}
      >
        {state === 'done' ? <Check size={14} strokeWidth={3} /> : n}
      </span>
      <span className={`text-sm transition ${state === 'todo' ? 'text-faint' : 'text-fg'}`}>{title}</span>
    </li>
  );
}

/** Visual on the right of the hero: a calm standby orb, or a live waveform once connected. */
function SessionVisual({ live }: { live: boolean }) {
  if (live) {
    const bars = Array.from({ length: 28 }, (_, i) => 0.35 + Math.abs(Math.sin(i * 1.7)) * 0.65);
    return (
      <div className="flex h-28 w-56 items-center gap-[3px]" aria-hidden>
        {bars.map((h, i) => (
          <span
            key={i}
            className="wave-bar w-full rounded-full bg-gradient-to-t from-brand to-brand-2"
            style={{ '--i': i, height: `${h * 100}%` } as React.CSSProperties}
          />
        ))}
      </div>
    );
  }
  return (
    <div className="relative grid size-40 place-items-center" aria-hidden>
      {[0, 1.2, 2.4].map((d) => (
        <span
          key={d}
          className="ripple absolute inset-6 rounded-full border border-brand/30"
          style={{ '--d': `${d}s` } as React.CSSProperties}
        />
      ))}
      <span className="absolute inset-0 rounded-full border border-dashed border-line-strong" />
      <div className="animate-float">
        <LogoMark size={56} />
      </div>
    </div>
  );
}

/** One line summarising the interview the answers are tailored to, with a shortcut to edit it. */
function InterviewSummary({ ctx, onPrepare }: { ctx: InterviewContextState; onPrepare: () => void }) {
  const i = ctx.interview;
  const target = [i?.role, i?.company].filter(Boolean).join(' at ') || i?.field;
  const round = ROUND_TYPES.find((r) => r.id === i?.roundType && r.id !== 'general')?.label;
  if (!ctx.loaded || ctx.strength === 'none') return null;
  return (
    <button
      onClick={onPrepare}
      className="group mt-4 flex max-w-full flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl bg-white/[0.04] px-3 py-2 text-left text-xs ring-1 ring-line transition hover:ring-brand/40"
    >
      {target ? (
        <span className="flex min-w-0 items-center gap-1.5 font-medium text-fg">
          <Briefcase size={13} className="shrink-0 text-brand" />
          <span className="truncate">{target}</span>
          {round && <span className="text-muted">· {round}</span>}
        </span>
      ) : (
        <span className="text-muted">No role set yet</span>
      )}
      <span className="flex items-center gap-2.5 text-muted">
        <span className={`flex items-center gap-1 ${ctx.hasResume ? '' : 'text-faint line-through'}`}>
          {ctx.hasResume && <Check size={11} className="text-brand" strokeWidth={3} />} Resume
        </span>
        <span className={`flex items-center gap-1 ${ctx.hasJobDescription ? '' : 'text-faint line-through'}`}>
          {ctx.hasJobDescription && <Check size={11} className="text-brand" strokeWidth={3} />} Job description
        </span>
      </span>
      <span className="flex items-center gap-1 text-brand opacity-70 transition group-hover:opacity-100">
        <Pencil size={11} /> Edit
      </span>
    </button>
  );
}

/** Big session timer, with the free-trial countdown beside it while it's metered. */
function SessionClock({ elapsed, trial }: { elapsed: string; trial: TrialState | null }) {
  const low = trial !== null && trial.leftSeconds <= 120;
  return (
    <div className="rise-in mt-5 flex flex-wrap items-stretch gap-3">
      <div className="rounded-xl bg-white/[0.04] px-4 py-2.5 ring-1 ring-line">
        <p className="text-[11px] tracking-wide text-muted uppercase">Session time</p>
        <p className="font-mono text-2xl font-semibold tabular-nums">{elapsed}</p>
      </div>
      {trial && (
        <div
          className={`rounded-xl px-4 py-2.5 ring-1 ${
            trial.leftSeconds === 0 ? 'bg-danger/10 ring-danger/25' : low ? 'bg-warn/10 ring-warn/25' : 'bg-white/[0.04] ring-line'
          }`}
        >
          <p className="text-[11px] tracking-wide text-muted uppercase">Free minutes left</p>
          <p
            className={`font-mono text-2xl font-semibold tabular-nums ${
              trial.leftSeconds === 0 ? 'text-danger' : low ? 'text-warn' : ''
            }`}
          >
            {clock(trial.leftSeconds)}
          </p>
        </div>
      )}
    </div>
  );
}

function FreeTrial({ trial, style }: { trial: TrialState; style?: React.CSSProperties }) {
  const { totalSeconds, leftSeconds } = trial;
  const pct = totalSeconds ? (leftSeconds / totalSeconds) * 100 : 0;
  return (
    <Panel title="Free trial" icon={Timer} className="rise-in" style={style}>
      <p className="flex items-baseline gap-2">
        <span className="text-3xl font-semibold tracking-tight tabular-nums">{Math.ceil(leftSeconds / 60)}</span>
        <span className="text-sm text-muted">of {Math.round(totalSeconds / 60)} minutes left</span>
      </p>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
        <div
          className={`h-full rounded-full transition-[width] duration-1000 ${leftSeconds === 0 ? '' : pct <= 20 ? 'bg-warn' : 'bg-brand-gradient'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="mt-3 text-xs leading-relaxed text-faint">
        {leftSeconds === 0
          ? 'Your free minutes are used up. Upgrade your plan to keep using live sessions.'
          : 'Minutes count only while a session is running, including warm-up questions. Preparing your interview is always free.'}
      </p>
    </Panel>
  );
}

function SessionHero({
  name,
  status,
  elapsed,
  trial,
  ctx,
  onPrepare,
}: {
  name: string;
  status: LiveStatus;
  elapsed: string | null;
  trial: TrialState | null;
  ctx: InterviewContextState;
  onPrepare: () => void;
}) {
  const live = status.state === 'connected';
  const pending = status.state === 'connecting' || status.state === 'reconnecting';
  const prepared = ctx.strength !== 'none';

  const copy = live
    ? {
        title: "You're live",
        body: `Join your call, then press ${MOD} \\ to bring up the overlay. This window hides while the overlay is open; bring it back from the overlay's ⋮ menu → Open Friday AI.`,
      }
    : pending
      ? { title: 'Connecting…', body: 'Setting up a secure live session. This usually takes a second.' }
      : prepared || !ctx.loaded
        ? {
            title: 'Ready for your interview?',
            body: 'Start a session a few minutes before your call. Friday AI will listen for questions and answer on a private overlay.',
          }
        : {
            title: "Let's get you prepared",
            body: "Add your resume and the job you're interviewing for, so answers sound like you and use real examples from your experience.",
          };

  return (
    <section
      className={`rise-in relative isolate overflow-hidden rounded-[1.5rem] border p-7 transition-colors duration-700 ${
        live ? 'conic-border border-transparent' : 'border-line'
      }`}
      style={rise(0)}
    >
      <div className="absolute inset-0 -z-20 bg-surface" />
      <div className={`aurora -z-10 transition-opacity duration-1000 ${live ? 'opacity-100' : 'opacity-50'}`} aria-hidden>
        <span />
        <span />
        <span />
      </div>
      <div className="bg-grid absolute inset-0 -z-10" aria-hidden />

      <div className="flex items-center gap-8">
        <div className="min-w-0 flex-1">
          <p className="text-sm text-muted">
            {greeting()}, <span className="text-fg capitalize">{name}</span>
          </p>
          <h1 key={copy.title} className="rise-in mt-1.5 text-3xl font-semibold tracking-[-0.03em]">
            {live ? <span className="text-gradient">{copy.title}</span> : copy.title}
          </h1>
          <p className="mt-2 max-w-lg text-sm leading-relaxed text-muted">{copy.body}</p>
          {status.error && !live && <p className="mt-2 text-sm text-danger">{status.error}</p>}
          <InterviewSummary ctx={ctx} onPrepare={onPrepare} />

          <div className="mt-6 flex flex-wrap items-center gap-2.5">
            {status.state === 'disconnected' && !prepared && ctx.loaded ? (
              <>
                <button onClick={onPrepare} className="btn btn-primary btn-shine px-6 py-3 text-[15px]">
                  <ClipboardList size={17} /> Prepare interview
                </button>
                <button onClick={() => p.live.connect()} className="btn btn-secondary px-5 py-3">
                  <Play size={14} fill="currentColor" /> Start without it
                </button>
              </>
            ) : status.state === 'disconnected' ? (
              <button onClick={() => p.live.connect()} className="btn btn-primary btn-shine px-6 py-3 text-[15px]">
                <Play size={16} fill="currentColor" /> Start session
              </button>
            ) : (
              <>
                <button
                  onClick={() => p.overlay.toggle()}
                  disabled={!live}
                  className="btn btn-primary btn-shine px-6 py-3 text-[15px]"
                >
                  {pending ? <Spinner /> : <PanelTopOpen size={17} />} Show overlay
                </button>
                <button onClick={() => p.live.disconnect()} className="btn btn-secondary px-5 py-3">
                  <Square size={14} fill="currentColor" /> End session
                </button>
              </>
            )}
            {live && status.rttMs !== null && (
              <span className="ml-1 flex items-center gap-1 font-mono text-xs text-muted">
                <Zap size={11} className="text-brand" /> {status.rttMs} ms
              </span>
            )}
          </div>
          {elapsed && <SessionClock elapsed={elapsed} trial={trial} />}
          {!elapsed && trial?.leftSeconds === 0 && (
            <p className="mt-3 text-sm text-warn">
              Your free trial minutes are used up. Upgrade your plan to keep using live sessions.
            </p>
          )}

          <ol className="mt-7 flex flex-wrap gap-x-6 gap-y-3 border-t border-line pt-5">
            <Step n={1} title="Signed in" state="done" />
            <Step n={2} title="Prepare interview" state={prepared ? 'done' : live ? 'todo' : 'current'} />
            <Step n={3} title="Start session" state={live ? 'done' : prepared ? 'current' : 'todo'} />
            <Step n={4} title="Open overlay in your call" state={live ? 'current' : 'todo'} />
          </ol>
        </div>
        <div className="hidden shrink-0 md:block">
          <SessionVisual live={live} />
        </div>
      </div>
    </section>
  );
}

// ---- warm-up --------------------------------------------------------------------------------------

function WarmUp({ live, ctx, style }: { live: boolean; ctx: InterviewContextState; style?: React.CSSProperties }) {
  const { answer, error, startTurn } = useLiveAnswer();
  const [question, setQuestion] = useState('');
  const [asked, setAsked] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
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
      <p className="-mt-1 mb-4 text-sm text-muted">
        {ctx.hasResume
          ? 'Try a practice question to hear how Friday AI answers with your own experience.'
          : 'Try a practice question to see how answers will look during your interview.'}
      </p>

      <div className="flex flex-wrap gap-2">
        {sampleQuestions(ctx.interview).map((q) => (
          <button
            key={q}
            onClick={() => ask(q)}
            className="rounded-full bg-white/[0.04] px-3 py-1.5 text-left text-xs text-muted ring-1 ring-line transition hover:bg-brand/10 hover:text-brand hover:ring-brand/30"
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
            </div>
          </div>
          <div className="pk-md overflow-y-auto px-4 py-3" onClick={onAnswerClick}>
            <div dangerouslySetInnerHTML={{ __html: html }} />
            {streaming && <span className="inline-block h-4 w-[3px] translate-y-0.5 animate-caret bg-brand" />}
          </div>
        </div>
      ) : (
        <div className="mt-4 grid flex-1 place-items-center rounded-xl border border-dashed border-line py-8 text-center text-xs text-faint">
          {live ? 'Pick a question above to see an answer stream in.' : 'Answers appear here once a session is running.'}
        </div>
      )}
    </Panel>
  );
}

// ---- side panels ----------------------------------------------------------------------------------

function Hotkeys({ style }: { style?: React.CSSProperties }) {
  return (
    <Panel title="Hotkeys" icon={Keyboard} className="rise-in" style={style}>
      <ul className="space-y-1">
        {HOTKEYS.map(({ icon: Icon, label, keys }) => (
          <li key={label} className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-2 transition hover:bg-white/[0.03]">
            <Icon size={15} className="shrink-0 text-muted" />
            <span className="flex-1 text-sm">{label}</span>
            <Keys keys={keys} />
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs leading-relaxed text-faint">
        They work from any app, even while your meeting is in focus.
        {p.platform === 'linux' && ' On Wayland, global hotkeys may be blocked; use the buttons instead.'}
      </p>
    </Panel>
  );
}

function Privacy({ style }: { style?: React.CSSProperties }) {
  const [protection, setProtection] = useState<Protection | null>(null);
  useEffect(() => {
    p.app.protection().then(setProtection, () => {});
  }, []);
  const tone = !protection
    ? null
    : protection.level === 'hidden'
      ? { icon: ShieldCheck, title: 'Hidden from screen share', cls: 'text-brand bg-brand/10 ring-brand/25' }
      : protection.level === 'not_guaranteed'
        ? { icon: ShieldAlert, title: 'Not guaranteed on this system', cls: 'text-warn bg-warn/10 ring-warn/25' }
        : { icon: AlertTriangle, title: 'Visible when you share your screen', cls: 'text-danger bg-danger/10 ring-danger/25' };
  return (
    <Panel title="Screen-share privacy" icon={ShieldCheck} className="rise-in" style={style}>
      {!tone || !protection ? (
        <Spinner className="text-muted" />
      ) : (
        <>
          <div className={`flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-medium ring-1 ${tone.cls}`}>
            <tone.icon size={16} className="shrink-0" /> {tone.title}
          </div>
          <p className="mt-3 text-xs leading-relaxed text-muted">{protection.detail}</p>
          {protection.level !== 'hidden' && (
            <p className="mt-2 text-xs leading-relaxed text-faint">
              Tip: share a single window instead of your whole screen.
            </p>
          )}
        </>
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
        className="flex items-center gap-2 rounded-full px-2.5 py-1 text-xs text-muted transition hover:bg-white/5 hover:text-fg"
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
  const name = email.split('@')[0].split(/[._+-]/)[0];

  useEffect(() => {
    p.live.status().then(setStatus);
    return p.live.onStatus(setStatus);
  }, []);

  const tabs = [
    { id: 'home' as const, label: 'Home', icon: HomeIcon },
    { id: 'prepare' as const, label: 'Prepare', icon: ClipboardList },
  ];

  return (
    <div className="relative flex h-full flex-col">
      <div className="grain" aria-hidden />

      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line bg-bg/70 px-5 backdrop-blur-xl">
        <LogoMark size={26} />
        <span className="font-semibold tracking-tight">Friday AI</span>
        <nav className="ml-4 flex items-center gap-1 rounded-xl bg-white/[0.03] p-1 ring-1 ring-line">
          {tabs.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setView(id)}
              aria-current={view === id ? 'page' : undefined}
              className={`relative flex items-center gap-1.5 rounded-lg px-3 py-1 text-sm transition ${
                view === id ? 'bg-white/[0.08] text-fg shadow-sm' : 'text-muted hover:text-fg'
              }`}
            >
              <Icon size={14} /> {label}
              {id === 'prepare' && ctx.loaded && ctx.strength !== 'strong' && (
                <span className="size-1.5 rounded-full bg-brand shadow-[0_0_6px_1px] shadow-brand/60" title="Add more context" />
              )}
            </button>
          ))}
        </nav>
        <div className="ml-2">
          <SessionPill status={status} elapsed={elapsed} />
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={() => p.overlay.toggle()} className="btn btn-ghost !py-1.5" title={`Show or hide the overlay (${MOD} \\)`}>
            <PanelTopOpen size={15} /> Overlay <Kbd>{`${MOD} \\`}</Kbd>
          </button>
          <ProfileMenu email={email} me={me} />
        </div>
      </header>

      <main ref={mainRef} className="flex-1 overflow-y-auto">
        {view === 'prepare' ? (
          <div key="prepare" className="mx-auto max-w-5xl px-6 pt-6">
            <Prepare ctx={ctx} onDone={startInterview} />
          </div>
        ) : (
          <div key="home" className="mx-auto max-w-5xl space-y-5 p-6">
            <SessionHero name={name} status={status} elapsed={elapsed} trial={trial} ctx={ctx} onPrepare={() => setView('prepare')} />
            <div className="grid gap-5 lg:grid-cols-[1.45fr_1fr]">
              <WarmUp live={live} ctx={ctx} style={rise(2)} />
              <div className="space-y-5">
                {trial && <FreeTrial trial={trial} style={rise(3)} />}
                <Hotkeys style={rise(3)} />
                <Privacy style={rise(4)} />
              </div>
            </div>
          </div>
        )}
      </main>

      <footer className="flex h-10 shrink-0 items-center gap-3 border-t border-line px-4 text-xs text-faint">
        <SystemStatus />
        <span className="ml-auto">
          {me && <span className="capitalize">{me.plan} plan</span>}
          {trial && <span> · {Math.ceil(trial.leftSeconds / 60)} of {Math.round(trial.totalSeconds / 60)} free min left</span>}
        </span>
      </footer>
    </div>
  );
}
