// Contract between the Rust backend (via src/bridge.ts) and the React windows.
import type { HealthReport, Interview, InterviewInput, Me, Resume, ResumeUpload, ServerMessage } from '@parakeet/shared';

export type LiveState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';
export interface LiveStatus {
  state: LiveState;
  sessionId: string | null;
  rttMs: number | null;
  error?: string;
}
/** A server message as forwarded by main; the first token of each turn carries main-measured TTFT. */
export type LiveEvent = ServerMessage & { ttftMs?: number };

export type OverlayCommand = 'answer' | 'screenshot' | 'chat';

/** Capture state of one audio source (interviewer = system audio, you = microphone). */
export interface SourceStatus {
  /** The user wants it on. */
  enabled: boolean;
  state: 'off' | 'starting' | 'on' | 'error';
  error: string | null;
}
export interface AudioStatus {
  interviewer: SourceStatus;
  you: SourceStatus;
  /** Answer finished interviewer questions without pressing Answer. */
  autoAnswer: boolean;
}
export interface AudioSettings {
  interviewer: boolean;
  you: boolean;
  autoAnswer: boolean;
}

export interface Protection {
  level: 'hidden' | 'not_guaranteed' | 'visible';
  detail: string;
}

export interface Screenshot {
  id: string;
  width: number;
  height: number;
  /** Small data: URL for previews. */
  thumb: string;
}

export interface AuthState {
  user: { id: string; email: string } | null;
}

export interface ParakeetApi {
  auth: {
    get(): Promise<AuthState>;
    signIn(): Promise<AuthState>;
    signOut(): Promise<void>;
    onChange(cb: (s: AuthState) => void): () => void;
  };
  api: {
    me(): Promise<Me>;
    health(): Promise<HealthReport>;
  };
  /** Interview context: the resume and the interview being prepared for, attached to every answer. */
  profile: {
    resume(): Promise<Resume | null>;
    uploadResume(file: ResumeUpload): Promise<Resume>;
    deleteResume(): Promise<void>;
    interview(): Promise<Interview | null>;
    saveInterview(input: InterviewInput): Promise<Interview>;
  };
  live: {
    connect(): Promise<void>;
    disconnect(): Promise<void>;
    /** Sends a question, optionally with captured screenshots (ids from screenshot.capture). */
    ask(text: string, imageIds?: string[]): Promise<string>;
    cancel(turnId: string): Promise<void>;
    status(): Promise<LiveStatus>;
    onStatus(cb: (s: LiveStatus) => void): () => void;
    onMessage(cb: (m: LiveEvent) => void): () => void;
    /** A question was sent (from any window), or heard and auto-answered (`auto`); carries its text. */
    onAsked(cb: (q: { turnId: string; text: string; imageCount: number; auto?: boolean }) => void): () => void;
  };
  /** Live audio capture, running while the live session is. */
  audio: {
    status(): Promise<AudioStatus>;
    set(settings: AudioSettings): Promise<void>;
    onStatus(cb: (s: AudioStatus) => void): () => void;
  };
  overlay: {
    toggle(): Promise<void>;
    /** Shows the overlay and brings it to the front. */
    show(): Promise<void>;
    /** Ends the interview: stops the session and closes the overlay (quits if the main window was closed). */
    close(): Promise<void>;
    /** Global shortcut pressed while another app has focus. */
    onCommand(cb: (command: OverlayCommand) => void): () => void;
  };
  screenshot: {
    /** Captures the screen the overlay is on; the full image stays in Rust until sent. */
    capture(): Promise<Screenshot>;
    discard(id: string): Promise<void>;
  };
  app: {
    /** Whether this OS can keep Parakeet's windows out of screen sharing. */
    protection(): Promise<Protection>;
    copy(text: string): Promise<void>;
    showMain(): Promise<void>;
    quit(): Promise<void>;
  };
  platform: string;
}
