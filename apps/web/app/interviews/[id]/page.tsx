'use client';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import {
  ArrowLeft, BriefcaseBusiness, CalendarClock, ClipboardPaste, Copy, FileText, Lock, MessageSquareText, MoreHorizontal,
  Plus, Radio, Sparkles, Trash2, Wand2,
} from 'lucide-react';
import {
  FIELDS, FIELD_EXAMPLES, INSTRUCTION_IDEAS, INTERVIEW_STAGES, PROFILE_LIMITS, ROUND_TYPES, type InterviewDetail,
  type Interview, type InterviewStage, type Resume, type RoundType,
} from '@parakeet/shared';
import { ApiError, api } from '@/lib/api';
import { useRequireSession } from '@/lib/useSession';
import {
  MIN_USEFUL_JD, STAGE_TONE, formatWhen, fromLocalInput, interviewTitle, readiness, relative, roundsFor, toLocalInput,
} from '@/lib/interviews';
import { AppShell } from '@/components/AppShell';
import { LogoMark } from '@/components/Logo';
import { Spinner } from '@/components/ui';
import { ConfirmDialog, Menu, Toaster, toast } from '@/components/overlay';
import { ActiveBadge, Monogram, ReadinessList, ReadinessRing } from '@/components/interviews/parts';

interface Draft {
  field: string;
  company: string;
  role: string;
  roundType: RoundType;
  jobDescription: string;
  instructions: string;
  stage: InterviewStage;
  scheduledAt: string | null;
  notes: string;
}

const EMPTY: Draft = {
  field: '', company: '', role: '', roundType: 'general', jobDescription: '', instructions: '', stage: 'preparing',
  scheduledAt: null, notes: '',
};

const toDraft = (i: Interview): Draft => ({
  field: i.field, company: i.company, role: i.role, roundType: i.roundType, jobDescription: i.jobDescription,
  instructions: i.instructions, stage: i.stage, scheduledAt: i.scheduledAt, notes: i.notes,
});

const errorText = (e: unknown) => (e instanceof ApiError ? e.message : 'Something went wrong. Try again.');

export default function InterviewEditorPage() {
  return (
    <Suspense>
      <Editor />
    </Suspense>
  );
}

function Editor() {
  const email = useRequireSession();
  const router = useRouter();
  const params = useSearchParams();
  const { id } = useParams<{ id: string }>();
  const isNew = id === 'new';

  const [detail, setDetail] = useState<InterviewDetail | null>(null);
  const [resume, setResume] = useState<Resume | null | undefined>(undefined);
  const [saved, setSaved] = useState<Draft | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState<'delete' | 'leave' | null>(null);
  const [now] = useState(() => Date.now());

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const dirty = saved !== null && JSON.stringify(saved) !== JSON.stringify(draft);
  const { score, items } = useMemo(() => readiness(draft, resume), [draft, resume]);

  useEffect(() => {
    if (!email) return;
    api<{ resume: Resume | null }>('/v1/resume').then((r) => setResume(r.resume), () => setResume(null));
    if (isNew) {
      const round = ROUND_TYPES.find((r) => r.id === params.get('round'))?.id ?? 'general';
      const start = { ...EMPTY, roundType: round };
      setSaved(start);
      setDraft(start);
      return;
    }
    api<{ interview: InterviewDetail }>(`/v1/interviews/${id}`).then(
      ({ interview }) => {
        setDetail(interview);
        setSaved(toDraft(interview));
        setDraft(toDraft(interview));
        if (params.get('copied')) {
          toast('Copy created and made active. Update the round and date for the next stage.');
          router.replace(`/interviews/${id}`, { scroll: false });
        }
      },
      (e) => setLoadError(e instanceof ApiError && e.status === 404 ? 'not_found' : errorText(e)),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [email, id]);

  // Jump to the section named in the URL (e.g. from the readiness checklist on the list page).
  useEffect(() => {
    if (saved && location.hash) focusSection(location.hash.slice(1));
  }, [saved]);

  const save = useCallback(async () => {
    if (!saved || saving) return;
    setSaving(true);
    try {
      if (isNew) {
        const r = await api<{ interview: InterviewDetail }>('/v1/interviews', { method: 'POST', body: JSON.stringify(draft) });
        setSaved(draft);
        toast('Interview created. It is now your active interview.');
        router.replace(`/interviews/${r.interview.id}`);
      } else {
        const changes = Object.fromEntries(
          Object.entries(draft).filter(([k, v]) => v !== saved[k as keyof Draft]),
        );
        const r = await api<{ interview: Interview }>(`/v1/interviews/${id}`, {
          method: 'PATCH',
          body: JSON.stringify(changes),
        });
        // Take the server's copy (it trims text), unless the user kept typing while it saved.
        const stored = toDraft(r.interview);
        setSaved(stored);
        setDraft((d) => (d === draft ? stored : d));
        setDetail((d) => (d ? { ...d, ...r.interview } : d));
        toast('Changes saved.');
      }
    } catch (e) {
      toast(errorText(e), { tone: 'bad' });
    } finally {
      setSaving(false);
    }
  }, [draft, id, isNew, router, saved, saving]);

  // ⌘/Ctrl+S saves.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (dirty || isNew) save();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [dirty, isNew, save]);

  // Warn before closing the tab with unsaved changes.
  useEffect(() => {
    if (!dirty) return;
    const onUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, [dirty]);

  const activate = async () => {
    try {
      await api(`/v1/interviews/${id}/activate`, { method: 'POST' });
      setDetail((d) => (d ? { ...d, active: true } : d));
      toast('Now active. Your next live answer uses this interview.');
    } catch (e) {
      toast(errorText(e), { tone: 'bad' });
    }
  };

  const duplicate = async () => {
    try {
      const r = await api<{ interview: InterviewDetail }>(`/v1/interviews/${id}/duplicate`, { method: 'POST' });
      router.push(`/interviews/${r.interview.id}?copied=1`);
    } catch (e) {
      toast(errorText(e), { tone: 'bad' });
    }
  };

  const remove = async () => {
    setSaving(true);
    try {
      await api(`/v1/interviews/${id}`, { method: 'DELETE' });
      setSaved(draft); // nothing left to lose
      router.replace('/interviews');
    } catch (e) {
      toast(errorText(e), { tone: 'bad' });
      setSaving(false);
      setConfirm(null);
    }
  };

  const back = () => (dirty ? setConfirm('leave') : router.push('/interviews'));

  if (!email) {
    return (
      <div className="grid min-h-screen place-items-center">
        <LogoMark size={40} />
      </div>
    );
  }

  if (loadError) {
    return (
      <AppShell email={email}>
        <div className="mx-auto grid max-w-md place-items-center px-4 py-24 text-center">
          <p className="text-lg font-semibold">{loadError === 'not_found' ? 'Interview not found' : 'Couldn’t load this interview'}</p>
          <p className="mt-1 text-sm text-muted">
            {loadError === 'not_found' ? 'It may have been deleted.' : loadError}
          </p>
          <Link href="/interviews" className="btn btn-secondary mt-6">
            <ArrowLeft size={15} /> All interviews
          </Link>
        </div>
      </AppShell>
    );
  }

  const title = isNew ? 'New interview' : saved ? interviewTitle(draft) : '';
  const example = FIELD_EXAMPLES[draft.field];

  return (
    <AppShell email={email}>
      {/* sticky action bar (below the mobile top bar) */}
      <div className="sticky top-[57px] z-20 border-b border-line bg-bg/80 backdrop-blur-xl md:top-0">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3 sm:px-8">
          <button onClick={back} className="btn btn-ghost !p-2" aria-label="Back to interviews">
            <ArrowLeft size={18} />
          </button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{title || <span className="inline-block h-3.5 w-40 animate-pulse rounded bg-white/5" />}</p>
            <p className="text-xs text-muted" aria-live="polite">
              {saving ? 'Saving…' : isNew ? 'Not saved yet' : dirty ? 'Unsaved changes' : detail ? `Saved ${relative(detail.updatedAt, Math.max(Date.now(), Date.parse(detail.updatedAt)))}` : ''}
            </p>
          </div>
          {!isNew && detail && (
            <Menu
              label="More actions"
              trigger={<MoreHorizontal size={18} />}
              items={[
                { label: detail.active ? 'Active interview' : 'Make active', icon: Radio, onSelect: activate, disabled: detail.active },
                { label: 'Duplicate for next round', icon: Copy, onSelect: duplicate },
                'divider',
                { label: 'Delete', icon: Trash2, onSelect: () => setConfirm('delete'), danger: true },
              ]}
            />
          )}
          {dirty && !isNew && (
            <button onClick={() => saved && setDraft(saved)} className="btn btn-ghost hidden !py-2 sm:inline-flex">
              Discard
            </button>
          )}
          <button onClick={save} disabled={!saved || saving || (!isNew && !dirty)} className="btn btn-primary !py-2">
            {saving && <Spinner className="!size-3.5" />}
            {isNew ? 'Create interview' : 'Save'}
            <kbd className="hidden rounded border border-black/20 px-1 text-[10px] opacity-60 lg:inline">⌘S</kbd>
          </button>
        </div>
      </div>

      {!saved ? (
        <div className="grid place-items-center py-32">
          <Spinner className="text-muted" />
        </div>
      ) : (
        <div className="mx-auto grid max-w-6xl gap-6 px-4 py-8 sm:px-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="space-y-6">
            {/* hero */}
            <div className="flex items-center gap-4 animate-fade-up">
              <Monogram name={draft.company || draft.role || draft.field || '+'} size={56} />
              <div className="min-w-0">
                <h1 className="truncate text-2xl font-semibold tracking-tight">
                  {isNew && !draft.role && !draft.company ? 'New interview' : interviewTitle(draft)}
                </h1>
                <p className="truncate text-sm text-muted">
                  {isNew
                    ? 'The more Friday knows, the more your answers sound like you, for this exact role.'
                    : [draft.role && draft.company, ROUND_TYPES.find((r) => r.id === draft.roundType)?.label].filter(Boolean).join(' · ')}
                </p>
              </div>
            </div>

            <Section id="role" step={1} icon={BriefcaseBusiness} title="The role" text="Who you're interviewing with, and for what.">
              <FieldPicker value={draft.field} onChange={(v) => set('field', v)} />
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <Labeled label="Organisation">
                  <input
                    value={draft.company}
                    onChange={(e) => set('company', e.target.value)}
                    maxLength={PROFILE_LIMITS.maxCompanyChars}
                    placeholder={example ? `e.g. ${example[0]}` : 'Company, school, hospital…'}
                    className="input"
                  />
                </Labeled>
                <Labeled label="Role">
                  <input
                    value={draft.role}
                    onChange={(e) => set('role', e.target.value)}
                    maxLength={PROFILE_LIMITS.maxRoleChars}
                    placeholder={example ? `e.g. ${example[1]}` : 'Position you applied for'}
                    className="input"
                  />
                </Labeled>
              </div>
            </Section>

            <Section id="round" step={2} icon={Radio} title="Round" text="Answers are shaped differently for each kind of round.">
              <div role="radiogroup" aria-label="Interview round" className="grid gap-2 sm:grid-cols-2">
                {roundsFor(draft.field, draft.roundType).map((r) => {
                  const on = draft.roundType === r.id;
                  return (
                    <button
                      key={r.id}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      onClick={() => set('roundType', r.id)}
                      className={`flex items-start gap-3 rounded-xl border p-3 text-left transition ${
                        on ? 'border-brand/50 bg-brand/[0.07] shadow-[0_0_0_3px_rgb(52_211_153/0.08)]' : 'border-line hover:border-line-strong hover:bg-white/[0.03]'
                      }`}
                    >
                      <span className={`mt-0.5 grid size-4 shrink-0 place-items-center rounded-full ring-1 ${on ? 'ring-brand' : 'ring-line-strong'}`}>
                        {on && <span className="size-2 rounded-full bg-brand" />}
                      </span>
                      <span>
                        <span className="block text-sm font-medium">{r.label}</span>
                        <span className="block text-xs text-muted">{r.hint}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </Section>

            <Section
              id="jd"
              step={3}
              icon={FileText}
              title="Job description"
              text="Paste the full posting. Friday matches answers to what they're hiring for."
            >
              <JobDescription value={draft.jobDescription} onChange={(v) => set('jobDescription', v)} />
            </Section>

            <Section id="style" step={4} icon={Wand2} title="Answer style" text="How answers should sound. Friday follows this on every answer.">
              <AnswerStyle value={draft.instructions} onChange={(v) => set('instructions', v)} />
            </Section>

            <Section id="schedule" step={5} icon={CalendarClock} title="Date and status" text="Keep track of where you are with this interview.">
              <div className="grid gap-4 sm:grid-cols-[minmax(0,16rem)_1fr]">
                <Labeled label="Interview date and time">
                  <input
                    type="datetime-local"
                    value={toLocalInput(draft.scheduledAt)}
                    onChange={(e) => set('scheduledAt', fromLocalInput(e.target.value))}
                    className="input [color-scheme:dark]"
                  />
                  {draft.scheduledAt && (
                    <p className="mt-1.5 text-xs text-muted">
                      {formatWhen(draft.scheduledAt)} · <span className="text-brand">{relative(draft.scheduledAt, now)}</span>
                      <button type="button" onClick={() => set('scheduledAt', null)} className="ml-2 text-faint underline-offset-2 hover:text-fg hover:underline">
                        Clear
                      </button>
                    </p>
                  )}
                </Labeled>
                <div>
                  <span className="mb-1.5 block text-xs font-medium text-muted">Status</span>
                  <div role="radiogroup" aria-label="Status" className="flex flex-wrap gap-1.5">
                    {INTERVIEW_STAGES.map((s) => {
                      const on = draft.stage === s.id;
                      return (
                        <button
                          key={s.id}
                          type="button"
                          role="radio"
                          aria-checked={on}
                          onClick={() => set('stage', s.id)}
                          className={`rounded-full px-3 py-1.5 text-xs font-medium ring-1 transition ${
                            on ? STAGE_TONE[s.id] : 'text-muted ring-line hover:bg-white/5 hover:text-fg'
                          }`}
                        >
                          {s.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </Section>

            <Section id="notes" step={6} icon={Lock} title="Private notes" text="Only you see these. They are never sent to the AI.">
              <textarea
                value={draft.notes}
                onChange={(e) => set('notes', e.target.value)}
                maxLength={PROFILE_LIMITS.maxNotesChars}
                rows={5}
                placeholder={'Interviewer names, questions to ask them, salary expectations, follow-ups…'}
                className="input resize-y leading-relaxed"
              />
            </Section>

            {isNew && (
              <div className="flex justify-end">
                <button onClick={save} disabled={saving} className="btn btn-primary">
                  {saving ? <Spinner className="!size-3.5" /> : <Plus size={16} />} Create interview
                </button>
              </div>
            )}
          </div>

          {/* sidebar */}
          <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
            <div className="glass rounded-[var(--radius-card)] p-5 animate-fade-up">
              <div className="flex items-center gap-4">
                <ReadinessRing score={score} size={68} stroke={6} />
                <div>
                  <p className="text-sm font-semibold">{score === 100 ? 'Fully prepared' : score >= 70 ? 'Almost there' : 'Readiness'}</p>
                  <p className="mt-0.5 text-xs text-muted">How tailored your live answers will be.</p>
                </div>
              </div>
              <div className="-mx-2 mt-4">
                <ReadinessList
                  items={items}
                  onFix={(key) => (key === 'resume' ? router.push('/resume') : focusSection(key === 'field' ? 'role' : key))}
                />
              </div>
              {!items[0].done && (
                <p className="mt-3 rounded-lg bg-white/[0.03] px-3 py-2 text-xs text-muted">
                  <Link href="/resume" className="text-brand hover:underline">Upload your resume</Link>. It is shared by all your interviews.
                </p>
              )}
            </div>

            {!isNew && detail && (
              <div className="glass rounded-[var(--radius-card)] p-5 animate-fade-up [animation-delay:60ms]">
                {detail.active ? (
                  <>
                    <ActiveBadge />
                    <p className="mt-2 text-xs text-muted">The desktop app answers using this interview. Saved changes apply to the very next answer.</p>
                  </>
                ) : (
                  <>
                    <p className="text-sm font-semibold">Not active</p>
                    <p className="mt-0.5 text-xs text-muted">Live answers use another interview right now.</p>
                    <button onClick={activate} className="btn btn-secondary mt-3 w-full !py-2">
                      <Radio size={15} /> Make active
                    </button>
                  </>
                )}
              </div>
            )}

            {!isNew && detail && <Activity detail={detail} now={now} />}
          </aside>
        </div>
      )}

      <ConfirmDialog
        open={confirm === 'delete'}
        title="Delete this interview?"
        text="Its job description, answer style and notes will be removed. Past questions stay in your history."
        confirmLabel={saving ? 'Deleting…' : 'Delete'}
        danger
        busy={saving}
        onConfirm={remove}
        onCancel={() => setConfirm(null)}
      />
      <ConfirmDialog
        open={confirm === 'leave'}
        title="Discard unsaved changes?"
        text="You've made changes that aren't saved yet."
        confirmLabel="Discard"
        danger
        onConfirm={() => {
          setConfirm(null);
          setSaved(draft);
          router.push('/interviews');
        }}
        onCancel={() => setConfirm(null)}
      />
      <Toaster />
    </AppShell>
  );
}

/** Scrolls to a form section and puts the cursor in its first field. */
function focusSection(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el.querySelector<HTMLElement>('input, textarea')?.focus({ preventScroll: true });
  el.animate([{ boxShadow: '0 0 0 2px rgb(52 211 153 / 0.5)' }, { boxShadow: '0 0 0 2px transparent' }], { duration: 1400, easing: 'ease-out' });
}

// ---- building blocks -----------------------------------------------------------------------------

function Section({
  id,
  step,
  icon: Icon,
  title,
  text,
  children,
}: {
  id: string;
  step: number;
  icon: typeof FileText;
  title: string;
  text: string;
  children: React.ReactNode;
}) {
  return (
    <section
      id={id}
      className="glass scroll-mt-28 rounded-[var(--radius-card)] p-5 sm:p-6 animate-fade-up"
      style={{ animationDelay: `${step * 40}ms` }}
    >
      <header className="mb-5 flex items-start gap-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-white/5 text-brand ring-1 ring-line">
          <Icon size={16} />
        </span>
        <div>
          <h2 className="text-sm font-semibold">
            <span className="mr-1.5 text-faint tabular-nums">{step}.</span>
            {title}
          </h2>
          <p className="mt-0.5 text-xs text-muted">{text}</p>
        </div>
      </header>
      {children}
    </section>
  );
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-muted">{label}</span>
      {children}
    </label>
  );
}

const QUICK_FIELDS = 8;

function FieldPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const at = (FIELDS as readonly string[]).indexOf(value);
  const [more, setMore] = useState(at >= QUICK_FIELDS);
  const shown = more ? FIELDS : FIELDS.slice(0, QUICK_FIELDS);
  return (
    <div>
      <Labeled label="Field or department">
        <input
          value={value}
          maxLength={PROFILE_LIMITS.maxFieldChars}
          onChange={(e) => onChange(e.target.value)}
          className="input"
          placeholder="e.g. Teaching, Finance, Nursing, Aviation…"
        />
      </Labeled>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {shown.map((f) => {
          const on = value === f;
          return (
            <button
              key={f}
              type="button"
              onClick={() => onChange(on ? '' : f)}
              aria-pressed={on}
              className={`rounded-full px-2.5 py-1 text-xs ring-1 transition ${
                on ? 'bg-brand/15 text-brand ring-brand/40' : 'text-muted ring-line hover:bg-white/5 hover:text-fg'
              }`}
            >
              {f}
            </button>
          );
        })}
        <button type="button" onClick={() => setMore((m) => !m)} className="rounded-full px-2.5 py-1 text-xs text-brand hover:bg-brand/10">
          {more ? 'Fewer' : `+${FIELDS.length - QUICK_FIELDS} more`}
        </button>
      </div>
    </div>
  );
}

function JobDescription({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const max = PROFILE_LIMITS.maxJobDescriptionChars;
  const words = value.trim() ? value.trim().split(/\s+/).length : 0;
  const ref = useRef<HTMLTextAreaElement>(null);
  const paste = async () => {
    try {
      const text = (await navigator.clipboard.readText()).trim();
      if (!text) return toast('Your clipboard is empty.', { tone: 'bad' });
      onChange(text.slice(0, max));
      ref.current?.focus();
    } catch {
      toast('Your browser blocked reading the clipboard. Paste with Ctrl+V instead.', { tone: 'bad' });
    }
  };
  const short = value.trim().length > 0 && value.trim().length < MIN_USEFUL_JD;
  return (
    <div>
      <div className="relative">
        <textarea
          ref={ref}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          maxLength={max}
          rows={value ? 12 : 7}
          placeholder="Paste the job posting: responsibilities, required qualifications and skills, nice-to-haves…"
          className="input resize-y font-[inherit] text-sm leading-relaxed"
        />
        {!value && (
          <button type="button" onClick={paste} className="btn btn-secondary absolute right-3 bottom-3 !px-3 !py-1.5 text-xs">
            <ClipboardPaste size={14} /> Paste from clipboard
          </button>
        )}
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className={short ? 'text-warn' : 'text-faint'}>
          {short ? 'Looks short. The full posting gives much better answers.' : value ? `${words.toLocaleString()} words` : 'Optional, but the biggest boost to answer quality.'}
        </span>
        <span className="flex items-center gap-3 text-faint tabular-nums">
          {value && (
            <button type="button" onClick={() => onChange('')} className="hover:text-fg">
              Clear
            </button>
          )}
          {value.length.toLocaleString()} / {max.toLocaleString()}
        </span>
      </div>
    </div>
  );
}

function AnswerStyle({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const max = PROFILE_LIMITS.maxInstructionsChars;
  const lines = value.split('\n').map((l) => l.trim());
  const ideas = INSTRUCTION_IDEAS.filter((idea) => !lines.includes(idea));
  const add = (idea: string) => {
    const next = value.trim() ? `${value.trimEnd()}\n${idea}` : idea;
    if (next.length <= max) onChange(next);
  };
  return (
    <div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        maxLength={max}
        rows={4}
        placeholder={'e.g. Keep it short and simple.\nGive a one-line definition first, then a real example.'}
        className="input resize-y text-sm leading-relaxed"
      />
      <div className="mt-1.5 flex justify-end text-xs text-faint tabular-nums">
        {value.length} / {max}
      </div>
      {ideas.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1.5">
          <span className="mr-1 flex items-center gap-1 text-xs text-faint">
            <Sparkles size={12} /> Ideas
          </span>
          {ideas.map((idea) => (
            <button
              key={idea}
              type="button"
              onClick={() => add(idea)}
              className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs text-muted ring-1 ring-line transition hover:bg-white/5 hover:text-fg"
            >
              <Plus size={11} /> {idea}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const SHOWN_QUESTIONS = 5;

function Activity({ detail, now }: { detail: InterviewDetail; now: number }) {
  const [all, setAll] = useState(false);
  const { stats, recentQuestions: questions } = detail;
  const shown = all ? questions : questions.slice(0, SHOWN_QUESTIONS);
  return (
    <div className="glass rounded-[var(--radius-card)] p-5 animate-fade-up [animation-delay:120ms]">
      <p className="flex items-center gap-2 text-sm font-semibold">
        <MessageSquareText size={15} className="text-brand" /> Activity
      </p>
      <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
        {[
          ['Questions', stats.questions],
          ['Sessions', stats.sessions],
          ['Last used', stats.lastUsedAt ? relative(stats.lastUsedAt, now, 'narrow') : '—'],
        ].map(([label, v]) => (
          <div key={label} className="rounded-lg bg-white/[0.03] px-1 py-2">
            <dd className="truncate text-sm font-semibold tabular-nums">{v}</dd>
            <dt className="text-[11px] text-faint">{label}</dt>
          </div>
        ))}
      </dl>
      {questions.length > 0 ? (
        <>
          <p className="eyebrow mt-5">Recent questions</p>
          <ul className="mt-2 space-y-1">
            {shown.map((q, n) => (
              <li key={n} className="rounded-lg px-2 py-1.5 hover:bg-white/[0.03]">
                <p className="line-clamp-2 text-sm">{q.question}</p>
                <p className="text-[11px] text-faint">{relative(q.createdAt, now)}</p>
              </li>
            ))}
          </ul>
          {questions.length > SHOWN_QUESTIONS && (
            <button onClick={() => setAll((a) => !a)} className="mt-1 px-2 text-xs text-brand hover:underline">
              {all ? 'Show fewer' : `Show all ${questions.length}`}
            </button>
          )}
        </>
      ) : (
        <p className="mt-4 text-xs text-muted">
          Questions you&apos;re asked while this interview is active will show up here.
        </p>
      )}
    </div>
  );
}
