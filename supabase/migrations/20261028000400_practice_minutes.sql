-- Practice spends session minutes like live interviews (free plan and minute packs; paid plans are
-- unlimited). Time is measured on the server between answers, from metered_at.
alter table public.practice_sessions add column seconds int not null default 0 check (seconds >= 0);
alter table public.practice_sessions add column metered_at timestamptz;
