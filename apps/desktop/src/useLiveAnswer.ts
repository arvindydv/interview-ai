import { useEffect, useRef, useState } from 'react';
import type { LiveStatus } from './types';
import { parakeet } from './bridge';

export interface Answer {
  turnId: string;
  text: string;
  done: boolean;
  /** Time to first token, measured in main from when the question was sent (spec §16 target). */
  ttftMs?: number;
}

/** Subscribes to the live channel; batches token deltas once per animation frame (spec E2). */
export function useLiveAnswer() {
  const [status, setStatus] = useState<LiveStatus>({ state: 'disconnected', sessionId: null, rttMs: null });
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const buffer = useRef<{ turnId: string; text: string; ttftMs?: number } | null>(null);
  const frame = useRef<number | null>(null);

  useEffect(() => {
    parakeet.live.status().then(setStatus);
    const offStatus = parakeet.live.onStatus(setStatus);
    const flush = () => {
      frame.current = null;
      const b = buffer.current;
      if (!b) return;
      buffer.current = null;
      setAnswer((a) =>
        a && a.turnId === b.turnId
          ? { ...a, text: a.text + b.text, ttftMs: a.ttftMs ?? b.ttftMs }
          : { turnId: b.turnId, text: b.text, done: false, ttftMs: b.ttftMs },
      );
    };
    const offMsg = parakeet.live.onMessage((m) => {
      if (m.type === 'token') {
        if (buffer.current && buffer.current.turnId !== m.turnId) flush();
        buffer.current = {
          turnId: m.turnId,
          text: (buffer.current?.text ?? '') + m.delta,
          ttftMs: buffer.current?.ttftMs ?? m.ttftMs,
        };
        frame.current ??= requestAnimationFrame(flush);
      } else if (m.type === 'done') {
        flush();
        setAnswer((a) => (a && a.turnId === m.turnId ? { ...a, done: true } : a));
      } else if (m.type === 'error') {
        setError(`${m.code}: ${m.message}`);
      }
    });
    return () => {
      offStatus();
      offMsg();
      if (frame.current) cancelAnimationFrame(frame.current);
    };
  }, []);

  const startTurn = (turnId: string) => {
    setError(null);
    setAnswer((a) => (a?.turnId === turnId ? a : { turnId, text: '', done: false }));
  };

  return { status, answer, error, startTurn };
}
