'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AUDIO_FORMAT, INTERVIEWER_AUDIO, type DesktopStatus, type InterviewerState, type PracticeClientMessage, type PracticePhase, type PracticeQuestionKind,
  type PracticeServerMessage, type PracticeSession, type TrialBalance,
} from '@parakeet/shared';
import { API_URL } from './api';
import { supabase } from './supabase';

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
  follow_up: 'Follow-up',
  closing: 'Closing',
};

/** A comfortable speaking pace, in words per minute. */
export const PACE = { slow: 110, fast: 170 };

export const formatDuration = (ms: number) => {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** "1.2 s" */
export const formatSeconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

// ---- microphone ----------------------------------------------------------------------------------

/** 80 ms at 16 kHz. */
const FRAME_SAMPLES = (AUDIO_FORMAT.sampleRate * 80) / 1000;

export type MicState = 'off' | 'asking' | 'on' | 'blocked' | 'unsupported';

/**
 * The candidate's microphone as 16 kHz PCM frames, with echo cancellation so the interviewer's voice
 * from the speakers isn't picked up. `level` (0–1) drives the meter.
 */
export function useMicrophone(onFrame: (pcm: ArrayBuffer) => void) {
  const [state, setState] = useState<MicState>('off');
  const [level, setLevel] = useState(0);
  const frame = useRef(onFrame);
  frame.current = onFrame;
  const parts = useRef<{ stream: MediaStream; ctx: AudioContext } | null>(null);

  const start = useCallback(async () => {
    if (parts.current) return true;
    if (!navigator.mediaDevices?.getUserMedia || typeof AudioWorkletNode === 'undefined') {
      setState('unsupported');
      return false;
    }
    setState('asking');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
      });
      const ctx = new AudioContext();
      // Served from our own origin (app/pcm16-worklet.js): the CSP doesn't allow blob: scripts.
      await ctx.audioWorklet.addModule('/pcm16-worklet.js');
      const node = new AudioWorkletNode(ctx, 'pcm16', {
        processorOptions: { rate: AUDIO_FORMAT.sampleRate, frame: FRAME_SAMPLES },
      });
      let shown = 0;
      node.port.onmessage = (e: MessageEvent<{ pcm: ArrayBuffer; level: number }>) => {
        frame.current(e.data.pcm);
        // Speech sits around 0.02–0.2 RMS; scale so normal speech fills most of the meter.
        shown = Math.max(Math.min(1, e.data.level * 6), shown * 0.7);
        setLevel(shown);
      };
      ctx.createMediaStreamSource(stream).connect(node);
      parts.current = { stream, ctx };
      setState('on');
      return true;
    } catch (e) {
      setState((e as DOMException).name === 'NotAllowedError' || (e as DOMException).name === 'SecurityError' ? 'blocked' : 'unsupported');
      return false;
    }
  }, []);

  const stop = useCallback(() => {
    const p = parts.current;
    parts.current = null;
    p?.stream.getTracks().forEach((t) => t.stop());
    void p?.ctx.close().catch(() => {});
    setState('off');
    setLevel(0);
  }, []);

  useEffect(() => stop, [stop]);

  return { state, level, start, stop };
}

// ---- the live room -------------------------------------------------------------------------------

export type RoomStatus = 'connecting' | 'open' | 'closed' | 'error';

/** The interviewer's current line. */
export interface Line {
  id: string;
  text: string;
  test: boolean;
}

/**
 * Plays the interviewer's voice as it streams in: raw PCM chunks (INTERVIEWER_AUDIO) scheduled back to
 * back on one AudioContext, created from a click so the browser lets it make sound.
 */
class VoicePlayer {
  private ctx: AudioContext | null = null;
  private next = 0;
  private sources = new Set<AudioBufferSourceNode>();

  /** Call from a click (Join, Play test question). */
  unlock() {
    this.ctx ??= new AudioContext();
    void this.ctx.resume().catch(() => {});
  }

  get running() {
    return this.ctx?.state === 'running';
  }

  chunk(pcm: ArrayBuffer) {
    const ctx = this.ctx;
    if (!ctx) return;
    const int16 = new Int16Array(pcm);
    const buffer = ctx.createBuffer(1, int16.length, INTERVIEWER_AUDIO.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < int16.length; i++) data[i] = int16[i] / 0x8000;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(ctx.destination);
    // Buffer a moment before the first chunk (and after a hiccup in the stream), so a late chunk
    // doesn't leave a gap mid-word; then each chunk plays right after the last.
    if (this.next < ctx.currentTime + 0.02) this.next = ctx.currentTime + (this.next ? 0.15 : 0.3);
    src.start(this.next);
    this.next += buffer.duration;
    this.sources.add(src);
    src.onended = () => this.sources.delete(src);
  }

  /** Calls `done` when everything scheduled so far has played. */
  whenDone(done: () => void) {
    const left = this.ctx ? Math.max(0, this.next - this.ctx.currentTime) : 0;
    setTimeout(done, left * 1000 + 100);
  }

  stop() {
    for (const s of this.sources) s.stop();
    this.sources.clear();
    this.next = 0;
  }

  close() {
    this.stop();
    void this.ctx?.close().catch(() => {});
    this.ctx = null;
  }
}

const wsUrl = (path: string) => API_URL.replace(/^http/, 'ws') + path;

/** Speaks a line with the browser's own voice (when the server has none). */
function browserSpeak(text: string, onEnd: () => void) {
  if (!('speechSynthesis' in window)) return onEnd();
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  const voices = speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith('en'));
  const voice = voices.find((v) => /natural|neural|google/i.test(v.name)) ?? voices[0];
  if (voice) u.voice = voice;
  u.onend = u.onerror = () => onEnd();
  speechSynthesis.speak(u);
}

/**
 * The live practice interview over WS /v1/practice/:id/live: plays what the interviewer says,
 * streams the microphone (silenced while the interviewer speaks, so its voice is never taken for an
 * answer), and follows the interview's state.
 */
export function usePracticeRoom(sessionId: string, onSession: (s: PracticeSession) => void) {
  const [status, setStatus] = useState<RoomStatus>('connecting');
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [ready, setReady] = useState<{ stt: boolean; tts: boolean } | null>(null);
  const [phase, setPhase] = useState<PracticePhase>('lobby');
  const [interviewer, setInterviewer] = useState<InterviewerState>('idle');
  const [line, setLine] = useState<Line | null>(null);
  const [transcript, setTranscript] = useState('');
  const [endsAt, setEndsAt] = useState<number | null>(null);
  const [minutesLeft, setMinutesLeft] = useState<number | null | undefined>(undefined);
  const [desktop, setDesktop] = useState<DesktopStatus | null>(null);
  // The browser is holding the interviewer's sound back until a click.
  const [blocked, setBlocked] = useState(false);

  const ws = useRef<WebSocket | null>(null);
  const player = useRef<VoicePlayer | null>(null);
  const speaking = useRef(false);
  const muted = useRef(false);
  const current = useRef<Line | null>(null);
  const sessionCb = useRef(onSession);
  sessionCb.current = onSession;

  const send = useCallback((m: PracticeClientMessage) => {
    if (ws.current?.readyState === WebSocket.OPEN) ws.current.send(JSON.stringify(m));
  }, []);

  const finished = useCallback(
    (l: Line) => {
      if (current.current?.id !== l.id) return;
      current.current = null;
      speaking.current = false;
      send({ type: 'said', id: l.id });
    },
    [send],
  );

  const voice = () => (player.current ??= new VoicePlayer());

  useEffect(() => {
    let closed = false;
    const socket = new WebSocket(wsUrl(`/v1/practice/${sessionId}/live`));
    socket.binaryType = 'arraybuffer';
    ws.current = socket;
    socket.onopen = async () => {
      const { data } = await supabase().auth.getSession();
      socket.send(JSON.stringify({ type: 'auth', token: data.session?.access_token ?? '', hour: new Date().getHours() }));
      setStatus('open');
    };
    socket.onmessage = (e) => {
      if (typeof e.data !== 'string') {
        if (current.current) voice().chunk(e.data as ArrayBuffer);
        return;
      }
      let m: PracticeServerMessage;
      try {
        m = JSON.parse(e.data);
      } catch {
        return;
      }
      switch (m.type) {
        case 'ready':
          setReady({ stt: m.stt, tts: m.tts });
          return sessionCb.current(m.session);
        case 'say': {
          const l = { id: m.id, text: m.text, test: Boolean(m.test) };
          voice().stop();
          current.current = l;
          speaking.current = true;
          setTranscript('');
          setLine(l);
          // Sound needs a click first (e.g. after a reload): the room shows a button that unlocks it.
          setBlocked(m.audio && !voice().running);
          if (!m.audio) browserSpeak(l.text, () => finished(l));
          return;
        }
        case 'audio_end': {
          const l = current.current;
          if (l?.id === m.id) voice().whenDone(() => finished(l));
          return;
        }
        case 'state':
          setPhase(m.phase);
          return setInterviewer(m.interviewer);
        case 'transcript':
          return setTranscript(m.text);
        case 'clock':
          return setEndsAt(m.endsAt - m.serverTime + Date.now());
        case 'minutes':
          return setMinutesLeft(m.secondsLeft);
        case 'desktop':
          return setDesktop(m.desktop);
        case 'session':
          return sessionCb.current(m.session);
        case 'error':
          return setError({ code: m.code, message: m.message });
      }
    };
    socket.onclose = (e) => {
      if (closed) return;
      speaking.current = false;
      setStatus(e.code === 1000 || e.code === 4010 ? 'closed' : 'error');
      if (e.code === 4010) setError({ code: 'elsewhere', message: 'This interview was opened in another tab.' });
      else if (e.code !== 1000) setError((prev) => prev ?? { code: 'disconnected', message: 'The connection to the interview was lost.' });
    };
    return () => {
      closed = true;
      socket.close(1000);
      player.current?.close();
      player.current = null;
      if ('speechSynthesis' in window) speechSynthesis.cancel();
    };
  }, [sessionId, finished]);

  /** Microphone frames go to the interviewer; silence while it speaks or when muted. */
  const sendAudio = useCallback((pcm: ArrayBuffer) => {
    if (ws.current?.readyState !== WebSocket.OPEN) return;
    ws.current.send(speaking.current || muted.current ? new ArrayBuffer(pcm.byteLength) : pcm);
  }, []);

  const join = useCallback(() => {
    voice().unlock();
    send({ type: 'join' });
  }, [send]);

  /** After a reload the browser may hold sound back until a click; this click lets it play. */
  const replay = useCallback(() => {
    voice().unlock();
    setBlocked(false);
  }, []);

  return {
    status, error, ready, phase, interviewer, line, transcript, endsAt, minutesLeft, desktop, blocked,
    sendAudio,
    join,
    replay,
    setMuted: (on: boolean) => void (muted.current = on),
    test: () => {
      voice().unlock();
      send({ type: 'test' });
    },
    done: () => send({ type: 'done' }),
    repeat: () => send({ type: 'repeat' }),
    sendText: (text: string) => send({ type: 'text', text }),
    end: () => send({ type: 'end' }),
  };
}
