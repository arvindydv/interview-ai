'use client';
import { useId } from 'react';
import { Check, ChevronDown, Radio } from 'lucide-react';
import { INTERVIEW_STAGES, type InterviewStage } from '@parakeet/shared';
import { STAGE_TONE, monogram, stageLabel, type ReadinessItem } from '@/lib/interviews';
import { Menu } from '@/components/overlay';

export function Monogram({ name, size = 44 }: { name: string; size?: number }) {
  const { initials, gradient } = monogram(name || '?');
  return (
    <span
      aria-hidden
      style={{ width: size, height: size, fontSize: size * 0.36 }}
      className={`grid shrink-0 place-items-center rounded-xl bg-gradient-to-br ${gradient} font-semibold tracking-tight text-bg shadow-lg shadow-black/30 ring-1 ring-white/20`}
    >
      {initials}
    </span>
  );
}

export function StageBadge({ stage }: { stage: InterviewStage }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ${STAGE_TONE[stage]}`}>
      {stageLabel(stage)}
    </span>
  );
}

/** The stage badge, which opens a menu to change it. */
export function StagePicker({ stage, onChange }: { stage: InterviewStage; onChange: (s: InterviewStage) => void }) {
  return (
    <Menu
      label={`Stage: ${stageLabel(stage)}. Change`}
      align="left"
      triggerClassName={`inline-flex items-center gap-1 rounded-full py-0.5 pr-1.5 pl-2.5 text-xs font-medium ring-1 transition hover:brightness-125 ${STAGE_TONE[stage]}`}
      trigger={
        <>
          {stageLabel(stage)} <ChevronDown size={12} />
        </>
      }
      items={INTERVIEW_STAGES.map((s) => ({ label: s.label, checked: s.id === stage, onSelect: () => onChange(s.id) }))}
    />
  );
}

export function ActiveBadge() {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-brand/10 px-2.5 py-0.5 text-xs font-medium text-brand ring-1 ring-brand/30">
      <Radio size={12} /> Active
    </span>
  );
}

const scoreColor = (score: number) => (score >= 80 ? 'var(--color-brand)' : score >= 50 ? 'var(--color-brand-2)' : 'var(--color-warn)');

/** Circular 0–100 score. */
export function ReadinessRing({
  score,
  size = 76,
  stroke = 7,
  label = 'Readiness',
  outOf10,
}: {
  score: number;
  size?: number;
  stroke?: number;
  label?: string;
  /** Show the 0–100 score out of 10 (practice scores). */
  outOf10?: boolean;
}) {
  const id = useId();
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} role="img" aria-label={outOf10 ? `${label} ${(score / 10).toFixed(1)} out of 10` : `${label} ${score}%`}>
      <svg width={size} height={size} className="-rotate-90">
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={scoreColor(score)} />
            <stop offset="100%" stopColor={score >= 80 ? 'var(--color-brand-2)' : scoreColor(score)} />
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgb(255 255 255 / 0.07)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={`url(#${id})`}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - score / 100)}
          className="transition-[stroke-dashoffset] duration-700 ease-[cubic-bezier(0.2,0.7,0.2,1)]"
        />
      </svg>
      <span className="absolute inset-0 grid place-items-center text-center">
        <span className="font-semibold tabular-nums" style={{ fontSize: size * 0.24 }}>
          {outOf10 ? (score / 10).toFixed(1) : score}
          <span className="text-muted" style={{ fontSize: size * 0.13 }}>{outOf10 ? '/10' : '%'}</span>
        </span>
      </span>
    </div>
  );
}

/** Thin readiness bar for compact rows. */
export function ReadinessBar({ score }: { score: number }) {
  return (
    <div className="flex items-center gap-2" title={`Readiness ${score}%`}>
      <div className="h-1 w-14 overflow-hidden rounded-full bg-white/[0.07]">
        <div className="h-full rounded-full transition-all duration-700" style={{ width: `${score}%`, background: scoreColor(score) }} />
      </div>
      <span className="text-xs tabular-nums text-muted">{score}%</span>
    </div>
  );
}

export function ReadinessList({ items, onFix }: { items: ReadinessItem[]; onFix?: (key: string) => void }) {
  return (
    <ul className="space-y-1">
      {items.map((it) => (
        <li key={it.key}>
          <button
            type="button"
            disabled={it.done || !onFix}
            onClick={() => onFix?.(it.key)}
            className="group flex w-full items-start gap-3 rounded-lg px-2 py-2 text-left transition enabled:hover:bg-white/[0.04]"
          >
            <span
              className={`mt-0.5 grid size-[18px] shrink-0 place-items-center rounded-full ring-1 transition ${
                it.done ? 'bg-brand text-bg ring-brand' : 'ring-line-strong group-enabled:group-hover:ring-brand/60'
              }`}
            >
              {it.done && <Check size={11} strokeWidth={3} />}
            </span>
            <span className="min-w-0 flex-1">
              <span className={`block text-sm ${it.done ? 'text-muted' : 'text-fg'}`}>{it.label}</span>
              {!it.done && <span className="block text-xs text-faint">{it.hint}</span>}
            </span>
            {!it.done && <span className="mt-0.5 text-xs text-faint tabular-nums">+{it.weight}</span>}
          </button>
        </li>
      ))}
    </ul>
  );
}
