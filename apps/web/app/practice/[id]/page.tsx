'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import {
  AlertTriangle, ArrowLeft, ArrowRight, Check, CircleSlash, Headphones, Keyboard, Laptop, Mic, MicOff, PhoneOff, RefreshCw,
  Repeat2, Send, Timer, Volume2, X,
} from 'lucide-react';
import type { DesktopStatus, PracticeSession } from '@parakeet/shared';
import { ApiError, api } from '@/lib/api';
import { useRequireSession } from '@/lib/useSession';
import { roundLabel } from '@/lib/interviews';
import { formatLeft, formatSeconds, useMicrophone, usePracticeRoom, type MicState } from '@/lib/practice';
import { AppShell } from '@/components/AppShell';
import { LogoMark } from '@/components/Logo';
import { Spinner } from '@/components/ui';
import { ConfirmDialog, Toaster, toast } from '@/components/overlay';
import { Debrief } from '@/components/practice/Debrief';

const POLL_MS = 2000;
const PRICING = '/pricing?from=practice';
/** Below this, the clock turns amber. */
const LOW_MS = 60_000;

const errorText = (e: unknown) => (e instanceof ApiError ? e.message : 'Something went wrong. Try again.');

export default function PracticeSessionPage() {
  const email = useRequireSession();
  const { id } = useParams<{ id: string }>();
  const [session, setSession] = useState<PracticeSession | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(
    () =>
      api<{ session: PracticeSession }>(`/v1/practice/${id}`).then(
        (r) => setSession(r.session),
        (e) => setLoadError(e instanceof ApiError && e.status === 404 ? 'not_found' : errorText(e)),
      ),
    [id],
  );

  useEffect(() => {
    if (email) load();
  }, [email, load]);

  // Follow the worker while it scores.
  const waiting = session?.status === 'scoring';
  useEffect(() => {
    if (!waiting) return;
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [waiting, load]);

  if (!email) {
    return (
      <div className="grid min-h-screen place-items-center">
        <LogoMark size={40} />
      </div>
    );
  }

  return (
    <AppShell email={email}>
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-8 sm:py-10">
        <Link href="/practice" className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted transition hover:text-fg">
          <ArrowLeft size={15} /> Practice
        </Link>

        {loadError ? (
          <div className="grid place-items-center py-20 text-center">
            <p className="text-lg font-semibold">{loadError === 'not_found' ? 'Session not found' : 'Couldn’t load this session'}</p>
            <p className="mt-1 text-sm text-muted">{loadError === 'not_found' ? 'It may have been deleted.' : loadError}</p>
          </div>
        ) : !session ? (
          <div className="grid place-items-center py-32">
            <Spinner className="text-muted" />
          </div>
        ) : session.status === 'scoring' ? (
          <Waiting
            title="Reviewing your interview"
            text="Scoring each answer and how confidently you said it, and writing a stronger version of every answer. Usually under a minute."
          />
        ) : session.status === 'failed' ? (
          <Failed session={session} onChange={setSession} />
        ) : session.status === 'planning' || (session.status === 'ready' && !session.durationMinutes) ? (
          <Legacy session={session} onChange={setSession} />
        ) : session.status === 'ready' ? (
          <LiveInterview session={session} onChange={setSession} reload={load} />
        ) : (
          <Debrief session={session} />
        )}
      </div>
      <Toaster />
    </AppShell>
  );
}

// ---- waiting and failure -------------------------------------------------------------------------

function Waiting({ title, text }: { title: string; text: string }) {
  return (
    <section className="relative grid place-items-center overflow-hidden rounded-[var(--radius-card)] border border-line px-6 py-20 text-center animate-fade-up" aria-live="polite">
      <div className="absolute inset-0 -z-10 bg-surface" />
      <div className="aurora -z-10 opacity-40">
        <span />
        <span />
        <span />
      </div>
      <Orb active />
      <h1 className="mt-8 text-xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-1.5 max-w-sm text-sm text-muted">{text}</p>
    </section>
  );
}

function Failed({ session, onChange }: { session: PracticeSession; onChange: (s: PracticeSession) => void }) {
  const [busy, setBusy] = useState(false);
  const canRetry = session.answered > 0;
  const retry = async () => {
    setBusy(true);
    try {
      onChange((await api<{ session: PracticeSession }>(`/v1/practice/${session.id}/retry`, { method: 'POST' })).session);
    } catch (e) {
      toast(errorText(e), { tone: 'bad' });
    }
    setBusy(false);
  };
  return (
    <section className="glass grid place-items-center rounded-[var(--radius-card)] px-6 py-16 text-center">
      <AlertTriangle size={26} className="text-warn" />
      <h1 className="mt-4 text-lg font-semibold">{canRetry ? 'Scoring didn’t finish' : 'Nothing to review'}</h1>
      <p className="mt-1 max-w-sm text-sm text-muted">
        {session.error} {canRetry && 'Your answers are saved.'}
      </p>
      {canRetry ? (
        <button onClick={retry} disabled={busy} className="btn btn-primary mt-6">
          {busy ? <Spinner className="!size-4" /> : <RefreshCw size={15} />} Try again
        </button>
      ) : (
        <Link href="/practice" className="btn btn-primary mt-6">
          Start a new interview <ArrowRight size={15} />
        </Link>
      )}
    </section>
  );
}

/** A session from before live practice (a fixed list of questions), left unfinished. */
function Legacy({ session, onChange }: { session: PracticeSession; onChange: (s: PracticeSession) => void }) {
  const [busy, setBusy] = useState(false);
  const finish = async () => {
    setBusy(true);
    try {
      onChange((await api<{ session: PracticeSession }>(`/v1/practice/${session.id}/finish`, { method: 'POST' })).session);
    } catch (e) {
      toast(errorText(e), { tone: 'bad' });
      setBusy(false);
    }
  };
  return (
    <section className="glass grid place-items-center rounded-[var(--radius-card)] px-6 py-16 text-center">
      <h1 className="text-lg font-semibold">Practice has a new format</h1>
      <p className="mt-1 max-w-md text-sm text-muted">
        Interviews are now spoken, live, and as long as you choose. {session.answered > 0 && `You answered ${session.answered} questions in this one.`}
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        {session.answered > 0 && (
          <button onClick={finish} disabled={busy} className="btn btn-secondary">
            {busy && <Spinner className="!size-4" />} Get feedback on these answers
          </button>
        )}
        <Link href="/practice" className="btn btn-primary">
          Start a live interview <ArrowRight size={15} />
        </Link>
      </div>
    </section>
  );
}

/** The interviewer: a glowing orb that pulses while it speaks. */
function Orb({ active, size = 88 }: { active?: boolean; size?: number }) {
  return (
    <div className="relative grid shrink-0 place-items-center" style={{ width: size, height: size }} aria-hidden>
      {active && [0, 1, 2].map((n) => <span key={n} className="ripple absolute inset-0 rounded-full ring-1 ring-brand/50" style={{ '--d': `${n * 1.2}s` } as React.CSSProperties} />)}
      <span className="absolute inset-0 rounded-full bg-brand-gradient opacity-90 blur-[2px]" />
      <span className="absolute inset-[3px] rounded-full bg-[radial-gradient(circle_at_35%_30%,rgb(255_255_255/0.55),transparent_45%)]" />
      <span className="relative flex h-1/3 items-center gap-[3px]">
        {[0, 1, 2, 3, 4].map((i) => (
          <span
            key={i}
            className={`w-[3px] rounded-full bg-bg/80 ${active ? 'wave-bar h-full' : 'h-1/3'}`}
            style={{ '--i': i } as React.CSSProperties}
          />
        ))}
      </span>
    </div>
  );
}

function MicMeter({ level, state }: { level: number; state: MicState }) {
  return (
    <span className="flex h-5 items-end gap-[3px]" aria-hidden>
      {Array.from({ length: 10 }, (_, i) => (
        <span
          key={i}
          className={`w-[3px] rounded-full transition-[height] duration-75 ${state === 'on' && level * 10 > i ? 'bg-brand' : 'bg-white/[0.12]'}`}
          style={{ height: `${30 + i * 7}%` }}
        />
      ))}
    </span>
  );
}

// ---- the live interview --------------------------------------------------------------------------

function LiveInterview({
  session,
  onChange,
  reload,
}: {
  session: PracticeSession;
  onChange: (s: PracticeSession) => void;
  reload: () => void;
}) {
  const router = useRouter();
  const room = usePracticeRoom(session.id, onChange);
  const mic = useMicrophone(room.sendAudio);
  const [muted, setMuted] = useState(false);
  const [typing, setTyping] = useState(false);
  const [typed, setTyped] = useState('');
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);

  // Errors the room can't continue from.
  useEffect(() => {
    const e = room.error;
    if (!e) return;
    if (e.code === 'no_minutes' && room.phase === 'lobby') {
      toast(e.message, { tone: 'bad' });
      router.replace(PRICING);
    } else if (e.code === 'no_resume') {
      toast(e.message, { tone: 'bad' });
      router.replace('/practice');
    } else if (e.code === 'conflict') reload();
    else toast(e.message, { tone: 'bad' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.error]);

  // The interview ended: stop the microphone and show what's next.
  const stopMic = mic.stop;
  useEffect(() => {
    if (room.phase === 'ended') stopMic();
  }, [room.phase, stopMic]);

  const join = async () => {
    const ok = mic.state === 'on' || (await mic.start());
    if (!ok) setTyping(true);
    room.join();
  };

  const toggleMute = () => {
    setMuted((m) => {
      room.setMuted(!m);
      return !m;
    });
  };

  const sendTyped = () => {
    if (!typed.trim()) return;
    room.sendText(typed.trim());
    setTyped('');
  };

  if (room.status === 'error' || room.status === 'closed') {
    if (room.phase === 'ended') {
      return <Waiting title="Wrapping up" text="Saving your answers and starting your review." />;
    }
    return (
      <section className="glass grid place-items-center rounded-[var(--radius-card)] px-6 py-16 text-center">
        <AlertTriangle size={26} className="text-warn" />
        <h1 className="mt-4 text-lg font-semibold">{room.error?.code === 'elsewhere' ? 'Open in another tab' : 'Disconnected'}</h1>
        <p className="mt-1 max-w-sm text-sm text-muted">
          {room.error?.message ?? 'The connection to the interview was lost.'} Your answers so far are saved.
        </p>
        <button onClick={() => location.reload()} className="btn btn-primary mt-6">
          <RefreshCw size={15} /> Reconnect
        </button>
      </section>
    );
  }

  if (room.phase === 'lobby') {
    return (
      <Lobby
        session={session}
        ready={room.ready}
        mic={mic}
        desktop={room.desktop}
        testing={room.line?.test ? room.interviewer === 'speaking' : false}
        onTest={async () => {
          if (mic.state !== 'on') await mic.start();
          room.test();
        }}
        onJoin={join}
      />
    );
  }

  const left = room.endsAt ? Math.max(0, room.endsAt - now) : null;
  const listening = room.interviewer === 'listening';
  const status =
    room.phase === 'ended' || room.phase === 'closing'
      ? 'Wrapping up'
      : room.interviewer === 'speaking'
        ? 'Friday is speaking'
        : room.interviewer === 'thinking'
          ? 'Friday is thinking…'
          : listening
            ? room.transcript
              ? 'Listening…'
              : 'Your turn. Take a moment, then answer out loud.'
            : 'Connecting…';

  return (
    <div className="space-y-5">
      {/* top bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 animate-fade-up">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{session.title}</p>
          <p className="text-xs text-muted">
            {roundLabel(session.roundType)} · {session.durationMinutes} min interview
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {room.desktop?.connected && <DesktopChip desktop={room.desktop} />}
          {room.minutesLeft != null && room.minutesLeft < 300 && (
            <span className="rounded-full bg-warn/10 px-2.5 py-1 text-xs text-warn ring-1 ring-warn/30" title="Session minutes left on your account">
              {formatLeft(room.minutesLeft)} of minutes left
            </span>
          )}
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium tabular-nums ring-1 ${
              left !== null && left <= LOW_MS ? 'bg-warn/10 text-warn ring-warn/30' : 'bg-white/5 text-muted ring-line'
            }`}
            title={left === null ? 'The clock starts when you tell Friday you are ready' : 'Time left in the interview'}
          >
            <Timer size={13} />
            {left === null ? 'Not started' : `${Math.floor(left / 60_000)}:${String(Math.floor((left % 60_000) / 1000)).padStart(2, '0')} left`}
          </span>
        </div>
      </div>

      {/* interviewer */}
      <section className="relative overflow-hidden rounded-[var(--radius-card)] border border-line p-6 sm:p-8 animate-fade-up">
        <div className="absolute inset-0 -z-10 bg-surface" />
        <div className="absolute -top-28 -left-24 -z-10 size-96 glow opacity-60" />
        <div className="flex flex-col items-center gap-5 text-center">
          <Orb active={room.interviewer === 'speaking'} size={96} />
          <p className="flex items-center gap-2 text-xs text-muted" aria-live="polite">
            {room.interviewer === 'thinking' && <Spinner className="!size-3" />}
            {status}
          </p>
          <p className="min-h-[3.5rem] max-w-2xl text-xl leading-snug font-medium tracking-tight text-balance sm:text-2xl">
            {room.line && !room.line.test ? room.line.text : ''}
          </p>
          {room.blocked && (
            <button onClick={room.replay} className="btn btn-primary !py-2 text-sm animate-fade-up">
              <Volume2 size={16} /> Play
            </button>
          )}
        </div>
      </section>

      {/* you */}
      <section className={`glass rounded-[var(--radius-card)] p-5 transition sm:p-6 ${listening && !muted ? 'ring-1 ring-brand/40' : ''}`}>
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-xs font-medium text-muted">You</p>
          {mic.state === 'on' && !muted && <MicMeter level={mic.level} state={mic.state} />}
          {muted && <span className="text-xs text-warn">Muted</span>}
          <span className="ml-auto flex flex-wrap gap-2">
            {mic.state === 'on' && (
              <button onClick={toggleMute} className="btn btn-ghost !px-2.5 !py-1.5 text-xs" aria-pressed={muted}>
                {muted ? <MicOff size={15} /> : <Mic size={15} />} {muted ? 'Unmute' : 'Mute'}
              </button>
            )}
            <button
              onClick={room.repeat}
              disabled={!listening || room.phase !== 'interview'}
              className="btn btn-ghost !px-2.5 !py-1.5 text-xs"
            >
              <Repeat2 size={15} /> Repeat question
            </button>
            <button onClick={() => setTyping((t) => !t)} className="btn btn-ghost !px-2.5 !py-1.5 text-xs" aria-pressed={typing}>
              <Keyboard size={15} /> Type
            </button>
          </span>
        </div>
        <p className={`mt-4 min-h-[5rem] text-[15px] leading-relaxed whitespace-pre-wrap ${room.transcript ? 'text-fg/90' : 'text-faint'}`}>
          {room.transcript || (listening ? (room.ready?.stt === false ? 'Voice isn’t available right now. Type your answer below.' : 'Speak when you’re ready…') : '')}
        </p>
        {typing && (
          <div className="mt-3 flex gap-2">
            <textarea
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  sendTyped();
                }
              }}
              rows={3}
              maxLength={6000}
              placeholder="Type your answer…"
              className="input flex-1 resize-y text-[15px]"
              aria-label="Your answer"
            />
            <button onClick={sendTyped} disabled={!listening || !typed.trim()} className="btn btn-primary self-end" aria-label="Send answer">
              <Send size={15} />
            </button>
          </div>
        )}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
          <button onClick={() => setConfirmEnd(true)} className="btn btn-ghost !px-3 !py-2 text-sm text-danger">
            <PhoneOff size={15} /> End interview
          </button>
          <button onClick={room.done} disabled={!listening || !room.transcript} className="btn btn-primary">
            <Check size={15} /> I’ve finished my answer
          </button>
        </div>
        <p className="mt-3 text-[11px] text-faint">
          Friday waits while you think and moves on once you&apos;ve finished. Press the button if you want to move on sooner.
        </p>
      </section>

      <ConfirmDialog
        open={confirmEnd}
        title="End the interview now?"
        text={
          session.startedAt || room.endsAt
            ? 'Friday will stop here and review the answers you’ve given so far.'
            : 'The interview hasn’t started yet. You can come back to it from Practice.'
        }
        confirmLabel="End interview"
        onConfirm={() => {
          setConfirmEnd(false);
          if (room.phase === 'interview') room.end();
          else router.push('/practice');
        }}
        onCancel={() => setConfirmEnd(false)}
      />
    </div>
  );
}

function DesktopChip({ desktop }: { desktop: DesktopStatus }) {
  const heard = desktop.heard?.afterMs;
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full bg-white/5 px-2.5 py-1 text-xs text-muted ring-1 ring-line"
      title="The Friday desktop app on this account, and how quickly it heard the last question"
    >
      <Laptop size={13} className={desktop.hearing ? 'text-brand' : 'text-faint'} />
      {desktop.hearing ? (heard != null ? `Desktop heard it in ${formatSeconds(heard)}` : 'Desktop listening') : 'Desktop not listening'}
    </span>
  );
}

// ---- before the interview ------------------------------------------------------------------------

function Lobby({
  session,
  ready,
  mic,
  desktop,
  testing,
  onTest,
  onJoin,
}: {
  session: PracticeSession;
  ready: { stt: boolean; tts: boolean } | null;
  mic: ReturnType<typeof useMicrophone>;
  desktop: DesktopStatus | null;
  testing: boolean;
  onTest: () => void;
  onJoin: () => void;
}) {
  const [joining, setJoining] = useState(false);
  const resuming = Boolean(session.startedAt);
  const left = resuming ? Math.max(0, (session.durationMinutes ?? 0) * 60 - session.seconds) : null;
  return (
    <div className="space-y-5">
      <section className="relative overflow-hidden rounded-[var(--radius-card)] border border-line p-6 sm:p-8 animate-fade-up">
        <div className="absolute inset-0 -z-10 bg-surface" />
        <div className="absolute -top-28 -right-24 -z-10 size-[28rem] glow opacity-70" />
        <div className="flex flex-col gap-6 sm:flex-row sm:items-center">
          <Orb size={72} />
          <div className="min-w-0 flex-1">
            <p className="text-xs text-muted">
              {session.title} · {roundLabel(session.roundType)}
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">
              {resuming ? 'Pick up where you left off' : `Your ${session.durationMinutes}-minute interview with Friday`}
            </h1>
            <p className="mt-1.5 max-w-lg text-sm text-muted">
              {resuming
                ? `${formatLeft(left ?? 0)} left on the clock. Friday will repeat the question you were on.`
                : 'Friday will greet you, then ask if you’re ready. The clock starts when you say yes. Questions come from your resume, one at a time, with follow-ups.'}
            </p>
          </div>
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <CheckCard ok={mic.state === 'on'} icon={Mic} title="Microphone">
            {mic.state === 'on' ? (
              <span className="flex items-center gap-2">
                Say something to check the level <MicMeter level={mic.level} state={mic.state} />
              </span>
            ) : mic.state === 'blocked' ? (
              'Microphone access is blocked. Allow it in your browser’s address bar, or type your answers.'
            ) : mic.state === 'unsupported' ? (
              'No microphone available here. You can type your answers.'
            ) : (
              <button onClick={() => void mic.start()} className="btn btn-secondary !px-3 !py-1.5 text-xs">
                {mic.state === 'asking' ? <Spinner className="!size-3" /> : <Mic size={13} />} Allow microphone
              </button>
            )}
          </CheckCard>
          <CheckCard ok={Boolean(ready)} icon={Headphones} title="Sound">
            {ready?.tts === false
              ? 'Friday will speak with your browser’s voice.'
              : 'Use headphones or a quiet room so your answers are heard clearly.'}
            {ready?.stt === false && ' Voice answers are unavailable right now, so you’ll type.'}
          </CheckCard>
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-5">
          <p className="text-xs text-muted">
            {resuming ? 'Uses your session minutes while the interview runs.' : 'Session minutes are used only after you say you’re ready.'}
          </p>
          <button
            onClick={async () => {
              setJoining(true);
              await onJoin();
            }}
            disabled={!ready || joining}
            className="btn btn-primary btn-shine"
          >
            {!ready || joining ? <Spinner className="!size-4" /> : <ArrowRight size={16} />} {resuming ? 'Rejoin interview' : 'Join interview'}
          </button>
        </div>
      </section>

      <DesktopCheck desktop={desktop} testing={testing} onTest={onTest} disabled={!ready} />
    </div>
  );
}

function CheckCard({ ok, icon: Icon, title, children }: { ok: boolean; icon: typeof Mic; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-bg/40 p-4">
      <p className="flex items-center gap-2 text-sm font-medium">
        <Icon size={15} className={ok ? 'text-brand' : 'text-muted'} /> {title}
        {ok && <Check size={14} className="ml-auto text-brand" />}
      </p>
      <div className="mt-1.5 text-xs leading-relaxed text-muted">{children}</div>
    </div>
  );
}

/** Practising with the desktop app: does it hear this tab's interviewer, and how fast does it answer? */
function DesktopCheck({
  desktop,
  testing,
  onTest,
  disabled,
}: {
  desktop: DesktopStatus | null;
  testing: boolean;
  onTest: () => void;
  disabled: boolean;
}) {
  const steps = [
    { ok: Boolean(desktop?.connected), label: 'Friday desktop app is open and signed in to this account' },
    { ok: Boolean(desktop?.hearing), label: 'It is listening to the interviewer (system audio)' },
    {
      ok: Boolean(desktop?.heard),
      label: desktop?.heard
        ? `It heard the test question${desktop.heard.afterMs != null ? ` ${formatSeconds(desktop.heard.afterMs)} after it ended` : ''}`
        : 'It hears the test question',
    },
    {
      ok: desktop?.answerAfterMs != null,
      label:
        desktop?.answerAfterMs != null
          ? `Its answer started ${formatSeconds(desktop.answerAfterMs)} after the question ended`
          : 'It shows an answer',
    },
  ];
  return (
    <section className="glass rounded-[var(--radius-card)] p-5 sm:p-6 animate-fade-up">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-xl">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Laptop size={16} className="text-brand" /> Practise with the Friday desktop app <span className="text-xs font-normal text-faint">Optional</span>
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-muted">
            Rehearse the way you&apos;ll use Friday in the real interview. Open the desktop app, start a session with interviewer audio on,
            then play the test question. Friday&apos;s voice from this tab is the &ldquo;interviewer&rdquo;: check the app hears it and how
            quickly it answers. Your review will also show if your answers sounded read out.
          </p>
        </div>
        <button onClick={onTest} disabled={disabled || testing} className="btn btn-secondary !py-2 text-sm">
          {testing ? <Spinner className="!size-4" /> : <Volume2 size={15} />} Play test question
        </button>
      </div>
      <ul className="mt-4 grid gap-2 sm:grid-cols-2">
        {steps.map((s) => (
          <li key={s.label} className="flex items-start gap-2 text-xs">
            {s.ok ? <Check size={14} className="mt-px shrink-0 text-brand" /> : <CircleSlash size={14} className="mt-px shrink-0 text-faint" />}
            <span className={s.ok ? 'text-fg/90' : 'text-muted'}>{s.label}</span>
          </li>
        ))}
      </ul>
      {desktop?.heard && (
        <p className="mt-3 truncate rounded-lg bg-bg/40 px-3 py-2 text-xs text-muted ring-1 ring-line" title={desktop.heard.text}>
          Heard: &ldquo;{desktop.heard.text}&rdquo;
        </p>
      )}
      {desktop && !desktop.connected && (
        <p className="mt-3 flex items-center gap-1.5 text-xs text-faint">
          <X size={12} /> Not connected. Don&apos;t have it?{' '}
          <Link href="/#download" className="text-brand hover:underline">
            Download Friday
          </Link>
        </p>
      )}
    </section>
  );
}
