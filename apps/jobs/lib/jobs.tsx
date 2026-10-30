'use client';
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { JobsSummary } from '@parakeet/shared';
import { api } from './api';

// What the signed-in shell knows about the user: profile, preferences, counts and whether matches are
// being recomputed. Pages call `reload()` after anything that changes those.

interface JobsState {
  email: string;
  summary: JobsSummary | null;
  error: string | null;
  reload: () => Promise<void>;
}

const JobsContext = createContext<JobsState | null>(null);

export function useJobs() {
  const ctx = useContext(JobsContext);
  if (!ctx) throw new Error('useJobs outside JobsProvider');
  return ctx;
}

const POLL_MS = 4000;

export function JobsProvider({ email, children }: { email: string; children: React.ReactNode }) {
  const [summary, setSummary] = useState<JobsSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setSummary(await api<JobsSummary>('/v1/job-feed/summary'));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  // While matches are being computed (new resume or preferences), check back until they're ready.
  useEffect(() => {
    if (!summary?.matching) return;
    const t = setTimeout(reload, POLL_MS);
    return () => clearTimeout(t);
  }, [summary, reload]);

  return <JobsContext.Provider value={{ email, summary, error, reload }}>{children}</JobsContext.Provider>;
}
