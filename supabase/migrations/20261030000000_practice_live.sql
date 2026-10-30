-- Practice becomes a live, spoken interview: the candidate picks a length in minutes instead of a
-- number of questions, and the interviewer asks one question at a time from their resume until the
-- time is up. Questions and answers are appended as the interview goes.
alter table public.practice_sessions drop constraint practice_sessions_question_count_check;
alter table public.practice_sessions alter column question_count set default 0;
alter table public.practice_sessions add constraint practice_sessions_question_count_check check (question_count between 0 and 100);

-- Null for sessions from before live practice (a fixed list of questions).
alter table public.practice_sessions add column duration_minutes int check (duration_minutes between 1 and 60);
-- When the candidate said they were ready and the interview clock started.
alter table public.practice_sessions add column started_at timestamptz;
-- How the interviewer greets them, fixed when the session is created.
alter table public.practice_sessions add column candidate_name text not null default '';
