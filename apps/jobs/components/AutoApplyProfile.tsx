'use client';
import { useState } from 'react';
import { Check, Plus, X } from 'lucide-react';
import type { ApplicationProfile, WorkAuthorization } from '@parakeet/shared';
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
  const text = (k: 'firstName' | 'lastName' | 'email' | 'phone' | 'city' | 'country' | 'linkedin' | 'github' | 'portfolio' | 'website' | 'currentSalary' | 'expectedSalary' | 'earliestStart' | 'gender', placeholder = '') => (
    <input value={p[k]} onChange={(e) => set(k, e.target.value)} placeholder={placeholder} className="input" />
  );

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const next = await api<ApplicationProfile>('/v1/auto-apply/profile', { method: 'PUT', body: JSON.stringify(p) });
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
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Notice period" hint="days">
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
        <Field label="Current salary" hint="optional">{text('currentSalary', '₹18 LPA')}</Field>
        <Field label="Expected salary" hint="optional">{text('expectedSalary', '₹25 LPA')}</Field>
        <Field label="Willing to relocate">
          <select value={yesNo(p.willingToRelocate)} onChange={(e) => set('willingToRelocate', fromYesNo(e.target.value))} className="input">
            <option value="">Ask me each time</option>
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </select>
        </Field>
        <Field label="Gender" hint="optional; diversity questions are declined otherwise">{text('gender')}</Field>
      </div>

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
