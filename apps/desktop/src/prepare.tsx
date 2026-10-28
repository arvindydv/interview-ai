import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertCircle, ArrowRight, Award, Briefcase, Building2, Check, ChevronDown, FileText, FileUp, FolderGit2, GraduationCap, Info,
  MessageSquareText, Plus, RefreshCw, Sparkles, Star, Trash2, UserRound,
} from 'lucide-react';
import {
  FIELDS, FIELD_EXAMPLES, INSTRUCTION_IDEAS, PROFILE_LIMITS, ROUND_TYPES, SOFTWARE_FIELDS, type InterviewInput, type Resume,
  type ResumeProfile,
} from '@parakeet/shared';
import { Panel, Spinner } from './ui';
import { RESUME_ACCEPT, type ContextStrength, type InterviewContextState } from './useInterviewContext';

const rise = (i: number) => ({ '--i': i }) as React.CSSProperties;
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

// ---- context strength -----------------------------------------------------------------------------

export function ContextMeter({ ctx }: { ctx: InterviewContextState }) {
  const items = [
    { label: 'Resume', short: 'resume', done: ctx.hasResume },
    { label: 'Role & organisation', short: 'role', done: ctx.hasTarget },
    { label: 'Job description', short: 'job description', done: ctx.hasJobDescription },
  ];
  const label: Record<ContextStrength, string> = {
    none: 'No context yet',
    basic: 'Basic context',
    strong: 'Strong context',
  };
  const done = items.filter((it) => it.done).length;
  return (
    <div className="w-56 shrink-0" title={items.map((it) => `${it.done ? '✓' : '·'} ${it.label}`).join('\n')}>
      <div className="flex items-baseline justify-between text-xs">
        <span className="font-medium">{label[ctx.strength]}</span>
        <span className="text-muted tabular-nums">{done} of 3</span>
      </div>
      <div className="mt-2 flex gap-1">
        {items.map((it) => (
          <span
            key={it.label}
            className={`h-1 flex-1 rounded-full transition-colors duration-500 ${it.done ? 'bg-brand-gradient' : 'bg-white/10'}`}
          />
        ))}
      </div>
      <p className="mt-1.5 truncate text-[11px] text-faint">
        {done === 3 ? 'Answers use all of it' : `Missing: ${items.filter((it) => !it.done).map((it) => it.short).join(', ')}`}
      </p>
    </div>
  );
}

// ---- resume ---------------------------------------------------------------------------------------

function Dropzone({ onFile, busy }: { onFile: (f: File) => void; busy: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => input.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const f = e.dataTransfer.files[0];
        if (f) onFile(f);
      }}
      className={`group flex w-full flex-col items-center justify-center rounded-xl border border-dashed px-6 py-10 text-center transition ${
        over ? 'border-brand bg-brand/[0.05]' : 'border-line-strong hover:border-brand/40 hover:bg-white/[0.02]'
      }`}
    >
      <span
        className={`grid size-11 place-items-center rounded-xl bg-white/[0.04] text-muted ring-1 ring-line transition group-hover:text-brand ${
          over ? 'scale-110 text-brand' : ''
        }`}
      >
        {busy ? <Spinner /> : <FileUp size={20} />}
      </span>
      <span className="mt-4 text-sm font-semibold">{busy ? 'Reading your resume…' : 'Drop your resume here'}</span>
      <span className="mt-1 text-xs text-muted">
        or <span className="text-brand">browse files</span> · PDF, DOCX or TXT, up to 5 MB
      </span>
      <input
        ref={input}
        type="file"
        accept={RESUME_ACCEPT}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) onFile(f);
        }}
      />
    </button>
  );
}

function Section({ icon: Icon, title, children }: { icon: typeof Star; title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-muted">
        <Icon size={13} /> {title}
      </p>
      {children}
    </div>
  );
}

function ProfileView({ profile }: { profile: ResumeProfile }) {
  const [allSkills, setAllSkills] = useState(false);
  const [openStory, setOpenStory] = useState<number | null>(null);
  const skills = allSkills ? profile.skills : profile.skills.slice(0, 14);

  return (
    <div className="space-y-5">
      {(profile.name || profile.headline) && (
        <div className="flex items-center gap-3">
          <span className="bg-brand-gradient grid size-10 shrink-0 place-items-center rounded-full text-sm font-semibold text-bg uppercase">
            {(profile.name ?? '?')[0]}
          </span>
          <div className="min-w-0">
            {profile.name && <p className="truncate font-semibold">{profile.name}</p>}
            {profile.headline && <p className="truncate text-sm text-muted">{profile.headline}</p>}
          </div>
        </div>
      )}
      {profile.summary && (
        <p className="rounded-xl border-l-2 border-brand/60 bg-white/[0.02] py-2 pr-3 pl-3.5 text-sm leading-relaxed text-fg/85">
          {profile.summary}
        </p>
      )}

      {profile.skills.length > 0 && (
        <Section icon={Sparkles} title={`Skills (${profile.skills.length})`}>
          <div className="flex flex-wrap gap-1.5">
            {skills.map((s) => (
              <span key={s.name} className="rounded-full bg-white/[0.04] px-2.5 py-1 text-xs ring-1 ring-line">
                {s.name}
                {s.years ? <span className="ml-1 text-faint">{s.years}y</span> : null}
              </span>
            ))}
            {profile.skills.length > 14 && (
              <button onClick={() => setAllSkills((v) => !v)} className="rounded-full px-2.5 py-1 text-xs text-brand hover:bg-brand/10">
                {allSkills ? 'Show less' : `+${profile.skills.length - 14} more`}
              </button>
            )}
          </div>
        </Section>
      )}

      {profile.experience.length > 0 && (
        <Section icon={Briefcase} title="Experience">
          <ol className="relative space-y-3 border-l border-line pl-4">
            {profile.experience.slice(0, 5).map((e, i) => (
              <li key={i} className="relative">
                <span className="absolute top-1.5 -left-[21px] size-2 rounded-full bg-brand ring-4 ring-surface" />
                <p className="text-sm font-medium">
                  {e.title} <span className="text-muted">· {e.company}</span>
                </p>
                {e.period && <p className="text-xs text-faint">{e.period}</p>}
              </li>
            ))}
          </ol>
        </Section>
      )}

      {profile.projects.length > 0 && (
        <Section icon={FolderGit2} title="Projects & key work">
          <div className="grid gap-2">
            {profile.projects.slice(0, 4).map((pr) => (
              <div key={pr.name} className="rounded-xl bg-white/[0.02] p-3 ring-1 ring-line">
                <p className="text-sm font-medium">{pr.name}</p>
                <p className="mt-0.5 line-clamp-2 text-xs text-muted">{pr.impact ?? pr.summary}</p>
                {pr.tech.length > 0 && (
                  <p className="mt-1.5 flex flex-wrap gap-1">
                    {pr.tech.slice(0, 6).map((t) => (
                      <span key={t} className="rounded-md bg-accent/10 px-1.5 py-0.5 text-[10.5px] text-accent">
                        {t}
                      </span>
                    ))}
                  </p>
                )}
              </div>
            ))}
          </div>
        </Section>
      )}

      {profile.stories.length > 0 && (
        <Section icon={Star} title={`${profile.stories.length} STAR stories ready for behavioral questions`}>
          <div className="divide-y divide-line rounded-xl ring-1 ring-line">
            {profile.stories.map((s, i) => (
              <div key={i}>
                <button
                  onClick={() => setOpenStory(openStory === i ? null : i)}
                  className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm hover:bg-white/[0.02]"
                >
                  <span className="flex-1">{s.title}</span>
                  <ChevronDown size={14} className={`shrink-0 text-muted transition ${openStory === i ? 'rotate-180' : ''}`} />
                </button>
                {openStory === i && (
                  <dl className="pop-in space-y-1.5 px-3 pb-3 text-xs leading-relaxed">
                    {(['situation', 'action', 'result'] as const).map((k) => (
                      <div key={k} className="flex gap-2">
                        <dt className="w-16 shrink-0 font-medium text-brand capitalize">{k}</dt>
                        <dd className="text-muted">{s[k]}</dd>
                      </div>
                    ))}
                  </dl>
                )}
              </div>
            ))}
          </div>
        </Section>
      )}

      {(profile.certifications?.length ?? 0) > 0 && (
        <Section icon={Award} title="Certifications">
          <div className="flex flex-wrap gap-1.5">
            {profile.certifications.map((c) => (
              <span key={c} className="rounded-full bg-brand/10 px-2.5 py-1 text-xs text-brand ring-1 ring-brand/20">
                {c}
              </span>
            ))}
          </div>
        </Section>
      )}

      {profile.education.length > 0 && (
        <Section icon={GraduationCap} title="Education">
          <p className="text-sm text-muted">
            {profile.education.map((e) => [e.degree, e.school, e.year].filter(Boolean).join(', ')).join(' · ')}
          </p>
        </Section>
      )}
    </div>
  );
}

function AnalysingSkeleton() {
  return (
    <div className="space-y-4" aria-live="polite">
      <div className="flex items-center gap-2.5 rounded-xl bg-brand/[0.06] px-3 py-2.5 text-sm text-brand ring-1 ring-brand/20">
        <Spinner className="!size-3.5" /> Analysing your experience, projects and skills…
      </div>
      <div className="space-y-2.5">
        {['w-2/5', 'w-full', 'w-4/5'].map((w) => (
          <div key={w} className={`shimmer h-3 rounded-full ${w}`} />
        ))}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {[16, 20, 12, 24, 14, 18].map((w, i) => (
          <div key={i} className="shimmer h-6 rounded-full" style={{ width: `${w * 4}px` }} />
        ))}
      </div>
      <p className="text-xs text-faint">This takes about 20 seconds. Friday AI already uses your resume text in the meantime.</p>
    </div>
  );
}

function ResumeCard({ ctx, style }: { ctx: InterviewContextState; style?: React.CSSProperties }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const replaceInput = useRef<HTMLInputElement>(null);
  const resume: Resume | null = ctx.resume;

  const onFile = async (f: File) => {
    setBusy(true);
    setError(null);
    try {
      await ctx.upload(f);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel
      title="Your resume"
      icon={UserRound}
      className="rise-in"
      style={style}
      action={
        resume && (
          <div className="flex items-center gap-1">
            <button onClick={() => replaceInput.current?.click()} disabled={busy} className="btn btn-ghost !px-2 !py-1 text-xs">
              {busy ? <Spinner className="!size-3" /> : <RefreshCw size={12} />} Replace
            </button>
            <input
              ref={replaceInput}
              type="file"
              accept={RESUME_ACCEPT}
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f) onFile(f);
              }}
            />
          </div>
        )
      }
    >
      <p className="-mt-1 mb-4 text-sm text-muted">
        Friday AI answers in your voice, using real examples from your experience, achievements and qualifications.
      </p>

      {!resume ? (
        <Dropzone onFile={onFile} busy={busy} />
      ) : (
        <div className="space-y-5">
          <div className="flex items-center gap-3 rounded-xl bg-white/[0.03] px-3 py-2.5 ring-1 ring-line">
            <FileText size={18} className="shrink-0 text-brand-2" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{resume.fileName}</p>
              <p className="text-xs text-faint">
                {resume.charCount.toLocaleString()} characters ·{' '}
                {resume.status === 'parsing' ? 'analysing…' : resume.profile ? 'analysed' : 'used as text'}
              </p>
            </div>
            {confirmRemove ? (
              <span className="pop-in flex items-center gap-1">
                <button
                  onClick={() => ctx.remove().catch((e) => setError(errorText(e))).finally(() => setConfirmRemove(false))}
                  className="btn !bg-danger/15 !px-2 !py-1 text-xs !text-danger"
                >
                  Remove
                </button>
                <button onClick={() => setConfirmRemove(false)} className="btn btn-ghost !px-2 !py-1 text-xs">
                  Cancel
                </button>
              </span>
            ) : (
              <button onClick={() => setConfirmRemove(true)} className="btn btn-ghost !p-1.5" title="Remove resume">
                <Trash2 size={14} />
              </button>
            )}
          </div>

          {resume.status === 'parsing' ? (
            <AnalysingSkeleton />
          ) : resume.profile ? (
            <ProfileView profile={resume.profile} />
          ) : (
            <p className="flex gap-2 rounded-xl bg-white/[0.02] p-3 text-xs leading-relaxed text-muted ring-1 ring-line">
              <Info size={14} className="mt-0.5 shrink-0 text-brand-2" />
              <span>
                Friday AI will use the full text of your resume for answers.
                {resume.error && <span className="text-faint"> {resume.error}</span>}
              </span>
            </p>
          )}
        </div>
      )}

      {error && (
        <p className="mt-3 flex items-start gap-2 rounded-lg border border-danger/25 bg-danger/10 px-3 py-2 text-sm text-danger">
          <AlertCircle size={15} className="mt-0.5 shrink-0" /> {error}
        </p>
      )}
    </Panel>
  );
}

// ---- interview ------------------------------------------------------------------------------------

const EMPTY: InterviewInput = { field: '', company: '', role: '', roundType: 'general', jobDescription: '', instructions: '' };
const pick = (i: InterviewInput): InterviewInput => ({
  field: i.field ?? '',
  company: i.company,
  role: i.role,
  roundType: i.roundType,
  jobDescription: i.jobDescription,
  // Interviews saved before answer instructions existed don't have the key.
  instructions: i.instructions ?? '',
});

const QUICK_FIELDS = 8;

function FieldPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const known = (FIELDS as readonly string[]).includes(value);
  const [more, setMore] = useState(known && FIELDS.indexOf(value as (typeof FIELDS)[number]) >= QUICK_FIELDS);
  const shown = more ? FIELDS : FIELDS.slice(0, QUICK_FIELDS);
  return (
    <div>
      <span className="mb-1.5 block text-xs font-medium text-muted">Field or department</span>
      <input
        value={value}
        maxLength={PROFILE_LIMITS.maxFieldChars}
        onChange={(e) => onChange(e.target.value)}
        className="input"
        placeholder="e.g. Teaching, Finance, Nursing, Aviation…"
      />
      <div className="mt-2 flex flex-wrap gap-1.5">
        {shown.map((f) => {
          const active = value === f;
          return (
            <button
              key={f}
              type="button"
              onClick={() => onChange(active ? '' : f)}
              aria-pressed={active}
              className={`rounded-full px-2.5 py-1 text-xs ring-1 transition ${
                active ? 'bg-brand/15 text-brand ring-brand/40' : 'text-muted ring-line hover:bg-white/5 hover:text-fg'
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

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

/**
 * The interview form's draft. Saves automatically a moment after the user stops typing, and
 * `saveNow` saves straight away (for the Save & continue button).
 */
function useInterviewDraft(ctx: InterviewContextState) {
  const [draft, setDraft] = useState<InterviewInput>(() => (ctx.interview ? pick(ctx.interview) : EMPTY));
  const [state, setState] = useState<SaveState>('idle');
  const [error, setError] = useState<string | null>(null);
  const lastSaved = useRef(JSON.stringify(draft));
  const latest = useRef(draft);
  latest.current = draft;
  const inFlight = useRef<Promise<boolean> | null>(null);
  const { save } = ctx;

  /** Saves the latest draft if it changed. Resolves to false if saving failed. */
  const saveNow = useCallback(async (): Promise<boolean> => {
    // One save at a time; after it finishes, save again only if the draft changed meanwhile.
    if (inFlight.current) await inFlight.current;
    const current = latest.current;
    const json = JSON.stringify(current);
    if (json === lastSaved.current) return true;
    const run = (async () => {
      setState('saving');
      try {
        await save(current);
        lastSaved.current = json;
        setState('saved');
        setError(null);
        return true;
      } catch (e) {
        setState('error');
        setError(errorText(e));
        return false;
      }
    })();
    inFlight.current = run;
    try {
      return await run;
    } finally {
      if (inFlight.current === run) inFlight.current = null;
    }
  }, [save]);

  useEffect(() => {
    if (JSON.stringify(draft) === lastSaved.current) return;
    const id = setTimeout(() => void saveNow(), 700);
    return () => clearTimeout(id);
  }, [draft, saveNow]);

  const set = <K extends keyof InterviewInput>(k: K, v: InterviewInput[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const dirty = JSON.stringify(draft) !== lastSaved.current;
  return { draft, set, state, error, saveNow, dirty };
}

type InterviewDraft = ReturnType<typeof useInterviewDraft>;

function InterviewCard({ form, style }: { form: InterviewDraft; style?: React.CSSProperties }) {
  const { draft, set, error } = form;
  const example = FIELD_EXAMPLES[draft.field];
  // Coding and system design only make sense for software roles (kept if already chosen).
  const software = SOFTWARE_FIELDS.includes(draft.field);
  const rounds = ROUND_TYPES.filter((r) => !r.softwareOnly || software || r.id === draft.roundType);
  const jdLeft = PROFILE_LIMITS.maxJobDescriptionChars - draft.jobDescription.length;

  return (
    <Panel
      title="The interview"
      icon={Building2}
      className="rise-in flex flex-col"
      style={style}
    >
      <p className="-mt-1 mb-4 text-sm text-muted">
        Any job, any field. Answers are tailored to this role, organisation and job description.
      </p>

      <FieldPicker value={draft.field} onChange={(v) => set('field', v)} />

      <div className="mt-4 grid gap-3 @2xl:grid-cols-2">
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-muted">Organisation</span>
          <input
            value={draft.company}
            maxLength={PROFILE_LIMITS.maxCompanyChars}
            onChange={(e) => set('company', e.target.value)}
            className="input"
            placeholder={example ? `e.g. ${example[0]}` : 'Company, school…'}
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-muted">Job title</span>
          <input
            value={draft.role}
            maxLength={PROFILE_LIMITS.maxRoleChars}
            onChange={(e) => set('role', e.target.value)}
            className="input"
            placeholder={example ? `e.g. ${example[1]}` : 'Position applied for'}
          />
        </label>
      </div>

      <div className="mt-4">
        <span className="mb-1.5 block text-xs font-medium text-muted">Interview round</span>
        <div className="flex flex-wrap gap-1.5" role="radiogroup">
          {rounds.map((r) => {
            const active = draft.roundType === r.id;
            return (
              <button
                key={r.id}
                role="radio"
                aria-checked={active}
                title={r.hint}
                onClick={() => set('roundType', r.id)}
                className={`rounded-full px-3 py-1.5 text-xs font-medium ring-1 transition ${
                  active ? 'bg-brand/15 text-brand ring-brand/40' : 'text-muted ring-line hover:bg-white/5 hover:text-fg'
                }`}
              >
                {r.label}
              </button>
            );
          })}
        </div>
        <p className="mt-1.5 text-xs text-faint">{ROUND_TYPES.find((r) => r.id === draft.roundType)?.hint}</p>
      </div>

      <label className="mt-4 flex min-h-0 flex-1 flex-col">
        <span className="mb-1.5 flex items-baseline justify-between text-xs font-medium text-muted">
          Job description
          <span className={`font-normal ${jdLeft < 500 ? 'text-warn' : 'text-faint'}`}>
            {draft.jobDescription ? `${draft.jobDescription.length.toLocaleString()} chars` : 'Paste the full posting'}
          </span>
        </span>
        <textarea
          value={draft.jobDescription}
          maxLength={PROFILE_LIMITS.maxJobDescriptionChars}
          onChange={(e) => set('jobDescription', e.target.value)}
          className="input min-h-56 flex-1 resize-none leading-relaxed"
          placeholder="Paste the job posting: responsibilities, required qualifications and skills, nice-to-haves…"
        />
      </label>
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
    </Panel>
  );
}

// ---- answer instructions -------------------------------------------------------------------------


function InstructionsCard({ form, style }: { form: InterviewDraft; style?: React.CSSProperties }) {
  const { draft, set } = form;
  const value = draft.instructions;
  const lines = value.split('\n').map((l) => l.trim());
  const add = (idea: string) => {
    const next = value.trim() ? `${value.trimEnd()}\n${idea}` : idea;
    if (next.length <= PROFILE_LIMITS.maxInstructionsChars) set('instructions', next);
  };
  const ideas = INSTRUCTION_IDEAS.filter((idea) => !lines.includes(idea));

  return (
    <Panel title="How should Friday answer?" icon={MessageSquareText} className="rise-in" style={style}>
      <p className="-mt-1 mb-3 text-sm text-muted">
        Tell Friday AI how you like your answers: length, tone, structure, anything to always or never do. Used for every
        answer.
      </p>
      <label className="block">
        <span className="mb-1.5 flex items-baseline justify-between text-xs font-medium text-muted">
          Your instructions
          <span className="font-normal text-faint">
            {value.length ? `${value.length} / ${PROFILE_LIMITS.maxInstructionsChars.toLocaleString()}` : 'Optional'}
          </span>
        </span>
        <textarea
          value={value}
          maxLength={PROFILE_LIMITS.maxInstructionsChars}
          onChange={(e) => set('instructions', e.target.value)}
          className="input min-h-28 resize-y leading-relaxed"
          placeholder={'e.g. Keep it short and simple.\nGive a one-line definition first, then a real example.\nDon\'t use heavy technical words.'}
        />
      </label>
      {ideas.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {ideas.map((idea) => (
            <button
              key={idea}
              onClick={() => add(idea)}
              className="flex items-center gap-1 rounded-full px-2.5 py-1 text-xs text-muted ring-1 ring-line transition hover:bg-white/5 hover:text-fg"
            >
              <Plus size={12} /> {idea}
            </button>
          ))}
        </div>
      )}
    </Panel>
  );
}

// ---- page -----------------------------------------------------------------------------------------

/** Always-visible footer: what's been saved, and the button that finishes preparing. */
function SaveBar({ form, onDone }: { form: InterviewDraft; onDone: () => void | Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const { state, dirty } = form;
  const finish = async () => {
    setBusy(true);
    try {
      if (await form.saveNow()) await onDone();
    } finally {
      setBusy(false);
    }
  };

  const status =
    state === 'saving' || busy ? (
      <>
        <Spinner className="!size-3.5" /> Saving…
      </>
    ) : state === 'error' ? (
      <span className="flex items-center gap-1.5 text-danger">
        <AlertCircle size={14} /> Couldn't save. Check your connection and try again.
      </span>
    ) : state === 'saved' && !dirty ? (
      <span className="flex items-center gap-1.5 text-brand">
        <Check size={14} strokeWidth={3} /> All changes saved
      </span>
    ) : (
      'Your details save automatically as you type.'
    );

  return (
    <div className="sticky bottom-0 z-10 -mx-6 mt-2 border-t border-line bg-bg/85 px-6 py-3 backdrop-blur-xl">
      <div className="flex items-center gap-3">
        <span className="flex items-center gap-2 text-sm text-muted" aria-live="polite">
          {status}
        </span>
        <button onClick={finish} disabled={busy} className="btn btn-primary btn-shine ml-auto px-5 py-2.5">
          {busy && state !== 'saving' ? <Spinner /> : null}
          {state === 'error' ? 'Try again' : 'Save & start interview'} <ArrowRight size={16} />
        </button>
      </div>
    </div>
  );
}

/** Mounted once saved details are loaded, so the draft starts from them. */
function PrepareForm({ ctx, onDone }: { ctx: InterviewContextState; onDone: () => void | Promise<void> }) {
  const form = useInterviewDraft(ctx);
  return (
    <>
      <div className="grid items-start gap-5 @4xl:grid-cols-2">
        <div className="space-y-5">
          <ResumeCard ctx={ctx} style={rise(2)} />
          <InstructionsCard form={form} style={rise(3)} />
        </div>
        <InterviewCard form={form} style={rise(4)} />
      </div>
      <SaveBar form={form} onDone={onDone} />
    </>
  );
}

export function Prepare({ ctx, onDone }: { ctx: InterviewContextState; onDone: () => void | Promise<void> }) {
  const [retrying, setRetrying] = useState(false);
  const retry = () => {
    setRetrying(true);
    ctx.reload().finally(() => setRetrying(false));
  };
  if (!ctx.loaded) {
    return (
      <div className="grid h-64 place-items-center">
        <Spinner className="text-muted" />
      </div>
    );
  }
  return (
    <div className="space-y-5">
      <div className="rise-in flex flex-wrap items-end justify-between gap-x-8 gap-y-4 border-b border-line pb-5" style={rise(0)}>
        <div className="min-w-0 max-w-xl">
          <h2 className="text-2xl font-semibold tracking-[-0.025em]">Interview setup</h2>
          <p className="mt-1.5 text-sm leading-relaxed text-muted">
            The more Friday AI knows, the more your answers sound like you. Everything here is private to your account.
          </p>
        </div>
        {!ctx.loadError && <ContextMeter ctx={ctx} />}
      </div>
      {ctx.loadError && (
        <div className="flex items-center gap-3 rounded-lg border border-danger/25 bg-danger/10 px-3 py-2 text-sm text-danger">
          <AlertCircle size={15} className="shrink-0" />
          <span className="flex-1">Couldn't load your saved details: {ctx.loadError}</span>
          <button onClick={retry} disabled={retrying} className="btn btn-ghost !px-2 !py-1 text-xs !text-danger">
            {retrying ? <Spinner className="!size-3" /> : <RefreshCw size={12} />} Try again
          </button>
        </div>
      )}
      {/* Hidden while loading failed, so autosave can't overwrite saved details with an empty form. */}
      {!ctx.loadError && <PrepareForm ctx={ctx} onDone={onDone} />}
    </div>
  );
}
