# Friday Jobs Auto Apply extension

Submits the applications Friday prepared on the server (see `apps/worker/src/queues/autoApply.ts`) from
the user's own Chrome. It signs in by reading the user's session on the Friday Jobs site, claims one
prepared application at a time (`POST /v1/auto-apply/claim`), fills the job board's own form in a
background tab (`src/filler.js`), submits it and reports back. It never solves or skips a CAPTCHA: when
a job board asks for one, the tab stays open and the user is notified.

- Build: `pnpm --filter @parakeet/extension build` (set `FRIDAY_API_URL`, `FRIDAY_JOBS_URL`,
  `FRIDAY_SUPABASE_URL`, `FRIDAY_SUPABASE_KEY` for production), then load `dist/` from
  `chrome://extensions` → Load unpacked, or upload `dist.zip` to the Chrome Web Store.
- It starts paused; the user presses Start in the popup.
- `node test/fill.mjs tasks.json fixtures/ out/` fills saved copies of job board forms with the page's
  scripts removed and the network blocked, so it never reaches a job board.
