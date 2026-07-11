-- ============================================================================
-- Phase 2a Addendum 30 — in-app feedback / bug reports.
-- Run in Supabase SQL Editor. Requires phase2a_schema.sql already applied.
--
-- Backs the Help & Feedback form on the Home tab: users pick a category, type
-- a message, and optionally attach a screenshot (uploaded to the existing
-- building-photos bucket, feedback/ prefix). Reports land here so you can
-- read/triage them in the Supabase dashboard, attributable to accounts.
--
-- Video is intentionally NOT accepted in-app (storage cost + moderation) —
-- direct users to the community channel (Telegram/Discord) for clips.
-- ============================================================================

create table if not exists feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  category text not null check (category in ('bug', 'idea', 'amenity', 'other')),
  message text not null check (char_length(message) between 1 and 4000),
  screenshot_path text,            -- Storage path in building-photos, feedback/ prefix (optional)
  app_version text,
  platform text,
  status text not null default 'new' check (status in ('new', 'triaged', 'resolved')),
  created_at timestamptz not null default now()
);

create index if not exists idx_feedback_created_at on feedback(created_at desc);

alter table feedback enable row level security;

-- Anyone signed in (incl. anonymous sessions) can file a report as themselves.
drop policy if exists "Users can submit their own feedback" on feedback;
create policy "Users can submit their own feedback"
  on feedback for insert
  with check (auth.uid() = user_id);

-- Users may read back only their own submissions (triage/replies happen in the
-- dashboard, not in-app).
drop policy if exists "Users can read their own feedback" on feedback;
create policy "Users can read their own feedback"
  on feedback for select
  using (auth.uid() = user_id);
