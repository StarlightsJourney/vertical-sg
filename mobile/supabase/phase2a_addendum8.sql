-- ============================================================================
-- Phase 2a Addendum 8 — follows
-- Run in Supabase SQL Editor. Requires addendum 6 (profiles) already applied.
--
-- A basic follow graph: who you've added. Doesn't change the main feed
-- (still shows everyone, matching the current "public by default" model) —
-- just tracks the relationship and shows follower/following counts on
-- profiles. Filtering the feed to "following only" is a natural next step
-- once this exists, not built here to keep this migration focused.
-- ============================================================================

create table if not exists follows (
  follower_id uuid references auth.users(id) on delete cascade,
  followee_id uuid references auth.users(id) on delete cascade,
  created_at timestamptz default now(),
  primary key (follower_id, followee_id),
  check (follower_id <> followee_id)
);

create index idx_follows_followee on follows(followee_id);

alter table follows enable row level security;

create policy "Anyone can read follows"
  on follows for select
  using (true);

create policy "Users can follow others"
  on follows for insert
  with check (auth.uid() = follower_id);

create policy "Users can unfollow"
  on follows for delete
  using (auth.uid() = follower_id);

create or replace view follow_counts as
select
  p.user_id,
  (select count(*) from follows f where f.followee_id = p.user_id) as followers_count,
  (select count(*) from follows f where f.follower_id = p.user_id) as following_count
from profiles p;

grant select on follow_counts to anon, authenticated;

-- ============================================================================
-- Comments on feed posts (climbs) — separate from block_comments, which are
-- comments on a *building* shown in the building detail sheet. These are
-- comments on a specific *climb* shown in the Social feed.
-- ============================================================================
create table if not exists climb_comments (
  comment_id uuid primary key default gen_random_uuid(),
  climb_id uuid references climbs(climb_id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 280),
  status text default 'active', -- 'active' | 'hidden'
  report_count int default 0,
  created_at timestamptz default now()
);

create index idx_climb_comments_climb on climb_comments(climb_id, status);

alter table climb_comments enable row level security;

create policy "Anyone can read active climb comments"
  on climb_comments for select
  using (status = 'active');

create policy "Users can insert own climb comments"
  on climb_comments for insert
  with check (auth.uid() = user_id);

create policy "Users can delete own climb comments"
  on climb_comments for delete
  using (auth.uid() = user_id);

-- Report flow uses the same security-definer-RPC pattern as block_comments
-- and building_photos — no client-facing UPDATE policy, closing the same
-- class of gap fixed for those in addendum 5.
create or replace function increment_climb_comment_report_count(p_comment_id uuid)
returns void as $$
begin
  update climb_comments
  set report_count = report_count + 1
  where comment_id = p_comment_id;
end;
$$ language plpgsql security definer;

create or replace function auto_hide_reported_climb_comment()
returns trigger as $$
begin
  if new.report_count >= 3 and old.status = 'active' then
    new.status = 'hidden';
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists climb_comment_report_trigger on climb_comments;
create trigger climb_comment_report_trigger
  before update of report_count on climb_comments
  for each row execute function auto_hide_reported_climb_comment();
