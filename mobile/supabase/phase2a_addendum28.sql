-- ============================================================================
-- Phase 2a Addendum 28 — multi-photo posts (up to 6 photos per climb/post).
-- Run in Supabase SQL Editor. Requires phase2a_schema.sql already applied.
--
-- Tester feedback this addresses:
--   "make it such that you can upload multiple images in the social feed and
--   not just one, and eventually short videos that will be compressed as
--   well. but the max of 6 will be shown."
--
--   climbs.photo_path (singular) only ever supported one image per post.
--   This adds a photo_paths array alongside it, capped at 6 entries. The
--   single photo_path column is kept and still populated (mirrored to
--   photo_paths[1]) for any older code path that reads it directly, but new
--   multi-photo posts should be read via photo_paths going forward — see
--   PhotoGallery.tsx (rendering) and PhotoGridPicker.tsx (picking).
--
--   Video is intentionally NOT part of this addendum. expo-image-picker can
--   select video without a new dependency, but compressing it before upload
--   needs a native compression library this app doesn't have yet — adding
--   one would very likely require another EAS dev-client rebuild (same as
--   when react-native-svg/expo-linear-gradient were added this session).
--   That's real scoped work for later, not a quick follow-on to this.
-- ============================================================================

alter table climbs
  add column if not exists photo_paths text[];

alter table climbs
  drop constraint if exists climbs_photo_paths_max6;
alter table climbs
  add constraint climbs_photo_paths_max6 check (photo_paths is null or array_length(photo_paths, 1) <= 6);

comment on column climbs.photo_paths is
  'Up to 6 Storage paths (bucket building-photos), in display order. New multi-photo posts populate this; photo_path (singular) is kept in sync with photo_paths[1] for backward compatibility. Null/empty means no gallery.';

-- Backfill: give every existing single-photo post a 1-element gallery too,
-- so every renderer can standardize on reading photo_paths.
update climbs
  set photo_paths = array[photo_path]
  where photo_path is not null
    and photo_paths is null;
