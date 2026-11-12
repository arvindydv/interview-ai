-- Employer boards with tech jobs open to candidates in India, found by apps/worker/scripts/verify-boards.ts on
-- 2026-11-10: each identifier was either linked from the company's own website, or confirmed by the
-- provider's official API (Greenhouse board name, SmartRecruiters company name, Ashby postings naming the
-- company). Only providers with a public, documented API (no Workday). The number after each is the
-- tech jobs open to India it listed that day, none of them already stored.
insert into public.job_sources (provider, board, company, website, sync_every) values
  ('greenhouse', 'toast', 'Toast', 'toasttab.com', '30 minutes'),               -- 15
  ('greenhouse', 'netskope', 'Netskope', 'netskope.com', '30 minutes'),         -- 14
  ('ashby', 'sophos', 'Sophos', 'sophos.com', '30 minutes'),                    -- 8
  ('greenhouse', 'turing', 'Turing', 'turing.com', '30 minutes'),               -- 6
  ('greenhouse', 'celonis', 'Celonis', 'celonis.com', '30 minutes'),            -- 4
  ('greenhouse', 'commvault', 'Commvault', 'commvault.com', '30 minutes'),      -- 3
  ('smartrecruiters', 'endava', 'Endava', 'endava.com', '6 hours'),             -- 3
  ('greenhouse', 'saucelabs', 'Sauce Labs', 'saucelabs.com', '30 minutes'),     -- 3
  ('greenhouse', 'jfrog', 'JFrog', 'jfrog.com', '30 minutes'),                  -- 2
  ('smartrecruiters', 'grab', 'Grab', 'grab.com', '6 hours'),                   -- 2
  ('smartrecruiters', 'unacademy', 'Unacademy', 'unacademy.com', '6 hours'),    -- 1
  ('smartrecruiters', 'lendingkart', 'Lendingkart', 'lendingkart.com', '6 hours') -- 1
on conflict (provider, board) do nothing;
