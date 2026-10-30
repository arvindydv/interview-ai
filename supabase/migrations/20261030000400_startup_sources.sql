-- Startup job boards, found automatically (apps/worker/src/queues/discovery.ts): companies from startup
-- lists (Y Combinator's directory, a curated list of Indian startups) are probed on the job-board
-- providers, and each board found becomes a job source.

alter table public.job_sources drop constraint job_sources_provider_check;
alter table public.job_sources add constraint job_sources_provider_check
  check (provider in ('greenhouse', 'lever', 'ashby', 'workable'));

-- 'curated' (added by hand), 'yc' or 'india' (found by discovery).
alter table public.job_sources add column origin text not null default 'curated';
alter table public.job_sources add column startup boolean not null default false;
-- e.g. "Summer 2021", for the YC badge.
alter table public.job_sources add column yc_batch text;

-- Companies to look for. `key` is "<origin>:<id in that list>"; a company is probed again a month
-- after it was last checked, since startups open careers pages as they grow.
create table public.job_source_candidates (
  key        text primary key,
  origin     text not null,
  name       text not null,
  website    text,
  -- Board slugs worth trying, most likely first.
  slugs      text[] not null,
  yc_batch   text,
  checked_at timestamptz,
  source_id  uuid references public.job_sources (id) on delete set null,
  created_at timestamptz not null default now()
);
create index job_source_candidates_due_idx on public.job_source_candidates (checked_at nulls first);

alter table public.job_source_candidates enable row level security;

-- Curated boards that are startups.
update public.job_sources set startup = true
where board in ('groww', 'meesho', 'zeta', 'cred', 'linear', 'supabase', 'ramp', 'posthog', 'sarvam', 'elevenlabs', 'perplexity', 'cohere');
