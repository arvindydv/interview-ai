-- Friday Jobs platform bot: evidence for every application, Assisted Apply, and sites that refuse the bot.
--
-- * A site that refuses the background browser outright (Naukri's CDN answers 403) is recorded as
--   access_restricted and not tried again automatically before retry_after.
-- * Every applied row says how we know: 'verified' (the site's own confirmation was seen after submitting)
--   or 'user_reported' (the candidate applied themselves and said so). Clicking a button proves nothing.
-- * Assisted Apply: a job the candidate found (e.g. on Naukri), with its description pasted in; Friday
--   tailors the resume for it, the candidate submits on the site, then confirms.

alter table public.job_bot_sessions drop constraint job_bot_sessions_status_check;
alter table public.job_bot_sessions add constraint job_bot_sessions_status_check
  check (status in ('connected', 'disconnected', 'needs_verification', 'connecting', 'access_restricted'));
alter table public.job_bot_sessions add column retry_after timestamptz;

alter table public.job_bot_applications drop constraint job_bot_applications_outcome_check;
alter table public.job_bot_applications add constraint job_bot_applications_outcome_check
  check (outcome in ('applied', 'skipped', 'needs_answer', 'failed', 'already_applied', 'external', 'assisted'));
alter table public.job_bot_applications add column evidence text check (evidence in ('verified', 'user_reported'));
alter table public.job_bot_applications add column tailored_resume_id uuid references public.tailored_resumes (id) on delete set null;
alter table public.job_bot_applications add constraint job_bot_applied_has_evidence check (outcome <> 'applied' or evidence is not null) not valid;
update public.job_bot_applications set evidence = 'verified' where outcome = 'applied' and evidence is null;
alter table public.job_bot_applications validate constraint job_bot_applied_has_evidence;

-- Tailoring for a job that isn't a stored listing: its description, as the candidate pasted it.
alter table public.tailored_resumes add column description text;
