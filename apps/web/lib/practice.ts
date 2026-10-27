'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { PracticeQuestionKind, TrialBalance } from '@parakeet/shared';

/** Seconds of session minutes left, or null when the plan isn't metered (unlimited). */
export const secondsLeft = (trial: TrialBalance | null | undefined) =>
  trial ? Math.max(trial.totalSeconds - trial.usedSeconds, 0) : null;

/** "12 min", "45 sec" */
export const formatLeft = (seconds: number) => (seconds >= 60 ? `${Math.floor(seconds / 60)} min` : `${seconds} sec`);

export function scoreLabel(score: number) {
  if (score >= 80) return 'Excellent';
  if (score >= 65) return 'Good';
  if (score >= 45) return 'Getting there';
  return 'Needs practice';
}

/** Text colour for a 0–100 score. */
export const scoreTone = (score: number) => (score >= 65 ? 'text-brand' : score >= 45 ? 'text-brand-2' : 'text-warn');

export const KIND_LABEL: Record<PracticeQuestionKind, string> = {
  opener: 'Opener',
  behavioral: 'Behavioural',
  role: 'Role knowledge',
  situational: 'Situational',
  closing: 'Closing',
};

/** A comfortable answer length when spoken (about 1–2 minutes). */
export const PACE = { slow: 110, fast: 170 };

export const formatDuration = (ms: number) => {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

// ---- dictation -----------------------------------------------------------------------------------

// The Web Speech API isn't in TypeScript's DOM types yet; this is the part we use.
interface Recognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}

function recognitionClass(): (new () => Recognition) | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/**
 * Speech to text in the browser. `final` grows as phrases are recognised; `interim` is the phrase
 * being spoken. Recognition stops by itself after a pause, so it restarts until `stop()`.
 */
export function useDictation() {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [final, setFinal] = useState('');
  const [interim, setInterim] = useState('');
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<Recognition | null>(null);
  const wanted = useRef(false);

  useEffect(() => setSupported(Boolean(recognitionClass())), []);

  const stop = useCallback(() => {
    wanted.current = false;
    rec.current?.stop();
    setListening(false);
    setInterim('');
  }, []);

  const start = useCallback(() => {
    const Rec = recognitionClass();
    if (!Rec) return;
    setError(null);
    setFinal('');
    setInterim('');
    const r = new Rec();
    r.continuous = true;
    r.interimResults = true;
    r.lang = navigator.language || 'en-IN';
    r.onresult = (e) => {
      let done = '';
      let live = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const text = e.results[i][0].transcript;
        if (e.results[i].isFinal) done += text;
        else live += text;
      }
      if (done) setFinal((f) => `${f} ${done}`.replace(/\s+/g, ' ').trimStart());
      setInterim(live);
    };
    r.onerror = (e) => {
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      wanted.current = false;
      setListening(false);
      setError(
        e.error === 'not-allowed' || e.error === 'service-not-allowed'
          ? 'Microphone access is blocked. Allow it in your browser, or type your answer.'
          : 'Speech recognition stopped. Try again, or type your answer.',
      );
    };
    r.onend = () => {
      if (wanted.current) {
        try {
          r.start();
        } catch {
          setListening(false);
        }
      } else setListening(false);
    };
    rec.current = r;
    wanted.current = true;
    r.start();
    setListening(true);
  }, []);

  useEffect(() => () => {
    wanted.current = false;
    rec.current?.abort();
  }, []);

  return { supported, listening, final, interim, error, start, stop };
}

// ---- interviewer voice ---------------------------------------------------------------------------

function pickVoice() {
  const voices = speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith('en'));
  const lang = navigator.language.toLowerCase();
  return voices.find((v) => v.lang.toLowerCase() === lang) ?? voices.find((v) => /natural|neural|google/i.test(v.name)) ?? voices[0];
}

/** Reads questions aloud with the browser's own text-to-speech. */
export function useInterviewerVoice() {
  const [supported, setSupported] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  useEffect(() => {
    setSupported(typeof window !== 'undefined' && 'speechSynthesis' in window);
    return () => {
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) speechSynthesis.cancel();
    };
  }, []);

  const speak = useCallback((text: string) => {
    if (!('speechSynthesis' in window)) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const voice = pickVoice();
    if (voice) u.voice = voice;
    u.rate = 1;
    u.onstart = () => setSpeaking(true);
    u.onend = u.onerror = () => setSpeaking(false);
    speechSynthesis.speak(u);
  }, []);

  const cancel = useCallback(() => {
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    setSpeaking(false);
  }, []);

  return { supported, speaking, speak, cancel };
}
