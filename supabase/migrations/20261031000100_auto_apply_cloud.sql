-- Auto Apply from Friday's servers (apps/worker/src/applier.ts, apps/api/src/routes/applier.ts): prepared applications on job boards that
-- don't need the user's own browser are submitted by a server-side browser, so nothing waits for the
-- user's computer to be on. Anything the server can't finish (a CAPTCHA, a sign-in) goes to the
-- user's browser through the Friday extension instead.

-- The user can turn server submission off and keep everything in their own browser.
alter table public.auto_apply_settings add column cloud_submit boolean not null default true;

alter table public.auto_applications
  -- Only the user's browser may take it now (the servers hit a CAPTCHA or sign-in).
  add column needs_browser boolean not null default false,
  -- When a server-side submission pressed the job board's submit button. A lost claim after this
  -- is never sent again, but asks the user to confirm instead.
  add column submit_clicked_at timestamptz,
  -- Who sent it: Friday's servers, the user's browser (the extension), or the user themselves (they
  -- confirmed it after a CAPTCHA, a sign-in or a missing confirmation).
  add column submitted_via text check (submitted_via in ('cloud', 'browser', 'user'));

create index auto_applications_cloud_idx on public.auto_applications (score desc nulls last, created_at)
  where status = 'prepared' and not needs_browser;
