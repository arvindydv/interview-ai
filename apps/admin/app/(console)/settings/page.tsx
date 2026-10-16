'use client';
import { useEffect, useState } from 'react';
import { Check, Construction, Cpu, Gauge, Plus, Trash2 } from 'lucide-react';
import type { AppSettings } from '@parakeet/shared';
import { adminApi } from '@/lib/api';
import { useAction, useAsync } from '@/lib/useAsync';
import { Card, ErrorNote, PageHeader, Spinner } from '@/components/ui';

export default function SettingsPage() {
  const [r] = useAsync(() => adminApi<AppSettings>('/admin/settings'), []);
  const [form, setForm] = useState<AppSettings | null>(null);
  const [limits, setLimits] = useState<{ plan: string; limit: string }[]>([]);
  const [saved, setSaved] = useState(false);
  const act = useAction();

  const load = (s: AppSettings) => {
    setForm(s);
    setLimits(Object.entries(s.dailyQuestionLimits).map(([plan, limit]) => ({ plan, limit: String(limit) })));
  };
  useEffect(() => {
    if (r.state === 'ok') load(r.data);
  }, [r]);

  if (!form) return r.state === 'error' ? <ErrorNote>{r.error}</ErrorNote> : <Spinner className="text-muted" />;

  const set = <K extends keyof AppSettings>(k: K, v: AppSettings[K]) => {
    setForm({ ...form, [k]: v });
    setSaved(false);
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const dailyQuestionLimits: Record<string, number> = {};
    for (const l of limits) {
      const plan = l.plan.trim().toLowerCase();
      if (plan) dailyQuestionLimits[plan] = Math.max(0, Math.floor(Number(l.limit) || 0));
    }
    await act.run('save', async () => {
      const next = await adminApi<AppSettings>('/admin/settings', { method: 'PUT', body: JSON.stringify({ ...form, dailyQuestionLimits }) });
      load(next);
      setSaved(true);
    });
  };

  return (
    <form onSubmit={save} className="space-y-6">
      <PageHeader
        title="Settings"
        subtitle="Applied by the API within a few seconds, no redeploy needed."
        action={
          <button type="submit" className="btn btn-primary" disabled={act.busy !== null}>
            {act.busy ? <Spinner /> : saved ? <Check size={15} /> : null} {saved ? 'Saved' : 'Save changes'}
          </button>
        }
      />
      {act.error && <ErrorNote>{act.error}</ErrorNote>}

      <Card title="Maintenance mode" icon={Construction}>
        <label className="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            className="mt-1 size-4 accent-[var(--color-brand)]"
            checked={form.maintenanceMode}
            onChange={(e) => set('maintenanceMode', e.target.checked)}
          />
          <span>
            <span className="text-sm font-medium">Pause live answers for everyone</span>
            <span className="block text-sm text-muted">Users who ask a question see the message below instead of an answer.</span>
          </span>
        </label>
        <label className="mt-4 block">
          <span className="text-xs text-muted">Message shown to users</span>
          <textarea className="input mt-1 min-h-20 !text-sm" maxLength={500} value={form.maintenanceMessage} onChange={(e) => set('maintenanceMessage', e.target.value)} />
        </label>
      </Card>

      <Card title="Daily question limits" icon={Gauge}>
        <p className="mb-4 text-sm text-muted">
          Questions per user per UTC day, by plan. <span className="font-mono">0</span> means unlimited; plans not listed are unlimited.
        </p>
        <div className="space-y-2">
          {limits.map((l, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                className="input !py-2 !text-sm"
                placeholder="plan, e.g. free"
                value={l.plan}
                onChange={(e) => {
                  setLimits(limits.map((x, j) => (j === i ? { ...x, plan: e.target.value } : x)));
                  setSaved(false);
                }}
              />
              <input
                className="input !w-36 !py-2 !text-sm"
                type="number"
                min={0}
                value={l.limit}
                onChange={(e) => {
                  setLimits(limits.map((x, j) => (j === i ? { ...x, limit: e.target.value } : x)));
                  setSaved(false);
                }}
                aria-label="Questions per day"
              />
              <button
                type="button"
                className="btn btn-ghost !p-2 text-faint hover:!text-danger"
                onClick={() => {
                  setLimits(limits.filter((_, j) => j !== i));
                  setSaved(false);
                }}
                aria-label="Remove limit"
              >
                <Trash2 size={15} />
              </button>
            </div>
          ))}
        </div>
        <button type="button" className="btn btn-secondary mt-3 !py-1.5" onClick={() => setLimits([...limits, { plan: '', limit: '0' }])}>
          <Plus size={15} /> Add plan
        </button>
      </Card>

      <Card title="AI models" icon={Cpu}>
        <p className="mb-4 text-sm text-muted">Override the models set in the API&apos;s env. Leave empty to use the env defaults.</p>
        <div className="grid gap-4 md:grid-cols-2">
          <label>
            <span className="text-xs text-muted">Text questions (fast tier)</span>
            <input className="input mt-1 !py-2 font-mono !text-sm" placeholder="LLM_FAST_MODEL" value={form.fastModel} onChange={(e) => set('fastModel', e.target.value)} />
          </label>
          <label>
            <span className="text-xs text-muted">Screenshot questions (vision tier)</span>
            <input className="input mt-1 !py-2 font-mono !text-sm" placeholder="LLM_VISION_MODEL" value={form.visionModel} onChange={(e) => set('visionModel', e.target.value)} />
          </label>
        </div>
      </Card>
    </form>
  );
}
