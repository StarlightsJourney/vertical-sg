-- ============================================================================
-- Phase 2a Addendum
-- Run this in Supabase SQL Editor AFTER phase2a_schema.sql has been applied.
-- Adds: partial-floor climb logging, climb/location badge awarding,
-- and the building-photos storage bucket (previously left as a manual step).
-- ============================================================================

-- ============================================================================
-- 1. Partial-floor climb logging
-- ============================================================================
-- climb_qty = number of full sets (whole climbs of the building)
-- partial_floors = floors climbed on an incomplete final set, 0 if none
-- floors_climbed = climb_qty * storeys + partial_floors (computed client-side)
alter table climbs add column if not exists partial_floors int not null default 0;

-- ============================================================================
-- 2. Climb + location badge awarding (fires on every climb log)
-- ============================================================================
create or replace function award_climb_badges()
returns trigger as $$
declare
  total_climbs int;
  blk_storeys int;
  today_floors int;
  longest_streak int;
  max_town_blocks int;
  distinct_towns int;
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

  select storeys into blk_storeys from blocks where block_id = new.block_id;

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

  -- Longest-ever streak of consecutive climb-days (badge kept once earned,
  -- doesn't need to be the CURRENT streak — matches the "achieved" pattern
  -- used for other one-time badges)
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

  -- Town Explorer: 5+ distinct blocks climbed within a single town
  select coalesce(max(cnt), 0) into max_town_blocks
  from (
    select b.town, count(distinct c.block_id) as cnt
    from climbs c
    join blocks b on b.block_id = c.block_id
    where c.user_id = new.user_id and b.town is not null
    group by b.town
  ) t;

  if max_town_blocks >= 5 then
    perform award_badge(new.user_id, 'town_explorer');
  end if;

  -- Town Collector: climbed in 10+ distinct towns
  select count(distinct b.town) into distinct_towns
  from climbs c
  join blocks b on b.block_id = c.block_id
  where c.user_id = new.user_id and b.town is not null;

  if distinct_towns >= 10 then
    perform award_badge(new.user_id, 'town_collector');
  end if;

  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_climb_insert_award_badges on climbs;
create trigger on_climb_insert_award_badges
  after insert on climbs
  for each row execute function award_climb_badges();

-- ============================================================================
-- 3. Storage bucket for building photos
-- ============================================================================
insert into storage.buckets (id, name, public)
values ('building-photos', 'building-photos', true)
on conflict (id) do nothing;

create policy "Anyone can view photos"
  on storage.objects for select
  using (bucket_id = 'building-photos');

create policy "Authenticated users can upload photos"
  on storage.objects for insert
  with check (bucket_id = 'building-photos' and auth.role() = 'authenticated');

create policy "Users can delete own photos"
  on storage.objects for delete
  using (bucket_id = 'building-photos' and auth.uid() = owner);
