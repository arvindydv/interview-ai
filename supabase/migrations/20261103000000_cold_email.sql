-- Friday Jobs cold email: an email about one job to the company's recruiter or hiring manager, written by
-- the worker (apps/worker/src/queues/coldEmail.ts) and sent from the candidate's own Gmail by the API
-- (apps/api/src/routes/coldEmail.ts), with their resume tailored to the job attached.

-- The candidate's Gmail, connected with the gmail.send scope only (Friday can send, never read).
create table public.gmail_accounts (
  user_id       uuid primary key references public.users (id) on delete cascade,
  email         text not null,
  -- AES-256-GCM with GMAIL_TOKEN_KEY (apps/api/src/lib/gmail.ts): iv (12) || tag (16) || ciphertext.
  refresh_token bytea not null,
  scope         text not null,
  connected_at  timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Email finder (Hunter.io) results per company, so each company costs one lookup a month, not one per
-- candidate. key is the domain, or "name:<company>" when the listing has no website.
create table public.contact_lookups (
  key          text primary key,
  -- ColdEmailContact[] (packages/shared/src/coldEmail.ts)
  contacts     jsonb not null default '[]',
  looked_up_at timestamptz not null default now()
);

create table public.cold_emails (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.users (id) on delete cascade,
  listing_id      uuid references public.job_listings (id) on delete set null,
  -- Copied so the record outlives the listing.
  title           text not null,
  company         text not null,
  status          text not null default 'drafting' check (status in ('drafting', 'ready', 'sent', 'failed')),
  contacts        jsonb not null default '[]',
  to_email        text,
  to_name         text,
  subject         text not null default '',
  body            text not null default '',
  match_score     smallint,
  tailored_id     uuid references public.tailored_resumes (id) on delete set null,
  error           text,
  model           text,
  -- When the send started: a second send for the same email is refused from then on.
  sending_at      timestamptz,
  sent_at         timestamptz,
  gmail_message_id text,
  gmail_thread_id text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (user_id, listing_id)
);
create index cold_emails_user_created_idx on public.cold_emails (user_id, created_at desc);
create index cold_emails_user_sent_idx on public.cold_emails (user_id, sent_at desc) where sent_at is not null;

-- Only the API and worker (service connection) read these.
alter table public.gmail_accounts enable row level security;
alter table public.contact_lookups enable row level security;
alter table public.cold_emails enable row level security;
