import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL ??= 'http://127.0.0.1:54321';
process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
process.env.REDIS_URL ??= 'redis://127.0.0.1:6380';
process.env.OPENROUTER_API_KEY = 'test-key';
process.env.ANTHROPIC_API_KEY = '';
process.env.LLM_FAST_MODEL = 'openai/gpt-oss-120b:nitro';
process.env.LLM_FALLBACK_MODEL = '';
const { streamAnswer, fallbackModel, needsThinking } = await import('../src/lib/llm.js');

const sse = (text: string, model: string) =>
  new Response(
    [
      `data: ${JSON.stringify({ model, choices: [{ delta: { content: text } }] })}\n\n`,
      `data: ${JSON.stringify({ model, choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 3 } })}\n\n`,
      'data: [DONE]\n\n',
    ].join(''),
    { status: 200 },
  );

test('the fallback is a different model from the configured provider', () => {
  assert.equal(fallbackModel('openai/gpt-oss-120b:nitro'), 'anthropic/claude-haiku-5.5');
  // Claude falls back to the same model on another provider: a slow provider never means a weaker answer.
  assert.equal(fallbackModel('anthropic/claude-sonnet-5.5'), 'anthropic/claude-sonnet-5.5@claude-on-aws');
  assert.equal(fallbackModel('anthropic/claude-haiku-5.5'), 'anthropic/claude-haiku-5.5@claude-on-aws');
});

test('a model stuck before its first word is replaced by the fallback', async (t) => {
  const models: string[] = [];
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    models.push(body.model);
    if (models.length === 1) {
      // Never answers: hangs until aborted.
      return new Promise((_, reject) => init.signal!.addEventListener('abort', () => reject(init.signal!.reason)));
    }
    return sse('Hello', body.model);
  });
  let text = '';
  const fallbacks: string[] = [];
  const usage = await streamAnswer({
    text: 'What is the event loop?',
    signal: new AbortController().signal,
    onDelta: (d) => (text += d),
    onFallback: ({ to }) => fallbacks.push(to),
  });
  assert.deepEqual(models, ['openai/gpt-oss-120b:nitro', 'anthropic/claude-haiku-5.5']);
  assert.deepEqual(fallbacks, ['anthropic/claude-haiku-5.5']);
  assert.equal(text, 'Hello');
  assert.equal(usage.model, 'anthropic/claude-haiku-5.5');
});

test('an empty answer is retried on the fallback', async (t) => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    calls += 1;
    return sse(calls === 1 ? '' : 'Answer', JSON.parse(String(init.body)).model);
  });
  let text = '';
  await streamAnswer({ text: 'Explain closures', signal: new AbortController().signal, onDelta: (d) => (text += d) });
  assert.equal(calls, 2);
  assert.equal(text, 'Answer');
});

const delayed = (ms: number, signal: AbortSignal, make: () => Response) =>
  new Promise<Response>((resolve, reject) => {
    const t = setTimeout(() => resolve(make()), ms);
    signal.addEventListener('abort', () => {
      clearTimeout(t);
      reject(signal.reason);
    });
  });

test('a quick answer from the main model never calls the fallback', async (t) => {
  const models: string[] = [];
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    const model = JSON.parse(String(init.body)).model;
    models.push(model);
    return delayed(200, init.signal!, () => sse('Fast', model));
  });
  let text = '';
  await streamAnswer({ text: 'What is a closure?', signal: new AbortController().signal, onDelta: (d) => (text += d) });
  assert.deepEqual(models, ['openai/gpt-oss-120b:nitro']);
  assert.equal(text, 'Fast');
});

test('a slow start runs the fallback alongside, and only the first to answer is shown', async (t) => {
  const models: string[] = [];
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    const model = JSON.parse(String(init.body)).model;
    models.push(model);
    // The main model would answer after 8 s; the fallback answers 0.3 s after it starts (at 5.5 s).
    return delayed(models.length === 1 ? 8_000 : 300, init.signal!, () => sse(models.length === 1 ? 'Slow' : 'Backup', model));
  });
  let text = '';
  const started = Date.now();
  const usage = await streamAnswer({ text: 'Design a URL shortener', signal: new AbortController().signal, onDelta: (d) => (text += d) });
  assert.deepEqual(models, ['openai/gpt-oss-120b:nitro', 'anthropic/claude-haiku-5.5']);
  assert.equal(text, 'Backup');
  assert.equal(usage.model, 'anthropic/claude-haiku-5.5');
  assert.ok(Date.now() - started < 6_500, 'answered by the fallback without waiting for the slow model');
});

test('only code-tracing and calculation questions think before answering', () => {
  for (const q of [
    'What will this print: console.log 1, setTimeout log 2',
    'In what order does this code run?',
    'What is the output of this snippet?',
    'What is the time complexity of binary search?',
    'Calculate the EMI on a 5 lakh loan',
    'const x = () => 1; what does it return?',
  ]) assert.equal(needsThinking(q), true, q);
  for (const q of [
    'What is the event loop in Node.js?',
    'Tell me about yourself',
    'Agar database slow ho jaye peak time pe toh aap kya karoge?',
    'Why did you use Redis instead of Postgres?',
    'Suppose your API becomes slow during a sale. What would you do?',
  ]) assert.equal(needsThinking(q), false, q);
});

test('Claude through OpenRouter is pinned to Anthropic first, and a "@provider" suffix pins another', async (t) => {
  const bodies: any[] = [];
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    bodies.push(body);
    return sse('Hi', body.model);
  });
  process.env.LLM_FAST_MODEL = 'anthropic/claude-haiku-5.5';
  const { streamAnswer: answer } = await import('../src/lib/llm.js?pinned');
  await answer({ text: 'What is a closure?', signal: new AbortController().signal, onDelta: () => {}, models: { fast: 'anthropic/claude-haiku-5.5@claude-on-aws' } });
  await answer({ text: 'What does this print: console.log(1)', signal: new AbortController().signal, onDelta: () => {}, models: { fast: 'anthropic/claude-haiku-5.5' } });
  assert.equal(bodies[0].model, 'anthropic/claude-haiku-5.5');
  assert.deepEqual(bodies[0].provider, { order: ['claude-on-aws'], allow_fallbacks: true });
  assert.deepEqual(bodies[0].reasoning, { enabled: false });
  assert.deepEqual(bodies[1].provider, { order: ['anthropic', 'claude-on-aws'], allow_fallbacks: true });
  assert.deepEqual(bodies[1].reasoning, { effort: 'low', exclude: true });
});
