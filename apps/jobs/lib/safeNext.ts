/**
 * Only same-site paths may follow sign-in. `startsWith('/')` alone would let `//evil.com` and
 * `/\evil.com` through, which browsers treat as another origin.
 */
export function safeNext(raw: string | null, fallback = '/recommended') {
  if (!raw || !/^\/(?![/\\])/.test(raw)) return fallback;
  // Resolved against a placeholder origin so this also runs during server rendering.
  const base = 'https://same.origin';
  const u = new URL(raw, base);
  return u.origin === base ? u.pathname + u.search : fallback;
}
