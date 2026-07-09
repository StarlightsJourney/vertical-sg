-- ============================================================================
-- Phase 2a Addendum 17 — relax the challenges.title uniqueness for
-- user-created challenges.
-- Run in Supabase SQL Editor. Requires addendum 16 already applied.
--
-- `title` was made unique purely so the official seed data (addendum 9/10)
-- could use `on conflict (title) do nothing` to stay idempotent. Now that
-- users can create their own challenges (addendum 16), a global unique
-- title would let one user's challenge title collide with someone else's
-- (or an official one) and fail to insert. Replaces the plain unique
-- constraint with a partial unique index that only applies to official
-- (creator_id is null) challenges — `on conflict (title)` still matches
-- against it for the seed inserts, since those rows have creator_id null.
-- ============================================================================

alter table challenges drop constraint if exists challenges_title_key;

create unique index if not exists challenges_official_title_idx
  on challenges (title)
  where creator_id is null;
