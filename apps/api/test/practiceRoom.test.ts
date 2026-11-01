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
/** With `voice.on`, the room has a voice: every line is "synthesised" at once. */
const voice = { on: false };
mock.module('../src/lib/tts.js', {
  namedExports: {
    Speech: class {
      ready = Promise.resolve(true);
      done = Promise.resolve(true);
      constructor(readonly text: string) {}
      play = async () => true;
      cancel() {}
    },
    Voice: class {
      close() {}
    },
    ttsConfigured: () => voice.on,
  },
});
mock.module('../src/lib/trial.js', {
  namedExports: { chargeMinutes: async () => null, minutesLeft: () => 600, trialBalance: async () => null },
});

const prompts: string[] = [];
const script: Record<string, object[]> = { greeting: [], confirm: [], interview: [] };
mock.module('../src/lib/interviewer.js', {
  namedExports: {
    ACKNOWLEDGEMENTS: ['Okay.', 'Got it.', 'Sure.'],
    interviewerTurn: async ({ prompt }: { prompt: string }) => {
      prompts.push(prompt);
      const phase = prompt.includes('replied to your greeting') ? 'greeting' : prompt.includes('ready to start') ? 'confirm' : 'interview';
      const next = script[phase].shift() as ({ then?: Promise<void> } & object) | undefined;
      if (!next) throw new Error(`no scripted turn for ${phase}`);
      const { then, ...turn } = next;
      if (then) await then;
      return { answer_complete: true, question_kind: 'role', looking_for: '', ...turn };
    },
  },
});

const { PracticeRoom, sameReply } = await import('../src/lib/practiceRoom.js');

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(check: () => boolean, ms = 5000) {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out');
    await wait(20);
  }
}

function setup(onSay?: (text: string) => void) {
  for (const turns of Object.values(script)) turns.length = 0;
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
      if (m.type === 'say') {
        onSay?.(m.text);
        setTimeout(() => room.said(m.id), 10);
      }
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
  assert.match(lines()[0], /^Hi Arvind, good morning! I'm Friday, and I'll be taking your technical interview today\. How are you doing\?$/);
  assert.equal(store.started, false);

  script.confirm.push({ action: 'start', say: "Great, let's begin. You built the billing service at Acme. How did you design it?", question_kind: 'opener' });
  speak("I'm good, how are you?");
  await until(() => lines().length === 2 && listening());
  assert.equal(store.started, false, 'the clock waits for the candidate to be ready');

  speak('Yes, let us start');
  await until(() => store.questions.length === 1 && listening());
  assert.equal(store.started, true);
  assert.ok(sent.some((m) => m.type === 'clock'));
  assert.equal(store.questions[0].kind, 'opener');

  // Sounds unfinished: the interviewer stays quiet and keeps listening.
  script.interview.push({ answer_complete: false, action: 'ask', say: '' });
  const asked = prompts.length;
  speak('So the first thing we did was');
  await until(() => prompts.length === asked + 1);
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

test('a decision started on the early end of a sentence is used when the sentence ends as predicted', async () => {
  const { room, store, lines, listening } = setup();
  await room.join();
  script.greeting.push({ action: 'reply', say: 'Ready to start?' });
  speak('Hi');
  await until(() => lines().length === 2 && listening());
  script.confirm.push({ action: 'start', say: 'Tell me about your role at Acme.' });
  speak('Sure');
  await until(() => store.questions.length === 1 && listening());

  const before = prompts.length;
  script.interview.push({ action: 'ask', say: 'Got it. What was the hardest part?' });
  const answer = 'I led the billing team of five and we rebuilt invoicing';
  onTurn({ event: 'StartOfTurn', turn_index: 1, transcript: '' });
  onTurn({ event: 'Update', turn_index: 1, transcript: answer });
  onTurn({ event: 'EagerEndOfTurn', turn_index: 1, transcript: answer });
  await wait(30); // the model is asked now, before the end of the sentence is confirmed
  assert.equal(prompts.length, before + 1);
  assert.match(prompts[prompts.length - 1], /Candidate: I led the billing team/);
  onTurn({ event: 'EndOfTurn', turn_index: 1, transcript: answer });
  await until(() => store.questions.length === 2 && listening());
  assert.equal(prompts.length, before + 1, 'no second model call');
  assert.equal(store.answers[0]?.text, answer);

  // A sentence that carries on after the early end throws the speculation away.
  script.interview.push({ action: 'ask', say: 'unused' }, { action: 'ask', say: 'And how did you measure it?' });
  onTurn({ event: 'StartOfTurn', turn_index: 2, transcript: '' });
  onTurn({ event: 'EagerEndOfTurn', turn_index: 2, transcript: 'The hardest part was' });
  await wait(30);
  onTurn({ event: 'TurnResumed', turn_index: 2, transcript: 'The hardest part was' });
  onTurn({ event: 'Update', turn_index: 2, transcript: 'The hardest part was migrating old invoices' });
  onTurn({ event: 'EndOfTurn', turn_index: 2, transcript: 'The hardest part was migrating old invoices' });
  await until(() => store.questions.length === 3 && listening());
  assert.equal(store.questions[2].question, 'And how did you measure it?');
  room.close();
});

test('words still being recognised from the last reply are not taken for the next answer', async () => {
  // "Yes" ends a sentence and the interview starts, but the recogniser is still on "let's start".
  const { room, store, lines, listening } = setup((text) => {
    if (text.startsWith('Tell me')) onTurn({ event: 'StartOfTurn', turn_index: 2, transcript: '' });
  });
  await room.join();
  script.greeting.push({ action: 'reply', say: 'Ready to start?' });
  speak('Hi');
  await until(() => lines().length === 2 && listening());

  script.confirm.push({ action: 'start', say: 'Tell me about your role at Acme.' });
  onTurn({ event: 'StartOfTurn', turn_index: 1, transcript: '' });
  onTurn({ event: 'EndOfTurn', turn_index: 1, transcript: 'Yes.' });
  await until(() => store.questions.length === 1 && listening());
  onTurn({ event: 'EndOfTurn', turn_index: 2, transcript: 'Start.' });

  script.interview.push({ action: 'ask', say: 'What was the hardest part?' });
  onTurn({ event: 'StartOfTurn', turn_index: 3, transcript: '' });
  onTurn({ event: 'EndOfTurn', turn_index: 3, transcript: 'I led the billing team' });
  await until(() => store.questions.length === 2 && listening());
  assert.equal(store.answers[0]?.text, 'I led the billing team');
  room.close();
});

test('silence reported under the current turn does not hide the answer that follows', async () => {
  const { room, store, lines, listening } = setup((text) => {
    // While the greeting plays, Flux reports the (still empty) current turn.
    if (text.startsWith('Hi')) onTurn({ event: 'Update', turn_index: 5, transcript: '' });
  });
  await room.join();
  script.greeting.push({ action: 'reply', say: 'Ready to start?' });
  onTurn({ event: 'StartOfTurn', turn_index: 5, transcript: '' });
  onTurn({ event: 'EndOfTurn', turn_index: 5, transcript: 'I am good, thanks' });
  await until(() => lines().length === 2 && listening());
  assert.equal(store.started, false);
  room.close();
});

test('the reply to "how are you" and the first question are ready before the candidate says yes', async () => {
  const { room, store, lines, listening } = setup();
  prompts.length = 0;
  await room.join();
  script.confirm.push({ action: 'start', say: "Great, let's begin. Tell me about the billing service at Acme.", question_kind: 'opener' });
  speak("I'm good, thanks. And you?");
  await until(() => lines().length === 2 && listening());
  assert.match(lines()[1], /^I'm doing well, thanks for asking\. This is a 10-minute technical round/);
  assert.equal(prompts.length, 1, 'only the first question was asked of the model, ahead of time');
  assert.match(prompts[0], /about to say yes/);

  speak('Yes, ready.');
  await until(() => store.questions.length === 1 && listening());
  assert.equal(lines()[2], "Great, let's begin. Tell me about the billing service at Acme.");
  assert.equal(prompts.length, 1, 'no model call between the yes and the first question');
  assert.equal(store.started, true);
  room.close();
});

test('a question before starting goes to the model, and the prepared first question still follows a yes', async () => {
  const { room, store, lines, listening } = setup();
  prompts.length = 0;
  await room.join();
  script.confirm.push({ action: 'start', say: "Great, let's begin. Tell me about Acme.", question_kind: 'opener' });
  speak("Good. Will you ask coding questions?");
  script.greeting.push({ action: 'reply', say: 'No coding, just questions about your experience. Ready to begin?' });
  await until(() => lines().length === 2 && listening());
  assert.equal(lines()[1], 'No coding, just questions about your experience. Ready to begin?');

  speak('Okay, sure.');
  await until(() => store.questions.length === 1 && listening());
  assert.equal(store.questions[0].question, "Great, let's begin. Tell me about Acme.");
  room.close();
});

test('an early transcript that differs from the final one by a word still counts as the same reply', () => {
  const final = 'I designed them around resources like candidates, jobs, and applications, kept URLs flat and versioned them through a header.';
  assert.ok(sameReply('I design them around resources like candidates jobs and applications kept URLs flat and versioned them through a header', final));
  assert.ok(sameReply('Yes, I am ready.', 'yes i am ready'));
  assert.ok(!sameReply('Yes.', 'Yes. I am ready.'), 'more words is more reply');
  assert.ok(!sameReply('I led the billing team', 'I did not lead the billing team'));
});

/** Microphone audio: `ms` of voice (a loud tone) or silence, in 80 ms frames. */
function mic(room: { audio: (pcm: Buffer) => void }, ms: number, voice: boolean) {
  for (let t = 0; t < ms; t += 80) {
    const pcm = Buffer.alloc(2560);
    if (voice) for (let i = 0; i < 1280; i++) pcm.writeInt16LE(Math.round(6000 * Math.sin(i / 3)), i * 2);
    room.audio(pcm);
  }
}

test('after a short silence the interviewer replies without waiting for the recogniser, and its final words still reach the answer', async () => {
  const { room, store, lines, listening } = setup();
  await room.join();
  script.confirm.push({ action: 'start', say: 'Tell me about your role at Acme.' });
  speak('Hi');
  await until(() => lines().length === 2 && listening());
  speak('Sure');
  await until(() => store.questions.length === 1 && listening());

  script.interview.push({ action: 'ask', say: 'Got it. What was the hardest part?' });
  onTurn({ event: 'StartOfTurn', turn_index: 1, transcript: '' });
  onTurn({ event: 'Update', turn_index: 1, transcript: 'I led the billing team of five and we rebuilt invoicing' });
  mic(room, 1000, true);
  mic(room, 2080, false);
  await until(() => store.questions.length === 2 && listening());
  assert.equal(store.answers[0]?.text, 'I led the billing team of five and we rebuilt invoicing');

  // The recogniser's confirmation arrives later, with one more word.
  onTurn({ event: 'EndOfTurn', turn_index: 1, transcript: 'I led the billing team of five and we rebuilt invoicing fully' });
  await until(() => store.answers[0]?.text.endsWith('fully') ?? false);
  assert.equal(store.questions.length, 2, 'and it is not taken for an answer to the new question');
  room.close();
});

test('a reply the model judged unfinished is not asked about again while the candidate stays quiet', async () => {
  const { room, store, lines, listening } = setup();
  await room.join();
  script.confirm.push({ action: 'start', say: 'Tell me about your role at Acme.' });
  speak('Hi');
  await until(() => lines().length === 2 && listening());
  speak('Sure');
  await until(() => store.questions.length === 1 && listening());

  script.interview.push({ answer_complete: false, action: 'ask', say: '' });
  const asked = prompts.length;
  onTurn({ event: 'StartOfTurn', turn_index: 1, transcript: '' });
  onTurn({ event: 'Update', turn_index: 1, transcript: 'So the first thing we did was' });
  mic(room, 800, true);
  mic(room, 2080, false);
  await until(() => prompts.length === asked + 1);
  await wait(50);
  mic(room, 1600, false);
  await wait(50);
  assert.equal(prompts.length, asked + 1);
  assert.equal(store.questions.length, 1);
  room.close();
});

test('an answer that sounds finished is acknowledged at once, and the question that follows does not repeat the acknowledgement', async () => {
  voice.on = true;
  try {
    const { room, store, lines, listening } = setup();
    await room.join();
    script.confirm.push({ action: 'start', say: 'Tell me about your role at Acme.' });
    speak('Hi');
    await until(() => lines().length === 2 && listening());
    speak('Sure');
    await until(() => store.questions.length === 1 && listening());

    let release!: () => void;
    const slow = new Promise<void>((r) => (release = r));
    script.interview.push({ action: 'ask', say: 'Got it. What was the hardest part?', then: slow });
    const before = lines().length;
    onTurn({ event: 'StartOfTurn', turn_index: 1, transcript: '' });
    onTurn({ event: 'Update', turn_index: 1, transcript: 'I led the billing team of five and we rebuilt invoicing.' });
    mic(room, 1000, true);
    mic(room, 2080, false);
    // The model hasn't answered yet, but the candidate already hears an acknowledgement.
    await until(() => lines().length === before + 1);
    assert.match(lines()[before], /^(Okay|Got it|Right)/);
    release();
    await until(() => store.questions.length === 2 && listening());
    assert.equal(lines()[before + 1], 'What was the hardest part?');
    assert.equal(store.questions[1].question, 'What was the hardest part?');
    room.close();
  } finally {
    voice.on = false;
  }
});

test('after an acknowledgement, an answer the model judged unfinished is kept whole when the candidate carries on', async () => {
  voice.on = true;
  try {
    const { room, store, lines, listening } = setup();
    await room.join();
    script.confirm.push({ action: 'start', say: 'Tell me about your role at Acme.' });
    speak('Hi');
    await until(() => lines().length === 2 && listening());
    speak('Sure');
    await until(() => store.questions.length === 1 && listening());

    script.interview.push({ answer_complete: false, action: 'ask', say: '' });
    const asked = prompts.length;
    onTurn({ event: 'StartOfTurn', turn_index: 1, transcript: '' });
    onTurn({ event: 'Update', turn_index: 1, transcript: 'I led the billing team at Acme for two years.' });
    mic(room, 1000, true);
    mic(room, 2080, false);
    await until(() => prompts.length === asked + 1 && listening());
    assert.equal(store.questions.length, 1, 'still on the first question');

    // They carry on in the same sentence, then finish.
    script.interview.push({ action: 'ask', say: 'Got it. What changed?' });
    const full = 'I led the billing team at Acme for two years. We rebuilt invoicing from scratch.';
    onTurn({ event: 'Update', turn_index: 1, transcript: full });
    onTurn({ event: 'EndOfTurn', turn_index: 1, transcript: full });
    await until(() => store.questions.length === 2 && listening());
    assert.equal(store.answers[0]?.text, full);
    room.close();
  } finally {
    voice.on = false;
  }
});

test('an answer that starts in the same recogniser turn as the last reply is heard, without the last reply', async () => {
  // "Yes" starts the interview while the recogniser is still on "I am ready", and that turn never closes.
  const { room, store, lines, listening } = setup((text) => {
    if (text.startsWith('Tell me')) onTurn({ event: 'Update', turn_index: 2, transcript: 'I am ready' });
  });
  await room.join();
  script.confirm.push({ action: 'start', say: 'Tell me about your role at Acme.' });
  speak('Hi');
  await until(() => lines().length === 2 && listening());
  onTurn({ event: 'StartOfTurn', turn_index: 1, transcript: '' });
  onTurn({ event: 'EndOfTurn', turn_index: 1, transcript: 'Yes.' });
  await until(() => store.questions.length === 1 && listening());

  script.interview.push({ action: 'ask', say: 'What was the hardest part?' });
  mic(room, 400, true);
  onTurn({ event: 'Update', turn_index: 2, transcript: 'I am ready I led the billing team' });
  onTurn({ event: 'EndOfTurn', turn_index: 2, transcript: 'I am ready I led the billing team' });
  await until(() => store.questions.length === 2 && listening());
  assert.equal(store.answers[0]?.text, 'I led the billing team');
  room.close();
});

test('a pause under two seconds mid-answer is not taken for the end of the answer, even when the recogniser ends the sentence', async () => {
  const { room, store, lines, listening } = setup();
  await room.join();
  script.confirm.push({ action: 'start', say: 'Tell me about your role at Acme.' });
  speak('Hi');
  await until(() => lines().length === 2 && listening());
  speak('Sure');
  await until(() => store.questions.length === 1 && listening());

  // The recogniser ends the sentence and the model calls the answer finished after a 1.5 s pause...
  // (Replies prepared ahead during pauses use model turns too.)
  for (let i = 0; i < 6; i++) script.interview.push({ action: 'ask', say: 'What was the hardest part?' });
  onTurn({ event: 'StartOfTurn', turn_index: 1, transcript: '' });
  onTurn({ event: 'Update', turn_index: 1, transcript: 'I led the billing team.' });
  mic(room, 1000, true);
  onTurn({ event: 'EndOfTurn', turn_index: 1, transcript: 'I led the billing team.' });
  mic(room, 1500, false);
  await wait(300);
  assert.equal(store.questions.length, 1, 'no question yet: they have only paused for 1.5 s');

  // ...but they carry on, so that decision is dropped and the answer is taken whole.
  mic(room, 800, true);
  onTurn({ event: 'StartOfTurn', turn_index: 2, transcript: '' });
  onTurn({ event: 'Update', turn_index: 2, transcript: 'We rebuilt invoicing in six months.' });
  onTurn({ event: 'EndOfTurn', turn_index: 2, transcript: 'We rebuilt invoicing in six months.' });
  mic(room, 2080, false);
  await until(() => store.questions.length === 2 && listening());
  assert.equal(store.answers[0]?.text, 'I led the billing team. We rebuilt invoicing in six months.');
  room.close();
});

test('after two seconds of quiet the interviewer moves on', async () => {
  const { room, store, lines, listening } = setup();
  await room.join();
  script.confirm.push({ action: 'start', say: 'Tell me about your role at Acme.' });
  speak('Hi');
  await until(() => lines().length === 2 && listening());
  speak('Sure');
  await until(() => store.questions.length === 1 && listening());

  for (let i = 0; i < 4; i++) script.interview.push({ action: 'ask', say: 'What was the hardest part?' });
  onTurn({ event: 'StartOfTurn', turn_index: 1, transcript: '' });
  onTurn({ event: 'Update', turn_index: 1, transcript: 'I led the billing team.' });
  mic(room, 1000, true);
  onTurn({ event: 'EndOfTurn', turn_index: 1, transcript: 'I led the billing team.' });
  mic(room, 1900, false);
  await wait(300);
  assert.equal(store.questions.length, 1);
  mic(room, 200, false);
  await until(() => store.questions.length === 2 && listening());
  room.close();
});
