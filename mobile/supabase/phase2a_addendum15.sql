-- ============================================================================
-- Phase 2a Addendum 15 — challenges actually award real badges; limited-time
-- challenges; a genuinely brutal Everest challenge; a second monthly option.
-- Run in Supabase SQL Editor. Requires addendum 9, 10, 12 already applied.
--
-- Until now, a challenge's "reward_label"/"reward_icon" were purely cosmetic
-- text on the card — completing one never actually granted anything in the
-- real badge system (user_badges / BADGE_DEFS). That's the "challenges and
-- badges feel like the same thing" problem: badges unlock automatically the
-- moment you hit a condition; challenges are opt-in and time-boxed, and
-- completing one should hand you a real badge as the reward, not just
-- redraw some text on a card. This adds a badge_key column and has the
-- completion trigger actually call award_badge().
--
-- Also adds starts_at/ends_at (nullable) for genuinely limited-time, dated
-- challenges — distinct from the evergreen rolling 7-day/30-day weekly and
-- monthly ones. A challenge with both set is checked against that fixed
-- date window instead of a rolling one.
-- ============================================================================

alter table challenges add column if not exists badge_key text;
alter table challenges add column if not exists starts_at timestamptz;
alter table challenges add column if not exists ends_at timestamptz;

-- --- Link the 3 existing weekly challenges to real badges ---
update challenges set badge_key = 'century_sprint_challenge' where title = 'Century Sprint';
update challenges set badge_key = 'elevation_chaser_challenge' where title = 'Elevation Chaser';
update challenges set badge_key = 'iron_legs_challenge' where title = 'Iron Legs';

-- --- Rework the Everest Challenge: a month made it too easy — same total
-- height, but now due in a single WEEK. ~451 floors/day is genuinely brutal. ---
update challenges
set title = 'The Everest Gauntlet',
    description = 'Climb the full height of Mount Everest — 8,849m — via HDB stairwells. In ONE WEEK. Most people will not finish this.',
    period = 'weekly',
    target_floors = 3160,
    badge_key = 'everest_gauntlet_challenge'
where title = 'The Everest Challenge (SG Special)';

-- --- New monthly option (less extreme than Everest, still a real grind) ---
insert into challenges (title, description, difficulty, period, target_floors, reward_icon, reward_label, badge_key)
values
  ('The Long Haul', 'Climb 2,000 floors in a month — no single-day heroics required, just consistency.', 'hard', 'monthly', 2000, 'infinite-outline', 'Long Haul Badge', 'long_haul_challenge')
on conflict (title) do nothing;

-- --- Limited-time, dated challenges (not evergreen — real start/end windows) ---
insert into challenges (title, description, difficulty, period, target_floors, reward_icon, reward_label, badge_key, starts_at, ends_at)
values
  ('SG61 Countdown Climb', 'Climb 610 floors before National Day — one for every year of independence, times ten.', 'medium', 'weekly', 610, 'flag-outline', 'SG61 Badge', 'sg61_countdown_challenge', now(), '2026-08-09 23:59:59+08'),
  ('Mid-Year Momentum', 'A 2-week flash challenge to kick off the second half of the year: 300 floors before it closes.', 'easy', 'weekly', 300, 'rocket-outline', 'Momentum Badge', 'midyear_momentum_challenge', now(), now() + interval '14 days')
on conflict (title) do nothing;

-- --- Completion trigger: dated window for limited-time challenges, rolling
-- 7/30-day window for evergreen ones, and now actually awards the badge. ---
create or replace function check_challenge_completion()
returns trigger as $$
declare
  weekly_floors int;
  monthly_floors int;
  window_floors int;
  participant record;
  did_complete boolean;
begin
  select coalesce(sum(floors_climbed), 0) into weekly_floors
  from climbs
  where user_id = new.user_id and created_at >= now() - interval '7 days';

  select coalesce(sum(floors_climbed), 0) into monthly_floors
  from climbs
  where user_id = new.user_id and created_at >= now() - interval '30 days';

  for participant in
    select cp.challenge_id, c.target_floors, c.period, c.starts_at, c.ends_at, c.badge_key
    from challenge_participants cp
    join challenges c on c.challenge_id = cp.challenge_id
    where cp.user_id = new.user_id and cp.completed_at is null
  loop
    did_complete := false;

    if participant.starts_at is not null and participant.ends_at is not null then
      select coalesce(sum(floors_climbed), 0) into window_floors
      from climbs
      where user_id = new.user_id
        and created_at >= participant.starts_at
        and created_at <= participant.ends_at;
      did_complete := window_floors >= participant.target_floors;
    elsif participant.period = 'weekly' then
      did_complete := weekly_floors >= participant.target_floors;
    elsif participant.period = 'monthly' then
      did_complete := monthly_floors >= participant.target_floors;
    end if;

    if did_complete then
      update challenge_participants
      set completed_at = now()
      where challenge_id = participant.challenge_id and user_id = new.user_id;

      if participant.badge_key is not null then
        perform award_badge(new.user_id, participant.badge_key);
      end if;
    end if;
  end loop;

  return new;
end;
$$ language plpgsql security definer;
