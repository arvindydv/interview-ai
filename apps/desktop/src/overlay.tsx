import { StrictMode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { getCurrentWindow, LogicalSize } from '@tauri-apps/api/window';
import {
  AudioLines, Blend, Camera, ChevronDown, ImagePlus, Loader2, ShieldAlert, ShieldCheck, ChevronLeft, ChevronRight, Copy, Check, EyeOff, LayoutDashboard, Maximize2,
  MessageSquare, Mic, MicOff, Minimize2, Move, MoreVertical, PanelBottomOpen, Play, Power, SendHorizontal, Sparkles, Square, Volume2, VolumeX, X, Zap,
} from 'lucide-react';
import type { ListenState } from '@parakeet/shared';
import '@fontsource-variable/inter';
import { parakeet } from './bridge';
import type { AudioSettings, LiveStatus, Protection, Screenshot, SourceStatus } from './types';
import { LogoMark } from './ui';
import { renderMarkdown } from './overlay/markdown';
import { useOverlayState, type OverlayAnswer } from './overlay/useOverlayState';
import { clock, useElapsed, useMe, useTrial, type TrialState } from './useSession';
import './styles.css';
import './overlay/overlay.css';

const isMac = parakeet.platform === 'darwin';
const MOD = isMac ? '⌘' : 'Ctrl';
const COLLAPSED_HEIGHT = 64;
/** Background opacity of the overlay bars, as a user preference (text always stays solid). */
const OPACITY_KEY = 'parakeet.overlay.opacity';
const OPACITY_MIN = 0.2;
const OPACITY_DEFAULT = 0.97;

function loadOpacity() {
  try {
    const v = Number(localStorage.getItem(OPACITY_KEY));
    return v >= OPACITY_MIN && v <= 1 ? v : OPACITY_DEFAULT;
  } catch {
    return OPACITY_DEFAULT;
  }
}

/** Applies the opacity to every bar (via a CSS variable) and remembers it. */
function applyOpacity(value: number) {
  const v = Math.min(1, Math.max(OPACITY_MIN, Math.round(value * 100) / 100));
  document.documentElement.style.setProperty('--pk-bar-alpha', String(v));
  // Very see-through backgrounds need a text shadow to stay readable over busy windows.
  document.documentElement.classList.toggle('pk-see-through', v < 0.6);
  try {
    localStorage.setItem(OPACITY_KEY, String(v));
  } catch {}
  return v;
}

/** Matches IMAGE_LIMITS.maxImages in packages/shared (multi-screenshot context, spec D4). */
const MAX_SHOTS = 6;
const appWindow = getCurrentWindow();

// ---- small building blocks ------------------------------------------------------------------------

function Keys({ keys }: { keys: string[] }) {
  return (
    <span className="ml-1.5 flex items-center gap-0.5">
      {keys.map((k) => (
        <kbd
          key={k}
          className="grid h-[18px] min-w-[18px] place-items-center rounded-[5px] bg-white/[0.08] px-1 font-sans text-[10.5px] leading-none text-muted"
        >
          {k}
        </kbd>
      ))}
    </span>
  );
}

/** Rounded translucent bar; every overlay section floats as its own pill, like the reference design. */
function Bar({ className = '', children }: { className?: string; children: React.ReactNode }) {
  return (
    <div
      style={{ backgroundColor: 'rgb(11 15 23 / var(--pk-bar-alpha, 0.97))' }}
      className={`rounded-2xl border border-white/[0.08] shadow-lg shadow-black/40 backdrop-blur-xl ${className}`}
    >
      {children}
    </div>
  );
}

function ToolButton({
  label,
  keys,
  icon: Icon,
  onClick,
  active,
  spin,
}: {
  label: string;
  keys: string[];
  icon: typeof Sparkles;
  onClick: () => void;
  active?: boolean;
  spin?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={`${label} (${keys.join(' ')})`}
      aria-label={label}
      className={`flex h-9 shrink-0 items-center justify-center rounded-xl px-2.5 text-[13px] font-medium transition @[760px]:px-3 ${
        active ? 'bg-brand/15 text-brand ring-1 ring-brand/30' : 'bg-white/[0.05] text-fg hover:bg-white/[0.1]'
      }`}
    >
      <Icon size={15} className={`shrink-0 opacity-80 @[760px]:mr-1.5 ${spin ? 'animate-spin' : ''}`} />
      <span className="hidden whitespace-nowrap @[760px]:inline">{label}</span>
      <span className="hidden @[1080px]:flex">
        <Keys keys={keys} />
      </span>
    </button>
  );
}

function IconButton({
  title,
  onClick,
  children,
  dragRegion,
}: {
  title: string;
  onClick?: () => void;
  children: React.ReactNode;
  dragRegion?: boolean;
}) {
  return (
    <button
      title={title}
      aria-label={title}
      onClick={onClick}
      {...(dragRegion ? { 'data-tauri-drag-region': true } : {})}
      className={`grid size-9 place-items-center rounded-xl text-muted transition hover:bg-white/[0.08] hover:text-fg ${
        dragRegion ? 'cursor-move' : ''
      }`}
    >
      {children}
    </button>
  );
}

/**
 * Start / stop the interview. Minutes are only counted while it runs; while it does, shows the
 * session timer and the free-trial minutes left.
 */
function SessionControl({
  status,
  elapsed,
  trial,
  signedIn,
  onStart,
  onStop,
}: {
  status: LiveStatus;
  elapsed: string | null;
  trial: TrialState | null;
  signedIn: boolean;
  onStart: () => void;
  onStop: () => void;
}) {
  if (status.state === 'disconnected') {
    const usedUp = trial?.leftSeconds === 0;
    return (
      <button
        onClick={onStart}
        disabled={!signedIn}
        title={
          !signedIn
            ? 'Sign in from the Parakeet window first'
            : usedUp
              ? 'Your free trial minutes are used up'
              : trial
                ? `Start the interview · ${Math.ceil(trial.leftSeconds / 60)} free min left`
                : 'Start the interview'
        }
        className={`flex h-9 shrink-0 items-center gap-1.5 rounded-xl px-3 text-[13px] font-semibold transition disabled:opacity-40 ${
          usedUp ? 'bg-white/[0.05] text-muted' : 'bg-brand text-bg hover:brightness-110'
        }`}
      >
        <Play size={13} fill="currentColor" className="shrink-0" />
        <span className="whitespace-nowrap">
          Start<span className="hidden @[680px]:inline"> interview</span>
        </span>
        {trial && !usedUp && (
          <span className="hidden font-mono text-[11.5px] font-medium opacity-75 @[900px]:inline">{clock(trial.leftSeconds)}</span>
        )}
      </button>
    );
  }
  const live = status.state === 'connected';
  const low = trial !== null && trial.leftSeconds <= 120;
  return (
    <div className="flex h-9 shrink-0 items-center gap-1 rounded-xl bg-white/[0.05] pr-1 pl-2.5 ring-1 ring-white/10">
      {live ? (
        <span className="size-2 shrink-0 animate-pulse rounded-full bg-danger" aria-hidden />
      ) : (
        <Loader2 size={13} className="shrink-0 animate-spin text-warn" aria-hidden />
      )}
      <span className="ml-1 font-mono text-[13px] font-semibold tabular-nums" title="Session time">
        {elapsed ?? '00:00'}
      </span>
      {trial && (
        <span
          title="Free trial minutes left"
          className={`ml-1.5 hidden font-mono text-[12px] tabular-nums @[700px]:inline ${low ? 'text-warn' : 'text-muted'}`}
        >
          {clock(trial.leftSeconds)} left
        </span>
      )}
      <button
        onClick={onStop}
        title="Stop the interview (minutes stop counting)"
        aria-label="Stop"
        className="ml-1.5 flex h-7 items-center gap-1 rounded-lg bg-danger/15 px-2 text-[12.5px] font-semibold text-danger hover:bg-danger/25"
      >
        <Square size={11} fill="currentColor" />
        <span className="hidden @[620px]:inline">Stop</span>
      </button>
    </div>
  );
}

/**
 * Audio source toggle. Red dot = being captured and transcribed; amber = a problem (hover for why).
 * Click to mute or unmute the source.
 */
function SourceToggle({
  icon: Icon, offIcon: OffIcon, label, source, stt, onToggle,
}: {
  icon: typeof Mic;
  offIcon: typeof Mic;
  label: string;
  source?: SourceStatus;
  stt?: ListenState;
  onToggle: () => void;
}) {
  const enabled = source?.enabled ?? true;
  const on = source?.state === 'on';
  const live = on && stt === 'up';
  const problem = source?.state === 'error' || (on && stt === 'down');
  const title = !enabled
    ? `${label}: muted (click to turn on)`
    : source?.state === 'error'
      ? `${label}: ${source.error}`
      : live
        ? `${label}: listening (click to mute)`
        : on || source?.state === 'starting'
          ? `${label}: connecting…`
          : `${label}: starts with the interview`;
  return (
    <button
      onClick={onToggle}
      title={title}
      aria-label={title}
      aria-pressed={enabled}
      className={`relative grid size-8 place-items-center rounded-lg hover:bg-white/[0.08] ${enabled ? 'text-muted' : 'text-faint'}`}
    >
      {enabled ? <Icon size={16} /> : <OffIcon size={16} />}
      <span
        className={`absolute top-1 right-1 size-2 rounded-full ring-2 ring-[#0b0f17] ${
          live ? 'bg-danger' : problem ? 'bg-warn' : 'bg-faint'
        }`}
      />
    </button>
  );
}

// ---- answer view -----------------------------------------------------------------------------------

function AnswerBody({ answer }: { answer: OverlayAnswer }) {
  const html = useMemo(() => renderMarkdown(answer.text, !answer.done), [answer.text, answer.done]);
  const ref = useRef<HTMLDivElement>(null);

  // Copy buttons inside rendered code blocks (event delegation; the HTML is static).
  const onClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest('a')) {
      e.preventDefault(); // never navigate the overlay itself
      return;
    }
    const btn = target.closest<HTMLButtonElement>('[data-copy-code]');
    if (!btn) return;
    const code = btn.closest('.pk-code')?.querySelector('code')?.textContent ?? '';
    parakeet.app.copy(code).then(() => {
      btn.setAttribute('data-copied', '');
      setTimeout(() => btn.removeAttribute('data-copied'), 1200);
    });
  };

  return (
    <div ref={ref} onClick={onClick} className="pk-md">
      {answer.text ? (
        <div dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        !answer.error && (
          <div className="flex items-center gap-2 py-2 text-sm text-muted">
            <span className="flex gap-1">
              {[0, 1, 2].map((i) => (
                <span key={i} className="size-1.5 animate-pulse rounded-full bg-brand" style={{ animationDelay: `${i * 150}ms` }} />
              ))}
            </span>
            Thinking…
          </div>
        )
      )}
      {!answer.done && answer.text && <span className="ml-0.5 inline-block h-4 w-[3px] translate-y-0.5 animate-caret bg-brand" />}
      {answer.error && <p className="mt-2 text-sm text-danger">{answer.error}</p>}
    </div>
  );
}

// ---- overlay -------------------------------------------------------------------------------------------

function Overlay() {
  const { auth, status, audio, listening, answers, index, current, transcript, go, clearAnswers, clearTranscript } = useOverlayState();
  const [collapsed, setCollapsed] = useState(false);
  // The answer block can be closed; the window then shrinks to the bars above it.
  const [panelVisible, setPanelVisible] = useState(true);
  const [chatOpen, setChatOpen] = useState(false);
  const [chat, setChat] = useState('');
  // Screenshots waiting in the chat bar, sent together with the next message.
  const [shots, setShots] = useState<Screenshot[]>([]);
  const [capturing, setCapturing] = useState(false);
  const [protection, setProtection] = useState<Protection | null>(null);
  const [opacity, setOpacity] = useState(() => applyOpacity(loadOpacity()));
  const changeOpacity = useCallback((v: number) => setOpacity(applyOpacity(v)), []);
  useEffect(() => {
    parakeet.app.protection().then(setProtection, () => {});
  }, []);
  const [notice, setNotice] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  /** The ✕ asks first, so a stray click can't end the interview mid-answer. */
  const [confirmEnd, setConfirmEnd] = useState(false);
  const confirmRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!confirmEnd) return;
    const id = setTimeout(() => setConfirmEnd(false), 5000);
    return () => clearTimeout(id);
  }, [confirmEnd]);
  const [copied, setCopied] = useState(false);
  const [atBottom, setAtBottom] = useState(true);
  const expandedHeight = useRef(640);
  const stackRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const chatRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const [transcriptOverflows, setTranscriptOverflows] = useState(false);
  const connected = status.state === 'connected';
  const signedIn = Boolean(auth?.user);
  const elapsed = useElapsed(status);
  // Re-fetched after sign-in and after each session, for the free minutes shown on Start interview.
  const me = useMe(status.state !== 'disconnected' || !signedIn);
  const trial = useTrial(signedIn ? me : null, connected);
  const hearing = connected && audio?.interviewer.state === 'on' && listening?.sources.interviewer === 'up';
  const autoAnswer = audio?.autoAnswer ?? true;
  const setAudio = useCallback(
    (patch: Partial<AudioSettings>) => {
      if (!audio) return;
      void parakeet.audio.set({ interviewer: audio.interviewer.enabled, you: audio.you.enabled, autoAnswer: audio.autoAnswer, ...patch });
    },
    [audio],
  );

  const flash = useCallback((msg: string) => {
    setNotice(msg);
    setTimeout(() => setNotice((n) => (n === msg ? null : n)), 4000);
  }, []);

  // Running out of free minutes ends the session (main does that); say why.
  useEffect(
    () =>
      parakeet.live.onMessage((m) => {
        if (m.type === 'error' && !m.turnId && m.code === 'trial_ended') flash(m.message);
      }),
    [flash],
  );

  const startInterview = useCallback(() => {
    if (trial?.leftSeconds === 0) {
      flash('Your free trial minutes are used up. Upgrade your plan to keep using live sessions.');
      return;
    }
    void parakeet.live.connect();
  }, [trial, flash]);

  /**
   * Waits for the interview's live connection. Never starts one on its own: minutes only count
   * after the user presses Start interview.
   */
  const ensureConnected = useCallback(async () => {
    const state = (await parakeet.live.status()).state;
    if (state === 'connected') return true;
    if (state === 'disconnected') return null;
    return new Promise<boolean>((resolve) => {
      const off = parakeet.live.onStatus((s) => {
        if (s.state === 'connected') {
          off();
          resolve(true);
        }
      });
      setTimeout(() => {
        off();
        resolve(false);
      }, 6000);
    });
  }, []);

  const ask = useCallback(
    async (text: string, imageIds: string[] = []) => {
      if (!text.trim() && !imageIds.length) return false;
      const ready = await ensureConnected();
      if (!ready) {
        flash(ready === null ? 'Press Start interview first.' : 'Can’t reach Parakeet. Check your connection.');
        return false;
      }
      try {
        await parakeet.live.ask(text.trim(), imageIds);
        return true;
      } catch (e) {
        flash((e as Error).message);
        return false;
      }
    },
    [ensureConnected, flash],
  );

  // Window height follows what's shown: full (user-resizable), compact (bars only, fitted to content)
  // or collapsed (toolbar only). The overlay is transparent, so leftover empty space would still block
  // clicks to the app underneath; shrinking the window avoids that.
  const mode = collapsed ? 'collapsed' : panelVisible ? 'full' : 'compact';
  const lastMode = useRef(mode);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const scale = await appWindow.scaleFactor();
      const size = (await appWindow.innerSize()).toLogical(scale);
      if (lastMode.current === 'full' && mode !== 'full') expandedHeight.current = size.height;
      lastMode.current = mode;
      if (cancelled) return;
      // Content is measured in CSS px, the window in logical px. They differ under fractional scaling
      // on Linux (WebKitGTK), so convert with the ratio actually observed rather than assuming 1:1.
      const logicalPerCss = window.innerHeight > 0 ? size.height / window.innerHeight : 1;
      let cssHeight = mode === 'collapsed' ? COLLAPSED_HEIGHT : (stackRef.current?.offsetHeight ?? 100) + 12; // + p-1.5
      // An open menu may hang below the bars; make room for it in the small layouts.
      for (const el of [menuRef.current, confirmRef.current]) {
        const bottom = el?.getBoundingClientRect().bottom;
        if (bottom) cssHeight = Math.max(cssHeight, bottom + 8);
      }
      const height = mode === 'full' ? expandedHeight.current : Math.ceil(cssHeight * logicalPerCss);
      if (Math.abs(height - size.height) > 1) await appWindow.setSize(new LogicalSize(size.width, height));
    })();
    return () => {
      cancelled = true;
    };
  }, [mode, chatOpen, notice, menuOpen, confirmEnd, shots.length > 0]);

  const toggleCollapsed = useCallback(() => setCollapsed((c) => !c), []);

  const openChat = useCallback(() => {
    setCollapsed(false);
    setChatOpen(true);
    setTimeout(() => chatRef.current?.focus(), 30);
  }, []);

  // A new answer always brings the answer block back.
  const answerCount = answers.length;
  const seenAnswers = useRef(answerCount);
  useEffect(() => {
    if (answerCount > seenAnswers.current) {
      setPanelVisible(true);
      setCollapsed(false);
    }
    seenAnswers.current = answerCount;
  }, [answerCount]);

  // "Answer" answers what the interviewer just said (even mid-sentence). With nothing heard, it
  // falls back to typing the question.
  const answerNow = useCallback(() => {
    const heard = transcript.filter((l) => l.speaker === 'interviewer');
    if (!heard.length) {
      openChat();
      flash(
        status.state === 'disconnected'
          ? 'Press Start interview first.'
          : hearing
            ? 'Nothing heard from the interviewer yet. Type the question to get an answer.'
            : 'Not listening to the interviewer right now. Type the question to get an answer.',
      );
      return;
    }
    void ask(heard[heard.length - 1].text);
  }, [transcript, hearing, status.state, openChat, flash, ask]);

  // Surface capture and speech-to-text problems once each (the toggles keep showing them on hover).
  const problem =
    (audio?.interviewer.state === 'error' && audio.interviewer.error) ||
    (audio?.you.state === 'error' && audio.you.error) ||
    (connected && listening?.error) ||
    null;
  useEffect(() => {
    if (problem) flash(problem);
  }, [problem, flash]);

  // Each press captures the screen and appends it to the chat bar; Enter sends them all (spec D1/D4).
  const screenshot = useCallback(async () => {
    if (capturing) return;
    if (shots.length >= MAX_SHOTS) {
      flash(`Up to ${MAX_SHOTS} screenshots per question. Send these first.`);
      return;
    }
    setCapturing(true);
    try {
      const shot = await parakeet.screenshot.capture();
      setShots((list) => [...list, shot]);
      openChat();
    } catch (e) {
      flash((e as Error).message);
    } finally {
      setCapturing(false);
    }
  }, [capturing, shots.length, flash, openChat]);

  const removeShot = useCallback((id: string) => {
    setShots((list) => list.filter((s) => s.id !== id));
    void parakeet.screenshot.discard(id);
  }, []);

  const sendChat = useCallback(async () => {
    const text = chat;
    const ids = shots.map((s) => s.id);
    if (!text.trim() && !ids.length) return;
    setChat('');
    setShots([]);
    const sent = await ask(text, ids);
    if (!sent && ids.length) flash('Screenshots weren’t sent. Capture them again.');
  }, [chat, shots, ask, flash]);

  // Global shortcuts (fired by Rust even when the meeting app has focus).
  useEffect(
    () =>
      parakeet.overlay.onCommand((cmd) => {
        if (cmd === 'answer') answerNow();
        else if (cmd === 'screenshot') void screenshot();
        else if (cmd === 'chat') openChat();
      }),
    [answerNow, screenshot, openChat],
  );

  // Close the ⋮ menu on any click outside it (its wrapper also holds the trigger button).
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current?.parentElement?.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [menuOpen]);

  // Local shortcuts while the overlay itself is focused.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = isMac ? e.metaKey : e.ctrlKey;
      if (mod && e.key === 'ArrowLeft') go(-1);
      else if (mod && e.key === 'ArrowRight') go(1);
      else if (mod && e.key === 'Backspace') clearAnswers();
      else if (mod && e.shiftKey && e.key === 'ArrowUp') changeOpacity(opacity + 0.1);
      else if (mod && e.shiftKey && e.key === 'ArrowDown') changeOpacity(opacity - 0.1);
      else if (e.key === 'Escape') {
        setChatOpen(false);
        setMenuOpen(false);
      } else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, clearAnswers, opacity, changeOpacity]);

  // Keep the newest transcript text in view; fade the left edge only when older text is cut off.
  useEffect(() => {
    const el = transcriptRef.current;
    if (!el) return;
    const measure = () => {
      el.scrollTo({ left: el.scrollWidth });
      setTranscriptOverflows(transcript.length > 0 && el.scrollWidth > el.clientWidth + 1);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [transcript]);

  // Answer-first: each answer opens at its top so the direct answer is what you read. Details stream
  // in below; the "more below" button jumps down.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [current?.turnId]);
  useEffect(() => {
    const el = scrollRef.current;
    if (el) setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 40);
  }, [current?.text]);

  const copyAll = () => {
    if (!current?.text) return;
    parakeet.app.copy(current.text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    });
  };

  return (
    <div className="flex h-screen flex-col gap-2 p-1.5 text-fg select-none">
      <div ref={stackRef} className="flex shrink-0 flex-col gap-2">
        {/* ── toolbar ─────────────────────────────────────────────── */}
        <Bar className="@container relative z-20 flex h-[52px] shrink-0 items-center gap-1.5 px-2">
          <div data-tauri-drag-region className="flex h-full shrink-0 items-center gap-2 pr-1 pl-1.5">
            <LogoMark size={24} />
            <span data-tauri-drag-region className="hidden text-[15px] font-semibold tracking-tight @[1000px]:inline">
              Parakeet
            </span>
          </div>
          <SessionControl
            status={status}
            elapsed={elapsed}
            trial={trial}
            signedIn={signedIn}
            onStart={startInterview}
            onStop={() => void parakeet.live.disconnect()}
          />
          <SourceToggle
            icon={Volume2}
            offIcon={VolumeX}
            label="Interviewer audio"
            source={audio?.interviewer}
            stt={connected ? listening?.sources.interviewer : undefined}
            onToggle={() => setAudio({ interviewer: !(audio?.interviewer.enabled ?? true) })}
          />
          <SourceToggle
            icon={Mic}
            offIcon={MicOff}
            label="Your microphone"
            source={audio?.you}
            stt={connected ? listening?.sources.you : undefined}
            onToggle={() => setAudio({ you: !(audio?.you.enabled ?? true) })}
          />
        {protection && (
          <button
            onClick={() => flash(protection.detail)}
            title={protection.detail}
            aria-label={protection.level === 'hidden' ? 'Hidden from screen share' : 'Visible in screen share'}
            className={`grid size-8 place-items-center rounded-lg hover:bg-white/[0.08] ${
              protection.level === 'hidden' ? 'text-brand' : 'text-warn'
            }`}
          >
            {protection.level === 'hidden' ? <ShieldCheck size={16} /> : <ShieldAlert size={16} />}
          </button>
        )}
          <span className="mx-1 hidden h-6 w-px bg-white/10 @[620px]:block" />
          <ToolButton label="Answer" icon={Sparkles} keys={[MOD, '↵']} onClick={answerNow} />
          <ToolButton
          label={shots.length ? `Screenshot · ${shots.length}` : 'Screenshot'}
          icon={capturing ? Loader2 : Camera}
          spin={capturing}
          keys={[MOD, '⇧', '↵']}
          onClick={() => void screenshot()}
          active={shots.length > 0}
        />
          <ToolButton label="Chat" icon={MessageSquare} keys={[MOD, '⇧', '␣']} onClick={openChat} active={chatOpen} />
          <div data-tauri-drag-region className="h-full min-w-2 flex-1" />
          {/* Narrow: the logo and the empty space still drag the window. */}
          <div className="hidden @[620px]:block">
            <IconButton title="Drag to move" dragRegion>
              <Move size={16} className="pointer-events-none" />
            </IconButton>
          </div>
          {!collapsed && !panelVisible && (
            <IconButton title="Show answers" onClick={() => setPanelVisible(true)}>
              <PanelBottomOpen size={16} />
            </IconButton>
          )}
          <IconButton title={collapsed ? 'Expand' : 'Collapse'} onClick={toggleCollapsed}>
            {collapsed ? <Maximize2 size={16} /> : <Minimize2 size={16} />}
          </IconButton>
          <div className="relative">
            <IconButton title="More" onClick={() => setMenuOpen((o) => !o)}>
              <MoreVertical size={16} />
            </IconButton>
            {menuOpen && (
              <div
                ref={menuRef}
                className="absolute top-11 right-0 z-50 w-64 rounded-xl border border-white/10 bg-[#0e131d] p-1 shadow-2xl shadow-black/60"
              >
                <div className="px-2.5 pt-2 pb-2.5">
                  <div className="flex items-center gap-2.5 text-[13px]">
                    <Blend size={15} className="text-muted" />
                    <span className="flex-1">Opacity</span>
                    <span className="text-[12px] text-muted tabular-nums">{Math.round(opacity * 100)}%</span>
                  </div>
                  <input
                    type="range"
                    min={OPACITY_MIN * 100}
                    max={100}
                    step={5}
                    value={Math.round(opacity * 100)}
                    onChange={(e) => changeOpacity(Number(e.target.value) / 100)}
                    aria-label="Overlay opacity"
                    className="pk-range mt-2.5 w-full"
                  />
                  <div className="mt-1.5 flex items-center justify-between text-[11px] text-faint">
                    <span>See-through</span>
                    <span className="flex items-center">
                      <Keys keys={[MOD, '⇧', '↑']} />
                      <Keys keys={['↓']} />
                    </span>
                    <span>Solid</span>
                  </div>
                </div>
                <div className="mx-1 mb-1 h-px bg-white/[0.07]" />
                <button
                  onClick={() => setAudio({ autoAnswer: !autoAnswer })}
                  role="switch"
                  aria-checked={autoAnswer}
                  title="Answer each question as soon as the interviewer finishes asking it"
                  className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] hover:bg-white/[0.07]"
                >
                  <Sparkles size={15} className="text-muted" />
                  <span className="flex-1">Auto-answer questions</span>
                  <span className={`relative h-4 w-7 rounded-full transition-colors ${autoAnswer ? 'bg-brand' : 'bg-white/15'}`}>
                    <span className={`absolute top-0.5 size-3 rounded-full bg-white transition-all ${autoAnswer ? 'left-3.5' : 'left-0.5'}`} />
                  </span>
                </button>
                {[
                  { icon: LayoutDashboard, label: 'Open Parakeet', run: () => parakeet.app.showMain() },
                  { icon: EyeOff, label: 'Hide overlay', keys: [MOD, '\\'], run: () => parakeet.overlay.toggle() },
                  { icon: X, label: 'End interview', run: () => setConfirmEnd(true) },
                { icon: Power, label: 'Quit Parakeet', run: () => parakeet.app.quit() },
                ].map(({ icon: Icon, label, keys, run }) => (
                  <button
                    key={label}
                    onClick={() => {
                      setMenuOpen(false);
                      void run();
                    }}
                    className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] hover:bg-white/[0.07]"
                  >
                    <Icon size={15} className="text-muted" />
                    <span className="flex-1">{label}</span>
                    {keys && <Keys keys={keys} />}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="relative">
            <IconButton title="End interview and close overlay" onClick={() => setConfirmEnd((c) => !c)}>
              <X size={17} />
            </IconButton>
            {confirmEnd && (
              <div
                ref={confirmRef}
                className="absolute top-11 right-0 z-50 w-64 rounded-xl border border-white/10 bg-[#0e131d] p-3 shadow-2xl shadow-black/60"
              >
                <p className="text-[13px] font-semibold">End the interview?</p>
                <p className="mt-1 text-[12px] leading-relaxed text-muted">
                  This stops the live session and closes the overlay. To just hide it, press <Keys keys={[MOD, '\\']} />
                </p>
                <div className="mt-3 flex gap-2">
                  <button
                    onClick={() => void parakeet.overlay.close()}
                    className="flex-1 rounded-lg bg-danger/85 px-3 py-1.5 text-[13px] font-semibold text-white hover:bg-danger"
                  >
                    End interview
                  </button>
                  <button
                    onClick={() => setConfirmEnd(false)}
                    className="rounded-lg px-3 py-1.5 text-[13px] text-muted ring-1 ring-white/10 hover:bg-white/[0.08] hover:text-fg"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </Bar>

        {!collapsed && (
          /* ── transcript strip ──────────────────────────────────── */
          <Bar className="flex h-11 shrink-0 items-center gap-2 pr-1.5 pl-3">
            <AudioLines size={17} className={connected ? 'text-brand' : 'text-faint'} />
            <div
              ref={transcriptRef}
              className={`flex min-w-0 flex-1 gap-6 overflow-hidden text-[13.5px] whitespace-nowrap ${
                transcriptOverflows ? '[mask-image:linear-gradient(to_right,transparent,black_12%)]' : ''
              }`}
            >
              {transcript.length ? (
                transcript.map((l, i) => (
                  <span
                    key={l.id}
                    className={`${i === transcript.length - 1 ? 'text-fg' : 'text-muted'} ${l.speaker === 'you' ? 'opacity-70' : ''}`}
                  >
                    {l.speaker === 'you' && <span className="mr-1.5 text-faint">You:</span>}
                    {l.text}
                  </span>
                ))
              ) : (
                <span className="text-muted">
                  {signedIn
                    ? connected
                      ? hearing
                        ? autoAnswer
                          ? 'Listening… each question is answered as soon as the interviewer finishes it.'
                          : 'Listening… press Answer when the interviewer finishes a question.'
                        : 'Connected. Type a question with Chat, or turn on interviewer audio to answer what they ask.'
                      : status.state === 'disconnected'
                        ? 'Press Start interview when your call begins. Minutes only count while it’s running.'
                        : 'Connecting…'
                    : 'Sign in from the Parakeet window to start.'}
                </span>
              )}
            </div>
            <button
              onClick={clearTranscript}
              className="flex h-8 shrink-0 items-center rounded-lg px-2.5 text-[12.5px] text-muted hover:bg-white/[0.07] hover:text-fg"
            >
              Clear
            </button>
          </Bar>
        )}

        {/* ── chat input ────────────────────────────────────────── */}
        {!collapsed && chatOpen && (
          <Bar className="shrink-0">
            {shots.length > 0 && (
              <div className="flex items-center gap-2 overflow-x-auto px-3 pt-2.5">
                {shots.map((shot, i) => (
                  <div
                    key={shot.id}
                    className="group relative h-16 shrink-0 overflow-hidden rounded-lg ring-1 ring-white/15"
                    title={`Screenshot ${i + 1} · ${shot.width}×${shot.height}`}
                  >
                    <img src={shot.thumb} alt={`Screenshot ${i + 1}`} className="h-full w-auto" draggable={false} />
                    <span className="absolute bottom-1 left-1 rounded bg-black/70 px-1 text-[10px] font-semibold text-fg">
                      {i + 1}
                    </span>
                    <button
                      onClick={() => removeShot(shot.id)}
                      aria-label={`Remove screenshot ${i + 1}`}
                      className="absolute top-1 right-1 grid size-5 place-items-center rounded-full bg-black/75 text-fg opacity-80 hover:bg-danger hover:opacity-100"
                    >
                      <X size={11} />
                    </button>
                  </div>
                ))}
                {shots.length < MAX_SHOTS && (
                  <button
                    onClick={() => void screenshot()}
                    disabled={capturing}
                    title={`Add another screenshot (${MOD} ⇧ ↵)`}
                    className="grid h-16 w-16 shrink-0 place-items-center rounded-lg border border-dashed border-white/20 text-muted hover:border-brand/50 hover:text-brand"
                  >
                    {capturing ? <Loader2 size={18} className="animate-spin" /> : <ImagePlus size={18} />}
                  </button>
                )}
              </div>
            )}
            <div className="flex h-12 items-center gap-2 pr-1.5 pl-3.5">
              <MessageSquare size={16} className="shrink-0 text-brand" />
              <form
                className="flex flex-1 items-center gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  void sendChat();
                }}
              >
                <input
                  ref={chatRef}
                  value={chat}
                  onChange={(e) => setChat(e.target.value)}
                  placeholder={
                    shots.length
                      ? 'Add a note (optional) and press Enter to solve'
                      : 'Ask anything, e.g. “How do I reverse a string in Java?”'
                  }
                  className="h-9 min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-faint"
                />
                <button
                  disabled={!chat.trim() && !shots.length}
                  className="grid size-9 shrink-0 place-items-center rounded-xl bg-brand-gradient text-bg disabled:opacity-30"
                  aria-label="Send"
                >
                  <SendHorizontal size={16} />
                </button>
              </form>
              <button
                onClick={() => setChatOpen(false)}
                title="Close chat (Esc)"
                aria-label="Close chat"
                className="grid size-9 shrink-0 place-items-center rounded-xl text-muted hover:bg-white/[0.08] hover:text-fg"
              >
                <X size={16} />
              </button>
            </div>
          </Bar>
        )}

        {/* notices go here while the answer block is closed (it normally hosts them) */}
        {!collapsed && !panelVisible && notice && (
          <Bar className="px-3.5 py-2 text-[12.5px] text-warn">{notice}</Bar>
        )}
      </div>

      {/* ── answer panel ──────────────────────────────────────── */}
      {!collapsed && panelVisible && (
        <Bar className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="flex h-11 shrink-0 items-center gap-1 border-b border-white/[0.06] px-2">
            <button
              onClick={() => go(-1)}
              disabled={index <= 0}
              className="flex h-8 items-center rounded-lg px-2 text-muted hover:bg-white/[0.07] hover:text-fg disabled:opacity-30"
              title="Previous answer"
            >
              <ChevronLeft size={15} />
              <Keys keys={[MOD, '←']} />
            </button>
            <button
              onClick={() => go(1)}
              disabled={index >= answers.length - 1}
              className="flex h-8 items-center rounded-lg px-2 text-muted hover:bg-white/[0.07] hover:text-fg disabled:opacity-30"
              title="Next answer"
            >
              <ChevronRight size={15} />
              <Keys keys={[MOD, '→']} />
            </button>
            {answers.length > 0 && (
              <span className="ml-1 text-[11.5px] whitespace-nowrap text-faint tabular-nums">
                {index + 1} / {answers.length}
              </span>
            )}
            {current?.ttftMs !== undefined && (
              <span
                title="Time to first word"
                className="ml-2 flex items-center gap-1 rounded-full bg-brand/10 px-2 py-0.5 text-[11px] font-medium whitespace-nowrap text-brand"
              >
                <Zap size={11} /> {current.ttftMs < 1000 ? `${current.ttftMs} ms` : `${(current.ttftMs / 1000).toFixed(2)}s`}
              </span>
            )}
            <div className="flex-1" />
            <button
              onClick={copyAll}
              disabled={!current?.text}
              title="Copy answer"
              className="grid size-8 place-items-center rounded-lg text-muted hover:bg-white/[0.07] hover:text-fg disabled:opacity-30"
            >
              {copied ? <Check size={15} className="text-brand" /> : <Copy size={15} />}
            </button>
            <button
              onClick={clearAnswers}
              className="flex h-8 items-center rounded-lg px-2.5 text-[12.5px] text-muted hover:bg-white/[0.07] hover:text-fg"
            >
              Clear <Keys keys={[MOD, '⌫']} />
            </button>
            <button
              onClick={() => setPanelVisible(false)}
              title="Close answers"
              aria-label="Close answers"
              className="grid size-8 place-items-center rounded-lg text-muted hover:bg-white/[0.07] hover:text-fg"
            >
              <X size={16} />
            </button>
          </div>

          <div
            ref={scrollRef}
            onScroll={(e) => {
              const el = e.currentTarget;
              setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 40);
            }}
            className="min-h-0 flex-1 overflow-y-auto px-5 pt-3 pb-8 select-text"
          >
            {!signedIn ? (
              <div className="grid h-full place-items-center text-center">
                <div>
                  <p className="text-sm text-muted">You’re signed out.</p>
                  <button onClick={() => parakeet.app.showMain()} className="btn btn-primary mt-3">
                    Open Parakeet to sign in
                  </button>
                </div>
              </div>
            ) : current ? (
              <>
                {(current.question || current.imageCount) && (
                  <p className="mb-3 flex flex-wrap items-center gap-1.5 text-[12.5px] text-muted">
                    <span className="font-semibold text-brand-2">Q:</span>
                    {current.imageCount ? (
                      <span className="inline-flex items-center gap-1 rounded-md bg-white/[0.07] px-1.5 py-0.5 text-[11.5px] text-fg/80">
                        <Camera size={12} /> {current.imageCount} screenshot{current.imageCount > 1 ? 's' : ''}
                      </span>
                    ) : null}
                    {current.question}
                  </p>
                )}
                <AnswerBody answer={current} />
              </>
            ) : (
              <div className="grid h-full place-items-center text-center text-sm text-muted">
                <div className="max-w-sm space-y-2">
                  <Sparkles className="mx-auto text-brand" size={22} />
                  <p className="text-fg">Answers appear here, answer first, details after.</p>
                  <p className="text-[12.5px]">
                    <b className="text-fg">Answer</b> replies to the latest question · <b className="text-fg">Chat</b> to type
                    one · <b className="text-fg">Screenshot</b> to solve a coding problem on screen.
                  </p>
                </div>
              </div>
            )}
          </div>

          {!atBottom && current && (
            <button
              onClick={() => {
                setAtBottom(true);
                scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
              }}
              className="absolute right-10 bottom-2 grid size-8 place-items-center rounded-full bg-white/10 text-fg backdrop-blur hover:bg-white/20"
              title="More below"
            >
              <ChevronDown size={16} />
            </button>
          )}
          {notice && (
            <div className="absolute bottom-3 left-1/2 max-w-[80%] -translate-x-1/2 animate-fade-up rounded-xl border border-warn/25 bg-[#1a1408]/95 px-3.5 py-2 text-[12.5px] text-warn shadow-lg shadow-black/50 [animation-duration:200ms]">
              {notice}
            </div>
          )}
          {/* resize grip */}
          <button
            onMouseDown={(e) => {
              e.preventDefault();
              void appWindow.startResizeDragging('SouthEast');
            }}
            className="absolute right-1 bottom-1 grid size-7 cursor-se-resize place-items-center rounded-md text-faint hover:text-fg"
            title="Resize"
          >
            <Maximize2 size={13} className="rotate-90" />
          </button>
        </Bar>
      )}
    </div>
  );
}

// The overlay window is transparent; only the floating bars should be visible.
document.documentElement.style.background = 'transparent';
document.body.style.background = 'transparent';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Overlay />
  </StrictMode>,
);
