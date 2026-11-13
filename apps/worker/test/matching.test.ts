import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_MATCH_CONFIG, extractRequirements, parseSalaryLpa, parseYears, resolveMatchConfig, scoreMatch, unsupportedTerms,
  type MatchCandidateProfile,
} from '@parakeet/shared';

const JD = `About us
We build payments infrastructure for India.

What you'll do
Design services in Node.js and work with our data team on Spark pipelines.

Requirements
- 3-5 years of experience building backend services
- Strong proficiency in Node.js and TypeScript
- Experience with PostgreSQL and Redis
- Bachelor's degree in Computer Science or equivalent

Nice to have
- Kafka, Kubernetes
- Exposure to AWS

Compensation: ₹25 - 35 LPA`;

const NOW = new Date('2026-11-12T00:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

const asha: MatchCandidateProfile = {
  roles: ['Backend Engineer'],
  skills: ['Node.js', 'TypeScript', 'PostgreSQL', 'Kafka', 'Docker'],
  years: 4,
  locations: ['Bengaluru'],
  workplaces: [],
  workAuthorization: [{ country: 'India', authorized: true, needsSponsorship: false }],
  otherCountries: { authorized: false, needsSponsorship: true },
  country: 'India',
  degrees: ['B.Tech in Computer Science'],
};

const listing = (over: Partial<Parameters<typeof scoreMatch>[2]> = {}) => ({
  title: 'Backend Engineer', description: JD, level: 2, location: 'Bengaluru, India', workplace: null, postedAt: daysAgo(2),
  eligibility: 'india', now: NOW, ...over,
});

test('requirements: mandatory vs preferred skills, years, salary, degree', () => {
  const r = extractRequirements('Backend Engineer', JD, null, 'Full-time', null);
  for (const s of ['Node.js', 'TypeScript', 'PostgreSQL', 'Redis']) assert.ok(r.mandatorySkills.includes(s), `${s} mandatory`);
  for (const s of ['Kafka', 'Kubernetes', 'AWS']) assert.ok(r.preferredSkills.includes(s), `${s} preferred`);
  assert.ok(!r.mandatorySkills.includes('Kafka'));
  // Named under "What you'll do", not a requirement.
  assert.ok(!r.mandatorySkills.includes('Spark'));
  assert.equal(r.minYears, 3);
  assert.equal(r.maxYears, 5);
  assert.deepEqual([r.salaryMinLpa, r.salaryMaxLpa], [25, 35]);
  assert.equal(r.employmentType, 'full_time');
  assert.equal(r.degreeRequired, "Bachelor's");
  assert.deepEqual(r.workAuthCountries, []);
  assert.equal(r.sponsorship, 'unknown');
});

test('requirements: years, salary formats and currencies', () => {
  assert.deepEqual(parseYears('Minimum of 5 years of experience in data engineering'), [5, null]);
  assert.deepEqual(parseYears('7+ years of software experience. 2+ years with Kafka.'), [7, null]);
  // "Preferred" years are not the bar.
  assert.deepEqual(parseYears('2+ years of experience required. 5 years of Go experience preferred.'), [2, null]);
  assert.deepEqual(parseYears('We are a 10 year old company'), [null, null]);
  assert.deepEqual(parseSalaryLpa('$150K – $200K • Offers Equity'), [127.5, 170]);
  assert.deepEqual(parseSalaryLpa('$3,200 per month'), [32.6, 32.6]);
  assert.deepEqual(parseSalaryLpa('INR 12,00,000 - 18,00,000 per annum'), [12, 18]);
  assert.deepEqual(parseSalaryLpa('18 lakhs'), [18, 18]);
  assert.deepEqual(parseSalaryLpa('Competitive'), [null, null]);
});

test('requirements: work authorization and sponsorship', () => {
  const us = extractRequirements('Engineer', 'You must be authorized to work in the United States. We are unable to sponsor visas.', null, null, null);
  assert.deepEqual(us.workAuthCountries, ['United States']);
  assert.equal(us.sponsorship, 'not_offered');
  const uk = extractRequirements('Engineer', 'Candidates need the right to work in the UK; visa sponsorship is available.', null, null, null);
  assert.deepEqual(uk.workAuthCountries, ['United Kingdom']);
  assert.equal(uk.sponsorship, 'offered');
  assert.equal(extractRequirements('Engineering Intern', 'Join us', null, null, null).employmentType, 'internship');
  assert.equal(extractRequirements('Engineer', 'This is a 6 month contract role.', null, null, null).employmentType, 'contract');
});

test('score: a good, recent fit is eligible and explains itself', () => {
  const req = extractRequirements('Backend Engineer', JD, null, 'Full-time', null);
  const m = scoreMatch(asha, req, listing());
  assert.equal(m.eligible, true);
  assert.ok(m.score >= DEFAULT_MATCH_CONFIG.strongMatch, `score ${m.score}`);
  assert.deepEqual(m.mandatoryMissing, ['Redis']);
  assert.ok(m.reasons.some((r) => /3 of 4 required skills/.test(r)));
  assert.ok(m.gaps.some((g) => /Redis/.test(g)));
  assert.ok(m.components.recency === 100);
});

test('score: skills only come from the resume', () => {
  const req = extractRequirements('Backend Engineer', JD, null, null, null);
  const m = scoreMatch({ ...asha, skills: [] }, req, listing());
  assert.deepEqual(m.mandatoryMatched, []);
  assert.deepEqual(m.preferredMatched, []);
  assert.equal(m.components.skills, 0);
  // Resume spellings count for the posting's names: "ReactJS" is React, "GitLab CI/CD" is CI/CD.
  const req2 = extractRequirements('Frontend Engineer', 'Requirements\nReact and CI/CD experience', null, null, null);
  const m2 = scoreMatch({ ...asha, skills: ['ReactJS', 'GitLab CI/CD'] }, req2, listing({ title: 'Frontend Engineer' }));
  assert.deepEqual(m2.mandatoryMatched.sort(), ['CI/CD', 'React']);
});

test('reject: work authorization the candidate does not hold', () => {
  const req = extractRequirements('Backend Engineer', `${JD}\nYou must be authorized to work in the United States without sponsorship.`, null, null, null);
  const m = scoreMatch(asha, req, listing({ eligibility: 'elsewhere', location: 'New York, NY' }));
  assert.equal(m.eligible, false);
  assert.ok(m.rejections.some((r) => /United States/.test(r)));
  // Unknown authorization is a gap, never a rejection.
  const unknown = scoreMatch({ ...asha, otherCountries: null }, req, listing({ eligibility: 'elsewhere', location: 'New York, NY' }));
  assert.equal(unknown.eligible, true);
  assert.ok(unknown.gaps.some((g) => /doesn’t say/.test(g)));
  // Authorized but needing sponsorship that isn't offered.
  const needs = scoreMatch({ ...asha, workAuthorization: [...asha.workAuthorization, { country: 'United States', authorized: true, needsSponsorship: true }] }, req, listing());
  assert.equal(needs.eligible, false);
});

test('reject: on-site abroad for someone authorized only in India', () => {
  const req = extractRequirements('Backend Engineer', JD, null, null, null);
  const m = scoreMatch(asha, req, listing({ eligibility: 'elsewhere', location: 'Berlin, Germany' }));
  assert.equal(m.eligible, false);
  assert.ok(m.rejections[0].includes('Berlin'));
});

test('reject: experience gap beyond the configured maximum', () => {
  const req = extractRequirements('Backend Engineer', 'Requirements\n10+ years of experience with Node.js', null, null, null);
  assert.equal(scoreMatch(asha, req, listing()).eligible, false);
  // A wider allowance lets it through, with the gap explained.
  const lenient = scoreMatch(asha, req, listing(), resolveMatchConfig({ maxExperienceGapYears: 8 }));
  assert.equal(lenient.eligible, true);
  assert.ok(lenient.gaps.some((g) => /10\+ years/.test(g)));
});

test('reject: excluded employment type, salary below minimum, stale posting', () => {
  const contract = extractRequirements('Backend Engineer', JD, null, 'Contract', null);
  assert.equal(scoreMatch(asha, contract, listing(), resolveMatchConfig({ employmentTypes: ['full_time'] })).eligible, false);
  assert.equal(scoreMatch(asha, contract, listing()).eligible, true);

  const req = extractRequirements('Backend Engineer', JD, null, null, null);
  const low = scoreMatch(asha, req, listing(), resolveMatchConfig({ minSalaryLpa: 40 }));
  assert.equal(low.eligible, false);
  assert.ok(low.rejections[0].includes('₹35 LPA'));
  assert.equal(scoreMatch(asha, req, listing(), resolveMatchConfig({ minSalaryLpa: 30 })).eligible, true);

  const stale = scoreMatch(asha, req, listing({ postedAt: daysAgo(45) }));
  assert.equal(stale.eligible, false);
  assert.equal(scoreMatch(asha, req, listing({ postedAt: daysAgo(45) }), resolveMatchConfig({ maxPostedDays: 60 })).eligible, true);
});

test('config: weights and thresholds are configurable and clamped', () => {
  const c = resolveMatchConfig({ strongMatch: 300, minScore: -5, weights: { title: 0, skills: 1, experience: 0, location: 0, salary: 0, recency: 0 } });
  assert.equal(c.strongMatch, 100);
  assert.equal(c.minScore, 0);
  const req = extractRequirements('Backend Engineer', JD, null, null, null);
  const skillsOnly = scoreMatch(asha, req, listing(), c);
  assert.equal(skillsOnly.score, skillsOnly.components.skills);
  assert.deepEqual(resolveMatchConfig({}), DEFAULT_MATCH_CONFIG);
  assert.deepEqual(resolveMatchConfig({ weights: { title: 0, skills: 0, experience: 0, location: 0, salary: 0, recency: 0 } }).weights, DEFAULT_MATCH_CONFIG.weights);
});

test('score: a different kind of role scores low however many skills overlap', () => {
  const req = extractRequirements('Data Analyst', 'Requirements\nSQL, PostgreSQL, TypeScript', null, null, null);
  const m = scoreMatch(asha, req, listing({ title: 'Data Analyst' }));
  assert.ok(m.score < 60, `score ${m.score}`);
});

test('tailoring fact guard: new skills, degrees, certifications and employers are caught', () => {
  const source = 'Backend engineer at Acme Payments. Built REST APIs in Node.js and PostgreSQL. B.Tech, IIT Delhi.';
  assert.deepEqual(unsupportedTerms('Built REST APIs in Node.js and PostgreSQL for payments', source), []);
  assert.ok(unsupportedTerms('Built REST APIs in Node.js and Kafka', source).includes('Kafka'));
  assert.ok(unsupportedTerms('Holds an MBA and built APIs', source).some((t) => /MBA/.test(t)));
  assert.ok(unsupportedTerms('AWS Certified Solutions Architect who built APIs', source).length > 0);
  assert.ok(unsupportedTerms('Led a team at Google building APIs', source).includes('Google'));
  assert.deepEqual(unsupportedTerms('Built APIs at Acme Payments', source), []);
});
