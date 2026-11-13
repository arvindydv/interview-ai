-- More employer boards with tech jobs open to candidates in India, found by apps/worker/scripts/verify-boards.ts
-- (with --probe) on 2026-11-12 from 306 candidate companies: each identifier was either linked from the
-- company's own website, or confirmed by the provider's official public API (Greenhouse board name,
-- SmartRecruiters company name, Ashby/Lever postings naming the company). Public discovery endpoints only
-- (GET); nothing was submitted. Workday and Workable boards found in the same run are not added (Workday's
-- site terms; Workable is outside this batch). The number after each is the tech jobs open to India it
-- listed that day, none of them already stored.
insert into public.job_sources (provider, board, company, website, sync_every) values
  ('greenhouse', 'canonical', 'Canonical', 'canonical.com', '30 minutes'),             -- 53
  ('ashby', 'tekion', 'Tekion', 'tekion.com', '30 minutes'),                          -- 36
  ('greenhouse', 'highradius', 'HighRadius', 'highradius.com', '30 minutes'),         -- 18
  ('smartrecruiters', 'aristanetworks', 'Arista Networks', 'arista.com', '6 hours'),  -- 17
  ('lever', 'coupa', 'Coupa', 'coupa.com', '30 minutes'),                             -- 15
  ('greenhouse', 'bitwarden', 'Bitwarden', 'bitwarden.com', '30 minutes'),            -- 15
  ('greenhouse', 'fivetran', 'Fivetran', 'fivetran.com', '30 minutes'),               -- 14
  ('greenhouse', 'smartsheet', 'Smartsheet', 'smartsheet.com', '30 minutes'),         -- 12
  ('ashby', 'plane', 'Plane', 'plane.so', '30 minutes'),                              -- 7
  ('greenhouse', 'zinier', 'Zinier', 'zinier.com', '30 minutes'),                     -- 7
  ('ashby', 'kong', 'Kong', 'konghq.com', '30 minutes'),                              -- 6
  ('greenhouse', 'sumologic', 'Sumo Logic', 'sumologic.com', '30 minutes'),           -- 5
  ('ashby', 'gainsight', 'Gainsight', 'gainsight.com', '30 minutes'),                 -- 5
  ('ashby', 'anyscale', 'Anyscale', 'anyscale.com', '30 minutes'),                    -- 5
  ('greenhouse', 'starburst', 'Starburst', 'starburst.io', '30 minutes'),             -- 5
  ('greenhouse', 'singlestore', 'SingleStore', 'singlestore.com', '30 minutes'),      -- 5
  ('greenhouse', 'zuora', 'Zuora', 'zuora.com', '30 minutes'),                        -- 4
  ('ashby', 'railway', 'Railway', 'railway.com', '30 minutes'),                       -- 4
  ('ashby', 'clickhouse', 'ClickHouse', 'clickhouse.com', '30 minutes'),              -- 4
  ('greenhouse', 'startree', 'StarTree', 'startree.ai', '30 minutes'),                -- 3
  ('greenhouse', 'yugabyte', 'Yugabyte', 'yugabyte.com', '30 minutes'),               -- 2
  ('greenhouse', 'togetherai', 'Together AI', 'together.ai', '30 minutes'),           -- 2
  ('greenhouse', 'cockroachlabs', 'Cockroach Labs', 'cockroachlabs.com', '30 minutes'), -- 1
  ('greenhouse', 'samsara', 'Samsara', 'samsara.com', '30 minutes'),                  -- 1
  ('ashby', 'temporal', 'Temporal', 'temporal.io', '30 minutes')                      -- 1
on conflict (provider, board) do nothing;
