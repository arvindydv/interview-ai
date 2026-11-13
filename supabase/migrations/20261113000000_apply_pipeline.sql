-- Friday Jobs application pipeline (packages/shared/src/applyPipeline.ts):
--   matching with eligibility and explanations, a submission channel per application chosen by what the
--   provider actually authorizes, employer/partner ATS credentials for authorized API submission,
--   audit logs and a daily discovery/capacity report. Additive only: no existing data is changed except
--   backfilling channel on rows that were already sent.

-- ---- Matching -------------------------------------------------------------------------------------

-- MatchConfig: thresholds and weights, per user. {} means DEFAULT_MATCH_CONFIG.
alter table public.job_preferences add column match_config jsonb not null default '{}';

-- A job failing a mandatory requirement (work authorization, experience far above the candidate's,
-- an employment type they excluded…) is kept for the explanation but never auto-applied to.
alter table public.job_matches add column eligible boolean not null default true;
-- MatchExplanation: components, matched/missing mandatory and preferred skills, reasons.
alter table public.job_matches add column explanation jsonb;
create index job_matches_user_eligible_idx on public.job_matches (user_id, score desc) where eligible;

-- JobRequirements parsed from each description, cached per listing (deterministic extractor, versioned
-- so a better extractor re-parses).
create table public.job_requirements (
  listing_id   uuid primary key references public.job_listings (id) on delete cascade,
  version      smallint not null,
  data         jsonb not null,
  extracted_at timestamptz not null default now()
);

-- ---- Submission channels --------------------------------------------------------------------------

-- How each application is (or will be) sent, chosen from the provider's capability (resolveChannel):
--   api        the employer's ATS API, with a credential the employer or a partner granted us
--   cloud_form the employer's public form, filled by Friday's servers (only providers an operator enabled)
--   extension  the employer's public form, filled in the candidate's own browser
--   assisted   the candidate submits; Friday prepares the resume and answers
alter table public.auto_applications
  add column channel text check (channel in ('api', 'cloud_form', 'extension', 'assisted')),
  -- Sent with API submissions so a retry after a timeout can't create a second application.
  add column idempotency_key uuid not null default gen_random_uuid(),
  -- The ATS's own id for the application (API submissions).
  add column external_application_id text,
  -- Last submission failure, redacted: { code, httpStatus, message, retryable, at }.
  add column failure jsonb,
  add column cancelled_at timestamptz;

alter table public.auto_applications drop constraint auto_applications_submitted_via_check;
alter table public.auto_applications add constraint auto_applications_submitted_via_check
  check (submitted_via in ('api', 'cloud', 'browser', 'user'));

-- Rows already sent keep the channel they actually used.
update public.auto_applications set channel = case submitted_via when 'cloud' then 'cloud_form' else 'extension' end
where channel is null and submitted_via in ('cloud', 'browser');

-- Submitted always says who sent it; "You confirmed" vs "Verified" is read from it.
alter table public.auto_applications add constraint auto_applications_submitted_has_via
  check (status <> 'submitted' or submitted_via is not null) not valid;
alter table public.auto_applications validate constraint auto_applications_submitted_has_via;

create index auto_applications_api_idx on public.auto_applications (created_at)
  where status = 'prepared' and channel = 'api';

-- Employer or partner credentials for an ATS's application API. Never a candidate's password: these
-- are API keys an employer (or an ATS partnership) issued to Friday, with written permission recorded
-- in agreement_ref. Secrets are AES-256-GCM encrypted with ATS_CREDENTIALS_KEY (worker only).
create table public.ats_credentials (
  id            uuid primary key default gen_random_uuid(),
  provider      text not null check (provider in ('greenhouse', 'lever', 'ashby', 'smartrecruiters', 'workable', 'teamtailor')),
  -- The employer's board/site token as it appears in job_sources.board.
  board         text not null,
  secret_enc    bytea not null,
  granted_by    text not null,
  agreement_ref text not null,
  verified_at   timestamptz,
  last_error    text,
  revoked_at    timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (provider, board)
);

-- ---- Security and reporting -----------------------------------------------------------------------

-- Who did what to whose data. detail is redacted (redactSensitive) before it is written.
create table public.audit_logs (
  id          bigint generated always as identity primary key,
  user_id     uuid references public.users (id) on delete set null,
  actor       text not null check (actor in ('user', 'admin', 'worker', 'applier', 'system')),
  action      text not null,
  target_type text,
  target_id   text,
  detail      jsonb,
  ip          inet,
  created_at  timestamptz not null default now()
);
create index audit_logs_user_idx on public.audit_logs (user_id, created_at desc);
create index audit_logs_action_idx on public.audit_logs (action, created_at desc);

-- One row per day: discovery, eligibility and application-capacity numbers (DailyJobsReport).
create table public.jobs_daily_reports (
  day        date primary key,
  data       jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.job_requirements   enable row level security;
alter table public.ats_credentials    enable row level security;
alter table public.audit_logs         enable row level security;
alter table public.jobs_daily_reports enable row level security;
