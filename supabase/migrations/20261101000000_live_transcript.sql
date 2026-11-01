-- Interview feedback for real interviews: the whole conversation of a live session (what the
-- interviewer said and, with the microphone on, what the candidate said), as recognised. Written as
-- the interview goes; the feedback after it judges the candidate's own answers from it. Cleared with
-- the session's other text by the user's history setting, and when they delete the session.
alter table public.live_sessions add column transcript jsonb not null default '[]'::jsonb;
