-- Admin console: account status, live-answer activity, runtime settings and an audit trail.

-- Suspended users are refused by the API (lib/auth.ts) and disconnected from live sessions.
alter table public.users add column status text not null default 'active' check (status in ('active', 'suspended'));
alter table public.users add column admin_note text not null default '';
alter table public.users add column last_active_at timestamptz;

-- One row per live WebSocket connection (spec §3.5).
create table public.live_sessions (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references public.users (id) on delete cascade,
  client_session_id text not null,
  connected_at      timestamptz not null default now(),
  disconnected_at   timestamptz
);
create index live_sessions_user_idx on public.live_sessions (user_id, connected_at desc);
create index live_sessions_connected_idx on public.live_sessions (connected_at desc);

-- One row per question asked in a live session, with its answer and usage.
create table public.live_turns (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.users (id) on delete cascade,
  live_session_id uuid references public.live_sessions (id) on delete set null,
  turn_id         text not null,
  question        text not null default '',
  answer          text not null default '',
  image_count     int not null default 0,
  -- Interview context at the time of the question.
  field           text not null default '',
  company         text not null default '',
  role            text not null default '',
  has_resume      boolean not null default false,
  model           text,
  tier            text,
  status          text not null check (status in ('done', 'error', 'cancelled', 'blocked')),
  error_code      text,
  tokens_in       int not null default 0,
  tokens_out      int not null default 0,
  ttft_ms         int,
  duration_ms     int,
  created_at      timestamptz not null default now()
);
create index live_turns_created_idx on public.live_turns (created_at desc);
create index live_turns_user_created_idx on public.live_turns (user_id, created_at desc);

-- Runtime settings edited from the admin console (read by the API, cached for a few seconds).
create table public.app_settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

create table public.admin_audit (
  id          bigint generated always as identity primary key,
  admin_email text not null,
  action      text not null,
  target      text,
  details     jsonb not null default '{}',
  created_at  timestamptz not null default now()
);
create index admin_audit_created_idx on public.admin_audit (created_at desc);

-- Only the API's own Postgres role reads these; nothing is exposed through PostgREST.
alter table public.live_sessions enable row level security;
alter table public.live_turns    enable row level security;
alter table public.app_settings  enable row level security;
alter table public.admin_audit   enable row level security;
