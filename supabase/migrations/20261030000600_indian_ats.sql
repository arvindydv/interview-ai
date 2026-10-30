-- Careers platforms common among Indian companies: Keka, Freshteam and Zoho Recruit. Their boards are
-- found by discovery like the others (apps/worker/src/queues/discovery.ts). Darwinbox is left out: its
-- careers API sits behind bot protection that turns away anything but a real browser.
alter table public.job_sources drop constraint job_sources_provider_check;
alter table public.job_sources add constraint job_sources_provider_check
  check (provider in ('greenhouse', 'lever', 'ashby', 'workable', 'keka', 'freshteam', 'zohorecruit', 'himalayas', 'remoteok', 'jobicy'));
