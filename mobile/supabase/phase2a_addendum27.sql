-- ============================================================================
-- Phase 2a Addendum 27 — distinct "posted to feed" timestamp for climbs.
-- Run in Supabase SQL Editor. Requires phase2a_schema.sql already applied.
--
-- Tester feedback this addresses:
--   "when i added a post, it showed my post 1 day ago instead of today. this
--   is based on when i completed it and what happens is that it slots my
--   post all the way at the back."
--
--   The climb was tracked/logged (e.g. yesterday), but the user only chose
--   to attach a photo and share it to the Social feed later (today). The
--   feed sorted and displayed posts using climbs.created_at — the moment
--   the climb itself happened — with no separate notion of "when this
--   became a feed post." A climb logged yesterday but shared today therefore
--   showed "1d ago" and sorted below today's genuinely-new posts.
--
--   This adds a nullable posted_at column, set the moment a climb actually
--   gets a photo attached / gets shared to the feed (see logClimb() in
--   climbs.ts for the immediate-photo-at-log-time path, and the two
--   "post existing climb to feed" update paths in SocialScreen.tsx's
--   submitPost() and ClimbTrackerModal.tsx's handlePostToFeedNow()). It is
--   left null for climbs that never get posted, and for any pre-existing
--   rows — the app falls back to created_at for those (posted_at ?? created_at)
--   so nothing regresses. climbs.created_at itself is untouched and keeps
--   meaning "when the climb was completed," which is still what's used for
--   Profile's climb history, challenge progress windows, and badge date
--   checks.
-- ============================================================================

alter table climbs
  add column if not exists posted_at timestamptz;

comment on column climbs.posted_at is
  'When this climb was shared to the Social feed (photo attached), distinct from created_at (when the climb was completed). Null if never posted. Feed display/sort should use coalesce(posted_at, created_at).';

-- Backfill: for any existing photo-bearing rows (posted under the old
-- behaviour, before this column existed), treat their original created_at
-- as their posted_at too — preserves current feed ordering for historical
-- posts instead of leaving them null (which the client already falls back
-- on to created_at anyway, but this makes the data self-describing).
update climbs
  set posted_at = created_at
  where photo_path is not null
    and posted_at is null;

create index if not exists idx_climbs_posted_at on climbs(posted_at);
