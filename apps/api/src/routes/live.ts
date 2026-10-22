import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import {
  DEFAULT_SETTINGS, IMAGE_LIMITS, parseMessage, type ClientMessage, type ImageAttachment, type ServerMessage,
} from '@parakeet/shared';
import { closeLiveSession, openLiveSession, questionsToday, recordTurn, type TurnRecord } from '../lib/activity.js';
import { requireAuth } from '../lib/auth.js';
import { loadInterviewContext, type InterviewContext } from '../lib/context.js';
import { Conversation, Listener, type AnswerHandle } from '../lib/listen.js';
import { trackConnection } from '../lib/liveRegistry.js';
import { LlmError, llmConfigured, streamAnswer } from '../lib/llm.js';
import { getSettings } from '../lib/settings.js';
import { sttConfigured } from '../lib/stt.js';
import { SessionMeter, TRIAL_ENDED_MESSAGE } from '../lib/trial.js';

// Placeholder until the LLM proxy (spec C4/C5) is wired in: streams a canned, answer-first Markdown
// reply in small chunks so the overlay's rendering, cancellation and usage plumbing can be built
// against the real protocol. It is clearly labelled as a sample.
function stubAnswer(question: string, imageCount: number, context: InterviewContext | null) {
  const q = question.slice(0, 120) || 'your screenshot';
  const target = [context?.role, context?.company].filter(Boolean).join(' at ');
  const using = context
    ? [context.hasResume && 'your resume', target && `the ${target} interview`, context.hasJobDescription && 'the job description']
        .filter(Boolean)
        .join(', ')
    : '';
  return [
    `**Sample answer** (the AI model isn't connected yet: set \`OPENROUTER_API_KEY\` or \`ANTHROPIC_API_KEY\` on the API) for: _${q}_` +
      (imageCount ? ` with ${imageCount} screenshot${imageCount > 1 ? 's' : ''} received` : ''),
    '',
    using ? `_Context loaded: ${using}. The real model will use it to answer._` : '_No interview context yet: add your resume in Prepare._',
    '',
    "So the way I'd answer this is to start with one plain sentence I can say straight away, then back it up with a real example from my own work.",
    '',
    "I'd talk through what was going on, what I actually did, and how it turned out, and then tie it back to why that matters for this role.",
    ...(imageCount
      ? [
          '',
          'Here’s the kind of code you’d get for a coding screenshot:',
          '```python',
          'def two_sum(nums, target):',
          '    seen = {}',
          '    for i, n in enumerate(nums):',
          '        if target - n in seen:',
          '            return [seen[target - n], i]',
          '        seen[n] = i',
          '```',
        ]
      : []),
    '',
    'When the real model is connected, this answer will be generated from your resume and the job description.',
  ].join('\n');
}

async function streamStubAnswer(
  text: string,
  imageCount: number,
  context: InterviewContext | null,
  turnId: string,
  send: (m: ServerMessage) => void,
  signal: AbortSignal,
) {
  const answer = stubAnswer(text, imageCount, context);
  // ~12-char chunks at 20 ms: roughly the cadence of a fast LLM tier.
  const chunks = answer.match(/[\s\S]{1,12}/g) ?? [];
  for (const delta of chunks) {
    if (signal.aborted) return;
    send({ type: 'token', turnId, tier: 'fast', delta });
    await new Promise((r) => setTimeout(r, 20));
  }
  send({ type: 'done', turnId, usage: { tokensIn: text.length, tokensOut: Math.ceil(answer.length / 4) } });
}

/** Returns an error message, or null if the attachments are acceptable. */
function validateImages(images: unknown): string | null {
  if (images === undefined) return null;
  if (!Array.isArray(images)) return 'images must be an array';
  if (images.length > IMAGE_LIMITS.maxImages) return `At most ${IMAGE_LIMITS.maxImages} screenshots per question`;
  for (const img of images as ImageAttachment[]) {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(img?.mediaType)) return 'Unsupported image type';
    if (typeof img.data !== 'string' || !img.data || img.data.length > IMAGE_LIMITS.maxBase64Chars) {
      return 'Screenshot is empty or too large';
    }
  }
  return null;
}

type AskMessage = Extract<ClientMessage, { type: 'ask' }>;

/** Answers one turn with the LLM, or with the labelled sample when no credentials are configured. */
async function answerTurn(
  userId: string,
  msg: AskMessage,
  history: string,
  send: (m: ServerMessage) => void,
  signal: AbortSignal,
  log: FastifyInstance['log'],
  turn: TurnRecord,
  trialEnded: () => boolean,
) {
  const images = msg.images ?? [];
  // Settings, the daily count and the candidate's context are independent lookups: run them at once
  // so a heard question reaches the model after one database round trip, not three.
  // Loaded per question so edits in the main window apply to the very next answer. A failure here
  // must never block an answer: fall back to answering without the candidate's context.
  const contextP = loadInterviewContext(userId).catch((err) => {
    log.warn({ err, turnId: msg.turnId }, 'could not load interview context');
    return null;
  });
  // If the count can't be read, answer rather than lock the user out.
  const usageP = questionsToday(userId).catch((err) => {
    log.warn({ err }, 'could not count questions for the daily limit');
    return null;
  });
  const settings = await getSettings().catch((err) => {
    log.warn({ err }, 'could not load settings');
    return DEFAULT_SETTINGS;
  });
  if (settings.maintenanceMode) {
    turn.status = 'blocked';
    turn.errorCode = 'maintenance';
    return send({ type: 'error', turnId: msg.turnId, code: 'maintenance', message: settings.maintenanceMessage });
  }
  if (trialEnded()) {
    turn.status = 'blocked';
    turn.errorCode = 'trial_ended';
    return send({ type: 'error', turnId: msg.turnId, code: 'trial_ended', message: TRIAL_ENDED_MESSAGE });
  }
  if (Object.values(settings.dailyQuestionLimits).some((n) => n > 0)) {
    const usage = await usageP;
    const plan = usage?.plan ?? 'free';
    const limit = settings.dailyQuestionLimits[plan] ?? 0;
    if (usage && limit > 0 && usage.n >= limit) {
      turn.status = 'blocked';
      turn.errorCode = 'daily_limit';
      return send({
        type: 'error', turnId: msg.turnId, code: 'daily_limit',
        message: `You've used today's ${limit} questions on the ${plan} plan. The limit resets at 00:00 UTC.`,
      });
    }
  }

  const context = await contextP;
  Object.assign(turn, {
    field: context?.field ?? '',
    company: context?.company ?? '',
    role: context?.role ?? '',
    hasResume: context?.hasResume ?? false,
  });
  if (!llmConfigured()) {
    turn.model = 'sample';
    return streamStubAnswer(msg.text, images.length, context, msg.turnId, send, signal);
  }
  try {
    const usage = await streamAnswer({
      text: msg.text,
      images,
      context: context?.text,
      history,
      signal,
      models: { fast: settings.fastModel, vision: settings.visionModel },
      onDelta: (delta, tier) => send({ type: 'token', turnId: msg.turnId, tier, delta }),
    });
    turn.model = usage.model;
    log.info({ turnId: msg.turnId, model: usage.model, images: images.length, context: Boolean(context), history: Boolean(history), usage }, 'answer complete');
    send({ type: 'done', turnId: msg.turnId, usage: { tokensIn: usage.tokensIn, tokensOut: usage.tokensOut } });
  } catch (err) {
    if (signal.aborted) return; // cancelled by the client: nothing to report
    if (err instanceof LlmError) {
      log.warn({ turnId: msg.turnId, code: err.code }, err.message);
      return send({ type: 'error', turnId: msg.turnId, code: err.code, message: err.message });
    }
    log.error({ err, turnId: msg.turnId }, 'answer failed');
    send({ type: 'error', turnId: msg.turnId, code: 'internal', message: 'Something went wrong generating this answer.' });
  }
}

/** Answers a turn, tracking what it needs for the admin console (question, answer, usage, latency). */
async function answerTracked(
  userId: string,
  msg: AskMessage,
  history: string,
  send: (m: ServerMessage) => void,
  signal: AbortSignal,
  log: FastifyInstance['log'],
  trialEnded: () => boolean,
): Promise<TurnRecord> {
  const started = performance.now();
  const turn: TurnRecord = {
    userId, liveSessionId: null, turnId: msg.turnId, question: msg.text ?? '', answer: '',
    imageCount: msg.images?.length ?? 0, field: '', company: '', role: '', hasResume: false,
    model: null, tier: null, status: 'cancelled', errorCode: null, tokensIn: 0, tokensOut: 0, ttftMs: null, durationMs: null,
  };
  const tracked = (m: ServerMessage) => {
    if (m.type === 'token') {
      if (turn.ttftMs === null) turn.ttftMs = Math.round(performance.now() - started);
      turn.tier = m.tier;
      turn.answer += m.delta;
    } else if (m.type === 'done') {
      turn.status = 'done';
      turn.tokensIn = m.usage.tokensIn;
      turn.tokensOut = m.usage.tokensOut;
    } else if (m.type === 'error') {
      if (turn.status !== 'blocked') turn.status = 'error';
      turn.errorCode = m.code;
    }
    send(m);
  };
  try {
    await answerTurn(userId, msg, history, tracked, signal, log, turn, trialEnded);
  } catch (err) {
    log.error({ err, turnId: msg.turnId }, 'answer failed');
  }
  turn.durationMs = Math.round(performance.now() - started);
  return turn;
}

export default async function liveRoutes(app: FastifyInstance) {
  app.get<{ Params: { sessionId: string } }>(
    '/v1/live/:sessionId',
    { websocket: true, preValidation: requireAuth },
    (socket, req) => {
      const { sessionId } = req.params;
      const turns = new Map<string, AbortController>();
      const send = (m: ServerMessage) => {
        if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(m));
      };

      req.log.info({ userId: req.user.id, sessionId }, 'live session connected');
      const untrack = trackConnection(req.user.id, { close: (code, reason) => socket.close(code, reason) });
      // Activity tracking is best-effort: answers still work if Postgres is unhappy.
      const liveSessionId = openLiveSession(req.user, sessionId).catch((err) => {
        req.log.error({ err }, 'failed to record live session');
        return null;
      });
      const conversation = new Conversation();

      /**
       * Starts answering a question. Heard questions are `announce`d to the client (it didn't ask
       * them); a `hold` answer streams into a buffer until release(), and is dropped (never shown or
       * recorded) if cancelled first.
       */
      const startAnswer = (msg: AskMessage, opts: { announce?: boolean; hold?: boolean } = {}): AnswerHandle => {
        turns.get(msg.turnId)?.abort();
        const ctrl = new AbortController();
        turns.set(msg.turnId, ctrl);
        let held: ServerMessage[] | null = opts.hold ? [] : null;
        const out = (m: ServerMessage) => (held ? held.push(m) : send(m));
        const finished = answerTracked(req.user.id, msg, conversation.render(msg.text), out, ctrl.signal, req.log, () => meter.hasEnded).finally(() => {
          if (turns.get(msg.turnId) === ctrl) turns.delete(msg.turnId);
        });
        const record = () =>
          finished
            .then(async (turn) => {
              turn.liveSessionId = await liveSessionId;
              await recordTurn(turn);
            })
            .catch((err) => req.log.error({ err, turnId: msg.turnId }, 'failed to record turn'));
        const announce = () => opts.announce && send({ type: 'question', turnId: msg.turnId, text: msg.text });
        if (!held) {
          announce();
          void record();
        }
        return {
          release() {
            if (!held || ctrl.signal.aborted) return;
            announce();
            const buffered = held;
            held = null;
            buffered.forEach(send);
            void record();
          },
          cancel() {
            ctrl.abort();
            if (turns.get(msg.turnId) === ctrl) turns.delete(msg.turnId);
          },
        };
      };

      const listener = new Listener({
        send,
        conversation,
        log: req.log,
        answer: (text, hold) => startAnswer({ type: 'ask', turnId: randomUUID(), text }, { announce: true, hold }),
        keyterms: async () => {
          const ctx = await loadInterviewContext(req.user.id);
          return [ctx?.company, ctx?.role].filter((t): t is string => Boolean(t && t.length <= 60));
        },
      });

      // Session time is metered while the connection is open (and charged to the free trial on the
      // free plan). When the trial runs out, stop listening and answering; the socket stays open so
      // the client doesn't reconnect in a loop.
      const meter = new SessionMeter(req.user.id, liveSessionId, req.log, {
        onBalance: (trial) => send({ type: 'trial', trial }),
        onEnded: () => {
          req.log.info({ userId: req.user.id }, 'free trial used up');
          for (const ctrl of turns.values()) ctrl.abort();
          listener.stop(TRIAL_ENDED_MESSAGE);
          send({ type: 'error', code: 'trial_ended', message: TRIAL_ENDED_MESSAGE });
        },
      });
      void meter.start();

      send({
        type: 'status', userId: req.user.id, sessionId,
        providers: { stt: sttConfigured() ? 'up' : 'down', llm: llmConfigured() ? 'up' : 'down' },
      });

      socket.on('message', (raw, isBinary) => {
        if (isBinary) return listener.audio(Buffer.isBuffer(raw) ? raw : Buffer.concat(raw as Buffer[]));
        const msg = parseMessage<ClientMessage>(raw.toString());
        if (!msg) return send({ type: 'error', code: 'bad_message', message: 'Expected JSON with a type' });

        switch (msg.type) {
          case 'ping':
            return send({ type: 'pong', t: msg.t, serverTime: Date.now() });
          case 'ask': {
            const invalid = validateImages(msg.images);
            if (invalid) return send({ type: 'error', turnId: msg.turnId, code: 'bad_images', message: invalid });
            startAnswer(msg);
            return;
          }
          case 'listen':
            if (meter.hasEnded) return;
            if (!Array.isArray(msg.sources)) return send({ type: 'error', code: 'bad_message', message: 'sources must be an array' });
            listener.configure(msg.sources, msg.autoAnswer !== false);
            return;
          case 'cancel':
            turns.get(msg.turnId)?.abort();
            turns.delete(msg.turnId);
            return;
          case 'image':
            return send({ type: 'error', turnId: msg.turnId, code: 'not_implemented', message: 'Screenshot solve is not wired yet' });
        }
      });

      socket.on('close', () => {
        listener.close();
        void meter.stop();
        for (const ctrl of turns.values()) ctrl.abort();
        untrack();
        void liveSessionId.then((id) => (id ? closeLiveSession(id) : undefined)).catch(() => {});
        req.log.info({ sessionId }, 'live session closed');
      });
    },
  );
}
