'use client';
import { useEffect, useRef, useState } from 'react';
import { PRACTICE_SCORE_LABELS, scoreOutOf10, type PracticeScores } from '@parakeet/shared';

export interface TrendPoint {
  id: string;
  score: number;
  date: string;
  title: string;
}

const H = 180;
const PAD = { top: 14, right: 16, bottom: 26, left: 32 };
const GRID = [0, 50, 100];

const shortDate = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

/** Score per practice session over time: one series, so the title names it and there is no legend. */
export function ScoreTrend({ points }: { points: TrendPoint[] }) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const [active, setActive] = useState<number | null>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(240, e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const innerW = width - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (points.length === 1 ? innerW / 2 : (i / (points.length - 1)) * innerW);
  const y = (score: number) => PAD.top + innerH - (score / 100) * innerH;
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.score).toFixed(1)}`).join(' ');
  const area = points.length > 1 ? `${path} L${x(points.length - 1)},${y(0)} L${x(0)},${y(0)} Z` : '';

  // The crosshair snaps to the nearest session.
  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    let best = 0;
    for (let i = 1; i < points.length; i++) if (Math.abs(x(i) - px) < Math.abs(x(best) - px)) best = i;
    setActive(best);
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowRight') setActive((a) => Math.min(points.length - 1, (a ?? -1) + 1));
    else if (e.key === 'ArrowLeft') setActive((a) => Math.max(0, (a ?? points.length) - 1));
    else return;
    e.preventDefault();
  };

  const labelEvery = Math.max(1, Math.ceil(points.length / Math.floor(innerW / 70)));
  const p = active !== null ? points[active] : null;
  // High points show the readout underneath, so it never covers the chart's title.
  const flip = p !== null && y(p.score) < 80;

  return (
    <div ref={box} className="relative">
      <svg
        width={width}
        height={H}
        role="img"
        aria-label={`Practice scores over ${points.length} sessions. Use the arrow keys to read each one.`}
        tabIndex={0}
        onPointerMove={onMove}
        onPointerLeave={() => setActive(null)}
        onKeyDown={onKey}
        onBlur={() => setActive(null)}
        className="block touch-none overflow-visible outline-none focus-visible:rounded-lg focus-visible:ring-2 focus-visible:ring-brand/50"
      >
        <defs>
          <linearGradient id="trend-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-brand)" stopOpacity="0.18" />
            <stop offset="100%" stopColor="var(--color-brand)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {GRID.map((g) => (
          <g key={g}>
            <line x1={PAD.left} x2={width - PAD.right} y1={y(g)} y2={y(g)} stroke="rgb(255 255 255 / 0.06)" />
            <text x={PAD.left - 8} y={y(g)} dy="0.32em" textAnchor="end" className="fill-faint text-[10px] tabular-nums">
              {g / 10}
            </text>
          </g>
        ))}
        {points.map(
          (pt, i) =>
            i % labelEvery === 0 && (
              <text key={pt.id} x={x(i)} y={H - 6} textAnchor="middle" className="fill-faint text-[10px]">
                {shortDate(pt.date)}
              </text>
            ),
        )}
        {area && <path d={area} fill="url(#trend-fill)" />}
        <path d={path} fill="none" stroke="var(--color-brand)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {active !== null && (
          <line x1={x(active)} x2={x(active)} y1={PAD.top} y2={y(0)} stroke="rgb(255 255 255 / 0.25)" strokeDasharray="3 3" />
        )}
        {points.map((pt, i) => (
          <circle
            key={pt.id}
            cx={x(i)}
            cy={y(pt.score)}
            r={active === i ? 5.5 : 4}
            fill="var(--color-brand)"
            stroke="var(--color-surface)"
            strokeWidth={2}
            className="transition-[r]"
          />
        ))}
      </svg>
      {p && active !== null && (
        <div
          className={`pointer-events-none absolute z-10 -translate-x-1/2 rounded-lg border border-line-strong bg-surface-2/95 px-3 py-2 text-xs shadow-xl backdrop-blur ${
            flip ? '' : '-translate-y-full'
          }`}
          style={{ left: Math.min(Math.max(x(active), 70), width - 70), top: flip ? y(p.score) + 12 : y(p.score) - 10 }}
        >
          <p className="text-sm font-semibold tabular-nums">{scoreOutOf10(p.score)}</p>
          <p className="max-w-40 truncate text-muted">{p.title}</p>
          <p className="text-faint">{shortDate(p.date)}</p>
        </div>
      )}
      <table className="sr-only">
        <caption>Practice scores</caption>
        <thead>
          <tr>
            <th>Date</th>
            <th>Session</th>
            <th>Score</th>
          </tr>
        </thead>
        <tbody>
          {points.map((pt) => (
            <tr key={pt.id}>
              <td>{shortDate(pt.date)}</td>
              <td>{pt.title}</td>
              <td>{scoreOutOf10(pt.score)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** One bar per scoring category (0–10). */
export function ScoreBars({ scores, compact }: { scores: PracticeScores; compact?: boolean }) {
  return (
    <dl className={compact ? 'space-y-1.5' : 'space-y-3'}>
      {PRACTICE_SCORE_LABELS.filter(({ key }) => scores[key] !== undefined).map(({ key, label }) => (
        <div key={key} className="grid grid-cols-[6.5rem_1fr_2rem] items-center gap-3">
          <dt className={`text-muted ${compact ? 'text-xs' : 'text-sm'}`}>{label}</dt>
          <dd className={`overflow-hidden rounded bg-white/[0.06] ${compact ? 'h-1.5' : 'h-2'}`}>
            <div className="h-full rounded bg-brand transition-[width] duration-700" style={{ width: `${scores[key]! * 10}%` }} />
          </dd>
          <dd className={`text-right tabular-nums ${compact ? 'text-xs' : 'text-sm'}`}>{Math.round(scores[key]! * 10) / 10}</dd>
        </div>
      ))}
    </dl>
  );
}
