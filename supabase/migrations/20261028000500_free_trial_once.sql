-- One free trial per person, not per email address. Throwaway accounts were each getting 10 minutes.
--
-- New accounts start without trial minutes. The trial is granted (API lib/freeTrial.ts) the first
-- time the desktop app signs in on a computer that hasn't had one, from an email that isn't a
-- temporary inbox or an alias of an address that already had one, and not too many times from one
-- network. Accounts created before this keep the minutes they have.

-- Same mailbox, same trial: lowercased, "+tag" dropped, and for Gmail the dots too
-- ("A.B+x@googlemail.com" → "ab@gmail.com").
create function public.canonical_email(email text) returns text
language sql immutable parallel safe as $$
  select case
    when e.domain in ('gmail.com', 'googlemail.com') then replace(split_part(e.local, '+', 1), '.', '') || '@gmail.com'
    else split_part(e.local, '+', 1) || '@' || e.domain
  end
  from (select split_part(lower(trim(email)), '@', 1) as local, split_part(lower(trim(email)), '@', 2) as domain) e
$$;

alter table public.users add column email_canonical text generated always as (public.canonical_email(email)) stored;
create index users_email_canonical_idx on public.users (email_canonical);

-- pending: no trial yet (install the desktop app); granted; or why it was refused. Refusals are
-- looked at again when the app signs in on another computer.
alter table public.users add column trial_status text not null default 'pending'
  check (trial_status in ('pending', 'granted', 'device_used', 'email_used', 'disposable_email', 'network_limit', 'no_device_id'));
alter table public.users add column trial_granted_at timestamptz;
update public.users set trial_status = 'granted', trial_granted_at = created_at;
alter table public.users alter column trial_seconds set default 0;

-- Which computers and mailboxes have had a trial. Kept when the account is deleted, so deleting and
-- signing up again doesn't bring the minutes back. `machine_hash` is the API's hash of the app's own
-- hash of the OS machine id; the raw id never leaves the computer. `ip_hash` likewise.
create table public.trial_claims (
  machine_hash    text primary key,
  user_id         uuid references public.users (id) on delete set null,
  email_canonical text not null,
  ip_hash         text,
  created_at      timestamptz not null default now()
);
create index trial_claims_email_idx on public.trial_claims (email_canonical);
create index trial_claims_ip_idx on public.trial_claims (ip_hash, created_at desc);
alter table public.trial_claims enable row level security;

-- Which computer each install runs on, so the admin console can show accounts sharing one.
alter table public.devices add column machine_hash text;
create index devices_machine_idx on public.devices (machine_hash) where machine_hash is not null;
