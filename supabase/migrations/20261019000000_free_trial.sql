-- Free trial: every account starts with 10 minutes of live session time (users on the 'free' plan).
-- Metered by the API while a live connection is open (lib/trial.ts). Paid plans aren't metered.
alter table public.users add column trial_seconds      int not null default 600 check (trial_seconds >= 0);
alter table public.users add column trial_used_seconds int not null default 0   check (trial_used_seconds >= 0);
