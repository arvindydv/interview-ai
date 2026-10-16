import type { FastifyInstance } from 'fastify';
import { IMAGE_LIMITS, parseMessage, type ClientMessage, type ImageAttachment, type ServerMessage } from '@parakeet/shared';
import { requireAuth } from '../lib/auth.js';
import { loadInterviewContext, type InterviewContext } from '../lib/context.js';
import { LlmError, llmConfigured, streamAnswer } from '../lib/llm.js';

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
    `**Sample answer** (the AI model isn't connected yet: set \`ANTHROPIC_API_KEY\` on the API) for: _${q}_` +
      (imageCount ? ` with ${imageCount} screenshot${imageCount > 1 ? 's' : ''} received` : ''),
    '',
    using ? `_Context loaded: ${using}. The real model will use it to answer._` : '_No interview context yet: add your resume in Prepare._',
    '',
    '**Direct answer:** open with one sentence you can say out loud, then back it up with a real example from your own experience.',
    '',
    '### 🔑 Key points',
    '- Restate what they are really asking, in one line.',
    '- Give your answer, then one concrete example: the situation, what *you* did, and the result.',
    '- Close by linking it back to this role and organisation.',
    ...(imageCount
      ? [
          '',
          '### 💻 Example code (screenshot questions)',
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

/** Answers one turn with Claude, or with the labelled sample when no credentials are configured. */
async function answerTurn(
  userId: string,
  msg: Extract<ClientMessage, { type: 'ask' }>,
  send: (m: ServerMessage) => void,
  signal: AbortSignal,
  log: FastifyInstance['log'],
) {
  const images = msg.images ?? [];
  // Loaded per question so edits in the main window apply to the very next answer. A failure here
  // must never block an answer: fall back to answering without the candidate's context.
  const context = await loadInterviewContext(userId).catch((err) => {
    log.warn({ err, turnId: msg.turnId }, 'could not load interview context');
    return null;
  });
  if (!llmConfigured()) return streamStubAnswer(msg.text, images.length, context, msg.turnId, send, signal);
  try {
    const usage = await streamAnswer({
      text: msg.text,
      images,
      context: context?.text,
      signal,
      onDelta: (delta, tier) => send({ type: 'token', turnId: msg.turnId, tier, delta }),
    });
    log.info({ turnId: msg.turnId, model: usage.model, images: images.length, context: Boolean(context), usage }, 'answer complete');
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
      send({ type: 'status', userId: req.user.id, sessionId, providers: { stt: 'up', llm: 'up' } });

      socket.on('message', (raw) => {
        const msg = parseMessage<ClientMessage>(raw.toString());
        if (!msg) return send({ type: 'error', code: 'bad_message', message: 'Expected JSON with a type' });

        switch (msg.type) {
          case 'ping':
            return send({ type: 'pong', t: msg.t, serverTime: Date.now() });
          case 'ask': {
            const invalid = validateImages(msg.images);
            if (invalid) return send({ type: 'error', turnId: msg.turnId, code: 'bad_images', message: invalid });
            turns.get(msg.turnId)?.abort();
            const ctrl = new AbortController();
            turns.set(msg.turnId, ctrl);
            answerTurn(req.user.id, msg, send, ctrl.signal, req.log).finally(() => {
              if (turns.get(msg.turnId) === ctrl) turns.delete(msg.turnId);
            });
            return;
          }
          case 'cancel':
            turns.get(msg.turnId)?.abort();
            turns.delete(msg.turnId);
            return;
          case 'image':
            return send({ type: 'error', turnId: msg.turnId, code: 'not_implemented', message: 'Screenshot solve is not wired yet' });
        }
      });

      socket.on('close', () => {
        for (const ctrl of turns.values()) ctrl.abort();
        req.log.info({ sessionId }, 'live session closed');
      });
    },
  );
}
