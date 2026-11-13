# Friday Jobs: application platform status

Verified on 2026-11-13 against the local stack (branch `feat/jobs-apply-platform`). "Works" means tested
here. Deployment, sizing and cost: [FRIDAY_JOBS_DEPLOYMENT.md](FRIDAY_JOBS_DEPLOYMENT.md).

## 1. The pipeline

Discovery → matching → tailored resume → answers → submission through an authorized channel →
evidence → Applied Jobs dashboard. Every step is covered by `apps/api/test/pipeline.e2e.test.ts`, which
runs the real code with only the model and the job board's HTTP mocked.

| Step | Where | State |
|---|---|---|
| Discovery: Greenhouse, Lever, Ashby, SmartRecruiters, Workable, Teamtailor, Workday, Keka, Zoho, Freshteam boards; remote boards | `apps/worker/src/listings`, `queues/listings.ts` | Works. 739 sources; boards that 404 or stop answering close their jobs |
| Matching: mandatory/preferred skills, years, salary, employment type, work authorization, location, recency; 0–100 score with reasons; ineligible jobs never auto-applied; strong match ≥ 80 (configurable per user) | `packages/shared/src/matching.ts`, `queues/matches.ts` | Works. Deterministic, no model cost; ~1.8 s per user |
| Tailored resume per job, in the candidate's own file; lines naming a skill, employer, degree or certification not in the resume are dropped | `queues/tailor.ts` | Works |
| Screening answers: profile → saved answers → resume → model only for judgment questions. CTC, notice, work authorization, relocation, years with a tool the resume doesn't name: never sent to the model; unknown ones pause as Needs your action, answered once, reused | `autoapply/answers.ts` | Works |
| Channel per application, from what the provider authorizes (`resolveChannel`) | `packages/shared/src/applyPipeline.ts`, `submit/channel.ts` | Works, enforced at preparation and again at every claim |
| Authorized API submission (Greenhouse, Lever, Ashby, SmartRecruiters) | `apps/worker/src/submit`, `queues/submit.ts` | Built and tested with mocks. **Inactive until an employer grants a key** |
| Server-side form filling (`cloud_form`) | `applier.ts`, `browserServer.ts` | Built and tested on stand-in boards. **Off**: needs `AUTO_APPLY_CLOUD_FORM_PROVIDERS` + t3.medium + your approval |
| Extension (candidate's browser) | `apps/extension` | Works (e2e on stand-in boards) |
| Assisted Apply (candidate submits, Friday prepares, candidate confirms) | `/bot` page, `/v1/job-bot/assisted`, `channel = assisted` | Works. Production path for LinkedIn, Indeed, Naukri and anything without an automatic route |
| Applied Jobs dashboard: Verified vs You confirmed, counts only with evidence, signed resume downloads, Needs your action | `routes/appliedJobs.ts`, `/applied` | Works |
| LinkedIn/Indeed/Naukri personal bot | `apps/worker/src/experimental` | **Disabled** (`JOB_BOT_EXPERIMENTAL=false`), never scheduled |

## 2. Submission capability by provider (verified against vendor docs, 2026-11-13)

Public job-board APIs give **discovery only**. Every ATS submission API needs a credential from the
employer (or a partner agreement). None is held today.

| Provider | Discovery | Submission API needs | Connector | Credentials held | Public form (browser) | Status today |
|---|---|---|---|---|---|---|
| Greenhouse | Public board API | Employer's Job Board API key (Basic auth) | Built, mocked tests | 0 | Yes | Extension / Assisted |
| Lever | Public postings API | Employer's Lever API key (`?key=`); no custom questions via API | Built, mocked tests | 0 | Yes | Extension / Assisted |
| Ashby | Public job board API | Employer API key with `candidatesWrite` | Built, mocked tests | 0 | Yes | Extension / Assisted |
| SmartRecruiters | Public postings API | `X-SmartToken` from employer or partner | Built, mocked tests (host/header unconfirmed in docs) | 0 | Yes | Extension / Assisted |
| Workable | Public widget | Employer token, `w_candidates` | Not built | 0 | Yes | Extension / Assisted |
| Teamtailor | RSS | Employer admin API key | Not built | 0 | No | Assisted |
| Workday | Career-site JSON | No candidate API; per-employer sign-in; site terms bar robots | n/a | n/a | Sign-in | Blocked pending agreement |
| LinkedIn | None permitted | No candidate-side API exists | n/a | n/a | n/a | Assisted only |
| Indeed | None permitted | Only a "Permitted AI Connector" agreement | n/a | n/a | n/a | Assisted only |
| Naukri | None (403) | Info Edge partnership | n/a | n/a | n/a | Assisted only |

## 3. Authorization audit: from inventory to applications

Unique, open, India-eligible tech jobs (live counts, 2026-11-13):

| | Jobs | Note |
|---|---|---|
| 1. Discoverable via public APIs | **5,293** | 3,380 Workday, 602 Greenhouse, 379 SmartRecruiters, 181 Ashby, 119 Workable, 112 Lever, 520 other |
| 2. Eligible for the local profile (Backend/Full Stack, Bengaluru) | **494** eligible matches, **94** strong (≥ 80) | Only 20 of the 94 are outside Workday |
| 3. On providers with a submission API and a built connector | 1,274 | Greenhouse, Lever, Ashby, SmartRecruiters |
| 4. With the employer credential we need | **0** | No employer has granted a key |
| 5. Requiring the candidate (extension or Assisted) | **5,293** | All of them, today |
| 6. Confirmed submissions (all time, local) | **3 verified** + 9 the candidate recorded | 5 sent but unconfirmed, 16 waiting for answers, 3 failed; bot: 4 failed |

## 4. Volume: how close to 2,000 confirmed applications a month

Measured (windows are short: syncing only since 2026-11-10, and the laptop slept):
- New India-eligible tech postings: ~155 a day (employer posting dates, 1–12 Nov; range 12–370).
- For one Backend profile, 9% of that pool is eligible and 1.8% is a strong match: about **14 eligible
  and 3 strong new jobs a day**, two-thirds of them on Workday.
- Unattended capacity today: **0** (no employer credentials; server form filling off).
- Model cost: **~$0.0044 per prepared application** (Haiku); infrastructure ~$48–64 a month.

Realistic estimates for one profile like the local one:

| Setup | Confirmed a month (estimate) |
|---|---|
| Today: extension + Assisted, candidate present | 50–150, bounded by the candidate's time |
| + server form filling on Greenhouse/Lever/Ashby/SmartRecruiters/Workable (approval, t3.medium) | +~100 unattended, minus forms with a CAPTCHA (rate unknown until measured from the server) |
| + employer API credentials | Only for those employers' boards; each agreement adds that board's matching jobs |

**2,000 confirmed a month for one profile is not reachable from this inventory.** The limit is
eligible jobs, not throughput: ~155 new India tech postings a day is ~4,650 a month across *all* roles,
and ~9% of them (~420) are eligible for one role and seniority, before any channel limits. It becomes
plausible only across several role profiles per candidate, a much larger employer inventory, and
Workday or platform partnerships.

## 5. Blockers and what each needs

| Blocker | Needs |
|---|---|
| No unattended submissions | Your approval for server form filling (`AUTO_APPLY_CLOUD_FORM_PROVIDERS`, t3.medium), and/or employer API keys with written permission (`ats_credentials.agreement_ref`) |
| Workday (64% of India tech jobs) | Workday's or each employer's consent; per-employer sign-in |
| LinkedIn, Indeed, Naukri | Indeed Permitted AI Connector agreement; Info Edge partnership; LinkedIn has no route |
| Production database | Supabase Pro (Free plan is 500 MB with no backups; listings alone exceed it) |
| Gmail send (cold email) | Google OAuth verification + security assessment (restricted scope) |
| Jobs plan prices | Your approval (₹999 / ₹2,499 / ₹6,999 are placeholders) |
| Adzuna, JSearch | Commercial licence / terms confirmation |
| PyMuPDF (resume editing) | Artifex commercial licence, or open-sourcing |
