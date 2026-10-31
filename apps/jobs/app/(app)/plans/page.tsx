'use client';
import { useEffect, useState } from 'react';
import { Check, Crown } from 'lucide-react';
import { formatInr, type BillingOverview, type CheckoutOrder, type JobsPlan, type JobsPlanStatus } from '@parakeet/shared';
import { Spinner } from '@/components/ui';
import { api } from '@/lib/api';
import { openCheckout } from '@/lib/razorpay';

// Friday Jobs plans: how many applications Auto Apply sends a day, and how many resumes. One payment
// for 30 days through Razorpay; buying again extends it.

export default function PlansPage() {
  const [status, setStatus] = useState<JobsPlanStatus | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  const load = () => api<JobsPlanStatus>('/v1/jobs-plan').then(setStatus);
  useEffect(() => {
    load().catch((e) => setNotice({ ok: false, text: (e as Error).message }));
  }, []);

  async function buy(plan: JobsPlan) {
    setBusy(plan.id);
    setNotice(null);
    try {
      const order = await api<CheckoutOrder>('/v1/billing/orders', { method: 'POST', body: JSON.stringify({ productId: `jobs_${plan.id}` }) });
      const outcome = await openCheckout(order);
      if (outcome.status === 'paid') {
        await api<BillingOverview>('/v1/billing/verify', { method: 'POST', body: JSON.stringify(outcome.response) });
        await load();
        setNotice({ ok: true, text: `${plan.name} is active for 30 days.` });
      } else if (outcome.status === 'failed') {
        setNotice({ ok: false, text: outcome.message });
      }
    } catch (e) {
      setNotice({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  if (!status) {
    return <div className="grid min-h-[60vh] place-items-center">{notice ? <p className="text-sm text-danger">{notice.text}</p> : <Spinner className="text-muted" />}</div>;
  }
  const current = status.plan;

  return (
    <div className="mx-auto max-w-5xl px-4 pt-8 pb-16 sm:px-8">
      <h1 className="text-2xl font-semibold tracking-tight sm:text-[28px]">Plans</h1>
      <p className="mt-1 text-muted">
        You&rsquo;re on <span className="font-medium text-fg">{current.name}</span>
        {status.expiresAt && <> until {new Date(status.expiresAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'long' })}</>}:
        {' '}{current.dailyApplications} applications a day, {current.resumes} resume{current.resumes === 1 ? '' : 's'}.
      </p>
      {notice && (
        <p className={`mt-4 rounded-xl border px-4 py-3 text-sm ${notice.ok ? 'border-brand/20 bg-brand/5 text-brand' : 'border-danger/20 bg-danger/5 text-danger'}`}>
          {notice.text}
        </p>
      )}

      <div className="mt-8 grid gap-4 md:grid-cols-3">
        {status.plans
          .filter((p) => p.id !== 'free')
          .map((p) => {
            const popular = p.id === 'standard';
            const active = current.id === p.id;
            return (
              <section key={p.id} className={`card relative flex flex-col p-6 ${popular ? 'ring-2 ring-brand' : ''}`}>
                {popular && <span className="absolute -top-3 left-6 rounded-full bg-brand px-2.5 py-0.5 text-xs font-semibold text-white">Most popular</span>}
                <h2 className="flex items-center gap-1.5 font-semibold">
                  {p.id === 'premium' && <Crown size={16} className="text-amber-600" />} {p.name}
                </h2>
                <p className="mt-3">
                  <span className="text-3xl font-semibold tracking-tight">{formatInr(p.amount)}</span>
                  <span className="text-sm text-muted"> / 30 days</span>
                </p>
                <ul className="mt-5 flex-1 space-y-2 text-sm">
                  {p.highlights.map((h) => (
                    <li key={h} className="flex items-start gap-2">
                      <Check size={15} className="mt-0.5 shrink-0 text-brand" /> {h}
                    </li>
                  ))}
                </ul>
                <button disabled={busy !== null} onClick={() => buy(p)} className={`btn mt-6 ${popular ? 'btn-brand' : 'btn-secondary'}`}>
                  {busy === p.id ? <Spinner /> : active ? 'Add 30 days' : `Get ${p.name}`}
                </button>
              </section>
            );
          })}
      </div>
      <p className="mt-6 text-xs text-faint">
        Free: {status.plans.find((p) => p.id === 'free')?.dailyApplications} applications a day. Plans don&rsquo;t renew on their own; buy again to
        extend. Applications are sent only where a job board allows it, and never past a CAPTCHA.
      </p>
    </div>
  );
}
