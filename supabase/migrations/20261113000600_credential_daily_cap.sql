-- Employer credentials: how many applications a day Friday may send to that employer through its API
-- (agreed with the employer; queues/submit.ts enforces it at the moment of sending, counting sends in
-- flight and unconfirmed ones too, per India calendar day). Additive.
alter table public.ats_credentials add column daily_cap smallint not null default 10 check (daily_cap between 1 and 1000);
