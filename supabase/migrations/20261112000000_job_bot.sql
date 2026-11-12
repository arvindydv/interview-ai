-- Friday Jobs platform bot (packages/shared/src/jobBot.ts): applies for the user on LinkedIn, Naukri and
-- Indeed from the worker, signed in with sessions the user made on each site's own login page. Sessions
-- themselves stay on the worker's disk; only their status is kept here.

create table public.job_bot_settings (
  user_id    uuid primary key references public.users (id) on delete cascade,
  settings   jsonb not null,
  updated_at timestamptz not null default now()
);

create table public.job_bot_sessions (
  user_id     uuid not null references public.users (id) on delete cascade,
  platform    text not null check (platform in ('linkedin', 'naukri', 'indeed')),
  status      text not null default 'disconnected' check (status in ('connected', 'disconnected', 'needs_verification', 'connecting')),
  message     text,
  last_run_at timestamptz,
  updated_at  timestamptz not null default now(),
  primary key (user_id, platform)
);

-- Every job the bot opened: applied, or skipped and why. One row per job; a retry updates it.
create table public.job_bot_applications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.users (id) on delete cascade,
  platform   text not null check (platform in ('linkedin', 'naukri', 'indeed')),
  job_id     text not null,
  title      text not null default '',
  company    text not null default '',
  location   text not null default '',
  url        text not null,
  outcome    text not null check (outcome in ('applied', 'skipped', 'needs_answer', 'failed', 'already_applied', 'external')),
  detail     text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, platform, job_id)
);
create index job_bot_applications_user_idx on public.job_bot_applications (user_id, outcome, updated_at desc);

alter table public.job_bot_settings enable row level security;
alter table public.job_bot_sessions enable row level security;
alter table public.job_bot_applications enable row level security;
