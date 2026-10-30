-- Friday Jobs tailors the candidate's own resume file, keeping its design, so the upload is kept
-- (resumes are at most 5 MB). Resumes uploaded before this have no file and must be uploaded again.
alter table public.resumes add column file bytea;

-- The tailored copy of that file, in the same format (PDF or DOCX).
alter table public.tailored_resumes add column file bytea;
alter table public.tailored_resumes add column file_name text;
