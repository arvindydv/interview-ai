-- Practice mode (spec F1–F3): mock interviews. The question plan and the debrief are written by the
-- worker; answers by the API as the candidate goes.
create table public.practice_sessions (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.users (id) on delete cascade,
  interview_id   uuid references public.interview_sessions (id) on delete set null,
  -- Fixed at the start, so the history still reads right if the interview is edited or deleted.
  title          text not null default '',
  round_type     text not null,
  difficulty     text not null check (difficulty in ('warmup', 'standard', 'tough')),
  question_count int not null check (question_count between 1 and 10),
  status         text not null default 'planning' check (status in ('planning', 'ready', 'scoring', 'scored', 'failed')),
  error          text,
  questions      jsonb not null default '[]',
  answers        jsonb not null default '[]',
  result         jsonb,
  -- Overall 0–100 score from `result`, kept as a column for the readiness trend.
  score          int check (score between 0 and 100),
  created_at     timestamptz not null default now(),
  completed_at   timestamptz,
  updated_at     timestamptz not null default now()
);
create index practice_sessions_user_created_idx on public.practice_sessions (user_id, created_at desc);

alter table public.practice_sessions enable row level security;
create policy "practice read own rows" on public.practice_sessions for select using (auth.uid() = user_id);
