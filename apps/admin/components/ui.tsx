'use client';
import { useEffect } from 'react';
import type { LucideIcon } from 'lucide-react';
import { ArrowDownRight, ArrowUpRight, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { compact, pct } from '@/lib/format';

export function Card({
  title,
  icon: Icon,
  action,
  children,
  className = '',
  pad = true,
}: {
  title?: React.ReactNode;
  icon?: LucideIcon;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  pad?: boolean;
}) {
  return (
    <section className={`glass min-w-0 rounded-[var(--radius-card)] ${pad ? 'p-5' : ''} ${className}`}>
      {title && (
        <header className={`flex items-center justify-between gap-3 ${pad ? 'mb-4' : 'px-5 pt-5 pb-4'}`}>
          <div className="flex min-w-0 items-center gap-2.5">
            {Icon && (
              <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-white/5 text-brand ring-1 ring-line">
                <Icon size={16} />
              </span>
            )}
            <h2 className="truncate text-sm font-semibold">{title}</h2>
          </div>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

const tones = {
  ok: 'bg-brand/10 text-brand ring-brand/25',
  warn: 'bg-warn/10 text-warn ring-warn/25',
  bad: 'bg-danger/10 text-danger ring-danger/25',
  info: 'bg-accent/10 text-accent ring-accent/25',
  neutral: 'bg-white/5 text-muted ring-line',
};
export type Tone = keyof typeof tones;

export function Pill({ tone = 'neutral', children }: { tone?: Tone; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${tones[tone]}`}>
      {children}
    </span>
  );
}

export function Dot({ tone, pulse }: { tone: 'ok' | 'bad' | 'warn' | 'neutral'; pulse?: boolean }) {
  const c = { ok: 'bg-brand', bad: 'bg-danger', warn: 'bg-warn', neutral: 'bg-faint' }[tone];
  return (
    <span className="relative flex size-2 shrink-0">
      {pulse && <span className={`absolute inline-flex size-full animate-ping rounded-full opacity-60 ${c}`} />}
      <span className={`relative inline-flex size-2 rounded-full ${c}`} />
    </span>
  );
}

export function Spinner({ className = '' }: { className?: string }) {
  return <span className={`inline-block size-4 animate-spin rounded-full border-2 border-current border-r-transparent ${className}`} />;
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {action}
    </header>
  );
}

/** KPI tile: label, value, optional change vs a named period (up = good unless `invert`). */
export function Stat({
  label,
  value,
  delta,
  deltaLabel = 'vs prev 7d',
  hint,
  invert,
}: {
  label: string;
  value: React.ReactNode;
  delta?: number | null;
  deltaLabel?: string;
  hint?: React.ReactNode;
  invert?: boolean;
}) {
  const good = delta !== undefined && delta !== null && (invert ? delta < 0 : delta > 0);
  return (
    <div className="glass min-w-0 rounded-2xl p-4">
      <p className="truncate text-xs text-muted">{label}</p>
      <p className="mt-1.5 text-2xl font-semibold tracking-tight">{typeof value === 'number' ? compact(value) : value}</p>
      {delta !== undefined && delta !== null ? (
        <p className="mt-1 flex items-center gap-1 text-xs">
          <span className={`inline-flex items-center ${delta === 0 ? 'text-muted' : good ? 'text-brand' : 'text-danger'}`}>
            {delta > 0 ? <ArrowUpRight size={13} /> : delta < 0 ? <ArrowDownRight size={13} /> : null}
            {pct(Math.abs(delta))}
          </span>
          <span className="text-faint">{deltaLabel}</span>
        </p>
      ) : (
        hint && <p className="mt-1 truncate text-xs text-faint">{hint}</p>
      )}
    </div>
  );
}

export function ErrorNote({ children }: { children: React.ReactNode }) {
  return <p className="rounded-xl border border-danger/25 bg-danger/10 px-4 py-3 text-sm text-danger">{children}</p>;
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="px-5 py-10 text-center text-sm text-muted">{children}</p>;
}

export function Pager({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="flex items-center justify-between gap-3 border-t border-line px-5 py-3 text-xs text-muted">
      <span>
        {total === 0 ? 'No results' : `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} of ${total.toLocaleString()}`}
      </span>
      <div className="flex items-center gap-1">
        <button className="btn btn-ghost !p-1.5" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page">
          <ChevronLeft size={16} />
        </button>
        <span className="px-1 tabular-nums">
          {page} / {pages}
        </span>
        <button className="btn btn-ghost !p-1.5" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page">
          <ChevronRight size={16} />
        </button>
      </div>
    </div>
  );
}

/** Table shell with consistent header and row styles. */
export function Table({ head, children }: { head: React.ReactNode[]; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-left text-sm">
        <thead>
          <tr className="border-y border-line text-xs text-muted">
            {head.map((h, i) => (
              <th key={i} className="whitespace-nowrap px-5 py-2.5 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">{children}</tbody>
      </table>
    </div>
  );
}

export function Drawer({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: React.ReactNode; children: React.ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} aria-label="Close" />
      <aside className="relative flex h-full w-full max-w-2xl flex-col border-l border-line bg-surface shadow-2xl animate-fade-up">
        <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
          <h2 className="min-w-0 truncate font-semibold">{title}</h2>
          <button className="btn btn-ghost !p-1.5" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">{children}</div>
      </aside>
    </div>
  );
}

export const selectCls = 'input !w-auto !py-2 !pr-8 !text-sm';
