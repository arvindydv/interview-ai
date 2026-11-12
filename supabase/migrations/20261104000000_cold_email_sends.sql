-- Friday Jobs cold email to several people at a company: each recipient gets their own email (greeted by
-- name), recorded here. A recipient can never get the same job's email twice, and the 20-a-day limit
-- counts these sends. cold_emails.sent_at / to_email keep the first send, for lists.

create table public.cold_email_sends (
  id               uuid primary key default gen_random_uuid(),
  cold_email_id    uuid not null references public.cold_emails (id) on delete cascade,
  user_id          uuid not null references public.users (id) on delete cascade,
  to_email         text not null,
  to_name          text,
  -- sending: claimed (a send that started and got no answer stays here, so it isn't sent twice right away)
  status           text not null default 'sending' check (status in ('sending', 'sent', 'failed')),
  error            text,
  sending_at       timestamptz not null default now(),
  sent_at          timestamptz,
  gmail_message_id text,
  gmail_thread_id  text,
  unique (cold_email_id, to_email)
);
create index cold_email_sends_user_sent_idx on public.cold_email_sends (user_id, sent_at desc) where sent_at is not null;
create index cold_email_sends_user_sending_idx on public.cold_email_sends (user_id, sending_at desc) where status = 'sending';

-- Emails sent before this table existed.
insert into public.cold_email_sends (cold_email_id, user_id, to_email, to_name, status, sending_at, sent_at, gmail_message_id, gmail_thread_id)
select id, user_id, to_email, to_name, 'sent', sent_at, sent_at, gmail_message_id, gmail_thread_id
from public.cold_emails where sent_at is not null and to_email is not null;

-- Sends are claimed per recipient now.
alter table public.cold_emails drop column sending_at;

-- Only the API and worker (service connection) read these.
alter table public.cold_email_sends enable row level security;
