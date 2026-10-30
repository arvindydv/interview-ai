-- More jobs, especially in India: job search engines (Adzuna, Jooble) as sources, one copy of each
-- job across every platform it's on, and recruitment agencies told apart from employers.

alter table public.job_sources drop constraint job_sources_provider_check;
alter table public.job_sources add constraint job_sources_provider_check
  check (provider in ('greenhouse', 'lever', 'ashby', 'workable', 'keka', 'freshteam', 'zohorecruit',
                      'himalayas', 'remoteok', 'jobicy', 'adzuna', 'jooble'));

-- Which copy of a job is shown when several sources carry it: lowest first. Companies' own boards
-- (full description, apply on the employer's site), then remote-job boards (full description), then
-- search engines (an excerpt).
alter table public.job_sources add column rank smallint not null default 0;
update public.job_sources set rank = 1 where provider in ('himalayas', 'remoteok', 'jobicy');

-- Where an aggregator says the job was first posted, e.g. "naukri.com".
alter table public.job_listings add column posted_on text;
-- Posted by a recruitment agency or staffing firm (isAgency in packages/shared/src/listings.ts).
alter table public.job_listings add column agency boolean not null default false;
-- Company, title and city, normalised (dedupeKey in packages/shared/src/listings.ts).
alter table public.job_listings add column dedupe_key text;
-- Set when another open listing with the same key is the copy shown; recomputed after every sync.
alter table public.job_listings add column duplicate_of uuid references public.job_listings (id) on delete set null;

create index job_listings_dedupe_idx on public.job_listings (dedupe_key) where closed_at is null;

-- Synced only when their keys are set in the worker's environment (ADZUNA_APP_ID / ADZUNA_APP_KEY,
-- JOOBLE_API_KEY). The board is the country searched.
insert into public.job_sources (provider, board, company, website, origin, sync_every, rank) values
  ('adzuna', 'in', 'Adzuna', 'adzuna.in', 'search', '6 hours', 2),
  ('jooble', 'in', 'Jooble', 'jooble.org', 'search', '6 hours', 2);
