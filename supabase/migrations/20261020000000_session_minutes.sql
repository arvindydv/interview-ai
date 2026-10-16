-- Minutes history: metered time per live session (every plan), and how much of it came out of the
-- free trial. Written by the API's session meter (lib/trial.ts) every few seconds while connected,
-- so the numbers hold even when a connection drops without a clean disconnect.
alter table public.live_sessions add column seconds       int not null default 0 check (seconds >= 0);
alter table public.live_sessions add column trial_seconds int not null default 0 check (trial_seconds >= 0);

-- Sessions from before metering: use their connect/disconnect times (none of it came from the trial).
update public.live_sessions
set seconds = greatest(extract(epoch from disconnected_at - connected_at), 0)::int
where disconnected_at is not null and seconds = 0;
