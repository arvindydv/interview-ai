# Friday Jobs: application platform audit and status

Checked against the repository and the local stack on 2026-11-12. "Working" means tested or seen working
here, not just present in code. Nothing below is committed yet (see git status).

## 1. Audit

| Feature | Exists | Working | Reusable | Changes required |
|---|---|---|---|---|
| Jobs web app (Next.js, `apps/jobs`) and API (Fastify, `apps/api`) | Yes | Yes | Yes | None |
| Worker + BullMQ queues + schedulers (`apps/worker`) | Yes | Yes (local `pnpm dev`) | Yes | Production deploy pending (release on hold) |
| Auth (Supabase) | Yes | Yes | Yes | None |
| Job aggregation: Greenhouse, Lever, Ashby, Workable, SmartRecruiters, Workday, Keka, Freshteam, Zoho Recruit, Teamtailor (new), Himalayas, Jobicy, Remote OK, Jooble, JSearch, Adzuna | Yes | Yes, except Adzuna (off: needs a licence) and JSearch/Jooble (terms unconfirmed) | Yes | Commit; decide on Workday (site terms) |
| Sync logging, source health, genuinely-new counts (`job_source_runs`) | Yes (new) | Yes | Yes | None |
| Dedupe: provider id, canonical apply URL, company/title/city key | Yes | Yes | Yes | None |
| Tech and India-eligibility classification | Yes (new) | Yes | Yes | None |
| Application Profile, saved answers | Yes | Yes | Yes | None |
| Resume upload, parsing, per-job tailoring (keeps the candidate's own file) | Yes | Yes | Yes | Tailoring now also works from a pasted description |
| Matching and recommendations | Yes | Yes | Yes | None |
| Cloud Auto Apply (ATS forms from the server: `browser` + `applier` containers) | Yes | Locally: 3 submitted, 5 pending. Off in production (compose profile `cloud-apply`, needs a bigger server) | Yes | Enable in production, size the server (t3.medium) |
| Platform bot `/bot` (LinkedIn, Naukri, Indeed in the user's own session) | Yes | LinkedIn: search and job pages work after the redesign fix; submission untested because LinkedIn's daily Easy Apply cap was reached (likely by HireShell on the same account). Naukri: refused (403). Indeed: not connected yet | Partly | Personal use only (see 3) |
| Evidence for every application | Yes (new) | Yes (DB refuses an applied row without evidence) | Yes | None |
| Assisted Apply (paste a job, tailored resume, confirm) | Yes (new) | Yes (integration tested) | Yes | None |
| Connector capability registry + admin view | Yes (new) | Yes | Yes | Keep current as terms change |
| Applied jobs tracking, saved jobs | Yes | Yes | Yes | None |
| Jobs plans and checkout | Yes | Prices are placeholders, not approved | Yes | Approve prices before release |
| Admin console: Jobs sources, connectors | Yes (new) | Yes | Yes | Set `JOBS_INFRA_MONTHLY_USD` for cost per 1,000 |
| Tests | Worker 29, API 32 unit + integration (local stack) | Pass | | Worker tests now run in CI |

Risks found: production database is the Supabase Free plan (500 MB) while listings alone take about 1 GB
locally, so Pro is needed before release; no production backups; the release is on hold.

## 2. What the official routes allow (researched 2026-11-12)

None of LinkedIn, Naukri or Indeed offers an API that lets a third party submit applications for a
candidate. Every official API sends applications from the platform to the employer or ATS.

- **Naukri**: no public API or aggregator feed; employer-side RMS/ATS integrations only (via an Info Edge
  account manager). Terms forbid automated access. Its CDN answers automated browsers with 403. Naukri's
  own auto-apply is **Naukri Neo** in Naukri360 Pro, with no external integration.
- **LinkedIn**: Apply Connect and Recruiter System Connect are for ATS partners (applications flow to the
  employer); Apply with LinkedIn and the Job Posting API are closed to new partners; Easy Apply APIs are
  removed. User Agreement §8.2 prohibits bots.
- **Indeed**: Indeed Apply, Job Sync and Disposition Sync are for ATS partners. Terms §D.21 and §A.3 ban
  automated applications outside Indeed's own tools. The only possible route is a "Permitted AI
  Connector", at Indeed's discretion.

## 3. How applications are sent now

| Channel | How | Cloud (laptop off) | Evidence |
|---|---|---|---|
| Employer ATS boards (Greenhouse, Lever, Ashby, Workable, SmartRecruiters) | Cloud Auto Apply fills the employer's own public form with the candidate's consent; CAPTCHAs wait for the candidate | Yes, once `cloud-apply` runs in production | Verified (the form's confirmation) |
| LinkedIn, Indeed | Platform bot in the candidate's own session, allowlisted personal use only (`JOB_BOT_USER_EMAILS`). Against both sites' terms | No (runs where the session is) | Verified (site confirmation) |
| Naukri | Assisted Apply: candidate pastes the job, Friday tailors the resume, candidate applies and confirms | n/a | User-reported |
| Any other site | Assisted Apply | n/a | User-reported |

A 403 or other refusal is recorded as `access_restricted` with a reason, not retried for 24 hours, and
never reported as "no jobs found". The bot never solves CAPTCHAs, rotates proxies, spoofs fingerprints or
disguises itself.

## 4. The volume target (65–75 a day per user)

Measured, not projected:
- Open, unique tech jobs open to candidates in India on employer ATS boards (Cloud Auto Apply's pool):
  **4,390**. New ones arrive at roughly **120–390 a day** across all users (measurement window was broken
  by the dev machine sleeping; needs a few days of continuous syncing).
- One user's applications are limited by how many of those match their roles, seniority and location
  (typically a small fraction), not by the applier.
- LinkedIn caps Easy Apply per account per day, and the bot shares that cap with anything else using the
  account.

So 65–75 verified applications a day per user is **not reachable through permitted channels today**
for a typical single role profile. The levers that move it: (1) more employer boards (each verified with
`apps/worker/scripts/verify-boards.ts`), (2) broader role and location preferences per user, (3) Cloud
Auto Apply in production, (4) partnerships: Info Edge, an Indeed AI-connector agreement, Adzuna's licence.

## 5. Not done yet

- Cloud Auto Apply in production (server size, `COMPOSE_PROFILES=cloud-apply`).
- Per-application tailoring inside bot runs (bot uses the uploaded resume; Assisted and Cloud Auto Apply tailor per job).
- The rest of the requested spec after "AI-powered job matching" (section 9 onward was cut off in the brief).
