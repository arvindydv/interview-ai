'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import {
  AlertTriangle, ArrowLeft, ArrowRight, Keyboard, Mic, RefreshCw, SkipForward, Sparkles, Square, Timer, Volume2, VolumeX,
} from 'lucide-react';
import type { PracticeAnswerInput, PracticeSession, TrialBalance } from '@parakeet/shared';
import { ApiError, api } from '@/lib/api';
import { useRequireSession } from '@/lib/useSession';
import { roundLabel } from '@/lib/interviews';
import { KIND_LABEL, formatDuration, formatLeft, secondsLeft, useDictation, useInterviewerVoice } from '@/lib/practice';
import { AppShell } from '@/components/AppShell';
import { LogoMark } from '@/components/Logo';
import { Spinner } from '@/components/ui';
import { ConfirmDialog, Toaster, toast } from '@/components/overlay';
import { Debrief } from '@/components/practice/Debrief';

const POLL_MS = 2000;
const VOICE_KEY = 'friday.practice.voice';

const PRICING = '/pricing?from=practice';
/** Below this, the minutes chip turns amber. */
const LOW_SECONDS = 120;

const isNoMinutes = (e: unknown) => e instanceof ApiError && e.status === 402;

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

  // Follow the worker while it plans or scores.
  const waiting = session?.status === 'planning' || session?.status === 'scoring';
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
        ) : session.status === 'planning' ? (
          <Waiting
            title="Your interviewer is getting ready"
            text={`Reading ${session.interviewId ? 'the role, the job description and ' : ''}your resume to write ${session.questionCount} questions.`}
          />
        ) : session.status === 'scoring' ? (
          <Waiting title="Reviewing your answers" text="Scoring each answer and writing a stronger version of it. Usually under a minute." />
        ) : session.status === 'failed' ? (
          <Failed session={session} onChange={setSession} />
        ) : session.status === 'ready' ? (
          <Room session={session} onChange={setSession} />
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
      <h1 className="mt-4 text-lg font-semibold">{session.questions.length ? 'Scoring didn’t finish' : 'The interview couldn’t start'}</h1>
      <p className="mt-1 max-w-sm text-sm text-muted">
        {session.error} {session.questions.length > 0 && 'Your answers are saved.'}
      </p>
      <button onClick={retry} disabled={busy} className="btn btn-primary mt-6">
        {busy ? <Spinner className="!size-4" /> : <RefreshCw size={15} />} Try again
      </button>
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

// ---- the interview -------------------------------------------------------------------------------

function Room({ session, onChange }: { session: PracticeSession; onChange: (s: PracticeSession) => void }) {
  const firstOpen = session.answers.findIndex((a) => a === null);
  const index = firstOpen === -1 ? session.questions.length : firstOpen;
  const done = index >= session.questions.length;
  const q = session.questions[index];
  const isLast = index === session.questions.length - 1;

  const voice = useInterviewerVoice(session.id, session.questions);
  const dictation = useDictation();
  const [voiceOn, setVoiceOn] = useState(true);
  const [text, setText] = useState('');
  const [mode, setMode] = useState<'voice' | 'text'>('text');
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [saving, setSaving] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  // Minutes left as of `at` (null = unlimited plan; undefined = not started yet), and whether they ran out.
  const [minutes, setMinutes] = useState<{ left: number | null; at: number } | undefined>(undefined);
  const [out, setOut] = useState(false);
  const router = useRouter();
  const base = useRef('');
  const area = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    try {
      setVoiceOn(localStorage.getItem(VOICE_KEY) !== 'off');
    } catch {
      // Private mode: keep the default.
    }
  }, []);
  const toggleVoice = () => {
    const next = !voiceOn;
    setVoiceOn(next);
    if (!next) voice.cancel();
    try {
      localStorage.setItem(VOICE_KEY, next ? 'on' : 'off');
    } catch {
      // Not remembered; fine.
    }
  };

  const answered = session.answers.filter((a) => a && !a.skipped).length;
  const sync = (trial: TrialBalance | null) => setMinutes({ left: secondsLeft(trial), at: Date.now() });

  // Opening the session starts the server's clock and tells us the minutes left. With none left
  // before anything is answered, there's nothing to do here: go and get minutes.
  useEffect(() => {
    api<{ session: PracticeSession; trial: TrialBalance | null }>(`/v1/practice/${session.id}/start`, { method: 'POST' }).then(
      (r) => sync(r.trial),
      (e) => {
        if (!isNoMinutes(e)) return setMinutes({ left: null, at: Date.now() });
        setOut(true);
        if (!answered) {
          toast((e as ApiError).message, { tone: 'bad' });
          router.replace(PRICING);
        }
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id]);

  const live = minutes && minutes.left !== null ? Math.max(0, Math.round(minutes.left - (now - minutes.at) / 1000)) : null;

  useEffect(() => {
    if (minutes?.left == null || out) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [minutes, out]);

  // Time's up: keep what was said so far, then stop taking answers.
  useEffect(() => {
    if (live !== 0 || out) return;
    setOut(true);
    dictation.stop();
    voice.cancel();
    if (text.trim()) submit(false, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live]);

  // A new question starts with an empty answer.
  useEffect(() => {
    setText('');
    setStartedAt(null);
    setMode('text');
    base.current = '';
  }, [index]);

  // Ask each new question out loud (and the current one when voice is switched back on).
  useEffect(() => {
    if (!q || !voiceOn) return;
    // A beat after the question card animates in.
    const t = setTimeout(() => voice.speak(index), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, voiceOn]);

  // Live transcript goes after whatever was already in the box.
  useEffect(() => {
    if (!dictation.listening && !dictation.final) return;
    setText([base.current, dictation.final, dictation.interim].filter(Boolean).join(' '));
  }, [dictation.final, dictation.interim, dictation.listening]);

  useEffect(() => {
    if (dictation.error) toast(dictation.error, { tone: 'bad' });
  }, [dictation.error]);

  useEffect(() => {
    if (!startedAt) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [startedAt]);

  const begin = () => setStartedAt((s) => s ?? Date.now());

  const toggleMic = () => {
    if (dictation.listening) return dictation.stop();
    voice.cancel();
    base.current = text.trim();
    setMode('voice');
    begin();
    dictation.start();
  };

  const submit = async (skipped: boolean, timeUp = false) => {
    if (saving || !q || (out && !timeUp)) return;
    dictation.stop();
    voice.cancel();
    const answer: PracticeAnswerInput = {
      text: skipped ? '' : text.trim(),
      mode,
      durationMs: startedAt ? Math.min(Date.now() - startedAt, 15 * 60_000) : 0,
      skipped: skipped || !text.trim(),
    };
    setSaving(true);
    try {
      const r = await api<{ session: PracticeSession; trial: TrialBalance | null }>(`/v1/practice/${session.id}/answers/${index}`, {
        method: 'PUT',
        body: JSON.stringify(answer),
      });
      sync(r.trial);
      if (isLast) await finish(r.session);
      else onChange(r.session);
    } catch (e) {
      if (isNoMinutes(e)) setOut(true);
      else toast(errorText(e), { tone: 'bad' });
    } finally {
      setSaving(false);
    }
  };

  const finish = async (current = session) => {
    try {
      onChange((await api<{ session: PracticeSession }>(`/v1/practice/${current.id}/finish`, { method: 'POST' })).session);
    } catch (e) {
      onChange(current);
      toast(errorText(e), { tone: 'bad' });
    }
  };

  // Ctrl/⌘+Enter submits.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && text.trim()) {
        e.preventDefault();
        submit(false);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  const elapsed = startedAt ? now - startedAt : 0;

  if (done) {
    return (
      <section className="glass grid place-items-center rounded-[var(--radius-card)] px-6 py-16 text-center">
        <Sparkles size={26} className="text-brand" />
        <h1 className="mt-4 text-lg font-semibold">That’s every question</h1>
        <button onClick={() => finish()} className="btn btn-primary mt-6">
          Get my feedback <ArrowRight size={15} />
        </button>
      </section>
    );
  }

  return (
    <div className="space-y-5">
      {/* progress */}
      <div className="flex flex-wrap items-center justify-between gap-3 animate-fade-up">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{session.title}</p>
          <p className="text-xs text-muted">
            {roundLabel(session.roundType)} · Question {index + 1} of {session.questions.length}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {live !== null && (
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium tabular-nums ring-1 ${
                live <= LOW_SECONDS ? 'bg-warn/10 text-warn ring-warn/30' : 'bg-white/5 text-muted ring-line'
              }`}
              title="Session minutes left. Practice uses them while you answer."
            >
              <Timer size={13} /> {live > 0 ? `${formatLeft(live)} left` : 'No minutes left'}
            </span>
          )}
          {voice.supported && (
            <button onClick={toggleVoice} className="btn btn-ghost !px-2.5 !py-1.5 text-xs" aria-pressed={voiceOn}>
              {voiceOn ? <Volume2 size={15} /> : <VolumeX size={15} />} Voice {voiceOn ? 'on' : 'off'}
            </button>
          )}
          <button
            onClick={() => (answered ? setConfirmEnd(true) : toast('Answer at least one question first.', { tone: 'bad' }))}
            className="btn btn-secondary !px-3 !py-1.5 text-xs"
          >
            End &amp; get feedback
          </button>
        </div>
      </div>
      <div className="flex gap-1.5" aria-hidden>
        {session.questions.map((_, n) => (
          <span
            key={n}
            className={`h-1 flex-1 rounded-full transition-colors duration-500 ${
              n < index ? (session.answers[n]?.skipped ? 'bg-faint' : 'bg-brand') : n === index ? 'bg-brand-2' : 'bg-white/[0.08]'
            }`}
          />
        ))}
      </div>

      {/* interviewer */}
      <section key={index} className="relative overflow-hidden rounded-[var(--radius-card)] border border-line p-6 sm:p-8 animate-fade-up">
        <div className="absolute inset-0 -z-10 bg-surface" />
        <div className="absolute -top-28 -left-24 -z-10 size-96 glow opacity-60" />
        <div className="flex flex-col items-start gap-5 sm:flex-row sm:items-center">
          <Orb active={voice.speaking} size={72} />
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-2 text-xs text-muted">
              Interviewer
              <span className="rounded-full bg-white/5 px-2 py-0.5 text-[11px] ring-1 ring-line">{KIND_LABEL[q.kind]}</span>
            </p>
            <h1 className="mt-2 text-xl leading-snug font-medium tracking-tight text-balance sm:text-2xl">{q.question}</h1>
          </div>
          {voice.supported && voiceOn && voice.blocked ? (
            // The browser won't play sound until the page is clicked (e.g. after a reload).
            <button onClick={() => voice.speak(index)} className="btn btn-primary shrink-0 !py-2 text-sm animate-fade-up">
              <Volume2 size={16} /> Play question
            </button>
          ) : (
            voice.supported && (
              <button onClick={() => voice.speak(index)} className="btn btn-ghost shrink-0 !px-2.5 !py-1.5 text-xs" aria-label="Hear the question again">
                <Volume2 size={15} /> Replay
              </button>
            )
          )}
        </div>
      </section>

      {/* answer */}
      {out ? (
        <OutOfMinutes answered={answered} total={session.questions.length} onFinish={() => finish()} />
      ) : (
      <section className={`glass rounded-[var(--radius-card)] p-5 transition sm:p-6 ${dictation.listening ? 'ring-1 ring-brand/40' : ''}`}>
        <div className="flex flex-wrap items-center gap-3">
          {dictation.supported ? (
            <button
              onClick={toggleMic}
              className={`btn ${dictation.listening ? 'bg-danger/90 text-bg hover:brightness-110' : 'btn-primary'} !py-2.5`}
              aria-pressed={dictation.listening}
            >
              {dictation.listening ? (
                <>
                  <Square size={14} fill="currentColor" /> Stop
                </>
              ) : (
                <>
                  <Mic size={16} /> {text ? 'Keep speaking' : 'Answer out loud'}
                </>
              )}
            </button>
          ) : (
            <p className="flex items-center gap-2 text-xs text-muted">
              <Keyboard size={14} /> Type your answer. (Speaking needs Chrome, Edge or Safari.)
            </p>
          )}
          {dictation.listening && (
            <span className="flex h-5 items-center gap-[3px]" aria-label="Listening">
              {Array.from({ length: 12 }, (_, i) => (
                <span key={i} className="wave-bar h-full w-[3px] rounded-full bg-brand" style={{ '--i': i } as React.CSSProperties} />
              ))}
            </span>
          )}
          <span className="ml-auto flex items-center gap-3 text-xs text-muted tabular-nums">
            <span>{words} words</span>
            <span className={elapsed > 150_000 ? 'text-warn' : ''}>{formatDuration(elapsed)}</span>
          </span>
        </div>
        <textarea
          ref={area}
          value={text}
          onChange={(e) => {
            if (dictation.listening) return;
            begin();
            setText(e.target.value);
          }}
          readOnly={dictation.listening}
          rows={7}
          maxLength={6000}
          placeholder={dictation.supported ? 'Press “Answer out loud” and speak, or type here…' : 'Type your answer here…'}
          className="input mt-4 resize-y text-[15px] leading-relaxed"
          aria-label="Your answer"
        />
        {elapsed > 150_000 && <p className="mt-2 text-xs text-warn">Over two and a half minutes. In a real interview, start wrapping up.</p>}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
          <button onClick={() => submit(true)} disabled={saving} className="btn btn-ghost !px-3 !py-2 text-sm">
            <SkipForward size={15} /> Skip
          </button>
          <button onClick={() => submit(false)} disabled={saving || !text.trim()} className="btn btn-primary">
            {saving && <Spinner className="!size-4" />}
            {isLast ? 'Finish & get feedback' : 'Next question'} <ArrowRight size={15} />
            <kbd className="hidden rounded border border-black/20 px-1 text-[10px] opacity-60 sm:inline">⌘↵</kbd>
          </button>
        </div>
      </section>
      )}

      <ConfirmDialog
        open={confirmEnd}
        title="End the interview now?"
        text={`You've answered ${answered} of ${session.questions.length}. The rest count as skipped.`}
        confirmLabel="End & get feedback"
        onConfirm={() => {
          setConfirmEnd(false);
          dictation.stop();
          voice.cancel();
          finish();
        }}
        onCancel={() => setConfirmEnd(false)}
      />
    </div>
  );
}

function OutOfMinutes({ answered, total, onFinish }: { answered: number; total: number; onFinish: () => void }) {
  return (
    <section className="rounded-[var(--radius-card)] border border-warn/30 bg-warn/[0.05] p-6 text-center animate-fade-up" aria-live="polite">
      <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-warn/10 text-warn ring-1 ring-warn/30">
        <Timer size={22} />
      </span>
      <h2 className="mt-4 text-lg font-semibold">You&apos;re out of session minutes</h2>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted">
        Practice uses the same minutes as live interviews.{' '}
        {answered > 0
          ? `Your ${answered} answer${answered === 1 ? ' is' : 's are'} saved, and feedback doesn't use minutes.`
          : 'Get more minutes to keep practising.'}
      </p>
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        <Link href={PRICING} className="btn btn-primary">
          Get more minutes <ArrowRight size={15} />
        </Link>
        {answered > 0 && (
          <button onClick={onFinish} className="btn btn-secondary">
            Get feedback on {answered} of {total}
          </button>
        )}
      </div>
    </section>
  );
}
