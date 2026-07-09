-- ============================================================================
-- Phase 2a Addendum 18 — real profile photo upload (alternative to the
-- illustrated mascot skins).
-- Run in Supabase SQL Editor. Requires phase2a_addendum6.sql already applied.
-- Reuses the existing building-photos bucket/policies (avatars/ prefix) —
-- no new bucket needed.
-- ============================================================================

alter table profiles add column if not exists avatar_photo_path text;
