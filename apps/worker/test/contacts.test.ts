import { test } from 'node:test';
import assert from 'node:assert/strict';
import { companyDomain, isPublicAddress } from '../src/contacts.js';

test('company websites never reach internal addresses', () => {
  for (const a of ['127.0.0.1', '10.0.0.5', '172.18.0.3', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1']) {
    assert.equal(isPublicAddress(a), false, a);
  }
  for (const a of ['13.127.228.95', '8.8.8.8', '2606:4700:4700::1111']) assert.equal(isPublicAddress(a), true, a);
});

test("only a company's own domain is searched", () => {
  assert.equal(companyDomain('https://www.Wingify.com/careers'), 'wingify.com');
  for (const w of ['aiosmedical.notion.site', 'jobs.lever.co', 'acme.github.io', '169.254.169.254', 'localhost', 'redis', null]) {
    assert.equal(companyDomain(w), null, String(w));
  }
});

test('job boards and hiring software are never taken for the company, and careers subdomains are dropped', () => {
  for (const w of ['in.indeed.com', 'www.naukri.com', 'acme.bamboohr.com', 'himalayas.app', 'www.adzuna.in', 'acme.teamtailor.com', 'wellfound.com']) {
    assert.equal(companyDomain(w), null, w);
  }
  assert.equal(companyDomain('https://careers.acme.co.uk/jobs/1'), 'acme.co.uk');
  assert.equal(companyDomain('jobs.razorpay.com'), 'razorpay.com');
});
