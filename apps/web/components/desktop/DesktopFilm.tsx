'use client';
import { useEffect, useRef, useState } from 'react';
import {
  Camera, Check, Circle, EyeOff, Globe, Headphones, Keyboard, Layers, MessageSquare, Mic, MonitorUp, Pause, Play, RotateCcw,
  ShieldCheck, Sparkles, Users, Video, X, Zap,
} from 'lucide-react';

// A self-playing, video-like walkthrough of what the desktop app does during an interview and why it
// has to be a desktop app. Every scene is drawn on a fixed 960×540 canvas and scaled to fit, so it
// looks the same at any width, like a real video. CSS animations live in app/globals.css (film-*).

const css = (v: Record<string, string | number>) => v as React.CSSProperties;
const W = 960;
const H = 540;

type Chapter = { title: string; caption: string; ms: number; Scene: () => React.ReactElement };

// ---- shared pieces --------------------------------------------------------------------------------

/** One line of text that types itself out. */
function Typed({ text, d, t, className = '' }: { text: string; d: number; t?: number; className?: string }) {
  return (
    <span
      className={`f-type block whitespace-nowrap ${className}`}
      style={css({ '--d': `${d}s`, '--t': `${t ?? Math.max(0.5, text.length * 0.028)}s`, '--steps': text.length })}
    >
      {text}
    </span>
  );
}

function Wave({ bars = 18, className = '' }: { bars?: number; className?: string }) {
  return (
    <span className={`flex items-center gap-[3px] ${className}`}>
      {Array.from({ length: bars }, (_, i) => (
        <span
          key={i}
          className="wave-bar w-[3px] rounded-full bg-gradient-to-t from-brand to-brand-2"
          style={css({ '--i': i, height: `${30 + Math.abs(Math.sin(i * 1.7)) * 70}%` })}
        />
      ))}
    </span>
  );
}

// The meeting is drawn in fixed light colours, like a real meeting app, so the dark glass overlay
// stands out on top of it in both site themes. It's a generic call, not any one product's UI.
const M = {
  window: '#f7f8fa',
  line: '#e3e6ec',
  tile: '#e6e9ef',
  ink: '#1f2433',
  muted: '#6b7280',
};

function Face({ label, color, size }: { label: string; color: string; size: number }) {
  return (
    <span
      className="grid place-items-center rounded-full font-semibold text-[#fff] shadow-lg"
      style={{ width: size, height: size, fontSize: size * 0.32, background: color }}
    >
      {label}
    </span>
  );
}

/** A video call: the interviewer large on the left (speaking), a panelist and you on the right. */
function Meeting({ captions = false, captionDelay = 0.5 }: { captions?: boolean; captionDelay?: number }) {
  const tools: [typeof Mic, string][] = [
    [Mic, 'Mute'],
    [Video, 'Stop video'],
    [Users, 'Participants'],
    [MessageSquare, 'Chat'],
    [MonitorUp, 'Share'],
    [Circle, 'Record'],
  ];
  return (
    <div
      className="absolute inset-x-5 top-4 bottom-4 overflow-hidden rounded-2xl shadow-2xl shadow-black/40"
      style={{ background: M.window, color: M.ink, border: `1px solid ${M.line}` }}
    >
      <div className="relative flex h-9 items-center gap-2 px-4" style={{ borderBottom: `1px solid ${M.line}` }}>
        <span className="size-3 rounded-full bg-[#ff5f57]" />
        <span className="size-3 rounded-full bg-[#febc2e]" />
        <span className="size-3 rounded-full bg-[#28c840]" />
        <span className="absolute inset-x-0 text-center text-[13px] font-medium">Video meeting · Round 2</span>
        <span className="ml-auto flex items-center gap-1 text-[11.5px] font-medium text-[#16a34a]">
          <ShieldCheck size={13} /> Encrypted
        </span>
      </div>

      <div className="grid gap-2.5 p-3" style={{ height: 'calc(100% - 36px - 58px)', gridTemplateColumns: '1fr 290px' }}>
        <div className="relative grid place-items-center overflow-hidden rounded-xl" style={{ background: M.tile, boxShadow: 'inset 0 0 0 3px #4ade80' }}>
          <div className="relative grid place-items-center">
            {[0, 1.2, 2.4].map((d) => (
              <span key={d} className="ripple absolute size-[120px] rounded-full ring-2 ring-[#4ade80]/70" style={css({ '--d': `${d}s` })} />
            ))}
            <Face label="PS" color="linear-gradient(135deg,#0ea5e9,#2563eb)" size={120} />
          </div>
          <span className="absolute bottom-3 left-3 flex items-center gap-1.5 rounded-full bg-black/55 px-3 py-1 text-[12px] text-[#fff]">
            <Mic size={12} /> Priya S. · Hiring manager
          </span>
          <Wave className="absolute right-4 bottom-4 h-6" bars={10} />
          {captions && (
            <div
              className="f-up absolute inset-x-10 bottom-14 rounded-lg bg-black/70 px-4 py-2.5 text-center text-[14px] leading-snug text-[#fff]"
              style={css({ '--d': `${captionDelay}s` })}
            >
              <Typed text={QUESTION} d={captionDelay + 0.2} className="mx-auto w-fit" />
            </div>
          )}
        </div>
        <div className="grid gap-2.5">
          {[
            ['SK', 'linear-gradient(135deg,#f472b6,#be185d)', 'Sanjay K.'],
            ['You', 'linear-gradient(135deg,#34d399,#047857)', 'You'],
          ].map(([l, c, n]) => (
            <div key={n} className="relative grid place-items-center rounded-xl" style={{ background: M.tile }}>
              <Face label={l} color={c} size={86} />
              <span className="absolute bottom-2 left-2 rounded-full bg-black/45 px-2 py-0.5 text-[11px] text-[#fff]">{n}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="flex h-[58px] items-center gap-1 px-5" style={{ borderTop: `1px solid ${M.line}`, background: '#ffffff' }}>
        {tools.map(([Icon, label]) => (
          <span key={label} className="flex w-[78px] flex-col items-center gap-1 text-[11px]" style={{ color: M.muted }}>
            <Icon size={17} style={{ color: label === 'Share' ? '#16a34a' : M.ink }} />
            {label}
          </span>
        ))}
        <span className="ml-auto rounded-full bg-[#ef4444] px-5 py-1.5 text-[13px] font-semibold text-[#fff]">Leave</span>
      </div>
    </div>
  );
}

const QUESTION = 'Tell me about a project you’re proud of.';
const CODE_QUESTION = 'Find the first character in a string that doesn’t repeat.';

/**
 * Friday's overlay: a dark glass panel floating over the call. It appears with a soft zoom and
 * blurs whatever is behind it, the way the real one does.
 */
function Overlay({
  delay = 0.3,
  question,
  children,
  shot = false,
}: {
  delay?: number;
  question: string;
  children: React.ReactNode;
  /** Screenshot mode: the camera button is pressed before the answer. */
  shot?: boolean;
}) {
  return (
    <div
      className="f-overlay absolute top-[46px] left-[190px] w-[580px] overflow-hidden rounded-2xl text-[#fff]"
      style={css({
        '--d': `${delay}s`,
        background: 'rgba(24, 28, 40, 0.74)',
        backdropFilter: 'blur(14px) saturate(140%)',
        WebkitBackdropFilter: 'blur(14px) saturate(140%)',
        border: '1px solid rgba(255,255,255,0.14)',
        boxShadow: '0 30px 80px -20px rgba(0,0,0,0.65), 0 0 0 1px rgba(52,211,153,0.15), 0 0 60px -10px rgba(52,211,153,0.35)',
      })}
    >
      {/* header */}
      <div className="flex items-center gap-2 px-4 py-2.5 text-[12px]" style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
        <span className="flex items-center gap-1.5 font-mono text-[#f87171]">
          <span className="size-1.5 animate-pulse rounded-full bg-[#f87171]" /> 12:48
        </span>
        <span className="h-3.5 w-px bg-[rgb(255_255_255/0.15)]" />
        <span className="flex items-center gap-1.5 rounded-full bg-[rgb(255_255_255/0.08)] px-2.5 py-1 font-medium">
          <Sparkles size={12} className="text-[#34d399]" /> Friday AI
        </span>
        <span className="flex items-center gap-1 rounded-full bg-[rgb(52_211_153/0.15)] px-2.5 py-1 text-[#34d399]">
          <Zap size={11} /> Auto-answer
        </span>
        <span className="ml-auto flex items-center gap-1 rounded-full bg-[rgb(255_255_255/0.08)] px-2.5 py-1 text-[rgb(255_255_255/0.8)]">
          <EyeOff size={12} /> Hidden from share
        </span>
        <span className="rounded-full bg-[#ef4444]/20 px-2.5 py-1 font-medium text-[#fca5a5]">Stop</span>
      </div>

      {/* the question it heard */}
      <p className="flex items-center gap-2 px-4 pt-3 text-[13px] text-[rgb(255_255_255/0.75)]">
        <span className="size-2 shrink-0 rounded-full bg-[#4ade80] shadow-[0_0_8px_2px_rgba(74,222,128,0.6)]" />
        <span className="truncate">{question}</span>
      </p>

      {/* the answer */}
      <div
        className="mx-3 mt-2.5 rounded-xl px-4 py-3"
        style={{ background: 'rgba(8,10,18,0.55)', border: '1px solid rgba(99,102,241,0.35)' }}
      >
        <div className="flex items-center font-mono text-[10.5px] tracking-[0.08em] text-[rgb(255_255_255/0.55)]">
          ANSWER
          <span className="f-pop ml-auto normal-case tracking-normal" style={css({ '--d': `${delay + (shot ? 1.8 : 0.5)}s` })}>
            first word in 0.6s
          </span>
        </div>
        <div className="mt-2 space-y-1 text-[13.5px] leading-[1.55]">{children}</div>
      </div>

      {/* follow-up bar */}
      <div className="flex items-center gap-2 px-3 pt-3">
        <span className="flex-1 rounded-lg bg-[rgb(255_255_255/0.07)] px-3 py-2 text-[12.5px] text-[rgb(255_255_255/0.45)]">Ask a follow-up or paste a question…</span>
        <span
          className={`grid size-9 place-items-center rounded-lg bg-[rgb(255_255_255/0.07)] text-[rgb(255_255_255/0.7)] ${shot ? 'f-press !bg-[rgb(52_211_153/0.25)] !text-[#34d399]' : ''}`}
          style={css({ '--d': `${delay + 0.6}s` })}
        >
          <Camera size={15} />
        </span>
        <span className="flex items-center gap-2 rounded-lg bg-gradient-to-r from-[#10b981] to-[#06b6d4] px-3.5 py-2 text-[12.5px] font-semibold text-[#04120c]">
          <Zap size={13} /> Answer
          <kbd className="rounded bg-black/20 px-1.5 text-[10.5px] font-medium">Ctrl ↵</kbd>
        </span>
      </div>
      <p className="flex items-center gap-1.5 px-4 pt-2 pb-3 text-[11.5px] text-[rgb(255_255_255/0.5)]">
        <span className="size-1.5 rounded-full bg-[#4ade80]" /> Listening · answers start when the question ends
      </p>
      {shot && <div className="f-flash pointer-events-none absolute inset-0 bg-[#fff]" style={css({ '--d': `${delay + 0.75}s` })} />}
    </div>
  );
}

// ---- scenes ---------------------------------------------------------------------------------------

function SceneListen() {
  return (
    <div className="film-drift absolute inset-0" style={css({ '--dur': '7s' })}>
      <Meeting captions captionDelay={0.6} />
      {/* Friday minimised to its logo bubble, listening */}
      <div
        className="f-pop absolute top-[64px] right-[44px] flex items-center gap-2.5 rounded-full py-2 pr-4 pl-2 text-[13px] text-[#fff]"
        style={css({ '--d': '2.4s', background: 'rgba(24,28,40,0.85)', backdropFilter: 'blur(10px)', boxShadow: '0 12px 30px -8px rgba(0,0,0,0.5), 0 0 0 1px rgba(52,211,153,0.35)' })}
      >
        <span className="grid size-8 place-items-center rounded-full bg-brand-gradient text-[#04120c]">
          <Headphones size={15} />
        </span>
        <span>
          <span className="block font-medium leading-tight">Friday is listening</span>
          <span className="block text-[11px] leading-tight text-[rgb(255_255_255/0.6)]">Question detected</span>
        </span>
        <Wave bars={7} className="h-4" />
      </div>
    </div>
  );
}

const ANSWER = [
  'Lead with the payments rewrite at Acme:',
  '• Moved checkout to an event-driven service',
  '• p95 latency 1.8s → 240ms, zero lost orders',
  '• I owned the design and led 3 engineers',
];

function SceneAnswer() {
  return (
    <div className="absolute inset-0">
      <Meeting />
      <Overlay question={QUESTION}>
        {ANSWER.map((l, i) => (
          <Typed key={l} text={l} d={0.9 + i * 0.75} className={i === 0 ? 'font-semibold' : 'text-[rgb(255_255_255/0.9)]'} />
        ))}
        <p className="f-up pt-1.5 text-[rgb(255_255_255/0.9)]" style={css({ '--d': '4.2s' })}>
          <b className="font-semibold text-[#34d399]">Say it:</b> “It taught me to ship big changes in small, safe steps.”
        </p>
      </Overlay>
    </div>
  );
}

const SOLUTION: [string, string][] = [
  ['def ', 'first_unique(s):'],
  ['    ', 'counts = Counter(s)'],
  ['    for ', 'i, ch in enumerate(s):'],
  ['        if ', 'counts[ch] == 1:'],
  ['            return ', 'i'],
  ['    return ', '-1'],
];

function SceneCode() {
  return (
    <div className="absolute inset-0">
      <Meeting />
      <Overlay question={CODE_QUESTION} shot delay={0.3}>
        <p className="f-up" style={css({ '--d': '1.9s' })}>
          <b className="font-semibold">Approach:</b> count every character once, then return the first with a count of 1. O(n) time.
        </p>
        <div className="f-up mt-1.5 rounded-lg bg-black/45 px-3.5 py-2.5 font-mono text-[12px] leading-[1.7]" style={css({ '--d': '2.2s' })}>
          {SOLUTION.map(([kw, rest], i) => (
            <span key={i} className="f-type block whitespace-pre" style={css({ '--d': `${2.4 + i * 0.35}s`, '--t': '0.35s', '--steps': 20 })}>
              <span className="text-[#c4b5fd]">{kw}</span>
              <span className="text-[rgb(255_255_255/0.9)]">{rest}</span>
            </span>
          ))}
        </div>
        <p className="f-up pt-1.5 text-[rgb(255_255_255/0.9)]" style={css({ '--d': '4.8s' })}>
          <b className="font-semibold text-[#34d399]">Say it:</b> two passes keep it linear.
        </p>
      </Overlay>
    </div>
  );
}

/** A small copy of the call, with the overlay or with where it would be. */
function MiniScreen({ label, sub, overlay, shared }: { label: string; sub: string; overlay: boolean; shared?: boolean }) {
  return (
    <div className="flex flex-col items-center">
      <div className="mb-3 text-center">
        <p className="text-[15px] font-semibold">{label}</p>
        <p className="text-[12px] text-muted">{sub}</p>
      </div>
      <div
        className="relative h-[270px] w-[410px] overflow-hidden rounded-2xl p-2.5 shadow-2xl shadow-black/40"
        style={{ background: M.window, border: `2px solid ${shared ? '#ef4444' : M.line}` }}
      >
        <div className="grid h-full grid-cols-[1fr_110px] gap-2">
          <div className="grid place-items-center rounded-lg" style={{ background: M.tile, boxShadow: 'inset 0 0 0 2px #4ade80' }}>
            <Face label="PS" color="linear-gradient(135deg,#0ea5e9,#2563eb)" size={64} />
          </div>
          <div className="grid gap-2">
            <div className="grid place-items-center rounded-lg" style={{ background: M.tile }}>
              <Face label="SK" color="linear-gradient(135deg,#f472b6,#be185d)" size={40} />
            </div>
            <div className="grid place-items-center rounded-lg" style={{ background: M.tile }}>
              <Face label="You" color="linear-gradient(135deg,#34d399,#047857)" size={40} />
            </div>
          </div>
        </div>
        {overlay ? (
          <div
            className="absolute top-10 left-1/2 w-[230px] -translate-x-1/2 rounded-xl p-3 text-[#fff]"
            style={{ background: 'rgba(24,28,40,0.78)', backdropFilter: 'blur(8px)', border: '1px solid rgba(255,255,255,0.14)', boxShadow: '0 16px 40px -12px rgba(0,0,0,0.6)' }}
          >
            <div className="flex items-center gap-1.5 text-[11px] font-semibold">
              <Sparkles size={11} className="text-[#34d399]" /> Friday AI
            </div>
            <div className="mt-2 space-y-1.5">
              {['92%', '78%', '86%', '60%'].map((w, i) => (
                <div key={i} className="h-1.5 rounded-full bg-gradient-to-r from-brand/70 to-brand-2/40" style={{ width: w }} />
              ))}
            </div>
          </div>
        ) : (
          <>
            <div
              className="f-pop absolute top-10 left-1/2 grid h-[92px] w-[230px] -translate-x-1/2 place-items-center rounded-xl border-2 border-dashed border-[#10b981]/60"
              style={css({ '--d': '1.6s' })}
            >
              <span className="flex items-center gap-1.5 rounded-full bg-[#10b981]/15 px-2.5 py-1 text-[11px] font-semibold text-[#047857]">
                <EyeOff size={12} /> Not in the screen share
              </span>
            </div>
            <span className="f-scan" style={css({ '--d': '0.6s' })} />
          </>
        )}
        {shared && (
          <span className="absolute top-2 left-2 flex items-center gap-1.5 rounded-md bg-[#ef4444] px-2 py-0.5 text-[10px] font-semibold text-[#fff]">
            <span className="size-1.5 animate-pulse rounded-full bg-[#fff]" /> SHARING
          </span>
        )}
      </div>
    </div>
  );
}

function SceneHidden() {
  return (
    <div className="absolute inset-0 grid place-items-center">
      <div className="flex items-end gap-10">
        <div className="f-up" style={css({ '--d': '0.2s' })}>
          <MiniScreen label="Your screen" sub="You see Friday’s answers" overlay />
        </div>
        <div className="f-up" style={css({ '--d': '0.6s' })}>
          <MiniScreen label="Interviewer’s view" sub="What your screen share shows" overlay={false} shared />
        </div>
      </div>
    </div>
  );
}

const COMPARE: { icon: typeof Headphones; label: string; web: string; app: string }[] = [
  { icon: Headphones, label: 'Hears the interviewer', web: 'Can’t hear Zoom, Meet or Teams', app: 'Hears the call’s audio directly' },
  { icon: Layers, label: 'Answers on top of the call', web: 'Hidden behind the meeting window', app: 'Floats over any meeting app' },
  { icon: EyeOff, label: 'Private on screen share', web: 'Shows up when you share', app: 'Excluded from screen capture*' },
  { icon: Keyboard, label: 'Hotkeys mid-call', web: 'Only when its tab is in focus', app: 'Work while the call has focus' },
];

function SceneWhy() {
  return (
    <div className="absolute inset-0 flex flex-col justify-center px-12 pb-4">
      <p className="f-up text-center text-[28px] font-semibold tracking-[-0.02em]">
        Why Friday is a <span className="text-gradient">desktop app</span>
      </p>
      <div className="mt-7 grid grid-cols-[230px_1fr_1fr] gap-x-4 gap-y-3 text-[14px]">
        <span />
        <span className="f-up flex items-center gap-2 px-4 text-[13px] font-semibold text-muted" style={css({ '--d': '0.3s' })}>
          <Globe size={15} /> A website in your browser
        </span>
        <span className="f-up flex items-center gap-2 px-4 text-[13px] font-semibold text-brand" style={css({ '--d': '0.3s' })}>
          <Sparkles size={15} /> Friday desktop app
        </span>
        {COMPARE.map(({ icon: Icon, label, web, app }, i) => {
          const d = 0.7 + i * 0.9;
          return (
            <div key={label} className="contents">
              <span className="f-up flex items-center gap-2.5 font-medium" style={css({ '--d': `${d}s` })}>
                <span className="grid size-8 place-items-center rounded-lg bg-white/[0.05] ring-1 ring-line">
                  <Icon size={15} className="text-brand-2" />
                </span>
                {label}
              </span>
              <span
                className="f-up flex items-center gap-2.5 rounded-xl bg-danger/[0.06] px-4 py-3 text-muted ring-1 ring-danger/20"
                style={css({ '--d': `${d + 0.15}s` })}
              >
                <span className="grid size-5 shrink-0 place-items-center rounded-full bg-danger/15 text-danger">
                  <X size={12} strokeWidth={3} />
                </span>
                {web}
              </span>
              <span
                className="f-up flex items-center gap-2.5 rounded-xl bg-brand/[0.08] px-4 py-3 ring-1 ring-brand/30"
                style={css({ '--d': `${d + 0.4}s` })}
              >
                <span className="f-pop grid size-5 shrink-0 place-items-center rounded-full bg-brand text-bg" style={css({ '--d': `${d + 0.55}s` })}>
                  <Check size={12} strokeWidth={3} />
                </span>
                {app}
              </span>
            </div>
          );
        })}
      </div>
      <p className="f-up mt-5 text-center text-[11.5px] text-faint" style={css({ '--d': '4.6s' })}>
        * On Windows 10 (2004+) and macOS 14 and earlier. Not available on Linux or macOS 15+.
      </p>
    </div>
  );
}

const CHAPTERS: Chapter[] = [
  {
    title: 'Hears your call',
    caption: 'Friday runs on your computer and hears the interviewer through your call’s audio. No bot joins the meeting.',
    ms: 7000,
    Scene: SceneListen,
  },
  {
    title: 'Answers in < 1s',
    caption: 'The overlay floats over your call and streams a clear answer, built from your resume, in under a second.',
    ms: 7000,
    Scene: SceneAnswer,
  },
  {
    title: 'Hidden on share',
    caption: 'You see the overlay. Your screen share doesn’t: it’s excluded from capture on supported systems.',
    ms: 6500,
    Scene: SceneHidden,
  },
  {
    title: 'Solves code',
    caption: 'Coding round? Press Ctrl + Shift + Enter: Friday reads the problem from your screen and writes the solution.',
    ms: 7500,
    Scene: SceneCode,
  },
  {
    title: 'Why desktop',
    caption: 'A website can’t hear another app, float over your call or stay off your screen share. The desktop app can.',
    ms: 8500,
    Scene: SceneWhy,
  },
];

const TOTAL_MS = CHAPTERS.reduce((a, c) => a + c.ms, 0);
const fmt = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const TICK = 100;

/**
 * The film with player controls. Plays while on screen (unless the visitor paused it or prefers
 * reduced motion), loops, and lets the visitor jump to any chapter.
 */
export function DesktopFilm({ className = '' }: { className?: string }) {
  const frameRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);
  const [chapter, setChapter] = useState(0);
  const [elapsed, setElapsed] = useState(0); // within the current chapter
  const [run, setRun] = useState(0); // remounts the scene so its animations replay
  const [visible, setVisible] = useState(false);
  const [userPaused, setUserPaused] = useState(false);
  const [reduced, setReduced] = useState(false);

  useEffect(() => setReduced(window.matchMedia('(prefers-reduced-motion: reduce)').matches), []);

  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setScale(e.contentRect.width / W));
    ro.observe(el);
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { threshold: 0.35 });
    io.observe(el);
    return () => {
      ro.disconnect();
      io.disconnect();
    };
  }, []);

  const playing = visible && !userPaused && !reduced;

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => setElapsed((e) => e + TICK), TICK);
    return () => clearInterval(id);
  }, [playing]);

  useEffect(() => {
    if (elapsed < CHAPTERS[chapter].ms) return;
    setChapter((c) => (c + 1) % CHAPTERS.length);
    setElapsed(0);
    setRun((r) => r + 1);
  }, [elapsed, chapter]);

  const jump = (i: number) => {
    setChapter(i);
    setElapsed(0);
    setRun((r) => r + 1);
  };

  const { Scene, caption } = CHAPTERS[chapter];
  const before = CHAPTERS.slice(0, chapter).reduce((a, c) => a + c.ms, 0);

  return (
    <div className={`film group/film relative ${className}`} data-paused={playing ? undefined : ''}>
      <div className="conic-border relative overflow-hidden rounded-[1.75rem] bg-surface/70 p-1.5 shadow-2xl shadow-black/50">
        {/* the picture */}
        <div ref={frameRef} className="relative aspect-video overflow-hidden rounded-[1.4rem] bg-bg ring-1 ring-line">
          <div className="bg-grid pointer-events-none absolute inset-0" aria-hidden />
          <div className="glow pointer-events-none absolute inset-0 opacity-70" aria-hidden />
          <div
            className="absolute top-0 left-0 origin-top-left"
            style={{ width: W, height: H, transform: `scale(${scale})`, opacity: scale ? 1 : 0 }}
            aria-hidden
          >
            <div key={`${chapter}-${run}`} className="film-scene absolute inset-0">
              <Scene />
            </div>
          </div>

          {/* top-left badge, like a video title */}
          <span className="absolute top-3 left-3 flex items-center gap-1.5 rounded-full bg-black/55 px-2.5 py-1 text-[10px] font-semibold tracking-[0.12em] text-[#fff] uppercase backdrop-blur sm:top-4 sm:left-4 sm:text-[11px]">
            <span className="size-1.5 rounded-full bg-brand shadow-[0_0_8px_2px] shadow-brand/70" /> How Friday works
          </span>

          {/* big play button while paused */}
          {userPaused && (
            <button
              onClick={() => setUserPaused(false)}
              aria-label="Play"
              className="absolute inset-0 grid place-items-center bg-black/20 backdrop-blur-[1px] transition hover:bg-black/10"
            >
              <span className="grid size-16 place-items-center rounded-full bg-brand-gradient text-[#04120c] shadow-2xl shadow-black/50 sm:size-20">
                <Play size={28} fill="currentColor" className="ml-1" />
              </span>
            </button>
          )}
        </div>

        {/* subtitles */}
        <p key={`c-${chapter}`} aria-live="polite" className="f-up min-h-[3.25rem] px-3 pt-3 text-center text-[13px] leading-snug text-fg/90 sm:px-6 sm:text-[15px]">
          {caption}
        </p>

        {/* controls */}
        <div className="flex items-center gap-3 px-2 pt-1 pb-2 sm:px-3">
          <button
            onClick={() => (reduced ? setReduced(false) : setUserPaused((p) => !p))}
            aria-label={playing ? 'Pause' : 'Play'}
            className="grid size-9 shrink-0 place-items-center rounded-full bg-white/[0.06] text-fg ring-1 ring-line transition hover:bg-white/10"
          >
            {playing ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" className="ml-0.5" />}
          </button>
          <div className="flex flex-1 gap-1.5">
            {CHAPTERS.map((c, i) => (
              <button
                key={c.title}
                onClick={() => jump(i)}
                aria-label={`Chapter ${i + 1}: ${c.title}`}
                aria-current={i === chapter ? 'step' : undefined}
                className="group/seg flex-1 py-1.5 text-left"
                style={{ flexGrow: c.ms }}
              >
                <span className="block h-1 overflow-hidden rounded-full bg-white/10 transition group-hover/seg:bg-white/20">
                  <span
                    className="block h-full origin-left rounded-full bg-brand-gradient transition-transform duration-100 ease-linear"
                    style={{
                      transform: `scaleX(${i < chapter ? 1 : i > chapter ? 0 : reduced ? 1 : Math.min(1, elapsed / c.ms)})`,
                    }}
                  />
                </span>
                <span
                  className={`mt-1.5 hidden truncate text-[11px] transition sm:block ${i === chapter ? 'font-medium text-fg' : 'text-faint group-hover/seg:text-muted'}`}
                >
                  {c.title}
                </span>
              </button>
            ))}
          </div>
          <span className="hidden shrink-0 text-[11px] text-faint tabular-nums sm:inline">
            {fmt(before + elapsed)} / {fmt(TOTAL_MS)}
          </span>
          <button
            onClick={() => jump(0)}
            aria-label="Replay from the start"
            className="grid size-8 shrink-0 place-items-center rounded-full text-faint transition hover:bg-white/[0.06] hover:text-fg"
          >
            <RotateCcw size={14} />
          </button>
        </div>
      </div>
      {/* hidden text for screen readers and search engines: the whole film in words */}
      <ol className="sr-only">
        {CHAPTERS.map((c) => (
          <li key={c.title}>
            {c.title}: {c.caption}
          </li>
        ))}
      </ol>
    </div>
  );
}

