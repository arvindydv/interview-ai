-- Referral partners (Instagram influencers and the like). Each partner has a link, /r/<code>, on the
-- website; people who sign up after following it are attributed to the partner, who earns a share of
-- everything those people pay (apps/api lib/partners.ts). Partners see their own numbers on the
-- website's /partner page; the admin console creates partners and records payouts.

create table public.partners (
  id              uuid primary key default gen_random_uuid(),
  -- The partner's own account, which they sign in with to see their dashboard.
  user_id         uuid not null unique references public.users (id) on delete cascade,
  code            text not null unique check (code ~ '^[a-z0-9][a-z0-9_-]{2,31}$'),
  name            text not null,
  instagram       text not null default '',
  -- Share of each payment, in basis points (2000 = 20%). Copied onto every payment it applies to, so
  -- changing it only affects payments made afterwards.
  commission_bps  int  not null check (commission_bps between 1 and 10000),
  -- An inactive partner's link stops attributing sign-ups and their referrals stop earning.
  active          boolean not null default true,
  created_at      timestamptz not null default now()
);

-- Who brought the user in. Set once, at sign-up, and never changed.
alter table public.users
  add column referred_by uuid references public.partners (id) on delete set null,
  add column referred_at timestamptz;
create index users_referred_by on public.users (referred_by, referred_at desc) where referred_by is not null;

-- The commission a paid payment earned its user's partner. A refunded payment keeps these but no
-- longer counts: earnings are summed over status = 'paid' only.
alter table public.payments
  add column referral_partner_id uuid references public.partners (id) on delete set null,
  add column referral_commission int  not null default 0 check (referral_commission >= 0); -- paise
create index payments_referral on public.payments (referral_partner_id, paid_at desc) where referral_partner_id is not null;

-- Link visits per partner per UTC day (de-duplicated per visitor IP, see lib/partners.ts).
create table public.partner_clicks (
  partner_id uuid not null references public.partners (id) on delete cascade,
  day        date not null,
  clicks     int  not null default 0,
  primary key (partner_id, day)
);

-- Money sent to a partner, recorded by an admin. Earned minus paid out is what is still owed.
create table public.partner_payouts (
  id          uuid primary key default gen_random_uuid(),
  partner_id  uuid not null references public.partners (id) on delete cascade,
  amount      int  not null check (amount > 0), -- paise
  -- UPI / bank transfer reference, shown to the partner.
  reference   text not null default '',
  note        text not null default '',
  paid_at     timestamptz not null default now(),
  created_by  text not null
);
create index partner_payouts_partner on public.partner_payouts (partner_id, paid_at desc);

-- Only the API's own Postgres role reads these; nothing is exposed through PostgREST.
alter table public.partners        enable row level security;
alter table public.partner_clicks  enable row level security;
alter table public.partner_payouts enable row level security;
