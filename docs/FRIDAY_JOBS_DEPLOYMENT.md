# Friday Jobs: deployment, sizing and cost

Prepared 2026-11-12 on branch `feat/jobs-apply-platform`. **Nothing here has been deployed or provisioned.**
Every step marked *(approval)* needs the owner's go-ahead first; the general server runbook is
[DEPLOYMENT.md](DEPLOYMENT.md).

## 1. What runs where

One server (today a t3.small in ap-south-1, Ubuntu 24.04), `deploy/compose.yml`:

| Service | Role | Always on? | mem_limit |
|---|---|---|---|
| caddy, web, admin, jobs, api | HTTPS and the sites | yes | 128 / 384 / 256 / 256 / 512 MB |
| redis | BullMQ queues and schedules (AOF on, `noeviction`) | yes | 256 MB |
| **worker** | listings sync, matching, Auto Apply preparation (tailoring, answers), API submissions, cold email, daily report, retention | yes | **512 MB** (was 384) |
| browser *(profile `cloud-apply`)* | Chromium only, sandboxed, no secrets | when enabled | 1024 MB |
| applier *(profile `cloud-apply`)* | claims applications from the API and drives the browser | when enabled | 192 MB |

The worker is what keeps applications moving while the candidate's laptop is off: schedules live in
Redis, jobs survive restarts (Redis AOF), Auto Apply's 10-minute tick puts stalled preparations back on the
queue and returns lapsed submission leases, and nothing that pressed a submit button is ever sent again.

Channels (see `packages/shared/src/applyPipeline.ts`, `resolveChannel`):

| Channel | Runs on | Needs |
|---|---|---|
| Employer ATS API | worker | an employer/partner credential in `ats_credentials` + `ATS_CREDENTIALS_KEY` |
| Friday servers fill the employer's form | browser + applier | `COMPOSE_PROFILES=cloud-apply`, the provider in `AUTO_APPLY_CLOUD_FORM_PROVIDERS` *(approval)*, a 4 GB server |
| Candidate's browser (extension) | the candidate's Chrome | the extension connected |
| Assisted Apply | the candidate | nothing |

## 2. Changes prepared in this branch (config only)

- `deploy/compose.yml`
  - **Fixed a broken file.** On `feat/friday-jobs` (and so this branch) the file had an old copy of the
    `worker` and `applier` services pasted after `applier`, so `docker compose` refused to parse it and
    every deploy from that branch would have failed. `main` is fine. Verified with
    `docker compose -f deploy/compose.yml config -q` (with and without `COMPOSE_PROFILES=cloud-apply`).
  - Worker: `mem_limit` 384 → 512 MB, heap 256 → 320 MB (measured below), and a **healthcheck** on the
    worker's Redis heartbeat (`worker:heartbeat:<container>:*`, written every 30 s by
    `apps/worker/src/heartbeat.ts`). `deploy.sh` already waits for healthy containers
    (`docker compose up --wait`), so a worker that can't reach Redis now fails the deploy instead of passing
    silently. Restart policy (`unless-stopped`), `init`, and log rotation (10 MB × 5 per container) were
    already in place and apply to every service.
- `infra/secrets/{worker,api}.env.example`: the new variables (below).
- `apps/worker/scripts/benchmark-cloud-apply.ts`, `apps/worker/scripts/daily-report.ts`: sizing and the
  daily report on demand.

Not changed: `infra/*.tf` (instance type stays `t3.small` until approved), CI/CD, SSM parameters.

## 3. Environment variables and credentials

New or newly relevant. Push with `infra/scripts/push-secrets.sh <service> infra/secrets/<service>.env`.

| Variable | Service | Value | Notes |
|---|---|---|---|
| `ATS_CREDENTIALS_KEY` | worker **and** api (same value) | `openssl rand -base64 32` | encrypts employer API keys. Losing it makes stored credentials unreadable (re-enter them). Unset = no API channel |
| `AUTO_APPLY_CLOUD_FORM_PROVIDERS` | worker and api (same list) | empty | *(approval)* list a provider only once server-side form filling for it is approved |
| `DOWNLOAD_URL_SECRET` | api | `openssl rand -base64 32` | signs short-lived resume download links on the Applied Jobs dashboard |
| `API_PUBLIC_URL`, `JOBS_URL` | api | production URLs | used in signed links and emails |
| `JOB_BOT_EXPERIMENTAL` | api, worker | `false` | **never `true` in production** (LinkedIn/Indeed/Naukri terms) |
| `RETENTION_*_DAYS` | worker | defaults | see `apps/worker/src/queues/retention.ts` |
| `GOOGLE_CLIENT_ID/SECRET`, `GMAIL_TOKEN_KEY` | api | | cold email from the candidate's Gmail; `gmail.send` is a restricted scope (Google verification + security assessment before public launch) *(approval)* |
| `HUNTER_API_KEY` | worker | | optional contact finder |
| `APPLIER_TOKEN`, `AUTO_APPLY_BROWSER_WS`, `BROWSER_WS_PATH`, `APPLIER_TOKEN_SHA256` | applier, browser, api | | only with `cloud-apply` ([DEPLOYMENT.md §8](DEPLOYMENT.md)) |

Credentials still required from outside (none can be created by us):

1. **Employer or partner ATS API keys** (Greenhouse Job Board API key, Lever Postings API key, Ashby API key
   with candidate write, SmartRecruiters X-SmartToken), each with written permission recorded in
   `ats_credentials.agreement_ref`. Zero are held today, so the API channel carries 0 jobs.
2. A decision on server-side form filling per provider (`AUTO_APPLY_CLOUD_FORM_PROVIDERS`).
3. Supabase Pro on the production project (see cost) and backups switched on.
4. Approved Jobs plan prices (checkout is gated on this).
5. Google OAuth verification for `gmail.send` (cold email), if cold email ships.
6. Licences/terms for keyed sources (Adzuna commercial licence; JSearch storage terms) before enabling them.

## 4. Release steps *(approval for each)*

Prerequisites: the branch's tests pass (`pnpm -r typecheck`, `pnpm --filter @parakeet/worker test`,
`pnpm --filter @parakeet/api test` with the local stack), Supabase Pro is active with a fresh backup.

1. **Back up the production database** (Supabase dashboard → Database → Backups, or
   `pg_dump --format=custom` with the session-pooler URL). Note the backup id.
2. **Migrations, in filename order**, from a machine with the repo at the release commit:
   ```bash
   npx supabase link --project-ref <prod-ref>
   npx supabase db push --linked --include-all --dry-run   # review the list
   npx supabase db push --linked --include-all
   ```
   `--linked` matters: without it the CLI targets the local stack. Pending in this branch (all additive:
   new tables/columns, constraint swaps, data backfills on new columns only):
   `20261030000100` … `20261031000100` (Friday Jobs base, if not yet applied), `20261103000000_cold_email`,
   `20261103000100_jsearch_source`, `20261104000000_cold_email_sends`, `20261110000000_india_employer_boards`,
   `20261110000100_listing_quality_and_source_runs`, `20261110000200_verified_india_tech_boards`,
   `20261112000000_job_bot`, `20261112000100_bot_evidence_assisted`, `20261113000000_apply_pipeline`,
   `20261113000500_more_india_boards`, plus any later ones in `supabase/migrations/`.
   `listing_quality_and_source_runs` backfills existing listings; on a large table run it off-peak.
3. **Secrets**: add the variables in §3 to `infra/secrets/*.env`, push them.
4. **Deploy**: merge to `main` (deploys only run on push to `main`). The workflow builds, ships `deploy/`,
   runs `deploy.sh`, and checks `/health` reports the new commit.
5. **Check**: `sudo docker compose ps` shows `worker` healthy; admin → Jobs sources shows syncs and, the next
   morning, the first daily report; `GET /admin/worker-health` lists the worker heartbeat.
6. **Only then, separately**: the server upgrade and `cloud-apply` (§6), each its own change.

## 5. Rollback

| What | How |
|---|---|
| Application code | **Actions → Deploy → re-run** the previous successful run, or on the server `sudo /opt/parakeet/releases/<previous-sha>/deploy.sh <previous-sha>`. Images are kept a week |
| Cloud apply | remove `COMPOSE_PROFILES` from `/opt/parakeet/config.env` (or empty `AUTO_APPLY_CLOUD_FORM_PROVIDERS`) and redeploy; prepared applications fall back to the extension or Assisted |
| API submission | revoke rows (`update ats_credentials set revoked_at = now()`) or unset `ATS_CREDENTIALS_KEY`; new applications route to the next channel |
| Migrations | all of this branch's migrations are additive, so old code runs against the new schema: roll back code, keep the schema. To undo schema too, restore the step-1 backup (loses data written since). Do not hand-drop columns that later releases read |
| Server size | `instance_type` back in `terraform.tfvars`, `terraform apply` (about a minute of downtime) |

## 6. Sizing (measured 2026-11-12, this laptop: 16 cores, Chrome 13x, local Supabase)

**Cloud form filling** (`apps/worker/scripts/benchmark-cloud-apply.ts`): real `submitInCloud` against
stand-in Lever and Ashby forms served locally (no real job board reached), each page carrying a 1.5 MB
script bundle that builds a large DOM, memory as PSS of the whole Chromium tree.

| Concurrent applications | Applications | All confirmed | Wall per application (p50) | Chromium CPU per application | Chromium peak memory | Applier/driver peak |
|---|---|---|---|---|---|---|
| idle | – | – | – | – | 145 MB | 149 MB |
| 1 | 6 | 6/6 | 5.6 s | 0.29 CPU-s | 244 MB | 173 MB |
| 2 | 12 | 12/12 | 5.6 s | 0.27 CPU-s | 293 MB | 190 MB |
| 4 | 24 | 24/24 | 5.7 s | 0.26 CPU-s | 376 MB | 212 MB |
| 8 | 48 | 48/48 | 5.7 s | 0.26 CPU-s | 551 MB | 251 MB |

So about 145 MB for Chromium plus ~50 MB per open application on these pages. Real ATS pages load more
(fonts, images, analytics, React/Next bundles): budget **~150 MB per tab**. With the production setting of
2 slots: 145 + 2 × 150 ≈ 450 MB, well inside the browser's 1024 MB limit (4 slots would also fit). CPU is
negligible: even at 10× the measured cost on a t3 vCPU, 2,000 applications a month is ~6 CPU-hours.
(The driver here is the benchmark process with tsx; the production applier is plain `node dist` with a
128 MB heap cap.)

**Worker** (the always-on process):

| Measurement | Result |
|---|---|
| Worker idle memory (dev `tsx watch`, all queues) | 165 MB RSS, 100 MB PSS |
| Worker during listings syncs (dev `tsx watch`, ~740 sources, 6 at a time) | highest seen 234 MB RSS; ~300 MB RSS right after a `tsx` restart (includes the TypeScript compiler, absent in production). A dedicated full-sync measurement was started but not completed (see below) |
| Matches refresh for one user (1,500 candidates → 600 matches) | 1.5–2.2 s wall, ~1 CPU-s, ≤ 320 MB process peak (with tsx) |
| Auto Apply preparation, model cost (Haiku 5.5 via OpenRouter, 30 applications) | tailoring $0.0031 + answers $0.0009 × 1.6 calls ≈ **$0.0045 per prepared application** |

Not yet measured: peak memory and CPU of one full listings sync in a production build (`node dist`); measure it on the
server with `docker stats parakeet-worker-1` during a :00/:30 sync before lowering any limit. The 512 MB limit leaves
room over the 234–300 MB seen in development.

Conclusion: **t3.small is enough for everything except cloud form filling.** Its 2 GB already carries
~2.3 GB of container limits (limits, not use). Turning on `cloud-apply` adds browser + applier (up to
~1.2 GB under load), so it needs a **4 GB** server. CPU is not the constraint at the volumes in reach
(t3 "standard" credits: a t3.medium's baseline is 0.4 vCPU sustained, far above the measured load).

## 7. Monthly cost (ap-south-1, on-demand, 730 h; AWS Price List API 2026-11-12)

Unit prices: t3.small $0.0224/h, t3.medium $0.0448/h, t4g.small $0.0112/h, t4g.medium $0.0224/h,
gp3 $0.0912/GB-month (30 GB root = $2.74), public IPv4 $0.005/h ($3.65). Supabase Pro $25/month (8 GB disk,
daily backups, Micro compute covered by the included credit); needed because listings alone exceed the
Free plan's 500 MB (local database: 1.3 GB).

| Option | Servers | AWS | + Supabase Pro | Total (before model cost) | Cloud form filling |
|---|---|---|---|---|---|
| **A** stay as is | t3.small | $22.74 | $25 | **≈ $48** | no |
| **B** one bigger server | t3.medium | $39.09 | $25 | **≈ $64** | yes |
| B′ same, Graviton | t4g.medium (arm64 images) | $22.74 | $25 | **≈ $48** | yes |
| **C** split web / worker | t3.small + t3.medium | $61.83 | $25 | **≈ $87** | yes |
| C′ split, Graviton | t4g.small + t4g.medium | $37.31 | $25 | **≈ $62** | yes |

Plus model cost: **≈ $0.0045 per prepared application** → about **$9–12 per 2,000 applications** (some
prepared applications never get sent). ECR, S3 and data transfer add roughly $1–3. Self-hosted Redis is
included (C needs the API host to reach Redis on the worker host over the VPC: a security-group rule; no
ElastiCache needed).

**Recommendation:** B (t3.medium, +$16/month over today) when, and only when, server-side form filling is
approved: it is a one-line Terraform change and needs no image changes. B′ costs the same as today but
needs arm64 images (CI `docker/build-push-action` with `platforms: linux/arm64`, and re-running the
image smoke test for Chromium and PyMuPDF on arm64) — worth doing before scaling. C only once one server's
4 GB is genuinely short; it adds a second host to operate. Until server-side filling is approved, A is
enough: the worker (API submissions, preparation, matching, reports) runs fine on the t3.small.
