-- SmartRecruiters (board = company identifier) and Workday (board = "<tenant>.<wdN>/<site>") boards, each
-- checked to be live. Add more with a row here. Each sync reads a page per job, so these sync every 6 hours.
insert into public.job_sources (provider, board, company, website, sync_every) values
  ('smartrecruiters', 'ServiceNow', 'ServiceNow', 'servicenow.com', '6 hours'),
  ('smartrecruiters', 'Ubisoft2', 'Ubisoft', 'ubisoft.com', '6 hours'),
  ('smartrecruiters', 'Equinox', 'Equinox', 'equinox.com', '6 hours'),
  ('workday', 'salesforce.wd12/External_Career_Site', 'Salesforce', 'salesforce.com', '6 hours'),
  ('workday', 'nvidia.wd5/NVIDIAExternalCareerSite', 'NVIDIA', 'nvidia.com', '6 hours'),
  ('workday', 'adobe.wd5/external_experienced', 'Adobe', 'adobe.com', '6 hours')
on conflict (provider, board) do nothing;
