-- ============================================================================
-- Phase 2a Addendum 19 — official app-run clubs with weekly rolling channels.
-- Run in Supabase SQL Editor. Requires addendum 16 already applied.
--
-- Replaces the old hardcoded "curated clubs" list (Facebook links etc, which
-- lived only in client code) with 3 real, app-owned clubs (Hiking, Trail
-- Runners, Climbing) that members can join. Each club automatically pools
-- its members' climbs into a shared weekly leaderboard (computed client-side
-- from the existing `climbs` table — no new column needed for that part).
--
-- Each club also has a weekly "channel": a rolling window of posts, visible
-- only for the current ISO week. Only members with role 'organizer' or
-- 'admin' may create posts (real logistics/schedule/route updates); regular
-- members cannot post text but CAN react to posts with an emoji. There is no
-- default "leader" — clubs start with zero organizers. To let someone post,
-- manually promote them once, e.g.:
--   update club_memberships set role = 'organizer'
--   where club_id = (select club_id from official_clubs where name = 'Hiking')
--     and user_id = '<some-user-uuid>';
-- ============================================================================

create table if not exists official_clubs (
  club_id uuid primary key default gen_random_uuid(),
  name text not null unique,
  category text not null check (category in ('Trail Running', 'Hiking', 'Climbing')),
  description text not null,
  created_at timestamptz not null default now()
);

alter table official_clubs enable row level security;

drop policy if exists "Anyone can read official clubs" on official_clubs;
create policy "Anyone can read official clubs"
  on official_clubs for select
  using (true);

insert into official_clubs (name, category, description) values
  ('Trail Runners', 'Trail Running', 'For members who take their climbing legs off-road — route shares, weekend meetup logistics, and race chatter, pooled into one weekly leaderboard.'),
  ('Hiking', 'Hiking', 'Nature reserves, hill trails, and weekend hikes around Singapore — plan routes and compare weekly elevation with the crew.'),
  ('Climbing', 'Climbing', 'Gym sessions, bouldering, and outdoor trips — for anyone who treats a stairwell as training for the wall.')
on conflict (name) do nothing;

create table if not exists club_memberships (
  club_id uuid not null references official_clubs(club_id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('member', 'admin', 'organizer')),
  joined_at timestamptz not null default now(),
  primary key (club_id, user_id)
);

alter table club_memberships enable row level security;

drop policy if exists "Anyone can read club memberships" on club_memberships;
create policy "Anyone can read club memberships"
  on club_memberships for select
  using (true);

drop policy if exists "Users can join a club as a member" on club_memberships;
create policy "Users can join a club as a member"
  on club_memberships for insert
  with check (auth.uid() = user_id and role = 'member');

drop policy if exists "Users can leave a club" on club_memberships;
create policy "Users can leave a club"
  on club_memberships for delete
  using (auth.uid() = user_id);

create table if not exists club_posts (
  post_id uuid primary key default gen_random_uuid(),
  club_id uuid not null references official_clubs(club_id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete cascade,
  body text not null,
  -- Monday of the ISO week this post belongs to — the UI only ever queries
  -- the current week, giving the "closes every week / rolling week" effect
  -- without needing a scheduled job to actually delete anything.
  week_start date not null default date_trunc('week', now())::date,
  created_at timestamptz not null default now()
);

alter table club_posts enable row level security;

drop policy if exists "Anyone can read club posts" on club_posts;
create policy "Anyone can read club posts"
  on club_posts for select
  using (true);

drop policy if exists "Organizers and admins can post" on club_posts;
create policy "Organizers and admins can post"
  on club_posts for insert
  with check (
    auth.uid() = author_id
    and exists (
      select 1 from club_memberships m
      where m.club_id = club_posts.club_id
        and m.user_id = auth.uid()
        and m.role in ('organizer', 'admin')
    )
  );

create table if not exists club_post_reactions (
  post_id uuid not null references club_posts(post_id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  emoji text not null,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id, emoji)
);

alter table club_post_reactions enable row level security;

drop policy if exists "Anyone can read reactions" on club_post_reactions;
create policy "Anyone can read reactions"
  on club_post_reactions for select
  using (true);

drop policy if exists "Users can react as themselves" on club_post_reactions;
create policy "Users can react as themselves"
  on club_post_reactions for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can remove their own reaction" on club_post_reactions;
create policy "Users can remove their own reaction"
  on club_post_reactions for delete
  using (auth.uid() = user_id);

-- Optional: actually delete posts from past weeks instead of just filtering
-- them out client-side. Not required for correctness (the app only ever
-- queries the current week), but available if you want to schedule it
-- (e.g. via pg_cron's `select cron.schedule(...)`) to keep the table small.
create or replace function cleanup_old_club_posts()
returns void as $$
begin
  delete from club_posts where week_start < date_trunc('week', now())::date;
end;
$$ language plpgsql security definer;

revoke execute on function cleanup_old_club_posts() from anon, authenticated, public;
