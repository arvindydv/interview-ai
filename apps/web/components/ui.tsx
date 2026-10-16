import type { LucideIcon } from 'lucide-react';

export function Card({
  title,
  icon: Icon,
  action,
  children,
  className = '',
}: {
  title?: string;
  icon?: LucideIcon;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`glass rounded-[var(--radius-card)] p-5 ${className}`}>
      {title && (
        <header className="mb-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            {Icon && (
              <span className="grid size-8 place-items-center rounded-lg bg-white/5 text-brand ring-1 ring-line">
                <Icon size={16} />
              </span>
            )}
            <h2 className="text-sm font-semibold">{title}</h2>
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
  neutral: 'bg-white/5 text-muted ring-line',
};

export function Pill({ tone = 'neutral', children }: { tone?: keyof typeof tones; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${tones[tone]}`}>
      {children}
    </span>
  );
}

export function Dot({ tone }: { tone: 'ok' | 'bad' | 'warn' | 'neutral' }) {
  const c = { ok: 'bg-brand', bad: 'bg-danger', warn: 'bg-warn', neutral: 'bg-faint' }[tone];
  return (
    <span className="relative flex size-2">
      {tone === 'ok' && <span className={`absolute inline-flex size-full animate-ping rounded-full opacity-60 ${c}`} />}
      <span className={`relative inline-flex size-2 rounded-full ${c}`} />
    </span>
  );
}

export function Spinner({ className = '' }: { className?: string }) {
  return <span className={`inline-block size-4 animate-spin rounded-full border-2 border-current border-r-transparent ${className}`} />;
}
