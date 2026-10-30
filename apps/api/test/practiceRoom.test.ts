import { mock, test } from 'node:test';
import assert from 'node:assert/strict';
import type { PracticeAnswer, PracticeQuestion, PracticeServerMessage, PracticeSession } from '@parakeet/shared';

// Run with --experimental-test-module-mocks (see the "test" script). The room's collaborators are
// replaced: speech-to-text is driven by hand, the interviewer model is scripted, and nothing is charged.

process.env.SUPABASE_URL ??= 'http://127.0.0.1:54321';
process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
process.env.REDIS_URL ??= 'redis://127.0.0.1:6380';

type OnTurn = (turn: { event: string; turn_index: number; transcript: string }) => void;
let onTurn: OnTurn = () => {};
mock.module('../src/lib/stt.js', {
  namedExports: {
    sttConfigured: () => true,
    FluxStream: class {
      constructor(opts: { onTurn: OnTurn }) {
        onTurn = opts.onTurn;
      }
      start() {
        return this;
      }
      send() {}
      close() {}
    },
  },
});
mock.module('../src/lib/tts.js', { namedExports: { streamSpeech: async () => false, ttsConfigured: () => false } });
mock.module('../src/lib/trial.js', {
  namedExports: { chargeMinutes: async () => null, minutesLeft: () => 600, trialBalance: async () => null },
});

const prompts: string[] = [];
const script: Record<string, object[]> = { greeting: [], confirm: [], interview: [] };
mock.module('../src/lib/interviewer.js', {
  namedExports: {
    interviewerTurn: async ({ prompt }: { prompt: string }) => {
      prompts.push(prompt);
      const phase = prompt.includes('replied to your greeting') ? 'greeting' : prompt.includes('ready to start') ? 'confirm' : 'interview';
      const next = script[phase].shift();
      if (!next) throw new Error(`no scripted turn for ${phase}`);
      return { answer_complete: true, question_kind: 'role', looking_for: '', ...next };
    },
  },
});

const { PracticeRoom } = await import('../src/lib/practiceRoom.js');

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(check: () => boolean, ms = 5000) {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out');
    await wait(20);
  }
}

function setup() {
  const sent: PracticeServerMessage[] = [];
  const store = {
    questions: [] as PracticeQuestion[],
    answers: [] as (PracticeAnswer | null)[],
    started: false,
    finished: false,
    seconds: 0,
  };
  const session: PracticeSession = {
    id: 's1', interviewId: null, title: 'General practice', roundType: 'technical', difficulty: 'standard', durationMinutes: 10,
    questionCount: 0, answered: 0, status: 'ready', score: null, createdAt: new Date().toISOString(), startedAt: null,
    completedAt: null, seconds: 0, error: null, questions: [], answers: [], result: null,
  };
  const room: InstanceType<typeof PracticeRoom> = new PracticeRoom({
    userId: 'u1',
    session,
    candidateName: 'Arvind Yadav',
    context: '<candidate_context>resume</candidate_context>',
    keyterms: [],
    model: 'claude-haiku-5-5',
    hour: 9,
    store: {
      addQuestion: async (q) => void (store.questions.push(q), store.answers.push(null)),
      setAnswer: async (i, a) => void (store.answers[i] = a),
      dropLastQuestion: async () => void (store.questions.pop(), store.answers.pop()),
      start: async () => void (store.started = true),
      addSeconds: async (s) => void (store.seconds += s),
      finish: async () => {
        store.finished = true;
        return { ...session, status: 'scoring' };
      },
      load: async () => session,
    },
    send: (m) => {
      sent.push(m);
      // The browser plays each line and reports back.
      if (m.type === 'say') setTimeout(() => room.said(m.id), 10);
    },
    sendAudio: () => {},
    close: () => {},
    log: { info: () => {}, warn: () => {}, error: () => {} },
  });
  const lines = () => sent.filter((m): m is Extract<PracticeServerMessage, { type: 'say' }> => m.type === 'say').map((m) => m.text);
  const listening = () => sent.findLast((m) => m.type === 'state')?.type === 'state' &&
    (sent.findLast((m) => m.type === 'state') as { interviewer: string }).interviewer === 'listening';
  return { room, sent, store, lines, listening };
}

/** The candidate says a sentence (one recognised turn). */
function speak(text: string) {
  onTurn({ event: 'StartOfTurn', turn_index: 0, transcript: '' });
  onTurn({ event: 'Update', turn_index: 0, transcript: text });
  onTurn({ event: 'EndOfTurn', turn_index: 0, transcript: text });
}

test('greets by name, starts the clock on yes, asks from the resume and waits for unfinished answers', async () => {
  const { room, sent, store, lines, listening } = setup();
  await room.join();
  assert.match(lines()[0], /^Hi Arvind, good morning! I'm Friday, and I'll be taking your role knowledge interview today\. How are you doing\?$/);
  assert.equal(store.started, false);

  script.greeting.push({ action: 'reply', say: "I'm well, thanks. This is a 10-minute round on your resume. Shall we start?" });
  speak("I'm good, how are you?");
  await until(() => lines().length === 2 && listening());
  assert.equal(store.started, false, 'the clock waits for the candidate to be ready');

  script.confirm.push({ action: 'start', say: "Great, let's begin. You built the billing service at Acme. How did you design it?", question_kind: 'opener' });
  speak('Yes, let us start');
  await until(() => store.questions.length === 1 && listening());
  assert.equal(store.started, true);
  assert.ok(sent.some((m) => m.type === 'clock'));
  assert.equal(store.questions[0].kind, 'opener');

  // Sounds unfinished: the interviewer stays quiet and keeps listening.
  script.interview.push({ answer_complete: false, action: 'ask', say: '' });
  speak('So the first thing we did was');
  await until(() => prompts.length === 3);
  await wait(50);
  assert.equal(lines().length, 3);
  assert.ok(listening());

  // They carry on; this time the answer is complete and the next question comes.
  script.interview.push({ action: 'ask', say: 'Got it. Why did you pick Postgres there?', question_kind: 'follow_up', looking_for: 'Trade-offs' });
  speak('split billing into its own service and moved invoices to a queue');
  await until(() => store.questions.length === 2 && listening());
  assert.equal(store.answers[0]?.text, 'So the first thing we did was split billing into its own service and moved invoices to a queue');
  assert.equal(store.answers[0]?.mode, 'voice');
  assert.ok(store.answers[0]?.delivery);
  assert.match(prompts[prompts.length - 1], /Minutes left: \d/);

  // Ending early drops the unanswered question and starts the review.
  await room.endEarly();
  assert.equal(store.finished, true);
  assert.equal(store.questions.length, 1);
  room.close();
});

test('a repeat request keeps the same question open', async () => {
  const { room, store, lines, listening } = setup();
  await room.join();
  script.greeting.push({ action: 'reply', say: 'Ready to start?' });
  speak('Hi');
  await until(() => lines().length === 2 && listening());
  script.confirm.push({ action: 'start', say: 'Tell me about your role at Acme.' });
  speak('Sure');
  await until(() => store.questions.length === 1 && listening());

  script.interview.push({ action: 'reply', say: 'Of course. Tell me about your role at Acme.' });
  speak('Sorry, could you repeat that?');
  await until(() => lines().length === 4 && listening());
  assert.equal(store.questions.length, 1);
  assert.equal(store.answers[0], null);
  room.close();
});
