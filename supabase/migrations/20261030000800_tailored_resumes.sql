-- Friday Jobs: a copy of the candidate's resume rewritten for one job's description, written by the
-- worker (apps/worker/src/queues/tailor.ts). One per user and job; tailoring again replaces it.

create table public.tailored_resumes (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.users (id) on delete cascade,
  listing_id  uuid references public.job_listings (id) on delete set null,
  -- The resume it was tailored from.
  resume_id   uuid references public.resumes (id) on delete set null,
  -- Copied so the record outlives the listing (closed listings are deleted after 30 days).
  title       text not null,
  company     text not null,
  status      text not null default 'tailoring' check (status in ('tailoring', 'ready', 'failed')),
  -- TailoredResume (packages/shared/src/listings.ts).
  content     jsonb,
  error       text,
  model       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (user_id, listing_id)
);
create index tailored_resumes_user_created_idx on public.tailored_resumes (user_id, created_at desc);

-- Only the API and worker (service connection) read these.
alter table public.tailored_resumes enable row level security;
