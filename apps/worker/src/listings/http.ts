import { AsyncLocalStorage } from 'node:async_hooks';

// Every request a listings sync makes goes through httpFetch, so each sync can report how many it made
// (job_source_runs.http_requests): the API usage half of source health.

const meter = new AsyncLocalStorage<{ requests: number }>();

export function httpFetch(input: string | URL, init?: RequestInit): Promise<Response> {
  const m = meter.getStore();
  if (m) m.requests++;
  return globalThis.fetch(input, init);
}

/** Runs `fn`, counting the requests it makes through httpFetch. */
export async function metered<T>(fn: () => Promise<T>): Promise<{ result: T; requests: number }> {
  const m = { requests: 0 };
  const result = await meter.run(m, fn);
  return { result, requests: m.requests };
}

/** The requests counted so far in the current metered call (for failures, which have no result). */
export const requestsSoFar = () => meter.getStore()?.requests ?? 0;
