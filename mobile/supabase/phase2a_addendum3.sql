-- ============================================================================
-- Phase 2a Addendum 3
-- Run in Supabase SQL Editor. Requires phase2a_schema.sql already applied.
-- Adds: public read access to climbs (fixes Recent Climbs + powers the new
-- Social feed), captions/photos on climbs, and kudos.
-- ============================================================================

-- ============================================================================
-- 1. Public read on climbs
-- ============================================================================
-- The original policy only let you read your OWN climbs — this silently
-- broke "Recent Climbs" on every building (it only ever showed your own
-- rows) and blocks any kind of feed entirely. Postgres combines multiple
-- permissive policies for the same command with OR, so this just adds
-- broader access on top rather than replacing the existing policy.
create policy "Anyone can read climbs"
  on climbs for select
  using (true);

-- Needed so a user can add a caption/photo to their own climb after logging it
create policy "Users can update own climbs"
  on climbs for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ============================================================================
-- 2. Optional caption + photo on a climb (the "post" in the feed)
-- ============================================================================
alter table climbs add column if not exists caption text;
alter table climbs add column if not exists photo_path text;

-- ============================================================================
-- 3. Kudos
-- ============================================================================
create table if not exists climb_kudos (
  kudos_id uuid primary key default gen_random_uuid(),
  climb_id uuid references climbs(climb_id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  created_at timestamp with time zone default now(),
  unique (climb_id, user_id)
);

create index idx_climb_kudos_climb on climb_kudos(climb_id);

alter table climb_kudos enable row level security;

create policy "Anyone can read kudos"
  on climb_kudos for select
  using (true);

create policy "Users can give kudos"
  on climb_kudos for insert
  with check (auth.uid() = user_id);

create policy "Users can remove own kudos"
  on climb_kudos for delete
  using (auth.uid() = user_id);
