'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  BookOpenText, Check, ChevronDown, Copy, Gauge, Hourglass, Lightbulb, MessageSquareQuote, Mic, RotateCcw, ShieldCheck, Target, Timer,
  TrendingUp,
} from 'lucide-react';
import {
  PRACTICE_DIFFICULTIES, PRACTICE_DURATIONS, type PracticeAnswer, type PracticeConfidence, type PracticeFeedback,
  type PracticeQuestion, type PracticeScores, type PracticeSession, type ReadingVerdict,
} from '@parakeet/shared';
import { ApiError, api } from '@/lib/api';
import { roundLabel } from '@/lib/interviews';
import { KIND_LABEL, PACE, formatDuration, formatSeconds, scoreLabel, scoreTone } from '@/lib/practice';
import { Spinner } from '@/components/ui';
import { toast } from '@/components/overlay';
import { ReadinessRing } from '@/components/interviews/parts';
import { ScoreBars } from '@/components/practice/charts';

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/** One answer's score out of 10, weighted like the overall score (apps/worker, queues/practice.ts). */
const answerScore = (s: PracticeScores) => {
  const content = mean([s.relevance, s.structure, s.specificity, s.clarity]);
  return s.confidence === undefined ? content : 0.6 * content + 0.4 * s.confidence;
};

export const READING: Record<ReadingVerdict, { label: string; tone: string }> = {
  natural: { label: 'Sounded natural', tone: 'text-brand bg-brand/10 ring-brand/30' },
  possibly_reading: { label: 'May have been reading', tone: 'text-brand-2 bg-brand-2/10 ring-brand-2/30' },
  likely_reading: { label: 'Sounded read out', tone: 'text-warn bg-warn/10 ring-warn/30' },
};

export function Debrief({ session }: { session: PracticeSession }) {
  const router = useRouter();
  const [again, setAgain] = useState(false);
  const result = session.result!;
  const answered = session.answers.map((a, n) => ({ a, f: result.questions[n] })).filter(({ a }) => a && !a.skipped);
  const categories = Object.fromEntries(
    (['confidence', 'relevance', 'structure', 'specificity', 'clarity'] as const)
      .filter((k) => answered.some(({ f }) => f.scores[k] !== undefined))
      .map((k) => [k, mean(answered.map(({ f }) => f.scores[k] ?? 0))]),
  ) as unknown as PracticeScores;
  const spoken = session.answers.filter((a): a is PracticeAnswer => Boolean(a && !a.skipped && a.wpm));
  const pace = spoken.length ? Math.round(mean(spoken.map((a) => a.wpm!))) : null;
  const fillers = session.answers.reduce((n, a) => n + (a?.fillers.reduce((m, f) => m + f.count, 0) ?? 0), 0);
  const time = session.answers.reduce((n, a) => n + (a?.durationMs ?? 0), 0);

  const practiseAgain = async () => {
    setAgain(true);
    try {
      const durationMinutes = (PRACTICE_DURATIONS as readonly number[]).includes(session.durationMinutes ?? 0) ? session.durationMinutes : 10;
      const r = await api<{ session: PracticeSession }>('/v1/practice', {
        method: 'POST',
        body: JSON.stringify({ interviewId: session.interviewId, roundType: session.roundType, difficulty: session.difficulty, durationMinutes }),
      });
      router.push(`/practice/${r.session.id}`);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Something went wrong. Try again.', { tone: 'bad' });
      if (e instanceof ApiError && e.status === 402) return router.push('/pricing?from=practice');
      setAgain(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* headline */}
      <section className="relative overflow-hidden rounded-[var(--radius-card)] border border-line p-6 sm:p-8 animate-fade-up">
        <div className="absolute inset-0 -z-10 bg-surface" />
        <div className="absolute -top-28 -right-24 -z-10 size-[28rem] glow opacity-80" />
        <div className="flex flex-col gap-6 sm:flex-row sm:items-center">
          <ReadinessRing score={result.score} size={120} stroke={9} label="Interview score" outOf10 />
          <div className="min-w-0 flex-1">
            <p className="text-xs text-muted">
              {session.title} · {roundLabel(session.roundType)} · {PRACTICE_DIFFICULTIES.find((d) => d.id === session.difficulty)?.label}
            </p>
            <h1 className={`mt-1 text-2xl font-semibold tracking-tight ${scoreTone(result.score)}`}>{scoreLabel(result.score)}</h1>
            <p className="mt-2 text-sm leading-relaxed text-fg/85">{result.summary}</p>
          </div>
        </div>
        <dl className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat icon={Check} label="Questions answered" value={`${answered.length} of ${session.questions.length}`} />
          <Stat
            icon={Gauge}
            label="Speaking pace"
            value={pace ? `${pace} wpm` : '—'}
            note={pace ? (pace < PACE.slow ? 'A little slow' : pace > PACE.fast ? 'A little fast' : 'Comfortable') : 'Typed answers'}
          />
          <Stat icon={MessageSquareQuote} label="Filler words" value={String(fillers)} note={fillers > 6 ? 'Try pausing instead' : undefined} />
          <Stat icon={Timer} label="Talking time" value={formatDuration(time)} />
        </dl>
      </section>

      {result.confidence && <ConfidenceCard confidence={result.confidence} answers={session.answers} />}

      <div className="grid items-start gap-6 lg:grid-cols-[1fr_1.2fr]">
        <section className="glass rounded-[var(--radius-card)] p-5 sm:p-6 animate-fade-up">
          <h2 className="mb-4 text-sm font-semibold">Across your answers</h2>
          <ScoreBars scores={categories} />
          <p className="mt-4 text-xs text-faint">Average out of 10 over the questions you answered.</p>
        </section>
        <section className="glass grid gap-5 rounded-[var(--radius-card)] p-5 sm:grid-cols-2 sm:p-6 animate-fade-up">
          <List icon={TrendingUp} title="What went well" items={result.strengths} tone="text-brand" />
          <List icon={Target} title="Work on next" items={result.improvements} tone="text-warn" />
        </section>
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Question by question</h2>
        {session.questions.map((q, n) => (
          <QuestionReview key={n} n={n} q={q} a={session.answers[n]} f={result.questions[n]} defaultOpen={n === 0} />
        ))}
      </section>

      <div className="flex flex-wrap justify-center gap-2 pt-2">
        <button onClick={practiseAgain} disabled={again} className="btn btn-primary">
          {again ? <Spinner className="!size-4" /> : <RotateCcw size={15} />} Practise again
        </button>
      </div>
    </div>
  );
}

/** How confidently the candidate came across: the debrief's focus for live practice. */
function ConfidenceCard({ confidence: c, answers }: { confidence: PracticeConfidence; answers: (PracticeAnswer | null)[] }) {
  const spoken = answers.filter((a): a is PracticeAnswer => Boolean(a && !a.skipped && a.delivery));
  const think = spoken.length ? mean(spoken.map((a) => a.delivery!.thinkMs)) : null;
  const pauses = spoken.reduce((n, a) => n + a.delivery!.longPauses, 0);
  const hedges = spoken.reduce((n, a) => n + a.delivery!.hedges.reduce((m, h) => m + h.count, 0), 0);
  const reading = READING[c.reading];
  return (
    <section className="relative overflow-hidden rounded-[var(--radius-card)] border border-line p-6 sm:p-7 animate-fade-up">
      <div className="absolute inset-0 -z-10 bg-surface" />
      <div className="flex flex-col gap-6 sm:flex-row">
        <div className="sm:w-56 sm:shrink-0">
          <p className="flex items-center gap-1.5 text-xs text-muted">
            <ShieldCheck size={14} className="text-brand" /> Confidence
          </p>
          <p className={`mt-2 text-4xl font-semibold tracking-tight tabular-nums ${scoreTone(c.score * 10)}`}>
            {c.score.toFixed(1)}
            <span className="text-base font-normal text-faint">/10</span>
          </p>
          <div className="mt-3 h-2 overflow-hidden rounded bg-white/[0.06]">
            <div className="h-full rounded bg-brand transition-[width] duration-700" style={{ width: `${c.score * 10}%` }} />
          </div>
          <p className={`mt-4 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${reading.tone}`}>
            <BookOpenText size={13} /> {reading.label}
          </p>
          {c.readingEvidence && <p className="mt-2 text-xs leading-relaxed text-muted">{c.readingEvidence}</p>}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm leading-relaxed text-fg/85">{c.summary}</p>
          {spoken.length > 0 && (
            <dl className="mt-4 grid grid-cols-3 gap-2">
              <Stat icon={Hourglass} label="Time to start" value={formatSeconds(think!)} note={think! > 6000 ? 'Start sooner' : 'Good'} />
              <Stat icon={Timer} label="Long pauses" value={String(pauses)} note={pauses > spoken.length ? 'Mid-answer silences' : undefined} />
              <Stat icon={MessageSquareQuote} label="Hedges" value={String(hedges)} note={hedges > 3 ? '“I think”, “maybe”…' : undefined} />
            </dl>
          )}
          {c.tips.length > 0 && (
            <div className="mt-5">
              <h3 className="flex items-center gap-2 text-sm font-semibold">
                <Lightbulb size={15} className="text-warn" /> Sound more confident next time
              </h3>
              <ol className="mt-3 space-y-2">
                {c.tips.map((t, n) => (
                  <li key={n} className="flex gap-3 text-sm leading-relaxed text-fg/85">
                    <span className="grid size-5 shrink-0 place-items-center rounded-full bg-warn/10 text-[11px] font-semibold text-warn">{n + 1}</span>
                    {t}
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function Stat({ icon: Icon, label, value, note }: { icon: typeof Check; label: string; value: string; note?: string }) {
  return (
    <div className="rounded-xl border border-line bg-bg/40 px-3 py-2.5 backdrop-blur">
      <dt className="flex items-center gap-1.5 text-[11px] text-muted">
        <Icon size={12} className="text-brand" /> {label}
      </dt>
      <dd className="mt-1 text-base font-semibold tabular-nums">{value}</dd>
      {note && <dd className="text-[11px] text-faint">{note}</dd>}
    </div>
  );
}

function List({ icon: Icon, title, items, tone }: { icon: typeof Check; title: string; items: string[]; tone: string }) {
  return (
    <div>
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <Icon size={15} className={tone} /> {title}
      </h3>
      <ul className="mt-3 space-y-2">
        {items.map((it, n) => (
          <li key={n} className="flex gap-2 text-sm leading-relaxed text-fg/85">
            <span className={`mt-2 size-1.5 shrink-0 rounded-full ${tone === 'text-brand' ? 'bg-brand' : 'bg-warn'}`} />
            {it}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The answer with its filler words marked, so they're easy to spot. */
function MarkedAnswer({ a }: { a: PracticeAnswer }) {
  const words = a.fillers.map((f) => f.word).sort((x, y) => y.length - x.length);
  if (!words.length) return <>{a.text}</>;
  const re = new RegExp(`\\b(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`, 'gi');
  return (
    <>
      {a.text.split(re).map((part, n) =>
        n % 2 ? (
          <mark key={n} className="rounded bg-warn/15 px-0.5 text-warn">
            {part}
          </mark>
        ) : (
          part
        ),
      )}
    </>
  );
}

function QuestionReview({
  n,
  q,
  a,
  f,
  defaultOpen,
}: {
  n: number;
  q: PracticeQuestion;
  a: PracticeAnswer | null;
  f: PracticeFeedback;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const skipped = !a || a.skipped;
  const score = answerScore(f.scores);
  const copy = () =>
    navigator.clipboard.writeText(f.betterAnswer).then(
      () => toast('Copied.'),
      () => toast('Couldn’t copy. Select the text instead.', { tone: 'bad' }),
    );
  return (
    <article className={`rounded-2xl border transition ${open ? 'border-line-strong bg-surface/70' : 'border-line bg-surface/40 hover:border-line-strong'}`}>
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-center gap-4 p-4 text-left sm:p-5">
        <span
          className={`grid size-11 shrink-0 place-items-center rounded-xl text-sm font-semibold tabular-nums ring-1 ${
            skipped ? 'bg-white/5 text-faint ring-line' : `bg-white/[0.04] ring-line-strong ${scoreTone(score * 10)}`
          }`}
        >
          {skipped ? '–' : score.toFixed(1)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[11px] text-faint">
            Q{n + 1} · {KIND_LABEL[q.kind]} · {f.verdict}
          </span>
          <span className={`mt-0.5 block text-sm font-medium ${open ? '' : 'truncate'}`}>{q.question}</span>
        </span>
        <ChevronDown size={16} className={`shrink-0 text-faint transition ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="grid gap-5 border-t border-line p-4 sm:p-5 lg:grid-cols-[1fr_15rem]">
          <div className="min-w-0 space-y-5">
            <div>
              <p className="eyebrow mb-2">Your answer</p>
              {skipped ? (
                <p className="text-sm text-faint">Skipped</p>
              ) : (
                <>
                  <p className="text-sm leading-relaxed whitespace-pre-wrap text-fg/85">
                    <MarkedAnswer a={a!} />
                  </p>
                  <p className="mt-2 text-[11px] text-faint">
                    {a!.words} words · {formatDuration(a!.durationMs)}
                    {a!.wpm ? ` · ${a!.wpm} wpm` : ''}
                    {a!.delivery && ` · ${formatSeconds(a!.delivery.thinkMs)} to start`}
                    {a!.delivery && a!.delivery.longPauses > 0 && ` · ${a!.delivery.longPauses} long pause${a!.delivery.longPauses === 1 ? '' : 's'}`}
                    {a!.fillers.length > 0 && ` · fillers: ${a!.fillers.map((x) => `“${x.word}” ×${x.count}`).join(', ')}`}
                    {a!.delivery && a!.delivery.hedges.length > 0 &&
                      ` · hedges: ${a!.delivery.hedges.map((x) => `“${x.word}” ×${x.count}`).join(', ')}`}
                  </p>
                </>
              )}
            </div>
            <div className="rounded-xl border border-line bg-bg/40 p-4">
              <p className="flex items-center gap-1.5 text-xs font-semibold">
                <Lightbulb size={13} className="text-warn" /> Feedback
              </p>
              <p className="mt-1.5 text-sm leading-relaxed text-fg/85">{f.feedback}</p>
            </div>
            {f.delivery && (
              <div className="rounded-xl border border-line bg-bg/40 p-4">
                <p className="flex flex-wrap items-center gap-1.5 text-xs font-semibold">
                  <Mic size={13} className="text-brand" /> How you said it
                  {f.reading && f.reading !== 'natural' && (
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${READING[f.reading].tone}`}>{READING[f.reading].label}</span>
                  )}
                </p>
                <p className="mt-1.5 text-sm leading-relaxed text-fg/85">{f.delivery}</p>
              </div>
            )}
            <div className="rounded-xl border border-brand/25 bg-brand/[0.04] p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="flex items-center gap-1.5 text-xs font-semibold text-brand">
                  <MessageSquareQuote size={13} /> A stronger answer
                </p>
                <button onClick={copy} className="btn btn-ghost !px-2 !py-1 text-xs">
                  <Copy size={12} /> Copy
                </button>
              </div>
              <p className="mt-1.5 text-sm leading-relaxed whitespace-pre-wrap text-fg/90">{f.betterAnswer}</p>
            </div>
          </div>
          <aside className="space-y-4">
            <ScoreBars scores={f.scores} compact />
            <div>
              <p className="eyebrow mb-1.5">What they look for</p>
              <p className="text-xs leading-relaxed text-muted">{q.lookingFor}</p>
            </div>
          </aside>
        </div>
      )}
    </article>
  );
}
