-- History and privacy (spec G1–G3): users browse and search their past live sessions, choose how long
-- question and answer text is kept, and can summarise or delete a session.

-- 'off' keeps no question or answer text at all (usage counts only); the others clear text older than
-- that many days. Existing behaviour is 'forever'.
alter table public.users add column history_retention text not null default 'forever'
  check (history_retention in ('off', '7d', '30d', '90d', 'forever'));

-- Deleting a session from history hides it and clears its text; usage and billing figures stay.
alter table public.live_sessions add column deleted_at timestamptz;
-- Post-interview summary (G2), written by the worker on request.
alter table public.live_sessions add column summary jsonb;
alter table public.live_sessions add column summary_status text check (summary_status in ('pending', 'ready', 'failed'));

-- Full-text search across questions and answers (G1). 'simple' because questions come in any language.
alter table public.live_turns add column search tsvector
  generated always as (to_tsvector('simple', coalesce(question, '') || ' ' || coalesce(answer, ''))) stored;
create index live_turns_search_idx on public.live_turns using gin (search);
create index live_turns_session_idx on public.live_turns (live_session_id, created_at);
