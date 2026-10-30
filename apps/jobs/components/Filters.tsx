'use client';
import { useEffect, useRef, useState } from 'react';
import { ArrowDownWideNarrow, Check, ChevronDown, Search, Wallet, X } from 'lucide-react';
import {
  COMPANY_TYPES, JOB_TYPES, JOB_TYPE_LABELS, LEVELS, PLATFORMS, POSTED_WITHIN, WORKPLACES, WORKPLACE_LABELS, type FeedFacets, type FeedFilters,
  type FeedSort,
} from '@parakeet/shared';
import { CompanyLogo } from './ui';
import { activeFilterCount } from '@/lib/filters';

function Toggle({ on, onClick, icon, label, count }: {
  on: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  count?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={`flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium transition ${
        on ? 'border-brand/40 bg-brand/[0.07] text-emerald-800' : 'border-line bg-surface text-muted hover:border-line-strong hover:text-fg'
      }`}
    >
      {icon}
      {label}
      {count !== undefined && <span className="text-xs text-faint tabular-nums">{count.toLocaleString('en-IN')}</span>}
    </button>
  );
}

function Popover({
  label,
  active,
  count,
  children,
  align = 'left',
  icon,
}: {
  label: string;
  active: boolean;
  /** Shown after the label, e.g. how many values are picked. */
  count?: number;
  children: (close: () => void) => React.ReactNode;
  align?: 'left' | 'right';
  icon?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={`flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium transition ${
          active
            ? 'border-brand/40 bg-brand/[0.07] text-emerald-800'
            : open
              ? 'border-line-strong bg-surface text-fg'
              : 'border-line bg-surface text-muted hover:border-line-strong hover:text-fg'
        }`}
      >
        {icon}
        {label}
        {count ? (
          <span className="grid h-5 min-w-5 place-items-center rounded-full bg-brand px-1.5 text-[11px] font-semibold text-white">{count}</span>
        ) : null}
        <ChevronDown size={14} className={`transition ${open ? 'rotate-180' : ''} ${active ? 'text-brand' : 'text-faint'}`} />
      </button>
      {open && (
        <div
          className={`absolute top-11 z-30 w-72 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-line bg-surface shadow-[0_16px_48px_-12px_rgb(12_19_34_/_0.25)] ${
            align === 'right' ? 'right-0' : 'left-0'
          }`}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

function Option({
  checked,
  onClick,
  children,
  count,
  radio,
}: {
  checked: boolean;
  onClick: () => void;
  children: React.ReactNode;
  count?: number;
  radio?: boolean;
}) {
  const empty = count === 0 && !checked;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-sm transition hover:bg-surface-2 ${empty ? 'opacity-45' : ''}`}
    >
      <span
        className={`grid size-[18px] shrink-0 place-items-center border transition ${radio ? 'rounded-full' : 'rounded-[5px]'} ${
          checked ? 'border-brand bg-brand text-white' : 'border-line-strong bg-surface'
        }`}
      >
        {checked && (radio ? <span className="size-1.5 rounded-full bg-white" /> : <Check size={12} strokeWidth={3} />)}
      </span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {count !== undefined && <span className="text-xs text-faint tabular-nums">{count.toLocaleString('en-IN')}</span>}
    </button>
  );
}

function MenuFooter({ onClear, close, disabled }: { onClear: () => void; close: () => void; disabled: boolean }) {
  return (
    <div className="flex items-center justify-between border-t border-line bg-surface-2/50 px-3 py-2">
      <button type="button" disabled={disabled} onClick={onClear} className="text-sm font-medium text-muted hover:text-fg disabled:opacity-40">
        Clear
      </button>
      <button type="button" onClick={close} className="btn btn-primary !px-3 !py-1.5 !text-xs">
        Done
      </button>
    </div>
  );
}

const toggle = <T,>(list: T[] | undefined, v: T) => (list?.includes(v) ? list.filter((x) => x !== v) : [...(list ?? []), v]);

function CompanyMenu({ filters, facets, onChange, close }: {
  filters: FeedFilters;
  facets: FeedFacets | null;
  onChange: (f: Partial<FeedFilters>) => void;
  close: () => void;
}) {
  const [find, setFind] = useState('');
  const picked = filters.company ?? [];
  const known = facets?.company ?? [];
  // Picked companies stay listed even when the other filters leave them with no jobs.
  const rows = [
    ...known,
    ...picked.filter((c) => !known.some((k) => k.company === c)).map((c) => ({ company: c, website: null, count: 0 })),
  ].filter((c) => c.company.toLowerCase().includes(find.trim().toLowerCase()));

  return (
    <>
      <div className="border-b border-line p-2">
        <label className="relative block">
          <Search size={14} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-faint" />
          <input autoFocus value={find} onChange={(e) => setFind(e.target.value)} placeholder="Find a company" className="input !py-2 !pl-8 text-sm" />
        </label>
      </div>
      <div className="max-h-72 overflow-y-auto p-1.5">
        {rows.length === 0 && <p className="px-3 py-6 text-center text-sm text-muted">No companies here</p>}
        {rows.map((c) => (
          <Option key={c.company} checked={picked.includes(c.company)} count={c.count} onClick={() => onChange({ company: toggle(picked, c.company) })}>
            <span className="flex items-center gap-2.5">
              <CompanyLogo company={c.company} website={c.website} size={22} />
              {c.company}
            </span>
          </Option>
        ))}
      </div>
      <MenuFooter disabled={!picked.length} onClear={() => onChange({ company: [] })} close={close} />
    </>
  );
}

const SORT_LABELS: Record<FeedSort, string> = { match: 'Best match', newest: 'Newest' };
const MIN_SCORES = [0, 60, 70, 80, 90];

export function SortMenu({ sort, onChange }: { sort: FeedSort; onChange: (s: FeedSort) => void }) {
  return (
    <Popover label={`Sort: ${SORT_LABELS[sort]}`} active={false} align="right" icon={<ArrowDownWideNarrow size={15} className="text-faint" />}>
      {(close) => (
        <div className="p-1.5">
          {(Object.keys(SORT_LABELS) as FeedSort[]).map((s) => (
            <Option key={s} radio checked={sort === s} onClick={() => { onChange(s); close(); }}>
              {SORT_LABELS[s]}
            </Option>
          ))}
        </div>
      )}
    </Popover>
  );
}

/** The filter menus for a browsing view. Counts come from `facets`; every change applies at once. */
export function FilterBar({
  filters,
  facets,
  onChange,
  showMatch,
  hide = [],
}: {
  filters: FeedFilters;
  facets: FeedFacets | null;
  onChange: (f: Partial<FeedFilters>) => void;
  /** The match-score menu: only where jobs have scores. */
  showMatch: boolean;
  /** Menus for filters the page pins, e.g. workplace on Remote jobs. */
  hide?: string[];
}) {
  const active = activeFilterCount({ ...filters, ...Object.fromEntries(hide.map((k) => [k, undefined])) });
  const posted = POSTED_WITHIN.find((p) => p.days === filters.posted);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Popover label={posted?.label ?? 'Date posted'} active={Boolean(posted)}>
        {(close) => (
          <div className="p-1.5">
            <Option radio checked={!filters.posted} onClick={() => { onChange({ posted: undefined }); close(); }}>
              Any time
            </Option>
            {POSTED_WITHIN.map((p) => (
              <Option key={p.days} radio checked={filters.posted === p.days} onClick={() => { onChange({ posted: p.days }); close(); }}>
                {p.label}
              </Option>
            ))}
          </div>
        )}
      </Popover>

      <Popover label="Experience" active={Boolean(filters.level?.length)} count={filters.level?.length}>
        {(close) => (
          <>
            <div className="p-1.5">
              {LEVELS.map((l) => (
                <Option key={l.id} checked={Boolean(filters.level?.includes(l.id))} count={facets?.level[l.id] ?? 0} onClick={() => onChange({ level: toggle(filters.level, l.id) })}>
                  {l.label}
                </Option>
              ))}
            </div>
            <MenuFooter disabled={!filters.level?.length} onClear={() => onChange({ level: [] })} close={close} />
          </>
        )}
      </Popover>

      {!hide.includes('workplace') && (
        <Popover label="Workplace" active={Boolean(filters.workplace?.length)} count={filters.workplace?.length}>
          {(close) => (
            <>
              <div className="p-1.5">
                {WORKPLACES.map((w) => (
                  <Option key={w} checked={Boolean(filters.workplace?.includes(w))} count={facets?.workplace[w] ?? 0} onClick={() => onChange({ workplace: toggle(filters.workplace, w) })}>
                    {WORKPLACE_LABELS[w]}
                  </Option>
                ))}
              </div>
              <MenuFooter disabled={!filters.workplace?.length} onClear={() => onChange({ workplace: [] })} close={close} />
            </>
          )}
        </Popover>
      )}

      <Popover label="Job type" active={Boolean(filters.type?.length)} count={filters.type?.length}>
        {(close) => (
          <>
            <div className="p-1.5">
              {JOB_TYPES.map((t) => (
                <Option key={t} checked={Boolean(filters.type?.includes(t))} count={facets?.type[t] ?? 0} onClick={() => onChange({ type: toggle(filters.type, t) })}>
                  {JOB_TYPE_LABELS[t]}
                </Option>
              ))}
            </div>
            <MenuFooter disabled={!filters.type?.length} onClear={() => onChange({ type: [] })} close={close} />
          </>
        )}
      </Popover>

      <Popover label="Platform" active={Boolean(filters.platform?.length)} count={filters.platform?.length}>
        {(close) => (
          <>
            <div className="p-1.5">
              {PLATFORMS.map((p) => (
                <Option key={p.id} checked={Boolean(filters.platform?.includes(p.id))} count={facets?.platform[p.id] ?? 0} onClick={() => onChange({ platform: toggle(filters.platform, p.id) })}>
                  {p.label}
                </Option>
              ))}
            </div>
            <MenuFooter disabled={!filters.platform?.length} onClear={() => onChange({ platform: [] })} close={close} />
          </>
        )}
      </Popover>

      <Popover label="Company type" active={Boolean(filters.companyType?.length)} count={filters.companyType?.length}>
        {(close) => (
          <>
            <div className="p-1.5">
              {COMPANY_TYPES.map((c) => (
                <Option key={c.id} checked={Boolean(filters.companyType?.includes(c.id))} count={facets?.companyType[c.id] ?? 0} onClick={() => onChange({ companyType: toggle(filters.companyType, c.id) })}>
                  {c.label}
                </Option>
              ))}
            </div>
            <MenuFooter disabled={!filters.companyType?.length} onClear={() => onChange({ companyType: [] })} close={close} />
          </>
        )}
      </Popover>

      <Popover label="Company" active={Boolean(filters.company?.length)} count={filters.company?.length}>
        {(close) => <CompanyMenu filters={filters} facets={facets} onChange={onChange} close={close} />}
      </Popover>

      {showMatch && (
        <Popover label={filters.minScore ? `${filters.minScore}%+ match` : 'Match'} active={Boolean(filters.minScore)}>
          {(close) => (
            <div className="p-1.5">
              {MIN_SCORES.map((m) => (
                <Option key={m} radio checked={(filters.minScore ?? 0) === m} onClick={() => { onChange({ minScore: m || undefined }); close(); }}>
                  {m ? `${m}% match or better` : 'Any match'}
                </Option>
              ))}
            </div>
          )}
        </Popover>
      )}

      <Toggle
        on={Boolean(filters.salary)}
        onClick={() => onChange({ salary: !filters.salary || undefined })}
        icon={<Wallet size={14} className={filters.salary ? 'text-brand' : 'text-faint'} />}
        label="Salary listed"
        count={facets?.withSalary}
      />

      {active > 0 && (
        <button
          type="button"
          onClick={() => onChange({ workplace: [], level: [], type: [], company: [], posted: undefined, minScore: undefined, salary: undefined, companyType: [], platform: [] })}
          className="flex h-9 items-center gap-1 rounded-full px-2.5 text-sm font-medium text-muted hover:text-fg"
        >
          <X size={14} /> Clear all
        </button>
      )}
    </div>
  );
}
