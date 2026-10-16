'use client';
import { useEffect, useRef, useState } from 'react';
import type { Breakdown, DayPoint } from '@parakeet/shared';
import { compact, dayLabel, int, pct } from '@/lib/format';

// Single-series charts on the dark surface. One hue (categorical slot 1, dark step) for every
// mark; text stays in the theme's text tokens. Gridlines are hairline and recessive.
const SERIES = '#3987e5';
const GRID = 'rgb(255 255 255 / 0.07)';

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

/** Rounds up to 1/2/5 × 10^n so ticks land on clean numbers. */
function niceMax(v: number) {
  if (v <= 4) return 4;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}

/** Column with a 4px rounded data end and a square baseline. */
function columnPath(x: number, y: number, w: number, h: number) {
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z`;
}

/** Daily counts as columns, with a hover tooltip per day. */
export function DailyColumns({ data, unit, height = 180 }: { data: DayPoint[]; unit: string; height?: number }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const padL = 32;
  const padB = 22;
  const padT = 8;
  const plotW = Math.max(0, width - padL);
  const plotH = height - padB - padT;
  const max = niceMax(Math.max(...data.map((d) => d.value), 0));
  const band = data.length ? plotW / data.length : 0;
  const barW = Math.max(2, Math.min(24, band - 2));
  const ticks = [0, max / 2, max];
  const total = data.reduce((s, d) => s + d.value, 0);
  const h = hover !== null ? data[hover] : null;

  return (
    <div ref={ref} className="relative" onMouseLeave={() => setHover(null)}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={`${unit} per day, last ${data.length} days: ${int(total)} total`}>
          {ticks.map((t) => {
            const y = padT + plotH - (t / max) * plotH;
            return (
              <g key={t}>
                <line x1={padL} x2={width} y1={y} y2={y} stroke={GRID} strokeWidth={1} />
                <text x={padL - 8} y={y} dy="0.32em" textAnchor="end" className="fill-faint text-[10px] tabular-nums">
                  {compact(t)}
                </text>
              </g>
            );
          })}
          {data.map((d, i) => {
            const bh = (d.value / max) * plotH;
            const x = padL + i * band + (band - barW) / 2;
            return (
              <g key={d.day}>
                {bh > 0 && (
                  <path d={columnPath(x, padT + plotH - bh, barW, bh)} fill={SERIES} opacity={hover === null || hover === i ? 1 : 0.45} />
                )}
                {/* Hit target: the whole band, taller than the mark. */}
                <rect x={padL + i * band} y={padT} width={band} height={plotH} fill="transparent" onMouseEnter={() => setHover(i)} />
              </g>
            );
          })}
          {[0, Math.floor((data.length - 1) / 2), data.length - 1].map((i) =>
            data[i] ? (
              <text
                key={i}
                x={padL + i * band + band / 2}
                y={height - 4}
                textAnchor={i === 0 ? 'start' : i === data.length - 1 ? 'end' : 'middle'}
                className="fill-faint text-[10px]"
              >
                {dayLabel(data[i].day)}
              </text>
            ) : null,
          )}
        </svg>
      )}
      {h && hover !== null && (
        <div
          className="pointer-events-none absolute z-10 -translate-x-1/2 whitespace-nowrap rounded-lg border border-line-strong bg-surface-2 px-2.5 py-1.5 text-xs shadow-xl"
          style={{ left: Math.min(Math.max(padL + hover * band + band / 2, 60), width - 60), top: 0 }}
        >
          <p className="text-muted">{dayLabel(h.day)}</p>
          <p className="font-semibold tabular-nums">
            {int(h.value)} {unit}
          </p>
        </div>
      )}
    </div>
  );
}

/** Horizontal bars for a breakdown, each labelled with its value and share. */
export function BarList({ items, empty = 'No data yet', percentOf }: { items: Breakdown[]; empty?: string; percentOf?: number }) {
  if (!items.length) return <p className="py-6 text-center text-sm text-muted">{empty}</p>;
  const max = Math.max(...items.map((i) => i.value), 1);
  const base = percentOf ?? items.reduce((s, i) => s + i.value, 0);
  return (
    <ul className="space-y-3">
      {items.map((it) => (
        <li key={it.label} className="group">
          <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 truncate" title={it.label}>
              {it.label}
            </span>
            <span className="shrink-0 tabular-nums text-muted">
              {int(it.value)}
              {base > 0 && <span className="ml-1.5 text-faint">{pct(it.value / base)}</span>}
            </span>
          </div>
          <div className="h-2 rounded-full bg-white/[0.04]">
            <div
              className="h-full rounded-full transition-[width] duration-500"
              style={{ width: `${Math.max((it.value / max) * 100, it.value ? 1.5 : 0)}%`, background: SERIES }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Funnel: each step's share of the first step and its conversion from the previous one. */
export function Funnel({ steps }: { steps: Breakdown[] }) {
  const first = steps[0]?.value ?? 0;
  return (
    <ol className="space-y-3">
      {steps.map((s, i) => {
        const prev = i > 0 ? steps[i - 1].value : null;
        return (
          <li key={s.label}>
            <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
              <span className="flex min-w-0 items-center gap-2">
                <span className="grid size-5 shrink-0 place-items-center rounded-full bg-white/5 text-[10px] text-muted ring-1 ring-line">{i + 1}</span>
                <span className="truncate">{s.label}</span>
              </span>
              <span className="shrink-0 tabular-nums">
                {int(s.value)}
                {prev !== null && prev > 0 && <span className="ml-1.5 text-xs text-faint">{pct(s.value / prev)} of prev</span>}
              </span>
            </div>
            <div className="h-2 rounded-full bg-white/[0.04]">
              <div
                className="h-full rounded-full"
                style={{ width: `${first ? Math.max((s.value / first) * 100, s.value ? 1.5 : 0) : 0}%`, background: SERIES }}
              />
            </div>
          </li>
        );
      })}
    </ol>
  );
}
