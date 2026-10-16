'use client';
import { useCallback, useEffect, useRef, useState } from 'react';

export type Async<T> =
  | { state: 'loading'; data?: T }
  | { state: 'ok'; data: T }
  | { state: 'error'; error: string; data?: T };

/**
 * Loads `fn` whenever `deps` change and exposes `reload`. Keeps showing the previous data while
 * reloading so tables don't flash empty, and ignores responses that arrive out of order.
 */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [r, setR] = useState<Async<T>>({ state: 'loading' });
  const seq = useRef(0);

  const reload = useCallback(() => {
    const id = ++seq.current;
    setR((prev) => ({ state: 'loading', data: prev.data }));
    fn().then(
      (data) => id === seq.current && setR({ state: 'ok', data }),
      (e: Error) => id === seq.current && setR((prev) => ({ state: 'error', error: e.message, data: prev.data })),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(reload, [reload]);
  return [r, reload] as const;
}

/** Runs a mutation, tracking busy state and the last error. */
export function useAction() {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(null);
    }
  };
  return { busy, error, run, setError };
}

/** Debounces a value so typing in a search box doesn't fire a request per keystroke. */
export function useDebounced<T>(value: T, delay = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return v;
}
