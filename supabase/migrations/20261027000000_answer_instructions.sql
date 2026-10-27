-- The candidate's own instructions for how answers should sound (length, tone, structure…), set on
-- the Prepare screen and attached to every live answer (lib/context.ts).
alter table public.interview_sessions add column instructions text not null default '';
