-- ============================================================================
-- Phase 2a Addendum 20 — plain elevation-target challenges become monthly,
-- generic-named (no unique branding unless the challenge is genuinely
-- special/harder); adds a challenge that beats Everest Gauntlet.
-- Run in Supabase SQL Editor. Requires addendum 15/16 already applied.
--
-- Rationale: a challenge that's just "climb N floors in a period" with no
-- special mechanic shouldn't have a unique brand name like "Iron Legs" — that
-- kind of naming should be reserved for genuinely harder/special challenges
-- (Everest Gauntlet and the new Double Eight-Thousander below). Client code
-- computes a generic display title for any challenge with generic_name=true
-- (e.g. "July HDB Elevation Challenge — 1120m"), so this column is the only
-- thing that needs to change here — the `title` column stays as an internal,
-- never-displayed identifier for these rows.
-- ============================================================================

alter table challenges add column if not exists generic_name boolean not null default false;

-- Century Sprint, Elevation Chaser, Iron Legs: weekly -> monthly, generic naming,
-- targets scaled up for the longer window.
update challenges set period = 'monthly', target_floors = 400, generic_name = true where title = 'Century Sprint';
update challenges set period = 'monthly', target_floors = 1400, generic_name = true where title = 'Elevation Chaser';
update challenges set period = 'monthly', target_floors = 2800, generic_name = true where title = 'Iron Legs';

-- Long Haul: already monthly, just gets generic naming too.
update challenges set generic_name = true where title = 'The Long Haul';

-- A challenge that beats Everest Gauntlet: combined height of Everest
-- (8,849m) + K2 (8,611m) = 17,460m ≈ 6,236 floors, same 1-week window as
-- Everest Gauntlet — genuinely harder, not just a bigger number.
insert into challenges (title, description, difficulty, period, target_floors, reward_icon, reward_label, badge_key, organizer)
values (
  'The Double Eight-Thousander',
  'Climb the combined height of Mount Everest (8,849m) and K2 (8,611m) — 17,460m of stairwell — in ONE WEEK. The single hardest challenge in the app.',
  'insane', 'weekly', 6236, 'trophy', 'Double Eight-Thousander Badge', 'double_eightthousander_challenge', 'Vertical'
)
-- Matches addendum17's partial unique index (challenges_official_title_idx),
-- which only covers rows where creator_id is null — a plain `on conflict
-- (title)` does not infer a partial index unless the predicate is repeated
-- here too (this is what actually threw the 42P10 error).
on conflict (title) where creator_id is null do nothing;
