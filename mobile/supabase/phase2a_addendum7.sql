-- ============================================================================
-- Phase 2a Addendum 7 — featured badge
-- Run in Supabase SQL Editor. Requires addendum 6 (profiles) already applied.
--
-- Lets a user pick one earned badge to display next to their name. Validity
-- (must be a badge they've actually earned) is enforced client-side rather
-- than a DB constraint, matching how badge_key itself isn't foreign-keyed
-- anywhere else in the schema — it's treated as an application-level enum.
-- ============================================================================

alter table profiles add column if not exists featured_badge text;
