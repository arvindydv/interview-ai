'use client';
import { useState } from 'react';
import { Check, Plus, X } from 'lucide-react';
import { commonQuestions, type ApplicationProfile, type WorkAuthorization } from '@parakeet/shared';
import { Spinner } from './ui';
import { api } from '@/lib/api';

// The application profile: what forms ask that a resume doesn't say. Auto Apply answers only from this,
// the resume and the user's own earlier answers.

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-sm font-medium">{label}</span>
      {hint && <span className="ml-1.5 text-xs text-faint">{hint}</span>}
      <div className="mt-1.5">{children}</div>
    </label>
  );
}

const splitList = (s: string) => [...new Set(s.split(',').map((x) => x.trim()).filter(Boolean))].slice(0, 20);
const yesNo = (v: boolean | null) => (v === null ? '' : v ? 'yes' : 'no');
const fromYesNo = (v: string) => (v === '' ? null : v === 'yes');

export function AutoApplyProfile({ initial, onSaved }: { initial: ApplicationProfile; onSaved: (p: ApplicationProfile) => void }) {
  const [p, setP] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof ApplicationProfile>(k: K, v: ApplicationProfile[K]) => setP((x) => ({ ...x, [k]: v }));
  const setAuth = (i: number, patch: Partial<WorkAuthorization>) =>
    set('workAuthorization', p.workAuthorization.map((w, j) => (j === i ? { ...w, ...patch } : w)));
  const text = (
    k: 'firstName' | 'lastName' | 'email' | 'phone' | 'city' | 'country' | 'linkedin' | 'github' | 'portfolio' | 'website' | 'currentSalary' |
      'expectedSalary' | 'earliestStart' | 'gender' | 'preferredName' | 'pronouns' | 'hometown',
    placeholder = '',
  ) => <input value={p[k]} onChange={(e) => set(k, e.target.value)} placeholder={placeholder} className="input" />;
  /** A yes/no question, or "ask me each time". */
  const choice = (
    k: 'willingToRelocate' | 'willingToTravel' | 'securityClearance' | 'recordingConsent' | 'backgroundCheckConsent',
    label: string,
    [yes, no] = ['Yes', 'No'],
  ) => (
    <Field label={label}>
      <select value={yesNo(p[k])} onChange={(e) => set(k, fromYesNo(e.target.value))} className="input">
        <option value="">Ask me each time</option>
        <option value="yes">{yes}</option>
        <option value="no">{no}</option>
      </select>
    </Field>
  );
  const [languages, setLanguages] = useState(initial.languages.join(', '));
  const common = commonQuestions({ ...p, languages: splitList(languages) });
  const answered = common.filter((q) => q.answered).length;

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const next = await api<ApplicationProfile>('/v1/auto-apply/profile', { method: 'PUT', body: JSON.stringify({ ...p, languages: splitList(languages) }) });
      setP(next);
      onSaved(next);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="First name">{text('firstName')}</Field>
        <Field label="Last name">{text('lastName')}</Field>
        <Field label="Email" hint="employers reply here">{text('email')}</Field>
        <Field label="Phone" hint="with country code">{text('phone', '+91 98765 43210')}</Field>
        <Field label="City">{text('city', 'Bengaluru')}</Field>
        <Field label="Country">{text('country', 'India')}</Field>
        <Field label="LinkedIn">{text('linkedin', 'https://linkedin.com/in/…')}</Field>
        <Field label="GitHub">{text('github', 'https://github.com/…')}</Field>
        <Field label="Portfolio">{text('portfolio')}</Field>
        <Field label="Website">{text('website')}</Field>
      </div>

      <div>
        <p className="text-sm font-medium">Where you can work</p>
        <p className="mt-0.5 text-xs text-muted">
          Forms ask about work permits and visa sponsorship. Countries not listed here are left for you to answer.
        </p>
        <div className="mt-3 space-y-2">
          {p.workAuthorization.map((w, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2 rounded-xl border border-line p-2.5">
              <input value={w.country} onChange={(e) => setAuth(i, { country: e.target.value })} placeholder="Country" className="input !w-40 !py-1.5" />
              <label className="flex items-center gap-1.5 text-sm">
                <input type="checkbox" checked={w.authorized} onChange={(e) => setAuth(i, { authorized: e.target.checked })} /> Allowed to work
              </label>
              <label className="flex items-center gap-1.5 text-sm">
                <input type="checkbox" checked={w.needsSponsorship} onChange={(e) => setAuth(i, { needsSponsorship: e.target.checked })} /> Needs visa sponsorship
              </label>
              <button
                type="button"
                onClick={() => set('workAuthorization', p.workAuthorization.filter((_, j) => j !== i))}
                className="btn btn-ghost ml-auto !p-1.5"
                aria-label="Remove country"
              >
                <X size={15} />
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => set('workAuthorization', [...p.workAuthorization, { country: p.workAuthorization.length ? '' : p.country, authorized: true, needsSponsorship: false }])}
            className="btn btn-secondary !py-1.5 !text-xs"
          >
            <Plus size={14} /> Add a country
          </button>
        </div>
        <label className="mt-3 block text-sm">
          <span className="font-medium">Every other country</span>
          <select
            value={p.otherCountries === null ? '' : p.otherCountries.authorized ? 'authorized' : 'sponsorship'}
            onChange={(e) =>
              set(
                'otherCountries',
                e.target.value === ''
                  ? null
                  : { authorized: e.target.value === 'authorized', needsSponsorship: e.target.value === 'sponsorship' },
              )
            }
            className="input mt-1.5"
          >
            <option value="">Ask me each time</option>
            <option value="sponsorship">Not allowed to work; I’d need visa sponsorship</option>
            <option value="authorized">Allowed to work without sponsorship</option>
          </select>
        </label>
      </div>

      <div>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-sm font-medium">Common questions</p>
          <span className={`text-xs font-medium ${answered === common.length ? 'text-brand' : 'text-amber-700'}`}>
            {answered} of {common.length} answered
          </span>
        </div>
        <p className="mt-0.5 text-xs text-muted">
          Forms ask these again and again. Answer them once and Friday fills them in everywhere instead of stopping to ask you.
        </p>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <Field label="Notice period" hint="days; 0 if you can join now">
            <input
              type="number"
              min={0}
              max={365}
              value={p.noticePeriodDays ?? ''}
              onChange={(e) => set('noticePeriodDays', e.target.value === '' ? null : Math.max(0, Math.min(365, Number(e.target.value))))}
              className="input"
            />
          </Field>
          <Field label="Can start" hint="e.g. Immediately">{text('earliestStart')}</Field>
          <Field label="Current salary (CTC)" hint="with currency">{text('currentSalary', '₹18 LPA')}</Field>
          <Field label="Expected salary (CTC)" hint="with currency">{text('expectedSalary', '₹25 LPA')}</Field>
          <div className="block">
            <span className="text-sm font-medium">Work arrangements you accept</span>
            <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1.5 text-sm">
              {(['remote', 'hybrid', 'onsite'] as const).map((w) => (
                <label key={w} className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={p.workplaces.includes(w)}
                    onChange={(e) => set('workplaces', e.target.checked ? [...p.workplaces, w] : p.workplaces.filter((x) => x !== w))}
                  />
                  {w === 'onsite' ? 'In the office' : w === 'hybrid' ? 'Hybrid' : 'Remote'}
                </label>
              ))}
            </div>
          </div>
          <Field label="Languages you can work in" hint="comma-separated">
            <input
              value={languages}
              onChange={(e) => setLanguages(e.target.value)}
              onBlur={() => set('languages', splitList(languages))}
              placeholder="English, Hindi"
              className="input"
            />
          </Field>
          {choice('willingToRelocate', 'Willing to relocate')}
          {choice('willingToTravel', 'Willing to travel for work')}
          <Field label="Home town" hint="Indian forms ask for a home state">{text('hometown', 'Lucknow, Uttar Pradesh')}</Field>
          {choice('securityClearance', 'Hold a government security clearance', ['Yes, I hold one', 'No'])}
          {choice('recordingConsent', 'OK with interviews being recorded or transcribed', ['Yes', 'No'])}
          {choice('backgroundCheckConsent', 'OK with a background check if offered the job', ['Yes', 'No'])}
          <Field label="Preferred name" hint="optional">{text('preferredName')}</Field>
          <Field label="Pronouns" hint="optional">{text('pronouns', 'she/her')}</Field>
          <Field label="Gender" hint="optional; diversity questions are declined otherwise">{text('gender')}</Field>
        </div>
      </div>

      <label className="flex items-start gap-3 rounded-xl border border-line p-3.5 text-sm">
        <input type="checkbox" checked={p.letAiDecide} onChange={(e) => set('letAiDecide', e.target.checked)} className="mt-0.5" />
        <span>
          <span className="font-medium">Let Friday answer judgment questions from my resume</span>
          <span className="mt-0.5 block text-xs text-muted">
            Questions about how you work or which role fits you best, and open questions it can answer from your real experience.
            Facts about you (salary, visas, clearances, consents) only ever come from this profile or from you.
          </span>
        </span>
      </label>

      {p.savedAnswers.length > 0 && (
        <div>
          <p className="text-sm font-medium">Your saved answers</p>
          <p className="mt-0.5 text-xs text-muted">Answers you gave on other forms, reused when the same question comes up.</p>
          <ul className="mt-3 divide-y divide-line rounded-xl border border-line">
            {p.savedAnswers.map((a, i) => (
              <li key={i} className="flex items-start gap-3 p-3 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="text-muted">{a.question}</p>
                  <p className="font-medium">{a.answer}</p>
                </div>
                <button
                  type="button"
                  onClick={() => set('savedAnswers', p.savedAnswers.filter((_, j) => j !== i))}
                  className="btn btn-ghost !p-1.5"
                  aria-label="Forget this answer"
                >
                  <X size={15} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex items-center justify-end gap-3 border-t border-line pt-5">
        {error && <p className="mr-auto text-sm text-danger">{error}</p>}
        {saved && (
          <span className="flex items-center gap-1.5 text-sm text-brand">
            <Check size={15} /> Saved
          </span>
        )}
        <button onClick={save} disabled={busy} className="btn btn-primary">
          {busy ? <Spinner /> : 'Save profile'}
        </button>
      </div>
    </div>
  );
}
