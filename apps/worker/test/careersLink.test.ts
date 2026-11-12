import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boardFromUrl, boardsInPage } from '../src/listings/careersLink.js';

test('careers links are read as the board each provider uses', () => {
  const cases: [string, string | null][] = [
    ['https://boards.greenhouse.io/razorpaysoftwareprivatelimited', 'greenhouse:razorpaysoftwareprivatelimited'],
    ['https://job-boards.greenhouse.io/Groww/jobs/123', 'greenhouse:groww'],
    ['https://boards.greenhouse.io/embed/job_board?for=acme&amp;b=x', 'greenhouse:acme'],
    ['https://jobs.lever.co/epifi', 'lever:epifi'],
    ['https://jobs.ashbyhq.com/Composio/abc', 'ashby:Composio'],
    ['https://apply.workable.com/plivo/j/123', 'workable:plivo'],
    ['https://careers.smartrecruiters.com/Freshworks', 'smartrecruiters:Freshworks'],
    ['https://browserstack.wd3.myworkdayjobs.com/en-US/External', 'workday:browserstack.wd3/External'],
    ['https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite/job/x', 'workday:nvidia.wd5/NVIDIAExternalCareerSite'],
    ['https://wingify.keka.com/careers/', 'keka:wingify'],
    ['https://acme.freshteam.com/jobs', 'freshteam:acme'],
    ['https://acme.zohorecruit.in/jobs/Careers', 'zohorecruit:acme.zohorecruit.in'],
    // Not a board, or not one we read
    ['https://www.greenhouse.io/blog', null],
    ['https://apply.workable.com/api/v1/x', null],
    ['https://acme.keka.com/hrms', null],
    ['https://rapido.darwinbox.in/ms/candidate/careers', null],
    ['https://www.linkedin.com/company/acme/jobs', null],
  ];
  for (const [url, want] of cases) {
    const b = boardFromUrl(url);
    assert.equal(b ? `${b.provider}:${b.board}` : null, want, url);
  }
});

test('a page lists each linked board once, from links, iframes and scripts', () => {
  const html = `<a href="https://jobs.lever.co/acme">Careers</a> <a href="https://jobs.lever.co/acme/123">Job</a>
    <iframe src="https://boards.greenhouse.io/embed/job_board?for=acme"></iframe>
    <script>window.board = "https://jobs.ashbyhq.com/acme"</script> <a href="https://acme.com/careers">Our careers</a>`;
  assert.deepEqual(boardsInPage(html).map((b) => `${b.provider}:${b.board}`), ['lever:acme', 'greenhouse:acme', 'ashby:acme']);
});
