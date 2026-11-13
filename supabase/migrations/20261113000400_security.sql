-- Indexes for the daily retention job (apps/worker/src/queues/retention.ts), so each policy finds its
-- rows without scanning whole tables. Additive only.

create index if not exists auto_apply_events_retention_idx on public.auto_apply_events (created_at) where detail is not null;
create index if not exists audit_logs_created_idx on public.audit_logs (created_at);
create index if not exists job_listings_closed_idx on public.job_listings (closed_at) where closed_at is not null;
create index if not exists auto_applications_tailored_idx on public.auto_applications (tailored_resume_id) where tailored_resume_id is not null;
create index if not exists job_bot_applications_tailored_idx on public.job_bot_applications (tailored_resume_id) where tailored_resume_id is not null;
