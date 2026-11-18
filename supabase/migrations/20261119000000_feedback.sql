-- Reviews and private feedback from signed-in users (website /feedback). A review is shown on the
-- public site only when the user opted in (publish) and an administrator approved it.

create table public.feedback (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.users (id) on delete cascade,
  kind         text not null check (kind in ('review', 'idea', 'bug', 'other')),
  rating       smallint check (rating between 1 and 5),
  message      text not null,
  display_name text not null default '',
  role         text not null default '',
  publish      boolean not null default false,
  -- new: waiting for an admin; approved: a review that may be shown; hidden: a review kept off the
  -- site; done: private feedback that was handled.
  status       text not null default 'new' check (status in ('new', 'approved', 'hidden', 'done')),
  admin_note   text not null default '',
  reviewed_by  text,
  reviewed_at  timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  check (kind <> 'review' or rating is not null)
);

-- One review per user: writing another edits it (and sends it back for approval).
create unique index feedback_one_review_per_user on public.feedback (user_id) where kind = 'review';
create index feedback_created_idx on public.feedback (created_at desc);
create index feedback_public_idx on public.feedback (created_at desc)
  where kind = 'review' and publish and status = 'approved';

-- Only the API's own Postgres role reads these; nothing is exposed through PostgREST.
alter table public.feedback enable row level security;
