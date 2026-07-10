-- ============================================================================
-- Phase 2a Addendum 21 — "Peers Only" challenge visibility.
-- Run in Supabase SQL Editor. Requires addendum 16 (challenges.creator_id +
-- the `follows` table from earlier phases) already applied.
--
-- User-created challenges could previously only be public (visible/joinable
-- by anyone, shown with a "Community" pill). This adds a `visibility` column
-- so a creator can instead scope a challenge to just their peers — anyone
-- who follows them or whom they follow (reusing the existing `follows`
-- table; there's no separate invite list). Public challenges are unaffected.
-- ============================================================================

alter table challenges add column if not exists visibility text not null default 'public' check (visibility in ('public', 'peers'));

drop policy if exists "Anyone can read active challenges" on challenges;

create policy "Read public challenges, or peers-only challenges you're connected to"
  on challenges for select
  using (
    is_active = true
    and (
      visibility = 'public'
      or creator_id = auth.uid()
      or exists (
        select 1 from follows f
        where (f.follower_id = auth.uid() and f.followee_id = challenges.creator_id)
           or (f.followee_id = auth.uid() and f.follower_id = challenges.creator_id)
      )
    )
  );
