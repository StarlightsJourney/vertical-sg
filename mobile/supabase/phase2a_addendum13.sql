-- ============================================================================
-- Phase 2a Addendum 13 — fix "new row violates row-level security policy"
-- on feed photo uploads, and add a challenge organizer field.
-- Run in Supabase SQL Editor. Safe to re-run (idempotent).
--
-- The original storage policies for the building-photos bucket (in
-- phase2a_addendum.sql) used bare `create policy`, which errors out if the
-- policy already exists (e.g. from a bucket recreated via the dashboard
-- after the earlier "bucket not found" issue) — if that happened partway,
-- the bucket could be left with no working INSERT policy, which surfaces
-- as exactly "new row violates row-level security policy" on upload.
-- This drops + recreates each policy unconditionally so it can't drift.
-- ============================================================================

insert into storage.buckets (id, name, public)
values ('building-photos', 'building-photos', true)
on conflict (id) do nothing;

drop policy if exists "Anyone can view photos" on storage.objects;
create policy "Anyone can view photos"
  on storage.objects for select
  using (bucket_id = 'building-photos');

drop policy if exists "Authenticated users can upload photos" on storage.objects;
create policy "Authenticated users can upload photos"
  on storage.objects for insert
  with check (bucket_id = 'building-photos' and auth.role() = 'authenticated');

drop policy if exists "Users can delete own photos" on storage.objects;
create policy "Users can delete own photos"
  on storage.objects for delete
  using (bucket_id = 'building-photos' and auth.uid() = owner);

-- Challenge detail view (Strava-style) shows "organized by" — challenges
-- are app-run, so this defaults to a single value for all of them.
alter table challenges add column if not exists organizer text not null default 'Vertical Community Challenges';
