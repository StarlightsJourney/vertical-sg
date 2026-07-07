-- ============================================================================
-- Phase 2a Addendum 10 — monthly challenges (Groups tab "Singapore Special")
-- Run in Supabase SQL Editor. Requires addendum 9 already applied.
--
-- Adds a `period` column so challenges can be measured against either a
-- rolling 7-day window (existing weekly challenges) or a rolling 30-day
-- window (new monthly "Singapore Special"). The completion trigger now
-- computes both rolling sums once per climb and checks each participant
-- against whichever window their joined challenge uses.
-- ============================================================================

alter table challenges add column if not exists period text not null default 'weekly';
alter table challenges drop constraint if exists challenges_period_check;
alter table challenges add constraint challenges_period_check check (period in ('weekly', 'monthly'));

-- Recompute challenge completion using the period-appropriate rolling window.
create or replace function check_challenge_completion()
returns trigger as $$
declare
  weekly_floors int;
  monthly_floors int;
  participant record;
begin
  select coalesce(sum(floors_climbed), 0) into weekly_floors
  from climbs
  where user_id = new.user_id and created_at >= now() - interval '7 days';

  select coalesce(sum(floors_climbed), 0) into monthly_floors
  from climbs
  where user_id = new.user_id and created_at >= now() - interval '30 days';

  for participant in
    select cp.challenge_id, c.target_floors, c.period
    from challenge_participants cp
    join challenges c on c.challenge_id = cp.challenge_id
    where cp.user_id = new.user_id and cp.completed_at is null
  loop
    if (participant.period = 'weekly' and weekly_floors >= participant.target_floors)
      or (participant.period = 'monthly' and monthly_floors >= participant.target_floors) then
      update challenge_participants
      set completed_at = now()
      where challenge_id = participant.challenge_id and user_id = new.user_id;
    end if;
  end loop;

  return new;
end;
$$ language plpgsql security definer;

-- Singapore Special — climb the full height of Mount Everest (8,849m) via
-- HDB stairwells in a single month. Deliberately absurd; the trigger above
-- checks it against the 30-day window instead of the 7-day one.
insert into challenges (title, description, difficulty, period, target_floors, reward_icon, reward_label)
values
  ('The Everest Challenge (SG Special)', 'Climb the full height of Mount Everest — 8,849m — via HDB stairwells. In one month. Good luck.', 'insane', 'monthly', 3160, 'trophy', 'Everest Badge')
on conflict (title) do nothing;
