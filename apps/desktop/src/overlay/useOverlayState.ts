import { useCallback, useEffect, useRef, useState } from 'react';
import { parakeet } from '../bridge';
import type { AuthState, LiveStatus } from '../types';

export interface OverlayAnswer {
  turnId: string;
  question: string;
  /** Screenshots sent with the question. */
  imageCount?: number;
  text: string;
  done: boolean;
  ttftMs?: number;
  error?: string;
}

export interface TranscriptLine {
  id: string;
  speaker: 'interviewer' | 'you';
  text: string;
}

const MAX_ANSWERS = 50;

/**
 * Overlay state: answer history (navigable), transcript strip and connection status.
 * Token deltas are batched once per animation frame (spec E2).
 */
export function useOverlayState() {
  const [auth, setAuth] = useState<AuthState | null>(null);
  const [status, setStatus] = useState<LiveStatus>({ state: 'disconnected', sessionId: null, rttMs: null });
  const [answers, setAnswers] = useState<OverlayAnswer[]>([]);
  const [index, setIndex] = useState(-1);
  const [transcript, setTranscript] = useState<TranscriptLine[]>([]);
  const pending = useRef(new Map<string, { text: string; ttftMs?: number }>());
  const frame = useRef<number | null>(null);
  const questions = useRef(new Map<string, string>());
  /** Answer to show once it lands in state (set when a new question is asked). */
  const jumpTo = useRef<string | null>(null);

  useEffect(() => {
    if (!jumpTo.current) return;
    const i = answers.findIndex((a) => a.turnId === jumpTo.current);
    if (i !== -1) {
      setIndex(i);
      jumpTo.current = null;
    }
  }, [answers]);

  useEffect(() => {
    parakeet.auth.get().then(setAuth);
    parakeet.live.status().then(setStatus);
    const offAuth = parakeet.auth.onChange(setAuth);
    const offStatus = parakeet.live.onStatus(setStatus);

    const flush = () => {
      frame.current = null;
      const batch = new Map(pending.current);
      pending.current.clear();
      if (!batch.size) return;
      setAnswers((list) => {
        let next = list;
        for (const [turnId, { text, ttftMs }] of batch) {
          const i = next.findIndex((a) => a.turnId === turnId);
          if (i === -1) {
            next = [...next, { turnId, question: questions.current.get(turnId) ?? '', text, done: false, ttftMs }];
          } else {
            next = next.map((a, j) => (j === i ? { ...a, text: a.text + text, ttftMs: a.ttftMs ?? ttftMs } : a));
          }
        }
        return next.slice(-MAX_ANSWERS);
      });
    };

    const offAsked = parakeet.live.onAsked(({ turnId, text, imageCount }) => {
      questions.current.set(turnId, text);
      const label = text || `${imageCount} screenshot${imageCount === 1 ? '' : 's'}`;
      setTranscript((t) => [...t, { id: turnId, speaker: 'interviewer' as const, text: label }].slice(-30));
      // A new question always jumps the view to its answer.
      jumpTo.current = turnId;
      setAnswers((list) =>
        list.some((a) => a.turnId === turnId)
          ? list.map((a) => (a.turnId === turnId ? { ...a, question: text, imageCount } : a))
          : [...list, { turnId, question: text, imageCount, text: '', done: false }].slice(-MAX_ANSWERS),
      );
    });

    const offMsg = parakeet.live.onMessage((m) => {
      if (m.type === 'token') {
        const cur = pending.current.get(m.turnId);
        pending.current.set(m.turnId, { text: (cur?.text ?? '') + m.delta, ttftMs: cur?.ttftMs ?? m.ttftMs });
        frame.current ??= requestAnimationFrame(flush);
      } else if (m.type === 'done') {
        flush();
        setAnswers((list) => list.map((a) => (a.turnId === m.turnId ? { ...a, done: true } : a)));
      } else if (m.type === 'error' && m.turnId) {
        setAnswers((list) => list.map((a) => (a.turnId === m.turnId ? { ...a, done: true, error: m.message } : a)));
      }
    });

    return () => {
      offAuth();
      offStatus();
      offAsked();
      offMsg();
      if (frame.current) cancelAnimationFrame(frame.current);
    };
  }, []);

  const clearAnswers = useCallback(() => {
    setAnswers([]);
    setIndex(-1);
  }, []);
  const clearTranscript = useCallback(() => setTranscript([]), []);
  const go = useCallback(
    (delta: number) => setIndex((i) => Math.min(Math.max(i + delta, 0), Math.max(answers.length - 1, 0))),
    [answers.length],
  );

  const current = index >= 0 ? answers[index] : undefined;
  return { auth, status, answers, index, current, transcript, go, clearAnswers, clearTranscript };
}
