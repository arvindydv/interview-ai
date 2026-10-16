-- Resumes (spec A2). Only the extracted text is kept, never the uploaded file.
create table public.resumes (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.users (id) on delete cascade,
  file_name   text not null,
  mime_type   text not null,
  text        text not null,
  -- Structured profile (skills, roles, projects, STAR stories) written by the worker.
  parsed_json jsonb,
  status      text not null default 'parsing' check (status in ('parsing', 'ready', 'failed')),
  error       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index resumes_user_created_idx on public.resumes (user_id, created_at desc);

-- The interview being prepared for (spec A3). The latest row per user is the "current" interview
-- whose context is attached to every live answer.
create table public.interview_sessions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.users (id) on delete cascade,
  company     text not null default '',
  role        text not null default '',
  round_type  text not null default 'general'
              check (round_type in ('general', 'behavioral', 'technical', 'coding', 'system_design')),
  jd_text     text not null default '',
  status      text not null default 'draft',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index interview_sessions_user_updated_idx on public.interview_sessions (user_id, updated_at desc);

alter table public.resumes            enable row level security;
alter table public.interview_sessions enable row level security;

create policy "resumes read own rows"   on public.resumes            for select using (auth.uid() = user_id);
create policy "sessions read own rows"  on public.interview_sessions for select using (auth.uid() = user_id);
