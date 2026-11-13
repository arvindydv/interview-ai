import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EMPTY_APPLICATION_PROFILE, type ApplicationProfile, type FormQuestion, type ResumeProfile } from '@parakeet/shared';

// No model may be reached from these tests: a key that can't work and a model id that can't resolve.
// Every question here must be settled before the model (profile, saved answer, or "unknown" guard).
process.env.ANTHROPIC_API_KEY = 'test-invalid';
delete process.env.OPENROUTER_API_KEY;
const { answerForm, unknownFact, knownFact } = await import('../src/autoapply/answers.js');

const q = (key: string, label: string, extra: Partial<FormQuestion> = {}): FormQuestion => ({
  key, label, type: 'text', required: true, options: [], kind: 'custom', ...extra,
});

const resume: ResumeProfile = {
  name: 'Asha Rao', headline: 'Backend engineer', summary: '', totalYearsExperience: 4,
  skills: [{ name: 'Node.js', years: 4 }, { name: 'PostgreSQL', years: 3 }],
  experience: [{ company: 'Acme', title: 'Software Engineer', period: '2022 - present', highlights: [] }],
  projects: [], education: [{ school: 'IIT Delhi', degree: 'B.Tech', year: '2021' }], certifications: [], stories: [],
};

const base: ApplicationProfile = {
  ...EMPTY_APPLICATION_PROFILE,
  firstName: 'Asha', lastName: 'Rao', email: 'asha@example.com', phone: '+91 98765 43210', city: 'Bengaluru', country: 'India',
};

const ctx = (profile: ApplicationProfile) => ({
  profile, resume, resumeText: 'Asha Rao. Backend engineer at Acme. Node.js, PostgreSQL.', resumeFileName: 'Resume.pdf', coverLetter: null,
  job: { title: 'Backend Engineer', company: 'Example', location: 'Bengaluru', description: '' }, model: 'never/called',
});

const FACT_QUESTIONS = [
  q('ctc', 'What is your current CTC?'),
  q('ectc', 'Expected CTC (in LPA)'),
  q('notice', 'What is your notice period?'),
  q('sponsor', 'Will you now or in the future require visa sponsorship?', { type: 'select', options: ['Yes', 'No'] }),
  q('relocate', 'Are you willing to relocate to Pune?', { type: 'select', options: ['Yes', 'No'] }),
  q('kafka', 'How many years of experience do you have with Kafka?'),
];

test('facts the profile leaves unknown are never guessed: they pause the application', async () => {
  const r = await answerForm(FACT_QUESTIONS, ctx(base));
  assert.deepEqual(r.missing.map((m) => m.key).sort(), ['ctc', 'ectc', 'kafka', 'notice', 'relocate', 'sponsor']);
  assert.ok(r.answers.every((a) => a.value === null));
  assert.equal(r.usage, null, 'the model was not called');
});

test('the guard names the topic and steps aside once the profile answers it', () => {
  assert.equal(unknownFact(FACT_QUESTIONS[0], base, resume), 'Current salary');
  assert.equal(unknownFact(FACT_QUESTIONS[1], base, resume), 'Expected salary');
  assert.equal(unknownFact(FACT_QUESTIONS[2], base, resume), 'Notice period');
  assert.equal(unknownFact(FACT_QUESTIONS[3], base, resume), 'Where you can work');
  assert.equal(unknownFact(FACT_QUESTIONS[4], base, resume), 'Relocation');
  assert.equal(unknownFact(FACT_QUESTIONS[5], base, resume), 'Years with kafka');
  const full: ApplicationProfile = {
    ...base, currentSalary: '₹18 LPA', expectedSalary: '₹25 LPA', noticePeriodDays: 30, willingToRelocate: true,
    workAuthorization: [{ country: 'India', authorized: true, needsSponsorship: false }],
  };
  for (const question of FACT_QUESTIONS.slice(0, 5)) assert.equal(unknownFact(question, full, resume), null, question.label);
  // Years with a tool on the resume, or overall, are worked out from the resume.
  assert.equal(unknownFact(q('n', 'How many years of experience do you have with Node.js?'), base, resume), null);
  assert.equal(unknownFact(q('t', 'Total years of experience in software development'), base, resume), null);
  assert.equal(unknownFact(q('t', 'Total years of experience in software development'), base, { ...resume, totalYearsExperience: null }), 'Total years of experience');
  // Not a fact question.
  assert.equal(unknownFact(q('w', 'Why do you want to work here?'), base, resume), null);
});

test('an answer the candidate gave once is reused, and beats the guard', async () => {
  const profile: ApplicationProfile = {
    ...base,
    savedAnswers: [
      { question: 'How many years of experience do you have with Kafka?', answer: '1' },
      { question: 'What is your current CTC?', answer: '18 LPA' },
    ],
  };
  const r = await answerForm([FACT_QUESTIONS[0], FACT_QUESTIONS[5]], ctx(profile));
  assert.deepEqual(r.missing, []);
  assert.deepEqual(r.answers.map((a) => [a.key, a.value, a.source]), [['ctc', '18 LPA', 'user'], ['kafka', '1', 'user']]);
  assert.equal(r.usage, null);
});

test('optional unknown facts are left blank, not guessed and not blocking', async () => {
  const r = await answerForm([q('ctc', 'Current CTC', { required: false })], ctx(base));
  assert.deepEqual(r.missing, []);
  assert.equal(r.answers[0].value, null);
});

test('standard fields come from the profile without the model', async () => {
  const r = await answerForm(
    [q('first_name', 'First name', { kind: 'standard' }), q('email', 'Email', { kind: 'standard' }), q('resume', 'Resume', { kind: 'resume', type: 'file' })],
    ctx(base),
  );
  assert.deepEqual(r.answers.map((a) => a.value), ['Asha', 'asha@example.com', 'Resume.pdf']);
  assert.equal(r.usage, null);
});

test('free-text notice period and CTC come word for word from the profile, without the model', async () => {
  const p = { ...base, noticePeriodDays: 30, expectedSalary: '₹24 LPA', currentSalary: '' };
  assert.equal(knownFact(q('a', 'What is your notice period?'), p), '30 days');
  assert.equal(knownFact(q('b', 'Notice period (in days)'), p), '30');
  assert.equal(knownFact(q('c', 'Expected CTC'), p), '₹24 LPA');
  // Unknown stays unknown (the guard asks the candidate); options are left to the mapping step.
  assert.equal(knownFact(q('d', 'Current CTC'), p), null);
  assert.equal(knownFact(q('e', 'Notice period', { type: 'select', options: ['Immediate', '30 days'] }), p), null);
  const { answers, missing } = await answerForm([q('n', 'What is your notice period?', { required: true })], ctx(p));
  assert.deepEqual(answers.map((a) => [a.value, a.source]), [['30 days', 'profile']]);
  assert.deepEqual(missing, []);
});
