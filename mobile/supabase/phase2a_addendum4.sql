-- ============================================================================
-- Phase 2a Addendum 4
-- Run in Supabase SQL Editor. Requires phase2a_schema.sql + addendum/2/3 applied.
-- Adds: weekly leaderboard views, and notifications when a badge is earned
-- (the original plan called for this — badges were awarded silently before).
-- ============================================================================

-- ============================================================================
-- 1. Leaderboard — weekly + all-time, ranked by total floors climbed
-- ============================================================================
create or replace view leaderboard_weekly as
select
  user_id,
  count(*) as total_climbs,
  sum(floors_climbed) as total_floors,
  max(floors_climbed) as best_single_climb
from climbs
where created_at >= now() - interval '7 days'
group by user_id
order by total_floors desc;

create or replace view leaderboard_all_time as
select
  user_id,
  count(*) as total_climbs,
  sum(floors_climbed) as total_floors,
  max(floors_climbed) as best_single_climb
from climbs
group by user_id
order by total_floors desc;

grant select on leaderboard_weekly to anon, authenticated;
grant select on leaderboard_all_time to anon, authenticated;

-- ============================================================================
-- 2. Badge-earned notifications
-- ============================================================================
-- Small display-name lookup so notifications read "Night Owl", not "night_owl".
-- Mirrors BADGE_DEFS in src/types/index.ts — update both places if badges change.
create or replace function badge_display_name(p_badge_key text)
returns text as $$
begin
  return case p_badge_key
    when 'first_climb' then 'First Climb'
    when 'climbs_10' then '10 Climbs'
    when 'climbs_50' then '50 Climbs'
    when 'tall_tower' then 'Tall Tower'
    when 'century' then 'Century Club'
    when 'streak_5' then '5-Day Streak'
    when 'streak_30' then '30-Day Streak'
    when 'verified_1' then 'Verified 1'
    when 'verified_5' then 'Verified 5'
    when 'verified_10' then 'Verified 10'
    when 'town_explorer' then 'Town Explorer'
    when 'town_collector' then 'Town Collector'
    when 'pioneer_1' then 'Pioneer'
    when 'pioneer_5' then 'Trailblazer'
    when 'pioneer_10' then 'Frontiersman'
    when 'night_owl' then 'Night Owl'
    when 'early_bird' then 'Early Bird'
    when 'century_sprint' then 'Century Sprint'
    when 'weekend_warrior' then 'Weekend Warrior'
    else p_badge_key
  end;
end;
$$ language plpgsql immutable;

-- Full restatement of award_badge — now notifies on a genuinely NEW award only
-- (on-conflict-do-nothing means row_count is 0 for a badge you already have).
create or replace function award_badge(p_user_id uuid, p_badge_key text)
returns void as $$
declare
  rows_affected int;
begin
  insert into user_badges (user_id, badge_key)
  values (p_user_id, p_badge_key)
  on conflict (user_id, badge_key) do nothing;

  get diagnostics rows_affected = row_count;

  if rows_affected > 0 then
    insert into notifications (user_id, type, block_id, message)
    values (
      p_user_id,
      'badge_earned',
      null,
      'New badge earned: ' || badge_display_name(p_badge_key) || '!'
    );
  end if;
end;
$$ language plpgsql security definer;
