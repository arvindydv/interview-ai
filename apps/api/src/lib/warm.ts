import { env } from '../env.js';

// Opens (or keeps open) the connections the practice interviewer needs, so a turn after a long answer
// doesn't start with a TLS handshake. Small authenticated requests; failures don't matter.

export function warmConnections() {
  const quiet = { signal: AbortSignal.timeout(10_000) };
  if (env.DEEPGRAM_API_KEY) {
    void fetch('https://api.deepgram.com/v1/projects', { ...quiet, headers: { authorization: `Token ${env.DEEPGRAM_API_KEY}` } })
      .then((r) => r.arrayBuffer())
      .catch(() => {});
  }
  if (env.OPENROUTER_API_KEY) {
    void fetch('https://openrouter.ai/api/v1/key', { ...quiet, headers: { Authorization: `Bearer ${env.OPENROUTER_API_KEY}` } })
      .then((r) => r.arrayBuffer())
      .catch(() => {});
  }
  if (env.ANTHROPIC_API_KEY) {
    void fetch('https://api.anthropic.com/v1/models?limit=1', {
      ...quiet,
      headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    })
      .then((r) => r.arrayBuffer())
      .catch(() => {});
  }
}
