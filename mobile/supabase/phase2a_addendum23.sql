-- ============================================================================
-- Phase 2a Addendum 23 — Overwatch-style monthly-resetting challenge badges,
-- an "Announcements" official club, and the challenge_id/generic_name pin
-- consistency fix.
-- Run in Supabase SQL Editor. Requires addendum 19, 20, 21 already applied.
--
-- Part 1: the 4 generic monthly elevation challenges (Century Sprint,
-- Elevation Chaser, Iron Legs, Long Haul — badge_keys ending in
-- _challenge, generic_name = true) should behave like Overwatch season
-- badges: complete the challenge again each month to keep the badge lit.
-- Previously `check_challenge_completion()` only ever fired once per
-- (challenge, user) — completed_at gated all future re-evaluation. This adds
-- a per-period completions table so generic_name challenges can be
-- re-completed (and re-award the badge, bumping its earned_at) every period,
-- while non-generic (special/dated) challenges keep the original one-shot
-- behavior.
-- ============================================================================

create table if not exists challenge_period_completions (
  challenge_id uuid not null references challenges(challenge_id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  -- 'YYYY-MM' for monthly challenges, the Monday date (YYYY-MM-DD) of the ISO
  -- week for weekly ones — whatever period the challenge resets on.
  period_key text not null,
  completed_at timestamptz not null default now(),
  primary key (challenge_id, user_id, period_key)
);

alter table challenge_period_completions enable row level security;

drop policy if exists "Users can read their own period completions" on challenge_period_completions;
create policy "Users can read their own period completions"
  on challenge_period_completions for select
  using (auth.uid() = user_id);

-- award_badge previously did `on conflict do nothing`, so re-awarding an
-- already-owned badge was a silent no-op — fine for permanent badges (only
-- ever awarded once), but wrong for resetting ones, which need earned_at
-- bumped forward on every re-completion so the client can tell "earned this
-- month" apart from "earned some previous month, now expired."
create or replace function award_badge(p_user_id uuid, p_badge_key text)
returns void as $$
declare
  rows_affected int;
begin
  if p_user_id <> auth.uid() then
    raise exception 'not authorized';
  end if;

  insert into user_badges (user_id, badge_key, earned_at)
  values (p_user_id, p_badge_key, now())
  on conflict (user_id, badge_key) do update set earned_at = now();

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

create or replace function check_challenge_completion()
returns trigger as $$
declare
  weekly_floors int;
  monthly_floors int;
  window_floors int;
  participant record;
  did_complete boolean;
  period_key text;
  inserted_completion boolean;
begin
  select coalesce(sum(floors_climbed), 0) into weekly_floors
  from climbs
  where user_id = new.user_id and created_at >= now() - interval '7 days';

  select coalesce(sum(floors_climbed), 0) into monthly_floors
  from climbs
  where user_id = new.user_id and created_at >= now() - interval '30 days';

  for participant in
    select cp.challenge_id, c.target_floors, c.period, c.starts_at, c.ends_at, c.badge_key, c.generic_name
    from challenge_participants cp
    join challenges c on c.challenge_id = cp.challenge_id
    where cp.user_id = new.user_id
      and (c.generic_name = true or cp.completed_at is null)
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

    if not did_complete then
      continue;
    end if;

    if participant.generic_name then
      period_key := case when participant.period = 'monthly'
        then to_char(now(), 'YYYY-MM')
        else to_char(date_trunc('week', now()), 'YYYY-MM-DD')
      end;

      insert into challenge_period_completions (challenge_id, user_id, period_key)
      values (participant.challenge_id, new.user_id, period_key)
      on conflict (challenge_id, user_id, period_key) do nothing;

      inserted_completion := found;

      if inserted_completion then
        update challenge_participants
        set completed_at = now()
        where challenge_id = participant.challenge_id and user_id = new.user_id;

        if participant.badge_key is not null then
          perform award_badge(new.user_id, participant.badge_key);
        end if;
      end if;
    else
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

-- ============================================================================
-- Part 2: an "Announcements" official club — a full-width joinable channel
-- for official app updates, reusing the same club_memberships/club_posts/
-- club_post_reactions machinery from addendum19 (organizer-only posts,
-- member emoji reactions, weekly-rolling window). No per-member leaderboard
-- makes sense for this one — the client just skips rendering that section
-- for category = 'Announcements'.
-- ============================================================================

alter table official_clubs drop constraint if exists official_clubs_category_check;
alter table official_clubs add constraint official_clubs_category_check
  check (category in ('Trail Running', 'Hiking', 'Climbing', 'Announcements'));

insert into official_clubs (name, category, description) values
  ('Vertical Announcements', 'Announcements', 'Official updates from the Vertical team — new features, challenge drops, and app news. Join to follow along.')
on conflict (name) do nothing;
