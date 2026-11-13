# Friday Jobs: rollout of authorized automatic applications

Plan as of 2026-11-13. Goal: real, verified applications sent while candidates' laptops are off, through
channels the employer has authorized. Status and numbers: [FRIDAY_JOBS_APPLY_PLATFORM.md](FRIDAY_JOBS_APPLY_PLATFORM.md);
servers and cost: [FRIDAY_JOBS_DEPLOYMENT.md](FRIDAY_JOBS_DEPLOYMENT.md).

## The key point

The first unattended channel is **one employer's API key, not a bigger server.** API submission is a
few HTTP requests per application from the existing worker; it runs on today's t3.small. The t3.medium
is only needed for server-side form filling (`cloud_form`), which stays off until separately approved.

## Phase 0: release without any automatic channel (no new spend except Supabase Pro)

Ship the branch with every automatic route off: no `ats_credentials`, `AUTO_APPLY_CLOUD_FORM_PROVIDERS`
empty, `JOB_BOT_EXPERIMENTAL=false`. Users get matching, tailored resumes, the extension and Assisted Apply.

Prerequisites (each needs your approval):
1. Supabase Pro with backups (the Free plan's 500 MB is smaller than the listings table).
2. Production secrets: `ATS_CREDENTIALS_KEY` (same value on API and worker), `DOWNLOAD_URL_SECRET`,
   `DEVICE_ID_PEPPER`, `APP_URL`/`JOBS_URL` on the worker (both were missing from the templates; check SSM).
3. Migrations with `supabase db push --linked --include-all` after a backup (all 44 apply cleanly on an
   empty database; additive except constraint widenings and backfills).
4. Jobs plan prices approved, or checkout hidden.

Exit criteria (one week): worker heartbeat steady, no stuck applications in Worker health, daily report
generated each day, dashboard counts match evidence, no errors from retention.

## Phase 1: one employer, one API key, a small daily cap

Pick the employer from **Admin → Employer credentials → Where a credential would unlock the most**.
Candidates today (India tech jobs posted in the last 30 days / eligible matches for the test profile):

| Employer | ATS | Last 30 days | Eligible matches | Why |
|---|---|---|---|---|
| Weekday | Workable | 44 | 20 | Recruiting platform posting for clients (verify): wants candidates, most likely to agree |
| Bosch | SmartRecruiters | 71 | 9 | Largest flow; also reachable via SmartRecruiters' partner programme |
| ServiceNow | SmartRecruiters | 30 | 8 | Same |
| Okta | Greenhouse | 16 | 10 | Good match rate |
| GitLab | Greenhouse | 11 | 8 | Good match rate |

Steps:
1. Agreement with the employer: written permission for Friday to submit candidates' applications through
   their ATS API on the candidates' consent, an agreed **daily cap**, what a good candidate is (we send
   only eligible matches ≥ the user's minimum, default 80), and a contact for problems.
2. They create the key (the admin form shows where, per ATS). Add it with the agreement reference and a
   cap of **5 a day**. Press **Check** (Ashby and Workable verify read-only; Greenhouse, Lever and
   SmartRecruiters are confirmed by the first submission).
3. Pilot users only: keep Auto Apply on for internal/consenting test candidates first. Their matching
   jobs on that board are routed `channel = api` automatically.
4. Watch for a week:
   - every API submission shows **Verified** with the ATS's application id;
   - zero duplicates (the employer can confirm from their side);
   - no `auth` / `validation` failures, or each one understood;
   - the employer is happy with candidate quality.
5. Raise the cap in steps (5 → 20 → 50) with the employer's agreement; open to all users.

Rollback at any point, in seconds and without a deploy: **Revoke** the credential in the admin console.
Its prepared applications re-route to the extension or Assisted Apply on the next tick (≤ 10 minutes);
nothing already sent is resent.

## Phase 2: more employers, then partner programmes

- Repeat Phase 1 per employer. The top 10 employers hold 728 of the 1,387 India tech jobs on boards
  with a submission API; 25 hold 999.
- Partner programmes scale past one-by-one keys (each still requires the employer to opt in):
  - **SmartRecruiters**: job-board partner via the Marketplace; one Partner API key, the Application API
    then accepts applications for customers who enable us.
  - **Greenhouse**: partner programme (Ingestion API); customers create a partner key for us.
  - Lever, Ashby, Workable: no candidate-side partner programme found; per-employer keys.

## Phase 3 (separate approval): server-side form filling

Only if you decide that filling employers' public forms from Friday's servers is acceptable. It
needs the t3.medium (+~$16/month), a CAPTCHA-rate measurement from the server IP, and listing providers in
`AUTO_APPLY_CLOUD_FORM_PROVIDERS`. Start with one provider and the same watch-list as Phase 1.

## Approvals and partnerships that move volume (largest first)

| Item | Unlocks (India tech jobs open today) | Who |
|---|---|---|
| Workday: employer consent or a Workday partnership | 3,380 (64%) | Workday / each employer |
| Employer API keys on Greenhouse, Lever, Ashby, SmartRecruiters, Workable | 1,387 (top 10 employers: 728) | Each employer |
| SmartRecruiters and Greenhouse partner programmes | Opt-in employers on those ATSs | SmartRecruiters, Greenhouse |
| Server form filling (Phase 3) | Same 1,387, without keys | You (policy + t3.medium) |
| Indeed Permitted AI Connector | Indeed's India inventory | Indeed |
| Info Edge (Naukri) partnership | Naukri's inventory | Info Edge |
| Adzuna / JSearch licences | More discovery only (no submission) | Adzuna, RapidAPI provider |

## Roadmap for more successful applications

1. **Now (no approvals needed)**: Assisted Apply and the extension are the volume channel. Reduce friction:
   one-click "apply with prepared resume and answers", daily digest of strong matches, answer-once
   questions (done), and measure conversion from match to confirmed application.
2. **Weeks 1–4**: Phase 0 release, Phase 1 with one employer, the daily report reviewed weekly.
3. **Months 1–3**: 5–10 employer keys from the target list; apply to the SmartRecruiters and Greenhouse
   partner programmes; decide on Phase 3.
4. **Inventory**: more verified India employer boards (each run of `scripts/verify-boards.ts` adds
   roughly 25), several role profiles per candidate (matching already supports role-specific resumes).
5. **Quality over count**: success is interviews, not submissions. Track response rate by channel
   (`/v1/jobs-analytics` has it) and keep the default minimum score at 80.

What stays off regardless: automating LinkedIn, Indeed or Naukri; solving CAPTCHAs; disguising browsers.
