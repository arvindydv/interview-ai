-- Payments through Razorpay (one-time orders, apps/api routes/billing.ts).
--   * Minute packs add to users.trial_seconds, the metered allowance the free plan spends (lib/trial.ts).
--   * Monthly/yearly plans set users.plan until plan_expires_at; after that the user is on 'free' again.

-- Null = the plan doesn't end (the free plan, or one set by an admin).
alter table public.users add column plan_expires_at timestamptz;

/** The plan in effect now: an expired paid plan counts as 'free'. */
create function public.current_plan(plan text, plan_expires_at timestamptz) returns text
language sql stable as $$
  select case when plan_expires_at is not null and plan_expires_at <= now() then 'free' else plan end
$$;

create table public.payments (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references public.users (id) on delete cascade,
  product             text not null,
  amount              int  not null check (amount > 0), -- paise
  currency            text not null default 'INR',
  razorpay_order_id   text not null unique,
  razorpay_payment_id text unique,
  status              text not null default 'created' check (status in ('created', 'paid', 'failed', 'refunded')),
  -- What the payment granted, so a refund takes back exactly that.
  granted_seconds     int  not null default 0 check (granted_seconds >= 0),
  granted_days        int  not null default 0 check (granted_days >= 0),
  created_at          timestamptz not null default now(),
  paid_at             timestamptz,
  refunded_at         timestamptz
);
create index payments_user_created on public.payments (user_id, created_at desc);

alter table public.payments enable row level security;
create policy "payments read own rows" on public.payments for select using (auth.uid() = user_id);
