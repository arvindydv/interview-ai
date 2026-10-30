import { INTERVIEWER_AUDIO } from '@parakeet/shared';
import { env } from '../env.js';

// Deepgram Aura text-to-speech: the practice interviewer's voice. Browser text-to-speech has no
// voices at all on many Linux setups and sounds robotic elsewhere, so the room plays this instead and
// falls back to the browser only when it's unavailable.
//
// Aura streams audio about as fast as it is spoken, so a line is forwarded chunk by chunk as raw PCM
// (INTERVIEWER_AUDIO) and starts playing after the first chunk, not after the whole line.

export const ttsConfigured = () => Boolean(env.DEEPGRAM_API_KEY);

interface Sink {
  /** The first audio is ready. */
  start: () => void;
  /** PCM, always a whole number of samples. */
  chunk: (pcm: Buffer) => void;
}

/** Speaks `text` into `sink`. Resolves false if no audio could be produced (nothing was started). */
export async function streamSpeech(text: string, sink: Sink, log: { warn: (o: object, m: string) => void }): Promise<boolean> {
  if (!ttsConfigured()) return false;
  const params = new URLSearchParams({
    model: env.DEEPGRAM_TTS_MODEL,
    encoding: INTERVIEWER_AUDIO.encoding,
    sample_rate: String(INTERVIEWER_AUDIO.sampleRate),
    container: 'none',
  });
  let started = false;
  try {
    const res = await fetch(`https://api.deepgram.com/v1/speak?${params}`, {
      method: 'POST',
      headers: { authorization: `Token ${env.DEEPGRAM_API_KEY}`, 'content-type': 'application/json' },
      // Aura reads at most 2000 characters per request; interviewer lines are far shorter.
      body: JSON.stringify({ text: text.slice(0, 2000) }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok || !res.body) {
      log.warn({ status: res.status, body: (await res.text().catch(() => '')).slice(0, 200) }, 'text-to-speech failed');
      return false;
    }
    let odd: Buffer | null = null;
    for await (const part of res.body as AsyncIterable<Uint8Array>) {
      let buf = Buffer.from(part);
      if (odd) buf = Buffer.concat([odd, buf]);
      // 16-bit samples: hold back a trailing odd byte for the next chunk.
      odd = buf.length % 2 ? buf.subarray(buf.length - 1) : null;
      if (odd) buf = buf.subarray(0, buf.length - 1);
      if (!buf.length) continue;
      if (!started) {
        started = true;
        sink.start();
      }
      sink.chunk(buf);
    }
    return started;
  } catch (err) {
    log.warn({ err: (err as Error).message }, 'text-to-speech unreachable');
    // Part of the line may have been sent; the browser plays what it got.
    return started;
  }
}
