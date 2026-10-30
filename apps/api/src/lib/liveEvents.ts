import { EventEmitter } from 'node:events';
import type { ServerMessage } from '@parakeet/shared';

// What a user's live (desktop app) connections send them, for other parts of the API to watch: the
// practice room uses it to show whether the desktop app heard the AI interviewer and how fast it
// answered. Per instance, like liveRegistry: with several API replicas, the practice room only sees
// desktop connections on its own instance.

export type LiveEvent = { kind: 'open' } | { kind: 'close' } | { kind: 'message'; message: ServerMessage };

const bus = new EventEmitter();
bus.setMaxListeners(0);

export function publishLive(userId: string, event: LiveEvent) {
  bus.emit(userId, event);
}

/** Calls `listener` for each of the user's live events; returns an unsubscribe function. */
export function subscribeLive(userId: string, listener: (event: LiveEvent) => void) {
  bus.on(userId, listener);
  return () => void bus.off(userId, listener);
}
