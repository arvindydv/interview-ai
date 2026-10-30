'use client';
import { useEffect, useState } from 'react';
import { Check, FileText, Plus, X } from 'lucide-react';
import { PREFERENCE_LIMITS, WORKPLACES, WORKPLACE_LABELS, type JobPreferences, type Workplace } from '@parakeet/shared';
import { ResumeUploadButton } from '@/components/ResumeUpload';
import { Spinner } from '@/components/ui';
import { api } from '@/lib/api';
import { useJobs } from '@/lib/jobs';

const LOCATION_IDEAS = ['India', 'Bengaluru', 'Hyderabad', 'Pune', 'Gurugram', 'Mumbai', 'Chennai', 'Remote'];

function TagInput({
  values,
  onChange,
  placeholder,
  suggestions = [],
}: {
  values: string[];
  onChange: (v: string[]) => void;
  placeholder: string;
  suggestions?: string[];
}) {
  const [draft, setDraft] = useState('');
  const has = (v: string) => values.some((x) => x.toLowerCase() === v.toLowerCase());
  const add = (raw: string) => {
    const v = raw.trim().slice(0, PREFERENCE_LIMITS.maxChars);
    if (v && !has(v) && values.length < PREFERENCE_LIMITS.maxItems) onChange([...values, v]);
    setDraft('');
  };
  const ideas = suggestions.filter((s) => !has(s));

  return (
    <div>
      <div className="flex min-h-12 flex-wrap items-center gap-1.5 rounded-xl border border-line-strong bg-surface p-2 focus-within:border-brand/50 focus-within:ring-4 focus-within:ring-brand/10">
        {values.map((v) => (
          <span key={v} className="inline-flex items-center gap-1 rounded-lg bg-surface-2 py-1 pr-1 pl-2.5 text-sm font-medium">
            {v}
            <button type="button" onClick={() => onChange(values.filter((x) => x !== v))} className="rounded p-0.5 text-faint hover:bg-surface-3 hover:text-fg" aria-label={`Remove ${v}`}>
              <X size={13} />
            </button>
          </span>
        ))}
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault();
              add(draft);
            } else if (e.key === 'Backspace' && !draft && values.length) onChange(values.slice(0, -1));
          }}
          onBlur={() => draft && add(draft)}
          placeholder={values.length ? '' : placeholder}
          className="min-w-40 flex-1 bg-transparent px-1.5 py-1 text-[15px] outline-none placeholder:text-faint"
        />
      </div>
      {ideas.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {ideas.map((s) => (
            <button key={s} type="button" onClick={() => add(s)} className="chip hover:border-line-strong hover:text-fg">
              <Plus size={12} /> {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function ProfilePage() {
  const { summary, reload } = useJobs();
  const [prefs, setPrefs] = useState<JobPreferences | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (summary && !prefs) setPrefs(summary.preferences);
  }, [summary, prefs]);

  if (!summary || !prefs) {
    return (
      <div className="grid min-h-[60vh] place-items-center">
        <Spinner className="text-muted" />
      </div>
    );
  }

  const { profile } = summary;
  const toggleWorkplace = (w: Workplace) =>
    setPrefs({ ...prefs, workplaces: prefs.workplaces.includes(w) ? prefs.workplaces.filter((x) => x !== w) : [...prefs.workplaces, w] });

  async function save() {
    setBusy(true);
    setError(null);
    try {
      setPrefs(await api<JobPreferences>('/v1/job-feed/preferences', { method: 'PUT', body: JSON.stringify(prefs) }));
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-4 pt-8 pb-16 sm:px-8">
      <h1 className="text-2xl font-semibold tracking-tight sm:text-[28px]">Profile & preferences</h1>
      <p className="mt-1 text-muted">Your matches come from your resume and what you&rsquo;re looking for.</p>

      <section className="card mt-8 p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="grid size-11 place-items-center rounded-xl bg-gradient-to-br from-emerald-50 to-cyan-50 text-brand">
              <FileText size={20} />
            </span>
            <div>
              <h2 className="font-semibold">Resume</h2>
              <p className="text-sm text-muted">
                {profile.resumeFileName ?? 'No resume yet'}
                {profile.resumeStatus === 'parsing' && ' · analysing…'}
                {profile.resumeStatus === 'failed' && ' · couldn’t be analysed in detail'}
              </p>
            </div>
          </div>
          <ResumeUploadButton
            label={profile.resumeFileName ? 'Replace' : 'Upload resume'}
            className={profile.resumeFileName ? 'btn btn-secondary' : 'btn btn-primary'}
          />
        </div>

        {(profile.headline || profile.topSkills.length > 0) && (
          <div className="mt-5 border-t border-line pt-5">
            {profile.headline && <p className="font-medium">{profile.headline}</p>}
            {profile.years !== null && <p className="mt-1 text-sm text-muted">{profile.years} years of experience</p>}
            {profile.topSkills.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-1.5">
                {profile.topSkills.map((s) => (
                  <span key={s} className="chip">
                    {s}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
        <p className="mt-5 text-xs text-faint">The same resume Friday AI uses to personalise your interview answers.</p>
      </section>

      <section className="card mt-6 space-y-7 p-5 sm:p-6">
        <div>
          <h2 className="font-semibold">Roles you want</h2>
          <p className="mt-1 mb-3 text-sm text-muted">
            {summary.resumeRoles.length
              ? `Leave empty to use your recent titles: ${summary.resumeRoles.join(', ')}.`
              : 'Job titles you’re aiming for, e.g. “Backend Engineer” or “Maths Teacher”.'}
          </p>
          <TagInput
            values={prefs.roles}
            onChange={(roles) => setPrefs({ ...prefs, roles })}
            placeholder="Add a job title and press Enter"
            suggestions={summary.resumeRoles}
          />
        </div>

        <div>
          <h2 className="font-semibold">Locations</h2>
          <p className="mt-1 mb-3 text-sm text-muted">Cities or countries you&rsquo;d work in. Leave empty for anywhere.</p>
          <TagInput
            values={prefs.locations}
            onChange={(locations) => setPrefs({ ...prefs, locations })}
            placeholder="Add a city or country"
            suggestions={LOCATION_IDEAS}
          />
        </div>

        <div>
          <h2 className="font-semibold">Workplace</h2>
          <p className="mt-1 mb-3 text-sm text-muted">Pick any that work for you. None picked means all.</p>
          <div className="grid gap-2 sm:grid-cols-3">
            {WORKPLACES.map((w) => {
              const on = prefs.workplaces.includes(w);
              return (
                <button
                  key={w}
                  type="button"
                  onClick={() => toggleWorkplace(w)}
                  className={`flex items-center justify-between rounded-xl border px-4 py-3 text-sm font-medium transition ${
                    on ? 'border-brand/50 bg-brand/5 text-fg' : 'border-line-strong text-muted hover:text-fg'
                  }`}
                  aria-pressed={on}
                >
                  {WORKPLACE_LABELS[w]}
                  <span className={`grid size-5 place-items-center rounded-md border ${on ? 'border-brand bg-brand text-white' : 'border-line-strong'}`}>
                    {on && <Check size={13} />}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-line pt-5">
          {error && <p className="mr-auto text-sm text-danger">{error}</p>}
          {saved && (
            <span className="flex items-center gap-1.5 text-sm text-brand">
              <Check size={15} /> Saved. Updating your matches…
            </span>
          )}
          <button onClick={save} disabled={busy} className="btn btn-primary">
            {busy ? <Spinner /> : 'Save preferences'}
          </button>
        </div>
      </section>
    </div>
  );
}
