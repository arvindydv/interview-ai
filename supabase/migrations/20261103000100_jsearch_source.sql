-- Friday Jobs: JSearch (RapidAPI), Google for Jobs results, which include postings from LinkedIn,
-- Naukri and Indeed. Searched once a day for the roles users want, and only when the worker has
-- JSEARCH_API_KEY (apps/worker/src/listings/search.ts). The board is the country searched.
alter table public.job_sources drop constraint job_sources_provider_check;
alter table public.job_sources add constraint job_sources_provider_check
  check (provider in ('greenhouse', 'lever', 'ashby', 'workable', 'smartrecruiters', 'workday', 'icims', 'keka', 'freshteam',
                      'zohorecruit', 'himalayas', 'remoteok', 'jobicy', 'adzuna', 'jooble', 'jsearch'));

insert into public.job_sources (provider, board, company, website, origin, sync_every, rank) values
  ('jsearch', 'in', 'JSearch', 'openwebninja.com', 'search', '1 day', 2);

-- Jooble's free key allows 500 requests in its lifetime, so it's searched once a day (4 searches,
-- JOOBLE_CALLS_PER_SYNC) instead of every six hours.
update public.job_sources set sync_every = '1 day' where provider = 'jooble';
