-- Seniority a listing's title asks for, for the experience filter and for matching (see LEVELS in
-- packages/shared/src/listings.ts): 0 internship, 1 entry, 2 mid, 3 senior, 4 lead / staff / manager,
-- 5 director and above. Read from the title, so every provider gets one.
alter table public.job_listings add column level smallint generated always as (
  case
    when title ~* '\m(intern|internship|trainee|apprentice)\M' then 0
    when title ~* '\m(director|vp|chief)\M|\mhead of\M|\mvice president\M' then 5
    when title ~* '\m(staff|principal|lead|architect|manager)\M' then 4
    when title ~* '\m(senior|sr)\M' then 3
    when title ~* '\m(junior|jr|entry|fresher|graduate)\M|\mnew grad\M' then 1
    else 2
  end
) stored;

create index job_listings_open_level_idx on public.job_listings (level) where closed_at is null;
