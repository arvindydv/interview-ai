// Realtime channel between the desktop client and the Edge API: WS /v1/live/:sessionId (spec §3.5).

export type AnswerTier = 'fast' | 'deep';
export type QuestionType = 'behavioural' | 'technical' | 'coding' | 'system_design' | 'other';

/** A screenshot sent with a question (spec D1–D4). Base64 without a data: prefix. */
export interface ImageAttachment {
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp';
  data: string;
}

/** Limits shared by the desktop app (capture) and the Edge API (validation). */
export const IMAGE_LIMITS = {
  maxImages: 6,
  /** Long edge after downscaling; matches the vision model's native resolution (spec D2). */
  maxEdgePx: 1568,
  /** Per image, base64 characters (~3.75 MB decoded). */
  maxBase64Chars: 5_000_000,
} as const;

/** Who is speaking: the interviewer (system audio) or the candidate (microphone). */
export type AudioSource = 'interviewer' | 'you';

/**
 * Live audio travels as binary WebSocket frames: byte 0 is the source (AUDIO_SOURCE_BYTE), the rest
 * is raw PCM in AUDIO_FORMAT. The desktop app sends ~80 ms per frame.
 */
export const AUDIO_FORMAT = { encoding: 'linear16', sampleRate: 16000, channels: 1 } as const;
export const AUDIO_SOURCE_BYTE: Record<AudioSource, number> = { interviewer: 0, you: 1 };

export type ListenState = 'off' | 'connecting' | 'up' | 'down';

/** Client → server */
export type ClientMessage =
  | {
      type: 'ask';
      turnId: string;
      text: string;
      questionType?: QuestionType;
      deep?: boolean;
      /** Screenshots to solve (multi-screenshot context, spec D4). */
      images?: ImageAttachment[];
    }
  | { type: 'cancel'; turnId: string }
  /** Which audio sources to transcribe, and whether finished interviewer questions are answered automatically. */
  | { type: 'listen'; sources: AudioSource[]; autoAnswer: boolean }
  | { type: 'image'; turnId: string; blobRef: string }
  | { type: 'ping'; t: number };

export interface Usage {
  tokensIn: number;
  tokensOut: number;
}

/** Server → client */
export type ServerMessage =
  | { type: 'token'; turnId: string; tier: AnswerTier; delta: string }
  | { type: 'done'; turnId: string; usage: Usage }
  | { type: 'error'; turnId?: string; code: string; message: string }
  | { type: 'status'; userId: string; sessionId: string; providers: Record<string, 'up' | 'degraded' | 'down'> }
  | { type: 'pong'; t: number; serverTime: number }
  /** Live transcript. `id` is stable for a speaking turn: partial updates replace the text until `final`. */
  | { type: 'transcript'; id: string; source: AudioSource; text: string; final: boolean }
  /** The server heard a question and is answering it as `turnId` (auto-answer). */
  | { type: 'question'; turnId: string; text: string }
  /** Speech-to-text state per source. */
  | { type: 'listening'; sources: Record<AudioSource, ListenState>; error?: string };

export function parseMessage<T extends { type: string }>(raw: string): T | null {
  try {
    const msg = JSON.parse(raw);
    return msg && typeof msg.type === 'string' ? (msg as T) : null;
  } catch {
    return null;
  }
}
