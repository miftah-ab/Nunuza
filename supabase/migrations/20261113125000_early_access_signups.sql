-- Public early-access intake. Only the server-side service role may write/read.
create table if not exists public.early_access_signups (
  id uuid primary key default gen_random_uuid(),
  name text,
  email text not null,
  linkedin_url text,
  challenge text,
  source text not null default 'website',
  created_at timestamptz not null default now(),
  constraint early_access_signups_email_length check (char_length(email) between 3 and 254),
  constraint early_access_signups_name_length check (name is null or char_length(name) <= 80),
  constraint early_access_signups_linkedin_length check (linkedin_url is null or char_length(linkedin_url) <= 500),
  constraint early_access_signups_challenge_length check (challenge is null or char_length(challenge) <= 80)
);

create unique index if not exists early_access_signups_email_lower_uidx
  on public.early_access_signups (lower(email));

alter table public.early_access_signups enable row level security;
revoke all on table public.early_access_signups from anon, authenticated;
grant all on table public.early_access_signups to service_role;

comment on table public.early_access_signups is
  'Nunuza website early-access requests. No public Data API access; server-side service role only.';
