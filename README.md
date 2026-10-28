# Friday AI: Real-Time AI Interview Assistant

Starter monorepo for the platform described in
[AI_Interview_Assistant_Product_Features_and_Architecture.pdf](AI_Interview_Assistant_Product_Features_and_Architecture.pdf).
It sets up auth and connectivity end to end; the product features (audio capture, STT, LLM answers…) build on top.

```
apps/
  api/        Edge API: Fastify, Supabase JWT verification, REST + WS /v1/live/:sessionId   :4000
  worker/     BullMQ background worker (resume parsing, pack builds, summaries… go here)
  web/        Next.js website: email-OTP + Google sign-in, dashboard, desktop sign-in handoff :3100
  admin/      Next.js admin console: analytics, users, live activity, settings, audit log      :3200
  jobs/       Next.js Friday Jobs site, a separate web app (jobs.DOMAIN in production)        :3300
  desktop/    Tauri 2 desktop app: React UI (src/) + Rust backend (src-tauri/), main window + overlay
packages/
  shared/     Types shared by every app (live WS protocol, REST shapes)
  emails/     React Email templates (auth + product emails), compiled for Supabase and rendered by the worker
supabase/     Local Supabase config, migrations, email template
```

## Prerequisites

Node 22+, pnpm 10, Docker, and for the desktop app **Rust** (`curl https://sh.rustup.rs -sSf | sh`) plus the
Tauri system packages for your OS:

| OS | Install |
|---|---|
| macOS 11+ | `xcode-select --install` |
| Windows 10/11 | [Microsoft C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) ("Desktop development with C++"). WebView2 ships with Windows 11 and is auto-installed on 10. |
| Ubuntu / Debian | `sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev libssl-dev libdbus-1-dev patchelf build-essential` |
| Arch / Manjaro | `sudo pacman -S --needed webkit2gtk-4.1 gtk3 libappindicator-gtk3 librsvg openssl patchelf base-devel` |
| Fedora | `sudo dnf install webkit2gtk4.1-devel gtk3-devel libappindicator-gtk3-devel librsvg2-devel openssl-devel patchelf` |

## First run

```bash
pnpm install
pnpm setup            # creates .env files from the .env.example files
pnpm infra:up         # Redis (docker, :6380) + local Supabase (Postgres :54322, Auth :54321, Mailpit :54324)
pnpm dev              # api + worker + web
pnpm dev:desktop      # in a second terminal: the Tauri desktop app (first run compiles Rust, ~2–5 min)
```

Open http://localhost:3100 and sign in with any email. Local Supabase doesn't send real email: open
**Mailpit at http://127.0.0.1:54324** to read the 6-digit code.

## What's wired up

| Flow | Where |
|---|---|
| Email OTP + Google OAuth sign-in (Supabase Auth) | `apps/web/app/login` |
| Desktop signs in through the system browser; the website hands the session to a one-shot `127.0.0.1` loopback listener (RFC 8252, works on every OS/distro without URL-scheme registration), checked with a random `state` (spec A1) | `apps/desktop/src-tauri/src/auth.rs`, `apps/web/app/desktop-auth` |
| Desktop refresh token kept in the OS credential store: macOS Keychain, Windows Credential Manager, Linux Secret Service (GNOME Keyring / KWallet); access token only in memory | `apps/desktop/src-tauri/src/store.rs` |
| API verifies Supabase JWTs locally via JWKS (ES256), with HS256 fallback for legacy projects | `apps/api/src/lib/auth.ts` |
| `GET /v1/me` creates/returns the app user; `POST /v1/devices` registers a desktop install | `apps/api/src/routes/me.ts` |
| `GET /health` checks Postgres, Redis and Auth | `apps/api/src/routes/health.ts` |
| `POST /v1/jobs/ping` round-trips a job through Redis → worker | `apps/api/src/routes/jobs.ts`, `apps/worker` |
| Authenticated WebSocket `ask` / `cancel` / `token` / `done` / `ping` protocol (spec §3.5), heartbeat RTT, reconnect with backoff, time-to-first-token measured in Rust | `apps/api/src/routes/live.ts`, `apps/desktop/src-tauri/src/live.rs` |
| Overlay window: transparent, always on top, content-protected, rAF token batching, `Ctrl/⌘+Shift+Space` | `apps/desktop/src-tauri/src/lib.rs`, `apps/desktop/src/overlay.tsx` |
| **Prepare** tab, for any profession (teaching, finance, HR, healthcare, software…): upload a resume (PDF/DOCX/TXT), set field, organisation, role, round and job description (spec A2/A3). Only the extracted text is stored, never the file | `apps/desktop/src/prepare.tsx`, `apps/api/src/routes/profile.ts` |
| Resume analysis: the worker turns the text into a structured profile (skills with years, roles, projects, STAR stories) with Claude structured outputs | `apps/worker/src/queues/profile.ts` |
| Every live answer gets the latest resume + interview as a second, prompt-cached system block (the "Interview Pack", spec A4), so answers use the candidate's real projects and are tailored to the JD | `apps/api/src/lib/context.ts`, `apps/api/src/lib/llm.ts` |

**Answers come from Claude** when `ANTHROPIC_API_KEY` is set in `apps/api/.env`. Without it the live channel
streams a labelled sample answer (which also says what interview context was loaded). Resume analysis needs the
key in `apps/worker/.env` too; without it the resume is still used for answers as plain text.

## Desktop app architecture

Tauri uses the OS's own web engine (WebView2 on Windows, WKWebView on macOS, WebKitGTK on Linux), so
installers are a few MB instead of ~100 MB for Electron. All logic (auth, token refresh, API calls, the live
WebSocket) runs in **Rust** (`src-tauri/src`); the React windows call it through typed commands in
`src/bridge.ts` and never see a token. Capabilities in `src-tauri/capabilities` limit what webviews can do,
and a strict CSP is set in `tauri.conf.json`. Native audio capture (spec B1/B2) will live in the same Rust crate.

**Platform notes**
- Screen-share exclusion (`content_protected`) works on Windows 10 2004+ and macOS ≤14; macOS 15+ and
  Linux cannot guarantee it (spec §8).
- Global hotkeys work on Windows, macOS and Linux X11. On Linux **Wayland** sessions most compositors don't
  allow apps to grab global keys; use the Overlay button instead.
- Linux without a Secret Service (e.g. bare window managers) falls back to a `0600` file in the app data dir.

## Configuration

| App | File | Notes |
|---|---|---|
| api | `apps/api/.env` | `SUPABASE_URL`, `DATABASE_URL`, `REDIS_URL`, `CORS_ORIGINS`, `ANTHROPIC_API_KEY` |
| worker | `apps/worker/.env` | `REDIS_URL`, `DATABASE_URL`, `ANTHROPIC_API_KEY` (resume analysis; `LLM_PROFILE_MODEL` defaults to `claude-sonnet-5-5`) |
| web | `apps/web/.env.local` | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_API_URL` |
| desktop | `apps/desktop/.env` | `PARAKEET_*`, baked into the binary at compile time (env vars override) |

To use a hosted Supabase project, put its URL, publishable key and Postgres connection string in these
files and run `npx supabase link` + `npx supabase db push` to apply `supabase/migrations`.

**Google sign-in:** create an OAuth client in Google Cloud with redirect URI
`http://127.0.0.1:54321/auth/v1/callback`. Put `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID` and
`SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET` in `supabase/.env`, set `enabled = true` under
`[auth.external.google]` in `supabase/config.toml`, then restart Supabase.

## Deploying

Server apps run as Docker images (`Dockerfile`, one `--target` per app) on an AWS EC2 server behind Caddy,
with infrastructure in `infra/` (Terraform) and every push to `main` deployed by `.github/workflows/deploy.yml`.
Step-by-step first deploy, operations and desktop releases: **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)**.

## Building installers

`pnpm build:desktop` builds installers for the OS you're on, into `apps/desktop/src-tauri/target/release/bundle/`:

| OS | Output |
|---|---|
| macOS | `.dmg`, `.app` (`pnpm --filter @parakeet/desktop tauri build --target universal-apple-darwin` for Intel + Apple Silicon) |
| Windows | `.exe` (NSIS) and `.msi` |
| Linux | `.deb` (Ubuntu/Debian), `.rpm` (Fedora), `.AppImage` (runs on any distro, including Arch) |

Each OS must build its own installers, so `.github/workflows/desktop.yml` builds all three on GitHub Actions
(run it manually or push a `desktop-v*` tag). Set production URLs as repository variables (`PARAKEET_*`).
Code signing (Apple notarisation, Windows certificate) still needs certificates.

## AI answers and Screenshot Solve

- Put a Claude API key in `apps/api/.env` as `ANTHROPIC_API_KEY` (https://console.anthropic.com → API keys) and
  restart `pnpm dev`. Without it, answers are a clearly labelled sample so the UI still works.
- Models (per the spec, overridable with `LLM_FAST_MODEL` / `LLM_VISION_MODEL`): text questions → **Claude Haiku
  5.5** (fast tier, low effort), questions with screenshots → **Claude Sonnet 5.5** (vision, adaptive thinking at
  medium effort, server-side refusal fallback). See `apps/api/src/lib/llm.ts`.
- **Screenshot** (button or `Ctrl/⌘ ⇧ ↵`) captures the screen the overlay is on, hiding the overlay for the
  shot, and adds a thumbnail to Chat. Repeat for multi-part problems (up to 6), add an optional note, press
  Enter. Images are downscaled to 1568 px and JPEG-encoded in Rust (`src-tauri/src/screenshot.rs`) and sent with
  the question; they are never written to disk by Friday AI.
- Capture backends: native APIs (`xcap`) on Windows/macOS; the desktop screenshot portal on Linux (GNOME/KDE,
  Wayland and X11). macOS asks for **Screen Recording** permission the first time; some Linux desktops ask too.

## Email (Brevo)

| Email | Sent by | When |
|---|---|---|
| Sign-in code, sign-up confirmation, email change, re-authentication, invite, recovery | Supabase Auth → Brevo SMTP | Auth flows |
| Welcome | API enqueues → worker → Brevo | First time a user's account record is created |
| New-device security alert | API enqueues → worker → Brevo | A desktop install registers on an account that already has one |

- **Templates** live in `packages/emails/src` (React Email: table-based, inline styles, works in Gmail, Outlook
  and Apple Mail, with a plain-text part). `pnpm emails:preview` renders all of them to
  `packages/emails/preview/index.html`. After editing auth templates run `pnpm emails:build`: it compiles them to
  `supabase/templates/*.html` and regenerates their blocks in `supabase/config.toml`. Then restart Supabase.
- **Delivery:** product emails go through the BullMQ `email` queue with 6 attempts and exponential backoff
  (15 s → 4 min). SMTP 5xx errors (bad address, rejected sender) fail immediately without retrying. Job IDs
  are deterministic (`welcome-<userId>`, `new-device-<deviceId>`), so a retried request never double-sends.
  Requests never wait on SMTP.
- **Secrets** (`BREVO_SMTP_LOGIN`, `BREVO_SMTP_KEY`, `EMAIL_FROM`) live only in gitignored `apps/worker/.env`
  and `supabase/.env` (Supabase needs `EMAIL_FROM_ADDRESS` and `EMAIL_FROM_NAME` split out).
- **Local dev:** Supabase sends real email through Brevo. To capture auth emails in Mailpit
  (http://127.0.0.1:54324) instead, set `enabled = false` under `[auth.email.smtp]` and restart Supabase. The
  worker uses Mailpit automatically when the Brevo credentials are empty. Don't test with fake addresses
  through Brevo: bounces hurt sender reputation.
- **Production:** send from your own domain (e.g. `hello@yourdomain.com`), not a `@gmail.com` address. In Brevo,
  authenticate the domain (Senders, Domains & Dedicated IPs → add the DKIM and Brevo code DNS records), publish SPF
  (`include:spf.brevo.com`) and a DMARC record. Set the same SMTP values in the hosted Supabase project
  (Authentication → Emails → SMTP Settings) and raise its email rate limit.

## Admin console

`apps/admin` (http://localhost:3200, also started by `pnpm dev`) is the operator console. It talks to `/admin/*`
on the Edge API, which is disabled until these are set in `apps/api/.env`:

| Variable | |
|---|---|
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | The admin sign-in. Use a long random password. |
| `ADMIN_JWT_SECRET` | Signs admin sessions (≥ 32 chars, `openssl rand -hex 32`). Changing it signs the admin out. |
| `ADMIN_SESSION_HOURS` | Session length, default 12. |

Add the console's origin to `CORS_ORIGINS`. Sign-in is rate-limited (10 attempts per IP per 15 min) and is
completely separate from Supabase Auth, so a user token can never reach `/admin`.

| Page | What you can do |
|---|---|
| Overview | KPIs, questions / active users / sign-ups per day, activation funnel, fields, rounds, plans, OS, models, token usage, latency and error rate |
| Users | Search and filter; per user: stats, devices, resume, interview setups, live sessions and every question asked. Change plan, suspend (bans in Supabase, revokes sessions, closes live connections), sign out everywhere, remove devices / resume / interviews, re-run resume analysis, internal notes, delete the account and all data |
| Live activity | Every question asked in a live interview with its full answer, model, latency and tokens; auto-refreshes |
| Interviews | All interview setups, including job descriptions |
| System | Postgres / Redis / Auth health, live connections, BullMQ queue counts, failed jobs (retry or clear) |
| Settings | Maintenance mode, daily question limits per plan, model overrides: applied within seconds, no redeploy |
| Audit log | Every change made from the console |

Activity is recorded by the live route (`live_sessions`, `live_turns`; migration `20261018000000_admin.sql`).
Question and answer text is stored (screenshots are not), so mention this in your privacy policy.

## Useful commands

```bash
pnpm typecheck        # all packages
pnpm build            # all packages
pnpm db:reset         # re-create the local DB from supabase/migrations
pnpm infra:down       # stop Supabase + Redis
```
