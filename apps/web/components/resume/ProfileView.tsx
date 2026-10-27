'use client';
import { useState } from 'react';
import {
  Award, BookOpen, Briefcase, ChevronDown, Copy, FolderKanban, GraduationCap, Pencil, Plus, Quote, Target,
  Trash2, X, type LucideIcon,
} from 'lucide-react';
import type { ResumeProfile } from '@parakeet/shared';
import { toast } from '@/components/overlay';

type Story = ResumeProfile['stories'][number];
/** Saves the whole profile; shows `message` on success unless it is empty. Resolves to whether it saved. */
type Save = (next: ResumeProfile, message: string) => Promise<boolean>;

/**
 * Whether a number reads as a result: a percentage, money, a multiple, or a count of 20 or more.
 * Grade levels ("class 12") and years ("2016") are left alone.
 */
function isMetric(token: string) {
  if (/[₹$€£%xkKMBL+]|Cr|lakh|crore/.test(token)) return true;
  const n = Number(token.replace(/,/g, ''));
  return n >= 20 && !(Number.isInteger(n) && n >= 1950 && n <= 2100);
}

/** Highlights the results in a line, since concrete numbers are what make an answer land. */
export function Metrics({ text }: { text: string }) {
  const parts = text.split(/((?:[₹$€£]\s?)?\d[\d,.]*(?:\s?(?:%|x|k|K|M|B|L|Cr|lakh|crore)\b|%|\+)*)/g);
  return (
    <>
      {parts.map((p, n) =>
        n % 2 && isMetric(p) ? (
          <span key={n} className="font-medium text-brand">
            {p}
          </span>
        ) : (
          p
        ),
      )}
    </>
  );
}

function Panel({
  id,
  icon: Icon,
  title,
  count,
  action,
  children,
}: {
  id?: string;
  icon: LucideIcon;
  title: string;
  count?: number;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="glass scroll-mt-24 rounded-[var(--radius-card)] p-5 sm:p-6 animate-fade-up">
      <header className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="grid size-8 place-items-center rounded-lg bg-white/5 text-brand ring-1 ring-line">
            <Icon size={16} />
          </span>
          <h2 className="text-sm font-semibold">{title}</h2>
          {count !== undefined && <span className="text-xs text-faint tabular-nums">{count}</span>}
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

const EditButton = ({ onClick, label = 'Edit' }: { onClick: () => void; label?: string }) => (
  <button onClick={onClick} className="btn btn-ghost !px-2.5 !py-1.5 text-xs">
    <Pencil size={13} /> {label}
  </button>
);

function SaveRow({ busy, onCancel, onSave, saveLabel = 'Save' }: { busy: boolean; onCancel: () => void; onSave: () => void; saveLabel?: string }) {
  return (
    <div className="mt-4 flex justify-end gap-2">
      <button type="button" onClick={onCancel} className="btn btn-ghost !py-1.5">
        Cancel
      </button>
      <button type="button" onClick={onSave} disabled={busy} className="btn btn-primary !py-1.5">
        {saveLabel}
      </button>
    </div>
  );
}

// ---- introduction --------------------------------------------------------------------------------

export function Identity({ profile, editable, save }: { profile: ResumeProfile; editable: boolean; save: Save }) {
  const [edit, setEdit] = useState<null | { name: string; headline: string; years: string; summary: string }>(null);
  const [busy, setBusy] = useState(false);
  const start = () =>
    setEdit({
      name: profile.name ?? '',
      headline: profile.headline ?? '',
      years: profile.totalYearsExperience?.toString() ?? '',
      summary: profile.summary,
    });
  const submit = async () => {
    if (!edit) return;
    const years = edit.years.trim() === '' ? null : Number(edit.years);
    if (years !== null && (!Number.isFinite(years) || years < 0 || years > 70)) return toast('Years of experience should be a number.', { tone: 'bad' });
    setBusy(true);
    const ok = await save(
      { ...profile, name: edit.name.trim() || null, headline: edit.headline.trim() || null, totalYearsExperience: years, summary: edit.summary.trim() },
      'Introduction updated.',
    );
    setBusy(false);
    if (ok) setEdit(null);
  };
  const copy = () =>
    navigator.clipboard.writeText(profile.summary).then(
      () => toast('Copied to clipboard.'),
      () => toast('Couldn’t copy. Select the text instead.', { tone: 'bad' }),
    );

  if (edit) {
    return (
      <section id="summary" className="glass rounded-[var(--radius-card)] p-5 sm:p-6">
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_8rem]">
          <Field label="Name">
            <input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} maxLength={200} className="input" />
          </Field>
          <Field label="Headline">
            <input
              value={edit.headline}
              onChange={(e) => setEdit({ ...edit, headline: e.target.value })}
              maxLength={300}
              placeholder="e.g. Maths teacher, 7 years in CBSE schools"
              className="input"
            />
          </Field>
          <Field label="Years of experience">
            <input value={edit.years} onChange={(e) => setEdit({ ...edit, years: e.target.value })} inputMode="decimal" className="input" />
          </Field>
        </div>
        <Field label="Introduction (your “tell me about yourself” opener)" className="mt-3">
          <textarea
            value={edit.summary}
            onChange={(e) => setEdit({ ...edit, summary: e.target.value })}
            maxLength={2000}
            rows={4}
            className="input resize-y leading-relaxed"
          />
        </Field>
        <SaveRow busy={busy} onCancel={() => setEdit(null)} onSave={submit} />
      </section>
    );
  }

  return (
    <section id="summary" className="relative overflow-hidden rounded-[var(--radius-card)] border border-line p-6 sm:p-7 animate-fade-up">
      <div className="absolute inset-0 -z-10 bg-surface" />
      <div className="absolute -top-28 -left-20 -z-10 size-96 glow opacity-70" />
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="truncate text-2xl font-semibold tracking-tight">{profile.name || 'Your profile'}</h2>
          {profile.headline && <p className="mt-1 text-sm text-muted">{profile.headline}</p>}
          {profile.totalYearsExperience !== null && (
            <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-white/5 px-2.5 py-1 text-xs text-muted ring-1 ring-line">
              <Briefcase size={12} className="text-brand" /> {profile.totalYearsExperience} years of experience
            </p>
          )}
        </div>
        {editable && <EditButton onClick={start} />}
      </div>
      {profile.summary ? (
        <figure className="mt-5 rounded-2xl border border-line bg-bg/50 p-4 backdrop-blur">
          <figcaption className="flex items-center justify-between gap-2">
            <span className="eyebrow flex items-center gap-1.5">
              <Quote size={12} className="text-brand" /> Tell me about yourself
            </span>
            <button onClick={copy} className="btn btn-ghost !px-2 !py-1 text-xs" aria-label="Copy introduction">
              <Copy size={13} /> Copy
            </button>
          </figcaption>
          <blockquote className="mt-2 text-[15px] leading-relaxed text-fg/90">{profile.summary}</blockquote>
        </figure>
      ) : (
        editable && (
          <button onClick={start} className="mt-5 w-full rounded-2xl border border-dashed border-line-strong p-4 text-sm text-muted hover:border-brand/40 hover:text-fg">
            <Plus size={14} className="mr-1 inline" /> Write your introduction
          </button>
        )
      )}
    </section>
  );
}

function Field({ label, className = '', children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1.5 block text-xs font-medium text-muted">{label}</span>
      {children}
    </label>
  );
}

// ---- skills --------------------------------------------------------------------------------------

export function Skills({ profile, editable, save }: { profile: ResumeProfile; editable: boolean; save: Save }) {
  const [value, setValue] = useState('');
  const add = async () => {
    const names = value.split(',').map((s) => s.trim()).filter(Boolean);
    const have = new Set(profile.skills.map((s) => s.name.toLowerCase()));
    const fresh = [...new Set(names)].filter((n) => !have.has(n.toLowerCase())).map((name) => ({ name: name.slice(0, 100), years: null }));
    if (!fresh.length) return setValue('');
    if (await save({ ...profile, skills: [...profile.skills, ...fresh] }, fresh.length === 1 ? `Added ${fresh[0].name}.` : `Added ${fresh.length} skills.`)) {
      setValue('');
    }
  };
  const remove = (name: string) => {
    const before = profile;
    save({ ...profile, skills: profile.skills.filter((s) => s.name !== name) }, '').then(
      (ok) => ok && toast(`Removed ${name}.`, { action: { label: 'Undo', run: () => save(before, `Restored ${name}.`) } }),
    );
  };
  return (
    <Panel id="skills" icon={Target} title="Skills" count={profile.skills.length}>
      {profile.skills.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5">
          {profile.skills.map((s) => (
            <li
              key={s.name}
              className="group inline-flex items-center gap-1.5 rounded-full bg-white/[0.04] py-1 pr-1.5 pl-3 text-sm ring-1 ring-line transition hover:ring-line-strong"
            >
              {s.name}
              {s.years !== null && <span className="text-xs text-faint tabular-nums">{s.years}y</span>}
              {editable ? (
                <button
                  onClick={() => remove(s.name)}
                  aria-label={`Remove ${s.name}`}
                  className="rounded-full p-0.5 text-faint opacity-60 transition hover:bg-danger/15 hover:text-danger group-hover:opacity-100"
                >
                  <X size={12} />
                </button>
              ) : (
                <span className="w-1" />
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">No skills found yet.</p>
      )}
      {editable && (
        <form
          className="mt-4 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
        >
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Add skills, separated by commas"
            className="input !py-2 !text-sm"
            aria-label="Add skills"
          />
          <button type="submit" disabled={!value.trim()} className="btn btn-secondary !py-2">
            <Plus size={15} /> Add
          </button>
        </form>
      )}
    </Panel>
  );
}

// ---- experience and projects ---------------------------------------------------------------------

export function Experience({ profile }: { profile: ResumeProfile }) {
  if (!profile.experience.length) return null;
  return (
    <Panel icon={Briefcase} title="Experience" count={profile.experience.length}>
      <ol className="relative space-y-6 border-l border-line pl-6">
        {profile.experience.map((e, n) => (
          <li key={n} className="relative">
            <span
              className={`absolute top-1.5 -left-[29px] size-2.5 rounded-full ring-4 ring-bg ${n === 0 ? 'bg-brand' : 'bg-line-strong'}`}
              aria-hidden
            />
            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
              <p className="font-medium">{e.title}</p>
              {e.period && <p className="text-xs text-faint">{e.period}</p>}
            </div>
            <p className="text-sm text-muted">{e.company}</p>
            {e.highlights.length > 0 && (
              <ul className="mt-2 space-y-1.5">
                {e.highlights.map((h, k) => (
                  <li key={k} className="flex gap-2 text-sm leading-relaxed text-fg/85">
                    <span className="mt-2 size-1 shrink-0 rounded-full bg-faint" />
                    <span>
                      <Metrics text={h} />
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ol>
    </Panel>
  );
}

export function Projects({ profile }: { profile: ResumeProfile }) {
  if (!profile.projects.length) return null;
  return (
    <Panel icon={FolderKanban} title="Projects and key work" count={profile.projects.length}>
      <div className="grid gap-3 sm:grid-cols-2">
        {profile.projects.map((p, n) => (
          <article key={n} className="flex flex-col rounded-xl border border-line bg-bg/40 p-4 transition hover:border-line-strong">
            <h3 className="font-medium">{p.name}</h3>
            <p className="mt-1 text-sm leading-relaxed text-muted">{p.summary}</p>
            {p.impact && (
              <p className="mt-2 flex gap-1.5 text-sm">
                <Target size={14} className="mt-0.5 shrink-0 text-brand" />
                <span>
                  <Metrics text={p.impact} />
                </span>
              </p>
            )}
            {p.tech.length > 0 && (
              <div className="mt-auto flex flex-wrap gap-1 pt-3">
                {p.tech.map((t) => (
                  <span key={t} className="rounded-md bg-white/[0.04] px-1.5 py-0.5 text-[11px] text-muted ring-1 ring-line">
                    {t}
                  </span>
                ))}
              </div>
            )}
          </article>
        ))}
      </div>
    </Panel>
  );
}

export function Education({ profile }: { profile: ResumeProfile }) {
  if (!profile.education.length && !profile.certifications.length) return null;
  return (
    <Panel icon={GraduationCap} title="Education">
      <ul className="space-y-3">
        {profile.education.map((e, n) => (
          <li key={n} className="flex gap-3">
            <BookOpen size={15} className="mt-0.5 shrink-0 text-faint" />
            <div className="min-w-0">
              <p className="text-sm font-medium">{e.degree || e.school}</p>
              <p className="text-xs text-muted">{[e.degree && e.school, e.year].filter(Boolean).join(' · ')}</p>
            </div>
          </li>
        ))}
      </ul>
      {profile.certifications.length > 0 && (
        <>
          <p className="eyebrow mt-5 mb-2">Certifications</p>
          <ul className="flex flex-wrap gap-1.5">
            {profile.certifications.map((c) => (
              <li key={c} className="inline-flex items-center gap-1.5 rounded-full bg-accent/10 px-2.5 py-1 text-xs text-accent ring-1 ring-accent/25">
                <Award size={12} /> {c}
              </li>
            ))}
          </ul>
        </>
      )}
    </Panel>
  );
}

// ---- STAR stories --------------------------------------------------------------------------------

const STAR: { key: keyof Omit<Story, 'title'>; label: string; letter: string; hint: string }[] = [
  { key: 'situation', label: 'Situation', letter: 'S', hint: 'The context and the challenge' },
  { key: 'action', label: 'Action', letter: 'A', hint: 'What you did, in the first person' },
  { key: 'result', label: 'Result', letter: 'R', hint: 'What changed. Use numbers when you can' },
];

const EMPTY_STORY: Story = { title: '', situation: '', action: '', result: '' };

export function Stories({ profile, editable, save }: { profile: ResumeProfile; editable: boolean; save: Save }) {
  const [open, setOpen] = useState<number | null>(0);
  const [editing, setEditing] = useState<{ at: number | 'new'; story: Story } | null>(null);
  const [busy, setBusy] = useState(false);

  const commit = async () => {
    if (!editing) return;
    const story = Object.fromEntries(Object.entries(editing.story).map(([k, v]) => [k, v.trim()])) as Story;
    if (!story.title) return toast('Give the story a short title.', { tone: 'bad' });
    const stories = editing.at === 'new' ? [...profile.stories, story] : profile.stories.map((s, n) => (n === editing.at ? story : s));
    setBusy(true);
    const ok = await save({ ...profile, stories }, editing.at === 'new' ? 'Story added.' : 'Story updated.');
    setBusy(false);
    if (ok) {
      setOpen(editing.at === 'new' ? stories.length - 1 : editing.at);
      setEditing(null);
    }
  };

  const remove = (n: number) => {
    const before = profile;
    save({ ...profile, stories: profile.stories.filter((_, k) => k !== n) }, '').then(
      (ok) => ok && toast('Story deleted.', { action: { label: 'Undo', run: () => save(before, 'Story restored.') } }),
    );
  };

  return (
    <Panel
      id="stories"
      icon={Award}
      title="STAR stories"
      count={profile.stories.length}
      action={
        editable &&
        !editing && (
          <button onClick={() => setEditing({ at: 'new', story: EMPTY_STORY })} className="btn btn-ghost !px-2.5 !py-1.5 text-xs">
            <Plus size={13} /> Add story
          </button>
        )
      }
    >
      <p className="-mt-2 mb-4 text-xs text-muted">
        Ready-made answers for “Tell me about a time…” questions, built only from facts in your resume.
      </p>
      <ul className="space-y-2">
        {profile.stories.map((s, n) =>
          editing?.at === n ? (
            <li key={n}>
              <StoryForm story={editing.story} onChange={(story) => setEditing({ at: n, story })} busy={busy} onCancel={() => setEditing(null)} onSave={commit} />
            </li>
          ) : (
            <li key={n} className={`rounded-xl border transition ${open === n ? 'border-line-strong bg-white/[0.02]' : 'border-line hover:border-line-strong'}`}>
              <button
                onClick={() => setOpen(open === n ? null : n)}
                aria-expanded={open === n}
                className="flex w-full items-center gap-3 px-4 py-3 text-left"
              >
                <span className="grid size-6 shrink-0 place-items-center rounded-md bg-brand/10 text-xs font-semibold text-brand tabular-nums">{n + 1}</span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{s.title}</span>
                <ChevronDown size={16} className={`shrink-0 text-faint transition ${open === n ? 'rotate-180' : ''}`} />
              </button>
              {open === n && (
                <div className="space-y-3 px-4 pb-4">
                  {STAR.map(({ key, label, letter }) => (
                    <div key={key} className="flex gap-3">
                      <span
                        title={label}
                        className="mt-0.5 grid size-5 shrink-0 place-items-center rounded bg-white/5 text-[10px] font-bold text-muted ring-1 ring-line"
                      >
                        {letter}
                      </span>
                      <p className="text-sm leading-relaxed text-fg/85">
                        {s[key] ? <Metrics text={s[key]} /> : <span className="text-faint">Not stated</span>}
                      </p>
                    </div>
                  ))}
                  {editable && (
                    <div className="flex justify-end gap-1 pt-1">
                      <button onClick={() => setEditing({ at: n, story: s })} className="btn btn-ghost !px-2.5 !py-1.5 text-xs">
                        <Pencil size={13} /> Edit
                      </button>
                      <button onClick={() => remove(n)} className="btn btn-ghost !px-2.5 !py-1.5 text-xs hover:!text-danger">
                        <Trash2 size={13} /> Delete
                      </button>
                    </div>
                  )}
                </div>
              )}
            </li>
          ),
        )}
        {editing?.at === 'new' && (
          <li>
            <StoryForm story={editing.story} onChange={(story) => setEditing({ at: 'new', story })} busy={busy} onCancel={() => setEditing(null)} onSave={commit} isNew />
          </li>
        )}
      </ul>
      {!profile.stories.length && !editing && <p className="text-sm text-muted">No stories yet. Add one from your proudest piece of work.</p>}
    </Panel>
  );
}

function StoryForm({
  story,
  onChange,
  busy,
  onCancel,
  onSave,
  isNew,
}: {
  story: Story;
  onChange: (s: Story) => void;
  busy: boolean;
  onCancel: () => void;
  onSave: () => void;
  isNew?: boolean;
}) {
  return (
    <div className="rounded-xl border border-brand/30 bg-brand/[0.03] p-4">
      <Field label="Title">
        <input
          autoFocus
          value={story.title}
          onChange={(e) => onChange({ ...story, title: e.target.value })}
          maxLength={200}
          placeholder="e.g. Turned around a failing class’s board results"
          className="input !py-2"
        />
      </Field>
      {STAR.map(({ key, label, hint }) => (
        <Field key={key} label={`${label} · ${hint}`} className="mt-3">
          <textarea
            value={story[key]}
            onChange={(e) => onChange({ ...story, [key]: e.target.value })}
            maxLength={2000}
            rows={2}
            className="input resize-y !py-2 text-sm leading-relaxed"
          />
        </Field>
      ))}
      <SaveRow busy={busy} onCancel={onCancel} onSave={onSave} saveLabel={isNew ? 'Add story' : 'Save'} />
    </div>
  );
}
