'use client';
import { useEffect, useState } from 'react';
import { AUTO_APPLY_STATUS_LABELS, AUTO_APPLY_STATUSES, type JobsAnalytics } from '@parakeet/shared';
import { Spinner } from '@/components/ui';
import { api } from '@/lib/api';

// How the user's applications are doing: volume, replies, and which sources and match levels get
// answers. Replies are what the user records on each application (Interviewing, Offer, Not selected).

const pct = (r: number) => `${Math.round(r * 100)}%`;
const BAR = 'var(--color-brand)';

function Stat({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="card p-4">
      <p className="text-xs font-semibold tracking-wider text-faint uppercase">{label}</p>
      <p className="mt-1.5 text-2xl font-semibold tracking-tight tabular-nums">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-muted">{sub}</p>}
    </div>
  );
}

/** Applications per day: one series, so no legend; hover a day for its numbers. */
function Daily({ data }: { data: JobsAnalytics['daily'] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...data.map((d) => d.applied));
  const w = 100 / data.length;
  const h = hover !== null ? data[hover] : null;
  return (
    <div className="relative">
      <svg viewBox="0 0 100 40" preserveAspectRatio="none" className="h-44 w-full" role="img" aria-label="Applications per day">
        <line x1="0" x2="100" y1="40" y2="40" stroke="var(--color-line-strong)" strokeWidth="0.3" vectorEffect="non-scaling-stroke" />
        {data.map((d, i) => {
          const bh = (d.applied / max) * 38;
          return (
            <g key={d.day} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              {/* Hit target: the whole column. */}
              <rect x={i * w} y={0} width={w} height={40} fill="transparent" />
              {d.applied > 0 && (
                <rect x={i * w + w * 0.18} y={40 - bh} width={w * 0.64} height={bh} rx={0.6} fill={BAR} opacity={hover === null || hover === i ? 1 : 0.45} />
              )}
            </g>
          );
        })}
      </svg>
      <div className="mt-1.5 flex justify-between text-[11px] text-faint tabular-nums">
        <span>{data[0]?.day.slice(5)}</span>
        <span>{data[data.length - 1]?.day.slice(5)}</span>
      </div>
      {h && (
        <div
          className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs shadow-md"
          style={{ left: `${(hover! + 0.5) * w}%` }}
        >
          <p className="font-medium">{new Date(h.day).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</p>
          <p className="text-muted">
            {h.applied} applied · {h.responses} replies
          </p>
        </div>
      )}
    </div>
  );
}

/** A labelled horizontal bar for a rate, with the counts beside it in text. */
function RateRow({ label, applied, responses, rate, best }: { label: string; applied: number; responses: number; rate: number; best: number }) {
  return (
    <tr className="border-t border-line">
      <td className="py-2.5 pr-3 font-medium">{label}</td>
      <td className="py-2.5 pr-3 text-right tabular-nums">{applied}</td>
      <td className="py-2.5 pr-3 text-right tabular-nums">{responses}</td>
      <td className="w-1/2 py-2.5">
        <div className="flex items-center gap-2" title={`${pct(rate)} replied`}>
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-3">
            <div className="h-full rounded-full" style={{ width: `${best ? (rate / best) * 100 : 0}%`, background: BAR }} />
          </div>
          <span className="w-10 text-right text-xs tabular-nums text-muted">{pct(rate)}</span>
        </div>
      </td>
    </tr>
  );
}

function RateTable({ title, rows }: { title: string; rows: { label: string; applied: number; responses: number; rate: number }[] }) {
  const best = Math.max(0, ...rows.map((r) => r.rate));
  return (
    <section className="card p-5">
      <h2 className="font-semibold">{title}</h2>
      {rows.some((r) => r.applied) ? (
        <table className="mt-3 w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-faint">
              <th className="pb-2 font-medium" />
              <th className="pb-2 pr-3 text-right font-medium">Applied</th>
              <th className="pb-2 pr-3 text-right font-medium">Replies</th>
              <th className="pb-2 font-medium">Reply rate</th>
            </tr>
          </thead>
          <tbody>
            {rows.filter((r) => r.applied).map((r) => (
              <RateRow key={r.label} {...r} best={best} />
            ))}
          </tbody>
        </table>
      ) : (
        <p className="mt-3 text-sm text-muted">No applications in this period yet.</p>
      )}
    </section>
  );
}

export default function AnalyticsPage() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<JobsAnalytics | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setData(null);
    api<JobsAnalytics>(`/v1/jobs-analytics?days=${days}`).then(setData, (e) => setError((e as Error).message));
  }, [days]);

  return (
    <div className="mx-auto max-w-5xl px-4 pt-8 pb-16 sm:px-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-[28px]">Analytics</h1>
          <p className="mt-1 text-muted">Replies are what you record on each application in Applied.</p>
        </div>
        <div className="flex rounded-lg border border-line bg-surface p-0.5 text-sm">
          {[7, 30, 90].map((d) => (
            <button key={d} onClick={() => setDays(d)} className={`rounded-md px-3 py-1.5 font-medium ${days === d ? 'bg-surface-2 text-fg' : 'text-muted'}`}>
              {d} days
            </button>
          ))}
        </div>
      </div>

      {!data ? (
        <div className="grid h-64 place-items-center">{error ? <p className="text-sm text-danger">{error}</p> : <Spinner className="text-muted" />}</div>
      ) : (
        <div className="mt-6 space-y-6">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <Stat label="Applied" value={data.totals.applied} sub={`${data.totals.auto} by Auto Apply`} />
            <Stat label="Replies" value={data.totals.responses} />
            <Stat label="Reply rate" value={pct(data.totals.responseRate)} />
            <Stat label="Interviews" value={data.totals.interviews} />
            <Stat label="Offers" value={data.totals.offers} />
          </div>

          <section className="card p-5">
            <h2 className="font-semibold">Applications per day</h2>
            <div className="mt-4">
              <Daily data={data.daily} />
            </div>
          </section>

          <div className="grid gap-6 md:grid-cols-2">
            <RateTable title="By job board" rows={data.bySource} />
            <RateTable title="By match score" rows={data.byScore.map((b) => ({ ...b, label: b.band }))} />
          </div>

          <section className="card p-5">
            <h2 className="font-semibold">Auto Apply</h2>
            <div className="mt-3 grid grid-cols-3 gap-3 sm:grid-cols-6">
              {AUTO_APPLY_STATUSES.map((s) => (
                <div key={s} className="rounded-xl bg-surface-2/60 p-3">
                  <p className="text-xs text-muted">{AUTO_APPLY_STATUS_LABELS[s]}</p>
                  <p className="mt-0.5 text-lg font-semibold tabular-nums">{data.autoApply[s]}</p>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
