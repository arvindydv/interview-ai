import { Briefcase, EyeOff, FileText, Lock, ShieldCheck, Sparkles, Star, Trash2, Zap } from 'lucide-react';

const css = (v: Record<string, string | number>) => v as React.CSSProperties;

/** Live Assist: an audio waveform feeding a streaming answer. */
export function LiveVisual() {
  const bars = Array.from({ length: 32 }, (_, i) => 0.35 + Math.abs(Math.sin(i * 1.7)) * 0.65);
  return (
    <div className="grid gap-4 sm:grid-cols-[1fr_1.2fr] sm:items-center">
      <div className="flex h-24 items-center gap-[3px] rounded-xl bg-bg/60 px-4 ring-1 ring-line">
        {bars.map((h, i) => (
          <span
            key={i}
            className="wave-bar w-full rounded-full bg-gradient-to-t from-brand to-brand-2"
            style={css({ '--i': i, height: `${h * 100}%` })}
          />
        ))}
      </div>
      <div className="rounded-xl bg-bg/60 p-4 ring-1 ring-brand/25">
        <div className="mb-3 flex items-center gap-2 text-[11px]">
          <Sparkles size={12} className="text-brand" />
          <span className="font-semibold">Answer</span>
          <span className="ml-auto flex items-center gap-1 rounded-full bg-brand/10 px-2 py-0.5 text-brand">
            <Zap size={10} /> 0.6s
          </span>
        </div>
        <div className="space-y-2">
          {['92%', '78%', '86%', '54%'].map((w, i) => (
            <div key={i} className="type-line" style={css({ '--w': w, '--d': `${i * 0.25}s` })} />
          ))}
        </div>
      </div>
    </div>
  );
}

/** Screenshot Solve: a code snippet being scanned. */
export function ScanVisual() {
  const lines = [
    ['def', ' two_sum(nums, target):'],
    ['  ', 'seen = {}'],
    ['  for', ' i, n in enumerate(nums):'],
    ['    if', ' target - n in seen:'],
    ['      return', ' [seen[target-n], i]'],
    ['    ', 'seen[n] = i'],
  ];
  return (
    <div className="relative overflow-hidden rounded-xl bg-bg/70 p-4 font-mono text-[11px] leading-5 ring-1 ring-line">
      {['left-1.5 top-1.5 border-l-2 border-t-2', 'right-1.5 top-1.5 border-r-2 border-t-2', 'left-1.5 bottom-1.5 border-l-2 border-b-2', 'right-1.5 bottom-1.5 border-r-2 border-b-2'].map(
        (c) => <span key={c} className={`absolute size-3 rounded-[3px] border-brand-2 ${c}`} />,
      )}
      {lines.map(([kw, rest], i) => (
        <div key={i} className="whitespace-pre text-muted">
          <span className="text-accent">{kw}</span>
          {rest}
        </div>
      ))}
      <span className="scan-line" />
      <span className="absolute right-3 bottom-3 rounded-md bg-brand/15 px-2 py-0.5 text-[10px] text-brand ring-1 ring-brand/30">
        O(n) · O(n)
      </span>
    </div>
  );
}

/** Practice Mode: a readiness score ring filling up. */
export function ScoreVisual() {
  return (
    <div className="flex items-center gap-5">
      <div className="score-ring grid size-24 shrink-0 place-items-center rounded-full">
        <div className="grid size-[78px] place-items-center rounded-full bg-surface">
          <span className="score-num text-2xl font-semibold tabular-nums" />
        </div>
      </div>
      <div className="flex-1 space-y-2.5 text-[11px]">
        {[
          ['Structure', 'w-[88%]'],
          ['Clarity', 'w-[94%]'],
          ['Depth', 'w-[76%]'],
        ].map(([label, w]) => (
          <div key={label}>
            <div className="mb-1 flex justify-between text-muted">
              <span>{label}</span>
            </div>
            <div className="h-1.5 rounded-full bg-white/5">
              <div className={`h-full rounded-full bg-gradient-to-r from-brand to-brand-2 ${w}`} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Resume context: documents floating into place. */
export function ContextVisual() {
  const docs = [
    { icon: FileText, label: 'Resume.pdf', r: '-6deg', d: '0s', pos: 'left-0 top-2' },
    { icon: Briefcase, label: 'Job description', r: '4deg', d: '-2s', pos: 'right-0 top-8' },
    { icon: Star, label: 'STAR stories', r: '-2deg', d: '-4s', pos: 'left-8 bottom-0' },
  ];
  return (
    <div className="relative h-32">
      {docs.map(({ icon: Icon, label, r, d, pos }) => (
        <div
          key={label}
          className={`float-slow absolute flex items-center gap-2 rounded-xl bg-surface-2 px-3 py-2 text-xs shadow-xl shadow-black/40 ring-1 ring-line-strong ${pos}`}
          style={css({ '--r': r, '--d': d })}
        >
          <span className="grid size-7 place-items-center rounded-lg bg-accent/15 text-accent">
            <Icon size={14} />
          </span>
          {label}
        </div>
      ))}
    </div>
  );
}

/** Screen-share privacy: the overlay vanishes from the shared view. */
export function CloakVisual() {
  return (
    <div className="relative h-32 overflow-hidden rounded-xl bg-bg/70 ring-1 ring-line">
      <div className="flex items-center gap-1.5 border-b border-line px-3 py-2 text-[10px] text-muted">
        <span className="size-1.5 animate-pulse rounded-full bg-danger" /> What the interviewer sees
      </div>
      <div className="p-3">
        <div className="h-2 w-2/3 rounded-full bg-white/5" />
        <div className="mt-2 h-2 w-1/2 rounded-full bg-white/5" />
      </div>
      <div className="cloak absolute right-3 bottom-3 w-28 rounded-lg bg-surface-2 p-2 ring-1 ring-brand/40">
        <div className="mb-1.5 flex items-center gap-1 text-[9px] text-brand">
          <Sparkles size={9} /> Friday AI
        </div>
        <div className="h-1.5 rounded-full bg-brand/40" />
        <div className="mt-1 h-1.5 w-3/4 rounded-full bg-brand/25" />
      </div>
      <div className="cloak-badge absolute right-3 bottom-3 flex items-center gap-1.5 rounded-lg bg-surface-2 px-2.5 py-1.5 text-[10px] text-muted ring-1 ring-line-strong">
        <EyeOff size={11} className="text-brand" /> Hidden from capture
      </div>
    </div>
  );
}

/** Privacy section hero: a shield with ripples and orbiting guarantees. */
export function ShieldOrbit() {
  const sats = [
    { icon: Lock, angle: 0 },
    { icon: EyeOff, angle: 120 },
    { icon: Trash2, angle: 240 },
  ];
  return (
    <div className="relative mx-auto grid aspect-square w-full max-w-[22rem] place-items-center">
      {[0, 1.2, 2.4].map((d) => (
        <span
          key={d}
          className="ripple absolute inset-[22%] rounded-full border border-brand/40"
          style={css({ '--d': `${d}s` })}
        />
      ))}
      <div className="absolute inset-[6%] rounded-full border border-dashed border-line-strong" />
      <div className="absolute inset-[24%] rounded-full border border-line" />

      {/* orbiting satellites; each one counter-rotates so its icon stays upright */}
      <div className="orbit absolute inset-[6%]" style={css({ '--dur': '28s' })}>
        {sats.map(({ icon: Icon, angle }) => (
          <div key={angle} className="absolute inset-0" style={{ transform: `rotate(${angle}deg)` }}>
            <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2">
              <div style={{ transform: `rotate(${-angle}deg)` }}>
                <div className="orbit-rev" style={css({ '--dur': '28s' })}>
                  <span className="grid size-11 place-items-center rounded-xl bg-surface-2 text-brand-2 shadow-lg shadow-black/50 ring-1 ring-line-strong">
                    <Icon size={18} />
                  </span>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="relative grid size-28 place-items-center rounded-[2rem] bg-gradient-to-br from-brand/25 to-accent/20 shadow-glow ring-1 ring-brand/40">
        <ShieldCheck size={48} className="text-brand" strokeWidth={1.6} />
      </div>
    </div>
  );
}
