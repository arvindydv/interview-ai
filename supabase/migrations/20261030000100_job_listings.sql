-- Friday Jobs: listings aggregated from companies' public job boards (Greenhouse, Lever, Ashby).
-- The worker syncs every enabled source on a schedule (apps/worker/src/queues/listings.ts); the API
-- serves them publicly to the jobs site.

create table public.job_sources (
  id             uuid primary key default gen_random_uuid(),
  provider       text not null check (provider in ('greenhouse', 'lever', 'ashby')),
  -- The company's board token / slug in the provider's URLs, e.g. "stripe" in boards.greenhouse.io/stripe.
  board          text not null,
  company        text not null,
  enabled        boolean not null default true,
  last_synced_at timestamptz,
  last_error     text,
  created_at     timestamptz not null default now(),
  unique (provider, board)
);

create table public.job_listings (
  id               uuid primary key default gen_random_uuid(),
  source_id        uuid not null references public.job_sources (id) on delete cascade,
  -- The provider's id for the posting; stable across syncs.
  external_id      text not null,
  title            text not null,
  company          text not null,
  department       text,
  location         text not null default '',
  workplace        text check (workplace in ('remote', 'hybrid', 'onsite')),
  employment_type  text,
  salary           text,
  -- Sanitised at ingestion to a small allowlist of formatting tags (no attributes but links).
  description_html text not null default '',
  description_text text not null default '',
  apply_url        text not null,
  posted_at        timestamptz,
  first_seen_at    timestamptz not null default now(),
  last_seen_at     timestamptz not null default now(),
  -- Set when a sync no longer finds the posting on the company's board.
  closed_at        timestamptz,
  search tsvector generated always as (
    setweight(to_tsvector('english', title), 'A') ||
    setweight(to_tsvector('english', company || ' ' || coalesce(department, '')), 'B') ||
    setweight(to_tsvector('english', location), 'B') ||
    setweight(to_tsvector('english', left(description_text, 20000)), 'C')
  ) stored,
  unique (source_id, external_id)
);

create index job_listings_search_idx on public.job_listings using gin (search);
create index job_listings_open_idx on public.job_listings (posted_at desc nulls last) where closed_at is null;

-- Only the API and worker (service connection) read these.
alter table public.job_sources  enable row level security;
alter table public.job_listings enable row level security;

-- Starting set of boards, each checked to be live. Add more with a row here; the next sync picks them up.
insert into public.job_sources (provider, board, company) values
  ('greenhouse', 'stripe', 'Stripe'),
  ('greenhouse', 'airbnb', 'Airbnb'),
  ('greenhouse', 'databricks', 'Databricks'),
  ('greenhouse', 'figma', 'Figma'),
  ('greenhouse', 'discord', 'Discord'),
  ('greenhouse', 'coinbase', 'Coinbase'),
  ('greenhouse', 'gitlab', 'GitLab'),
  ('greenhouse', 'cloudflare', 'Cloudflare'),
  ('greenhouse', 'robinhood', 'Robinhood'),
  ('greenhouse', 'dropbox', 'Dropbox'),
  ('greenhouse', 'groww', 'Groww'),
  ('lever', 'palantir', 'Palantir'),
  ('lever', 'spotify', 'Spotify'),
  ('lever', 'meesho', 'Meesho'),
  ('lever', 'zeta', 'Zeta'),
  ('lever', 'cred', 'CRED'),
  ('ashby', 'openai', 'OpenAI'),
  ('ashby', 'notion', 'Notion'),
  ('ashby', 'ramp', 'Ramp'),
  ('ashby', 'linear', 'Linear'),
  ('ashby', 'supabase', 'Supabase');
