-- Meta Conversions API (apps/api lib/metaCapi.ts): a paid order is reported to Meta as a Purchase,
-- only if the buyer allowed marketing cookies when they opened checkout. What the event needs to be
-- matched to the ad click is kept here until it is sent, then cleared.

alter table public.payments
  add column meta_consent    boolean not null default false,
  add column meta_fbp        text,
  add column meta_fbc        text,
  add column meta_client_ip  text,
  add column meta_user_agent text,
  -- Null until reported; 'sending' while the request is in flight (claimed by exactly one reporter);
  -- 'sent' once Meta accepted it.
  add column meta_purchase   text check (meta_purchase in ('sending', 'sent'));
