-- ============================================================================
-- Phase 2a Addendum 6 — profiles (handles, avatar skins, searchable identity)
-- Run in Supabase SQL Editor. Requires schema + addendum 1-5 already applied.
--
-- Until now, display names were computed client-side as "Climber{uid.slice(4)}"
-- with nothing persisted or searchable, and there was no way to look someone
-- up or see their chosen avatar. This adds a real profile row per user
-- (created automatically, including for anonymous sessions — climbs already
-- work without an account, so profiles should too), searchable by handle.
-- ============================================================================

-- Needed before the trigram index below can use gin_trgm_ops — must run first.
create extension if not exists pg_trgm;

create table if not exists profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  avatar_idx int not null default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_profiles_display_name on profiles using gin (display_name gin_trgm_ops);

alter table profiles enable row level security;

create policy "Anyone can read profiles"
  on profiles for select
  using (true);

create policy "Users can insert own profile"
  on profiles for insert
  with check (auth.uid() = user_id);

create policy "Users can update own profile"
  on profiles for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Auto-create a profile (random pseudonym, default avatar) the moment any
-- account is created — anonymous sign-in included, matching the app's
-- "browse and climb without an account" philosophy.
create or replace function handle_new_user_profile()
returns trigger as $$
begin
  insert into profiles (user_id, display_name)
  values (new.id, 'Climber' || floor(random() * 9000 + 1000)::int)
  on conflict (user_id) do nothing;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile
  after insert on auth.users
  for each row execute function handle_new_user_profile();

-- Backfill profiles for any existing users who signed up before this migration
insert into profiles (user_id, display_name)
select id, 'Climber' || floor(random() * 9000 + 1000)::int
from auth.users
on conflict (user_id) do nothing;
