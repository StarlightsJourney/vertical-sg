-- ============================================================================
-- Phase 2a Addendum 26 — extend amenity_comments (from phase2a_addendum22.sql)
-- to also cover *static* (bundled JSON) amenity entries, not just DB-backed
-- amenity_reports rows.
-- Run in Supabase SQL Editor. Requires phase2a_addendum22.sql and
-- phase2a_addendum25.sql already applied.
--
-- Tester feedback this addresses:
--   Tapping a water-cooler pin (a static/bundled entry — see
--   staticAmenityKey() in MapScreen.tsx, and phase2a_addendum25.sql which
--   gave these entries their own verification tables since they have no
--   amenity_reports row) hid the entire comment section with no visible
--   reason why. That's because amenity_comments.report_id is a not-null
--   foreign key to amenity_reports, and static entries have no such row to
--   reference. This addendum makes report_id nullable, adds a static_key
--   text column (mirroring static_amenity_status.amenity_key /
--   static_amenity_verifications.amenity_key), and requires exactly one of
--   the two to be set per comment — so the same amenity_comments table now
--   backs comments on both kinds of entries.
--
-- amenity_comment_likes is unaffected: it keys off comment_id only (not
-- report_id), so it already works unchanged for comments on either kind of
-- entry.
-- ============================================================================

-- --- 1. Make report_id nullable, add static_key, require exactly one. ---
alter table amenity_comments
  alter column report_id drop not null;

alter table amenity_comments
  add column if not exists static_key text;

alter table amenity_comments
  drop constraint if exists amenity_comments_one_target_check;

alter table amenity_comments
  add constraint amenity_comments_one_target_check
  check ((report_id is not null) <> (static_key is not null));

create index if not exists idx_amenity_comments_static_key on amenity_comments(static_key);

-- --- 2. Insert policy — the existing policy already only checks
-- "auth.uid() = user_id" (it never referenced report_id), so it already
-- permits static-key comments unchanged. Re-declared here anyway so this
-- addendum is self-contained and the policy's intent (allow either target,
-- as long as the new check constraint above is satisfied) is explicit. ---
drop policy if exists "Users can post their own amenity comments" on amenity_comments;
create policy "Users can post their own amenity comments"
  on amenity_comments for insert
  with check (auth.uid() = user_id);
