-- ============================================================================
-- Phase 2a Addendum 2
-- Run in Supabase SQL Editor. Requires phase2a_schema.sql (and ideally
-- phase2a_addendum.sql, for partial_floors) already applied.
-- Adds: pioneer + hidden/mystery badges, building ratings, building comments.
-- ============================================================================

-- ============================================================================
-- 1. Pioneer badges — first person to ever log a climb at a given block
-- ============================================================================
create table if not exists building_pioneers (
  block_id uuid primary key references blocks(block_id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  achieved_at timestamp with time zone default now()
);

alter table building_pioneers enable row level security;

create policy "Anyone can read pioneers"
  on building_pioneers for select
  using (true);

-- ============================================================================
-- 2. Full restatement of the climb-badge trigger — adds hidden/mystery
--    badges (night_owl, early_bird, century_sprint, weekend_warrior) and
--    pioneer badges on top of the existing climb/location badge checks.
--    Safe to run whether or not phase2a_addendum.sql's version already ran —
--    create or replace fully supersedes it.
-- ============================================================================
create or replace function award_climb_badges()
returns trigger as $$
declare
  total_climbs int;
  blk_storeys int;
  blk_address text;
  today_floors int;
  longest_streak int;
  max_town_blocks int;
  distinct_towns int;
  climb_hour int;
  climb_dow int;
  has_saturday boolean;
  has_sunday boolean;
  became_pioneer boolean := false;
  pioneer_count int;
begin
  select count(*) into total_climbs from climbs where user_id = new.user_id;

  if total_climbs = 1 then
    perform award_badge(new.user_id, 'first_climb');
  end if;
  if total_climbs >= 10 then
    perform award_badge(new.user_id, 'climbs_10');
  end if;
  if total_climbs >= 50 then
    perform award_badge(new.user_id, 'climbs_50');
  end if;

  select storeys, ('Blk ' || blk_no || ' ' || street) into blk_storeys, blk_address
  from blocks where block_id = new.block_id;

  if blk_storeys is not null and blk_storeys >= 40 then
    perform award_badge(new.user_id, 'tall_tower');
  end if;

  -- Century: 100+ floors climbed in a single calendar day
  select coalesce(sum(floors_climbed), 0) into today_floors
  from climbs
  where user_id = new.user_id
    and created_at::date = new.created_at::date;

  if today_floors >= 100 then
    perform award_badge(new.user_id, 'century');
  end if;

  -- Longest-ever streak of consecutive climb-days (badge kept once earned)
  select coalesce(max(streak_len), 0) into longest_streak
  from (
    select count(*) as streak_len
    from (
      select d, d - (row_number() over (order by d))::int as grp
      from (select distinct created_at::date as d from climbs where user_id = new.user_id) days
    ) grouped
    group by grp
  ) s;

  if longest_streak >= 5 then
    perform award_badge(new.user_id, 'streak_5');
  end if;
  if longest_streak >= 30 then
    perform award_badge(new.user_id, 'streak_30');
  end if;

  -- Town Explorer / Town Collector
  select coalesce(max(cnt), 0) into max_town_blocks
  from (
    select b.town, count(distinct c.block_id) as cnt
    from climbs c join blocks b on b.block_id = c.block_id
    where c.user_id = new.user_id and b.town is not null
    group by b.town
  ) t;
  if max_town_blocks >= 5 then
    perform award_badge(new.user_id, 'town_explorer');
  end if;

  select count(distinct b.town) into distinct_towns
  from climbs c join blocks b on b.block_id = c.block_id
  where c.user_id = new.user_id and b.town is not null;
  if distinct_towns >= 10 then
    perform award_badge(new.user_id, 'town_collector');
  end if;

  -- ---- Hidden / mystery badges ----
  climb_hour := extract(hour from new.created_at);
  climb_dow := extract(dow from new.created_at); -- 0 = Sunday, 6 = Saturday

  if climb_hour >= 0 and climb_hour < 5 then
    perform award_badge(new.user_id, 'night_owl');
  end if;

  if climb_hour < 7 then
    perform award_badge(new.user_id, 'early_bird');
  end if;

  if new.floors_climbed >= 40 then
    perform award_badge(new.user_id, 'century_sprint');
  end if;

  select exists(select 1 from climbs where user_id = new.user_id and extract(dow from created_at) = 6) into has_saturday;
  select exists(select 1 from climbs where user_id = new.user_id and extract(dow from created_at) = 0) into has_sunday;
  if has_saturday and has_sunday then
    perform award_badge(new.user_id, 'weekend_warrior');
  end if;

  -- ---- Pioneer badges ----
  insert into building_pioneers (block_id, user_id)
  values (new.block_id, new.user_id)
  on conflict (block_id) do nothing;

  get diagnostics became_pioneer = row_count;
  if became_pioneer then
    insert into notifications (user_id, type, block_id, message)
    values (new.user_id, 'pioneer', new.block_id, 'You were the first to climb ' || coalesce(blk_address, 'this building') || '.');

    select count(*) into pioneer_count from building_pioneers where user_id = new.user_id;
    perform award_badge(new.user_id, 'pioneer_1');
    if pioneer_count >= 5 then perform award_badge(new.user_id, 'pioneer_5'); end if;
    if pioneer_count >= 10 then perform award_badge(new.user_id, 'pioneer_10'); end if;
  end if;

  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_climb_insert_award_badges on climbs;
create trigger on_climb_insert_award_badges
  after insert on climbs
  for each row execute function award_climb_badges();

-- ============================================================================
-- 3. Building ratings
-- ============================================================================
create table if not exists block_ratings (
  rating_id uuid primary key default gen_random_uuid(),
  block_id uuid references blocks(block_id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  rating int not null check (rating between 1 and 5),
  created_at timestamp with time zone default now(),
  unique (block_id, user_id)
);

create index idx_block_ratings_block on block_ratings(block_id);

alter table block_ratings enable row level security;

create policy "Anyone can read ratings"
  on block_ratings for select
  using (true);

create policy "Users can insert own rating"
  on block_ratings for insert
  with check (auth.uid() = user_id);

create policy "Users can update own rating"
  on block_ratings for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create or replace view block_rating_summary as
select
  block_id,
  round(avg(rating)::numeric, 1) as avg_rating,
  count(*) as rating_count
from block_ratings
group by block_id;

-- ============================================================================
-- 4. Building comments — from other climbers, with lightweight moderation
--    matching the existing photo-report pattern (3 reports auto-hides).
-- ============================================================================
create table if not exists block_comments (
  comment_id uuid primary key default gen_random_uuid(),
  block_id uuid references blocks(block_id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 280),
  status text default 'active', -- 'active' | 'hidden'
  report_count int default 0,
  created_at timestamp with time zone default now()
);

create index idx_block_comments_block on block_comments(block_id, status);

alter table block_comments enable row level security;

create policy "Anyone can read active comments"
  on block_comments for select
  using (status = 'active');

create policy "Users can insert own comments"
  on block_comments for insert
  with check (auth.uid() = user_id);

create policy "Users can delete own comments"
  on block_comments for delete
  using (auth.uid() = user_id);

create policy "Users can report comments"
  on block_comments for update
  using (auth.uid() is not null)
  with check (auth.uid() is not null);

create or replace function increment_comment_report_count(p_comment_id uuid)
returns void as $$
begin
  update block_comments
  set report_count = report_count + 1
  where comment_id = p_comment_id;
end;
$$ language plpgsql security definer;

create or replace function auto_hide_reported_comment()
returns trigger as $$
begin
  if new.report_count >= 3 and old.status = 'active' then
    new.status = 'hidden';
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists comment_report_trigger on block_comments;
create trigger comment_report_trigger
  before update of report_count on block_comments
  for each row execute function auto_hide_reported_comment();
