-- Friday Jobs for signed-in users: listings matched to each user's resume and preferences, plus the
-- jobs they save and apply to. Matches are computed by the worker (apps/worker/src/queues/matches.ts).

-- Company website, for the logo shown next to each listing.
alter table public.job_sources add column website text;

-- What the user is looking for. Created on their first visit to the jobs site; only users with a row
-- get their matches refreshed after every sync.
create table public.job_preferences (
  user_id    uuid primary key references public.users (id) on delete cascade,
  -- Target job titles. Empty: taken from the resume's recent titles.
  roles      text[] not null default '{}',
  -- Cities or countries. Empty: anywhere.
  locations  text[] not null default '{}',
  -- Subset of remote / hybrid / onsite. Empty: any.
  workplaces text[] not null default '{}',
  -- When matches were last computed.
  matched_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.job_matches (
  user_id        uuid not null references public.users (id) on delete cascade,
  listing_id     uuid not null references public.job_listings (id) on delete cascade,
  -- 0–100 overall, and its parts (0–100 each): title fit, skills found in the posting, seniority fit.
  score          smallint not null check (score between 0 and 100),
  title_score    smallint not null,
  skill_score    smallint not null,
  level_score    smallint not null,
  matched_skills text[] not null default '{}',
  computed_at    timestamptz not null default now(),
  primary key (user_id, listing_id)
);
create index job_matches_user_score_idx on public.job_matches (user_id, score desc);

-- Jobs a user saved or applied to. Title and company are copied so the record outlives the listing
-- (closed listings are deleted after 30 days).
create table public.job_applications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.users (id) on delete cascade,
  listing_id  uuid references public.job_listings (id) on delete set null,
  title       text not null,
  company     text not null,
  location    text not null default '',
  apply_url   text not null,
  status      text not null check (status in ('saved', 'applied', 'interviewing', 'offer', 'rejected')),
  applied_at  timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (user_id, listing_id)
);
create index job_applications_user_updated_idx on public.job_applications (user_id, updated_at desc);

alter table public.job_preferences  enable row level security;
alter table public.job_matches      enable row level security;
alter table public.job_applications enable row level security;

update public.job_sources s set website = w.website
from (values
  ('stripe', 'stripe.com'), ('airbnb', 'airbnb.com'), ('databricks', 'databricks.com'), ('figma', 'figma.com'),
  ('discord', 'discord.com'), ('coinbase', 'coinbase.com'), ('gitlab', 'gitlab.com'), ('cloudflare', 'cloudflare.com'),
  ('robinhood', 'robinhood.com'), ('dropbox', 'dropbox.com'), ('groww', 'groww.in'), ('palantir', 'palantir.com'),
  ('spotify', 'spotify.com'), ('meesho', 'meesho.com'), ('zeta', 'zeta.tech'), ('cred', 'cred.club'),
  ('openai', 'openai.com'), ('notion', 'notion.so'), ('ramp', 'ramp.com'), ('linear', 'linear.app'),
  ('supabase', 'supabase.com')
) as w (board, website)
where s.board = w.board;

-- More boards, each checked to be live.
insert into public.job_sources (provider, board, company, website) values
  ('greenhouse', 'druva', 'Druva', 'druva.com'),
  ('greenhouse', 'inmobi', 'InMobi', 'inmobi.com'),
  ('greenhouse', 'mongodb', 'MongoDB', 'mongodb.com'),
  ('greenhouse', 'datadog', 'Datadog', 'datadoghq.com'),
  ('greenhouse', 'twilio', 'Twilio', 'twilio.com'),
  ('greenhouse', 'okta', 'Okta', 'okta.com'),
  ('greenhouse', 'elastic', 'Elastic', 'elastic.co'),
  ('greenhouse', 'zscaler', 'Zscaler', 'zscaler.com'),
  ('greenhouse', 'newrelic', 'New Relic', 'newrelic.com'),
  ('greenhouse', 'pinterest', 'Pinterest', 'pinterest.com'),
  ('greenhouse', 'reddit', 'Reddit', 'reddit.com'),
  ('greenhouse', 'lyft', 'Lyft', 'lyft.com'),
  ('greenhouse', 'instacart', 'Instacart', 'instacart.com'),
  ('greenhouse', 'asana', 'Asana', 'asana.com'),
  ('ashby', 'cohere', 'Cohere', 'cohere.com'),
  ('ashby', 'perplexity', 'Perplexity', 'perplexity.ai'),
  ('ashby', 'sarvam', 'Sarvam AI', 'sarvam.ai'),
  ('ashby', 'elevenlabs', 'ElevenLabs', 'elevenlabs.io'),
  ('ashby', 'posthog', 'PostHog', 'posthog.com'),
  ('ashby', 'plaid', 'Plaid', 'plaid.com');
