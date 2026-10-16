-- Interviews for any profession: a free-text field (teaching, finance, HR…) and rounds that aren't
-- software-specific.
alter table public.interview_sessions add column field text not null default '';

alter table public.interview_sessions drop constraint interview_sessions_round_type_check;
alter table public.interview_sessions add constraint interview_sessions_round_type_check
  check (round_type in ('general', 'behavioral', 'technical', 'case_study', 'presentation', 'coding', 'system_design'));
