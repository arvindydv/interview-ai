-- App-side user record, 1:1 with auth.users (spec §3.4).
create table public.users (
  id            uuid primary key references auth.users (id) on delete cascade,
  email         text not null,
  auth_provider text not null default 'email',
  plan          text not null default 'free',
  region        text,
  created_at    timestamptz not null default now()
);

-- Desktop installs per user, used for device limits (spec A1) and compatibility analytics.
create table public.devices (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.users (id) on delete cascade,
  device_key  text not null,
  os          text not null,
  os_version  text,
  app_version text,
  last_seen   timestamptz not null default now(),
  unique (user_id, device_key)
);

-- The Edge API talks to Postgres directly with its own credentials; clients never query
-- these tables through PostgREST, so lock them down to row owners only.
alter table public.users   enable row level security;
alter table public.devices enable row level security;

create policy "users read own row"   on public.users   for select using (auth.uid() = id);
create policy "devices read own rows" on public.devices for select using (auth.uid() = user_id);
