'use client';
import { Monitor, Moon, Sun, type LucideIcon } from 'lucide-react';
import { useTheme, type ThemePreference } from '@/lib/theme';

/** One-click light/dark switch for nav bars. */
export function ThemeToggle({ className = '' }: { className?: string }) {
  const { theme, setPreference } = useTheme();
  const next = theme === 'dark' ? 'light' : 'dark';
  return (
    <button
      type="button"
      onClick={() => setPreference(next)}
      aria-label={`Switch to ${next} mode`}
      title={`Switch to ${next} mode`}
      className={`btn btn-ghost !p-2 ${className}`}
    >
      {/* both icons render so the swap is a crossfade, not a re-mount */}
      <span className="relative grid size-[18px] place-items-center">
        <Sun size={18} className={`absolute transition duration-300 ${theme === 'light' ? 'scale-100 rotate-0 opacity-100' : 'scale-50 -rotate-90 opacity-0'}`} />
        <Moon size={18} className={`absolute transition duration-300 ${theme === 'dark' ? 'scale-100 rotate-0 opacity-100' : 'scale-50 rotate-90 opacity-0'}`} />
      </span>
    </button>
  );
}

const OPTIONS: { id: ThemePreference; label: string; icon: LucideIcon }[] = [
  { id: 'dark', label: 'Dark', icon: Moon },
  { id: 'light', label: 'Light', icon: Sun },
  { id: 'system', label: 'System', icon: Monitor },
];

/** Dark / Light / System segmented control. */
export function ThemePicker({ compact = false }: { compact?: boolean }) {
  const { preference, setPreference } = useTheme();
  return (
    <div role="radiogroup" aria-label="Theme" className="inline-flex w-full gap-1 rounded-xl bg-white/[0.04] p-1 ring-1 ring-line">
      {OPTIONS.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          type="button"
          role="radio"
          aria-checked={preference === id}
          aria-label={label}
          title={label}
          onClick={() => setPreference(id)}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg text-xs font-medium transition ${compact ? 'py-1.5' : 'px-3 py-2'} ${
            preference === id ? 'bg-surface text-fg shadow-sm ring-1 ring-line-strong' : 'text-muted hover:text-fg'
          }`}
        >
          <Icon size={14} /> {!compact && label}
        </button>
      ))}
    </div>
  );
}
