import type { LucideIcon } from 'lucide-react';
import type { LiveState } from './types';

export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <defs>
        <linearGradient id="pk-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#34d399" />
          <stop offset="0.55" stopColor="#22d3ee" />
          <stop offset="1" stopColor="#a78bfa" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill="url(#pk-g)" />
      <g fill="#04120c">
        <rect x="8" y="12" width="3" height="8" rx="1.5" />
        <rect x="14.5" y="8" width="3" height="16" rx="1.5" />
        <rect x="21" y="11" width="3" height="10" rx="1.5" />
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
