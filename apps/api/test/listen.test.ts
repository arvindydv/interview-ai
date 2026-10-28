import { test } from 'node:test';
import assert from 'node:assert/strict';

// lib/listen.ts reads env (and so DATABASE_URL etc.) on import.
process.env.SUPABASE_URL ??= 'http://127.0.0.1:54321';
process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
process.env.REDIS_URL ??= 'redis://127.0.0.1:6380';
const { isQuestion } = await import('../src/lib/listen.js');

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
