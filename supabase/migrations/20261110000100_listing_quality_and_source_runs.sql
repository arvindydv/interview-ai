-- Friday Jobs: what each listing is (tech category, eligibility for candidates in India, canonical apply
-- URL for cross-source duplicates, the source's own expiry date) and a log of every source sync, so
-- source health and genuinely new jobs per day are measured rather than estimated.
-- Classification rules: packages/shared/src/listingQuality.ts (set by the worker at ingestion).

alter table public.job_sources drop constraint job_sources_provider_check;
alter table public.job_sources add constraint job_sources_provider_check
  check (provider in ('greenhouse', 'lever', 'ashby', 'workable', 'smartrecruiters', 'teamtailor', 'workday', 'icims', 'keka',
                      'freshteam', 'zohorecruit', 'himalayas', 'remoteok', 'jobicy', 'adzuna', 'jooble', 'jsearch'));

-- techCategory(): 'software', 'backend', 'ml_ai'…; null for non-tech roles.
alter table public.job_listings add column tech_category text;
-- eligibility(): 'india', 'remote_india', 'remote_global', 'remote_apac', 'remote_unspecified', 'remote_other', 'elsewhere', 'unknown'.
alter table public.job_listings add column eligibility text;
-- canonicalUrl() of apply_url: the same posting reached through two sources compares equal.
alter table public.job_listings add column canonical_url text;
-- When the source says the posting expires (Himalayas); an expired listing is closed.
alter table public.job_listings add column expires_at timestamptz;

create index job_listings_canonical_idx on public.job_listings (canonical_url) where closed_at is null;
create index job_listings_first_seen_idx on public.job_listings (first_seen_at desc);

-- One row per sync of a source: what was fetched and what changed.
create table public.job_source_runs (
  id              bigint generated always as identity primary key,
  source_id       uuid not null references public.job_sources (id) on delete cascade,
  started_at      timestamptz not null default now(),
  finished_at     timestamptz,
  ok              boolean,
  error           text,
  -- The source's first successful sync: its jobs are a backfill, not new jobs.
  initial         boolean not null default false,
  http_requests   int not null default 0,
  fetched         int not null default 0,
  -- Fetched postings stored (after dropping ones without a title or link, and aggregator copies of directly synced companies).
  kept            int not null default 0,
  inserted        int not null default 0,
  -- Inserted and not a duplicate of a listing from another source, after duplicate marking.
  inserted_unique int not null default 0,
  inserted_tech   int not null default 0,
  -- Inserted, unique, tech, and open to candidates in India (INDIA_ELIGIBLE).
  inserted_tech_india int not null default 0,
  closed          int not null default 0,
  duplicates      int not null default 0
);
create index job_source_runs_source_idx on public.job_source_runs (source_id, started_at desc);
create index job_source_runs_started_idx on public.job_source_runs (started_at desc);
alter table public.job_source_runs enable row level security;

-- Adzuna stays off until its commercial licence is confirmed (the worker also needs ADZUNA_SYNC_ENABLED).
update public.job_sources set enabled = false where provider = 'adzuna';
