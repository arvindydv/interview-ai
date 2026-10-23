import { useId } from 'react';
import type { LucideIcon } from 'lucide-react';
import type { LiveState } from './types';

export function LogoMark({ size = 28 }: { size?: number }) {
  // Unique per instance: a gradient defined inside a hidden (display: none) copy doesn't paint.
  const id = useId();
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <defs>
        <linearGradient id={`${id}g`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#34d399" />
          <stop offset="0.55" stopColor="#22d3ee" />
          <stop offset="1" stopColor="#a78bfa" />
        </linearGradient>
        <linearGradient id={`${id}s`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#047857" />
          <stop offset="1" stopColor="#155e75" />
        </linearGradient>
      </defs>
      <rect x=".5" y=".5" width="31" height="31" rx="8" fill="#0b1411" stroke={`url(#${id}g)`} strokeOpacity=".35" />
      {/* One ribbon folded twice into a slanted F; the darker triangles are the folds' shadows on the stem. */}
      <g transform="translate(3.4 0) skewX(-10)">
        <path d="M8 6h5.6v20.5a1.2 1.2 0 0 1-1.2 1.2H9.2A1.2 1.2 0 0 1 8 26.5z" fill={`url(#${id}g)`} />
        <path d="M8 6h5.6l-5.6 5.6z" fill={`url(#${id}s)`} />
        <path d="M13.6 6h11.2a.8.8 0 0 1 .6 1.3l-3.4 4.3H8z" fill={`url(#${id}g)`} />
        <path d="M8 14.2h5.6l-5.6 5z" fill={`url(#${id}s)`} />
        <path d="M13.6 14.2h6.6a.8.8 0 0 1 .6 1.3l-2.9 3.7H8z" fill={`url(#${id}g)`} />
      </g>
    </svg>
  );
}

/** Glass card with an icon header, used by every main-window section. */
export function Panel({
  title,
  icon: Icon,
  action,
  children,
  className = '',
  style,
}: {
  title: string;
  icon: LucideIcon;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <section style={style} className={`glass rounded-[var(--radius-card)] p-5 ${className}`}>
      <header className="mb-4 flex items-center gap-2.5">
        <span className="grid size-8 place-items-center rounded-lg bg-gradient-to-br from-brand/20 to-accent/10 text-brand ring-1 ring-brand/20">
          <Icon size={16} />
        </span>
        <h2 className="text-sm font-semibold">{title}</h2>
        <div className="ml-auto">{action}</div>
      </header>
      {children}
    </section>
  );
}

const stateTone: Record<LiveState, string> = {
  connected: 'bg-brand',
  connecting: 'bg-warn',
  reconnecting: 'bg-warn',
  disconnected: 'bg-faint',
};

export function StatusDot({ state }: { state: LiveState }) {
  const c = stateTone[state];
  return (
    <span className="relative flex size-2">
      {state !== 'disconnected' && <span className={`absolute inline-flex size-full animate-ping rounded-full opacity-60 ${c}`} />}
      <span className={`relative inline-flex size-2 rounded-full ${c}`} />
    </span>
  );
}

export function Spinner({ className = '' }: { className?: string }) {
  return <span className={`inline-block size-4 animate-spin rounded-full border-2 border-current border-r-transparent ${className}`} />;
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="rounded-md bg-white/5 px-1.5 py-0.5 font-sans text-[11px] text-muted ring-1 ring-line">{children}</kbd>;
}
