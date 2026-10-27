'use client';
import { useCallback, useSyncExternalStore } from 'react';
import { THEME_STORAGE_KEY } from '@/lib/themeScript';

export type ThemePreference = 'dark' | 'light' | 'system';
export type Theme = 'dark' | 'light';

const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function readPreference(): ThemePreference {
  try {
    const p = localStorage.getItem(THEME_STORAGE_KEY);
    return p === 'light' || p === 'system' ? p : 'dark';
  } catch {
    return 'dark';
  }
}

const systemTheme = (): Theme => (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
const resolve = (p: ThemePreference): Theme => (p === 'system' ? systemTheme() : p);

function subscribe(listener: () => void) {
  listeners.add(listener);
  const media = matchMedia('(prefers-color-scheme: light)');
  const onSystem = () => {
    if (readPreference() !== 'system') return;
    document.documentElement.dataset.theme = systemTheme();
    emit();
  };
  const onStorage = (e: StorageEvent) => {
    if (e.key !== THEME_STORAGE_KEY) return;
    document.documentElement.dataset.theme = resolve(readPreference());
    emit();
  };
  media.addEventListener('change', onSystem);
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    media.removeEventListener('change', onSystem);
    window.removeEventListener('storage', onStorage);
  };
}

/** The saved preference, the theme actually showing, and a setter that applies it everywhere at once. */
export function useTheme() {
  const preference = useSyncExternalStore(subscribe, readPreference, () => 'dark' as ThemePreference);
  const theme = useSyncExternalStore(
    subscribe,
    () => (document.documentElement.dataset.theme === 'light' ? 'light' : 'dark') as Theme,
    () => 'dark' as Theme,
  );
  const setPreference = useCallback((p: ThemePreference) => {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, p);
    } catch {}
    const root = document.documentElement;
    // Skip colour transitions while swapping so every surface changes in the same frame.
    root.classList.add('theme-switching');
    root.dataset.theme = resolve(p);
    requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove('theme-switching')));
    emit();
  }, []);
  return { preference, theme, setPreference };
}
