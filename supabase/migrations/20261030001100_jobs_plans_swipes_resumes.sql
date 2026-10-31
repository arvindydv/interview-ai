-- Friday Jobs: plans, swipe review, role-specific resumes, cover letters and more job boards.

-- Plans (packages/shared/src/jobsPlans.ts): a 30-day one-time payment, like the interview plans,
-- separate from them. jobs_plan is null (free) or basic / standard / premium until it expires.
alter table public.users add column jobs_plan text check (jobs_plan in ('basic', 'standard', 'premium'));
alter table public.users add column jobs_plan_expires_at timestamptz;

-- Daily limits now go up to Premium's 500. "review" mode applies only to jobs the user swiped right on.
alter table public.auto_apply_settings drop constraint auto_apply_settings_daily_limit_check;
alter table public.auto_apply_settings add constraint auto_apply_settings_daily_limit_check check (daily_limit between 1 and 500);
alter table public.auto_apply_settings alter column daily_limit set default 20;
alter table public.auto_apply_settings add column mode text not null default 'auto' check (mode in ('auto', 'review'));

-- Swipe review: right is apply, left is skip. Skipped jobs are never applied to automatically.
create table public.job_swipes (
  user_id    uuid not null references public.users (id) on delete cascade,
  listing_id uuid not null references public.job_listings (id) on delete cascade,
  decision   text not null check (decision in ('apply', 'skip')),
  created_at timestamptz not null default now(),
  primary key (user_id, listing_id)
);

-- Role-specific resumes for job applications ("Frontend", "Backend"…), besides the main resume in
-- public.resumes (which the interview assistant uses). Each job is tailored from the one whose target
-- roles fit its title best, or from the main resume.
create table public.job_resumes (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.users (id) on delete cascade,
  name         text not null,
  target_roles text[] not null default '{}',
  file_name    text not null,
  mime_type    text not null,
  text         text not null,
  file         bytea not null,
  parsed_json  jsonb,
  status       text not null default 'parsing' check (status in ('parsing', 'ready', 'failed')),
  error        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index job_resumes_user_idx on public.job_resumes (user_id, created_at);

-- A tailored resume comes from the main resume (resume_id) or a role-specific one (job_resume_id).
alter table public.tailored_resumes add column job_resume_id uuid references public.job_resumes (id) on delete set null;
-- The cover letter written for the job, as text and as a PDF to attach.
alter table public.tailored_resumes add column cover_letter text;
alter table public.tailored_resumes add column cover_letter_file bytea;

-- More applicant tracking systems.
alter table public.job_sources drop constraint job_sources_provider_check;
alter table public.job_sources add constraint job_sources_provider_check
  check (provider in ('greenhouse', 'lever', 'ashby', 'workable', 'smartrecruiters', 'workday', 'icims', 'keka', 'freshteam',
                      'zohorecruit', 'himalayas', 'remoteok', 'jobicy', 'adzuna', 'jooble'));

alter table public.job_swipes  enable row level security;
alter table public.job_resumes enable row level security;
