-- Browsers running the Friday extension (apps/extension). Each gets its own long-lived token, so the
-- extension never shares (and rotates) the Friday Jobs site's Supabase session. The token is only
-- good for the extension's endpoints (claim, files, report), and the user can disconnect a browser.

create table public.auto_apply_devices (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.users (id) on delete cascade,
  -- e.g. "Chrome on Linux"
  name         text not null,
  -- sha256 of the token, hex. The token itself is only ever shown to the extension.
  token_hash   text not null unique,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz,
  revoked_at   timestamptz
);
create index auto_apply_devices_user_idx on public.auto_apply_devices (user_id, created_at desc) where revoked_at is null;

alter table public.auto_apply_devices enable row level security;
