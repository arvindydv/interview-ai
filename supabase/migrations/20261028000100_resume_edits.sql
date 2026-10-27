-- Resume page: candidates can correct the structured profile. Re-analysing the resume replaces
-- their edits, so the website warns first.
alter table public.resumes add column profile_edited_at timestamptz;
