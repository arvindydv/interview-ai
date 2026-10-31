# Friday Jobs Auto Apply extension

Submits the applications Friday prepared on the server (see `apps/worker/src/queues/autoApply.ts`) from
the user's own Chrome. It never solves or skips a CAPTCHA: when a job board asks for one (or for a
sign-in), the application waits for the user, the tab stays open for them and the queue moves on.

Friday's servers submit first where they can (`apps/worker/src/applier.ts`, which runs this same
`src/filler.js` in server-side Chromium). What they can't finish (a CAPTCHA, a sign-in, Workday, or
every application when the user chose "Only my browser") is marked `needs_browser` and left for this
extension. Both take prepared applications through the same lease, so neither sends one twice.

- **Connecting.** `src/session.js` reads the signed-in session on the Friday Jobs site once and the
  extension exchanges it for a device token of its own (`POST /v1/auto-apply/devices`). It never
  refreshes the site's session, so it can't sign the user out there. The token only works on the
  extension's endpoints (claim, files, report); browsers are listed and can be disconnected on the
  Auto Apply page, or from the popup.
- **Sending.** One prepared application at a time (`POST /v1/auto-apply/claim`, a 15-minute lease),
  filled by `src/filler.js` in a background tab, 45–90 s apart. The filler is injected on every page
  load in that tab: it fills and submits, and on pages loaded after submitting only looks for the job
  board's confirmation. Once the submit button is pressed an application is never sent again
  automatically; without a confirmation it waits for the user to confirm it.
- **Reports** go through an outbox in `chrome.storage`, retried until the API answers, and nothing new
  is claimed while one is undelivered.
- It starts paused; the user presses Start in the popup. Signing out on the site pauses it.

Build: `pnpm --filter @parakeet/extension build` (set `FRIDAY_API_URL` and `FRIDAY_JOBS_URL` for
production), then load `dist/` from `chrome://extensions` → Load unpacked, or upload `dist.zip` to the
Chrome Web Store. Set `NEXT_PUBLIC_EXTENSION_URL` on the jobs site to its store page for the
"Add to Chrome" button.

Tests:

- `pnpm --filter @parakeet/extension test:e2e` runs the built extension in Chromium against the local
  stack and stand-in job boards served by the test (Lever, Ashby, Greenhouse and Workday-style forms,
  CAPTCHA and sign-in hand-offs, closed tabs, an API outage). Chromium resolves the job boards'
  hostnames to the stand-in server and everything else to nothing, so no real job board is reached.
  Needs `SUPABASE_SERVICE_ROLE_KEY` (see the test's header).
- `node test/fill.mjs tasks.json fixtures/ out/` fills saved copies of job board forms with the page's
  scripts removed and the network blocked, never submitting.
