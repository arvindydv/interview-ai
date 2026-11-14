import { test } from 'node:test';
import assert from 'node:assert/strict';

// lib/listen.ts reads env (and so DATABASE_URL etc.) on import.
process.env.SUPABASE_URL ??= 'http://127.0.0.1:54321';
process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
process.env.REDIS_URL ??= 'redis://127.0.0.1:6380';
const { Conversation, QuestionBuffer, isQuestion } = await import('../src/lib/listen.js');

test('questions and requests from the interviewer are answered automatically', () => {
  for (const t of [
    'Tell me about yourself',
    'So what made you apply for this role',
    'Walk me through your resume',
    'Could you explain how a hash map works',
    "I'd like to know about your experience with React",
    'I want to hear about a time you handled a difficult customer',
    'I’m curious how you would design a URL shortener',
    'I would love to hear how you prioritise your work',
    'Take me through your last project',
    'Help me understand why you left your previous job',
    'Please introduce yourself',
    'Kindly explain the difference between SQL and NoSQL',
    'In your opinion what makes a good teacher',
    'Okay so the next question is about conflict resolution',
    "Let's talk about your biggest project",
    'Any questions for us',
  ]) {
    assert.equal(isQuestion(t), true, t);
  }
});

test('small talk and acknowledgements are not answered', () => {
  for (const t of ['Thank you that is great', 'Okay sounds good', 'Great, nice to meet you', 'I see, that makes sense', "Alright let's move on", 'Hi']) {
    assert.equal(isQuestion(t), false, t);
  }
});

test('Hindi and Hinglish questions are answered automatically', () => {
  for (const t of [
    'event loop kya hota hai',
    'aap ye explain karo ki closures kaise kaam karte hain',
    'apne last project ke baare mein batao',
    'agar server down ho jaye toh aap kya karoge',
    'microservices aur monolith mein difference samjhaiye',
    'aapne Redis kyun use kiya',
    'kitne users the us application pe',
    'आप अपने बारे में बताइए',
    'इवेंट लूप क्या है',
    'kya aap React ke hooks samjha sakte hain',
  ]) {
    assert.equal(isQuestion(t), true, t);
  }
  for (const t of ['theek hai, accha laga', 'haan sahi hai', 'okay bahut badhiya']) {
    assert.equal(isQuestion(t), false, t);
  }
});

test('a scenario asked in parts is answered as one question', () => {
  const q = new QuestionBuffer();
  q.push('So you have an e-commerce app with one million users.', 0);
  q.push('During a sale the payment service starts timing out.', 5_000);
  assert.equal(
    q.compose('What would you do first?', 9_000),
    'So you have an e-commerce app with one million users. During a sale the payment service starts timing out. What would you do first?',
  );
});

test('a long pause or the candidate speaking starts a new question', () => {
  const q = new QuestionBuffer();
  q.push('What is a closure?', 0);
  assert.equal(q.compose('What is hoisting?', QuestionBuffer.GAP_MS + 1), 'What is hoisting?');
  q.push('Tell me about your project.', 0);
  q.reset();
  assert.equal(q.compose('Why did you pick Postgres?', 1_000), 'Why did you pick Postgres?');
});

test('follow-ups see earlier suggested answers, and the question is not repeated in the history', () => {
  const c = new Conversation();
  c.add('interviewer', 'What is caching?');
  c.addAnswer('What is caching?', 'Caching means keeping a copy of data somewhere fast. In my app I used Redis.');
  c.add('interviewer', 'So your app has a slow page.');
  const history = c.render('So your app has a slow page. Why did you choose Redis?');
  assert.match(history, /Interviewer: What is caching\?/);
  assert.doesNotMatch(history, /slow page/);
  assert.match(history, /<answers_suggested_earlier>[\s\S]*I used Redis/);
});
