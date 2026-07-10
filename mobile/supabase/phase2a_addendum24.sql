-- ============================================================================
-- Phase 2a Addendum 24 — let users remove their own amenity reports, and cap
-- how many unverified reports a single user can have outstanding at once.
-- Run in Supabase SQL Editor. Requires phase2a_addendum22.sql already applied
-- (creates the amenity_reports table and its existing select/insert policies).
--
-- Tester feedback this addresses:
--   1. No way to remove a report you created yourself (e.g. a mistake, a
--      duplicate, or an amenity that's since been removed) — adds a delete
--      RLS policy restricted to the reporter, same style as the table's
--      existing "auth.uid() = reporter_id" insert policy (a plain policy is
--      simpler here than a wrapper RPC, and amenity_report_verifications /
--      amenity_comments both already `on delete cascade` from
--      amenity_reports, so removing a report also removes its verifications
--      and comments for free).
--   2. Nothing stopped a single user from flooding the map with unverified
--      reports — adds a row-count subquery to the insert policy's WITH CHECK
--      so a user can have at most 5 reports sitting in `status = 'unverified'`
--      at a time (once one gets verified, or the user deletes it via #1, they
--      free up a slot). Verified reports don't count against the cap.
-- ============================================================================

-- --- 1. Reporters can delete their own reports ---
drop policy if exists "Users can delete their own amenity reports" on amenity_reports;
create policy "Users can delete their own amenity reports"
  on amenity_reports for delete
  using (auth.uid() = reporter_id);

-- --- 2. Anti-spam cap: replace the insert policy with one that also rejects
-- the insert once the reporter already has 5+ unverified reports live. ---
drop policy if exists "Users can report their own amenity sightings" on amenity_reports;
create policy "Users can report their own amenity sightings"
  on amenity_reports for insert
  with check (
    auth.uid() = reporter_id
    and (
      select count(*) from amenity_reports
      where reporter_id = auth.uid() and status = 'unverified'
    ) < 5
  );
