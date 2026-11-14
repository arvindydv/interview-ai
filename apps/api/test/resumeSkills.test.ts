import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resumeSkills, type ResumeProfile } from '@parakeet/shared';

test('the interviewer gets the resume skills in order, then project tools, without repeats', () => {
  const profile = {
    skills: [{ name: 'JavaScript', years: 2 }, { name: 'React', years: null }, { name: 'Node.js', years: null }],
    projects: [
      { name: 'Chat app', summary: '', tech: ['node.js', 'Socket.io', 'MongoDB'], impact: null },
      { name: 'Portfolio', summary: '', tech: ['React', 'Tailwind CSS'], impact: null },
    ],
  } as unknown as ResumeProfile;
  assert.deepEqual(resumeSkills(profile), ['JavaScript', 'React', 'Node.js', 'Socket.io', 'MongoDB', 'Tailwind CSS']);
  assert.deepEqual(resumeSkills(null), []);
});
