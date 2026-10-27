-- Reports of AI-generated answers (Microsoft Store policy 11.16), filed from the desktop app and
-- reviewed in the admin console.

create table public.content_reports (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.users (id) on delete cascade,
  -- The answer's id as the client knows it (live_turns.turn_id).
  turn_id      text not null,
  live_turn_id uuid references public.live_turns (id) on delete set null,
  reason       text not null check (reason in ('harmful', 'inappropriate', 'misleading', 'other')),
  details      text not null default '',
  -- Snapshot of the reported question and answer, so the evidence outlives the turn record.
  question     text not null default '',
  answer       text not null default '',
  model        text,
  status       text not null default 'open' check (status in ('open', 'actioned', 'dismissed')),
  admin_note   text not null default '',
  reviewed_by  text,
  reviewed_at  timestamptz,
  created_at   timestamptz not null default now(),
  -- Reporting the same answer again updates the existing report.
  unique (user_id, turn_id)
);
create index content_reports_created_idx on public.content_reports (created_at desc);
create index content_reports_open_idx on public.content_reports (created_at desc) where status = 'open';

-- Lookups from a report to the turn it is about.
create index live_turns_user_turn_idx on public.live_turns (user_id, turn_id);

-- Only the API's own Postgres role reads these; nothing is exposed through PostgREST.
alter table public.content_reports enable row level security;
