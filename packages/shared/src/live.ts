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
  | { type: 'pong'; t: number; serverTime: number };

export function parseMessage<T extends { type: string }>(raw: string): T | null {
  try {
    const msg = JSON.parse(raw);
    return msg && typeof msg.type === 'string' ? (msg as T) : null;
  } catch {
    return null;
  }
}
