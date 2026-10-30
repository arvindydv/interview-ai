-- Remote-job boards as sources (Himalayas, Remote OK, Jobicy): one source carries many companies'
-- postings, so the company and logo come from each posting. Their terms ask for a visible credit and
-- a link to their page on every job, which the jobs site shows as "via <board>".

alter table public.job_sources drop constraint job_sources_provider_check;
alter table public.job_sources add constraint job_sources_provider_check
  check (provider in ('greenhouse', 'lever', 'ashby', 'workable', 'himalayas', 'remoteok', 'jobicy'));

-- How often the source is fetched. Company boards: every sync round. Remote boards are larger and ask
-- to be polled gently.
alter table public.job_sources add column sync_every interval not null default '30 minutes';

alter table public.job_listings add column company_logo text;

insert into public.job_sources (provider, board, company, website, origin, sync_every) values
  -- Remote jobs open to people in India, plus worldwide ones.
  ('himalayas', 'india', 'Himalayas', 'himalayas.app', 'remote', '3 hours'),
  ('remoteok', 'all', 'Remote OK', 'remoteok.com', 'remote', '6 hours'),
  ('jobicy', 'all', 'Jobicy', 'jobicy.com', 'remote', '6 hours');
