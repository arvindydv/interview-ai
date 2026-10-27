-- Interviews page: users keep several interviews and choose which one live answers use.

-- The active interview is the one most recently activated (previously: most recently edited), so
-- fixing a typo in an old interview no longer switches the desktop app over to it.
alter table public.interview_sessions add column active_at timestamptz not null default now();
update public.interview_sessions set active_at = updated_at;
create index interview_sessions_user_active_idx on public.interview_sessions (user_id, active_at desc);

-- When the interview happens, and where the candidate is with it. `status` was unused ('draft').
alter table public.interview_sessions add column scheduled_at timestamptz;
-- Private to the candidate; never sent to the model.
alter table public.interview_sessions add column notes text not null default '';

update public.interview_sessions set status = 'preparing';
alter table public.interview_sessions alter column status set default 'preparing';
alter table public.interview_sessions add constraint interview_sessions_status_check
  check (status in ('preparing', 'done', 'offer', 'rejected', 'withdrawn'));

-- Which interview each live question was answered for, so every interview shows its own activity.
alter table public.live_turns add column interview_id uuid references public.interview_sessions (id) on delete set null;
create index live_turns_interview_idx on public.live_turns (interview_id, created_at desc) where interview_id is not null;
