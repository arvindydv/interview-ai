-- Friday Jobs Auto Apply (packages/shared/src/autoApply.ts). The worker prepares applications on a
-- schedule (apps/worker/src/queues/autoApply.ts); the Friday extension submits them from the user's
-- browser and reports back through the API (apps/api/src/routes/autoApply.ts).

create table public.auto_apply_settings (
  user_id      uuid primary key references public.users (id) on delete cascade,
  enabled      boolean not null default false,
  min_score    smallint not null default 70 check (min_score between 50 and 90),
  daily_limit  smallint not null default 100 check (daily_limit between 1 and 100),
  -- The daily limit resets at midnight here.
  timezone     text not null default 'Asia/Kolkata',
  -- When the user agreed to applications being sent in their name. Required to enable.
  consented_at timestamptz,
  planned_at   timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index auto_apply_settings_enabled_idx on public.auto_apply_settings (planned_at nulls first) where enabled;

-- ApplicationProfile: what forms ask that a resume doesn't say.
create table public.application_profiles (
  user_id    uuid primary key references public.users (id) on delete cascade,
  data       jsonb not null default '{}',
  updated_at timestamptz not null default now()
);

create table public.auto_applications (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references public.users (id) on delete cascade,
  listing_id         uuid references public.job_listings (id) on delete set null,
  tailored_resume_id uuid references public.tailored_resumes (id) on delete set null,
  provider           text not null,
  apply_url          text not null,
  -- Copied so the record outlives the listing.
  title              text not null,
  company            text not null,
  score              smallint,
  status             text not null default 'preparing'
                     check (status in ('preparing', 'prepared', 'pending', 'submitted', 'failed', 'skipped')),
  reason_code        text,
  reason             text,
  -- FormQuestion[] and PreparedAnswer[]; missing: keys of required questions waiting for the user.
  form               jsonb,
  answers            jsonb,
  missing            text[] not null default '{}',
  attempts           smallint not null default 0,
  -- The extension's lease while it submits.
  claimed_by         text,
  claimed_at         timestamptz,
  -- After a failed submission, not handed to the extension again before this.
  retry_at           timestamptz,
  submitted_at       timestamptz,
  evidence           jsonb,
  -- The user's calendar day this counts against their daily limit.
  plan_day           date not null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  -- One application per job per user, ever.
  unique (user_id, listing_id)
);
create index auto_applications_user_status_idx on public.auto_applications (user_id, status, updated_at desc);
create index auto_applications_user_day_idx on public.auto_applications (user_id, plan_day);
create index auto_applications_active_idx on public.auto_applications (status, updated_at)
  where status in ('preparing', 'prepared', 'pending');
-- Same role at the same company posted twice (two locations, a repost): applied to once.
create index auto_applications_role_idx on public.auto_applications (user_id, lower(company), lower(title));

create table public.auto_apply_events (
  id             bigint generated always as identity primary key,
  application_id uuid not null references public.auto_applications (id) on delete cascade,
  user_id        uuid not null references public.users (id) on delete cascade,
  kind           text not null,
  message        text not null,
  detail         jsonb,
  created_at     timestamptz not null default now()
);
create index auto_apply_events_application_idx on public.auto_apply_events (application_id, id);

alter table public.auto_apply_settings  enable row level security;
alter table public.application_profiles enable row level security;
alter table public.auto_applications    enable row level security;
alter table public.auto_apply_events    enable row level security;
