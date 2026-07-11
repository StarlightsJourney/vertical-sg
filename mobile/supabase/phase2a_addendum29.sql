-- ============================================================================
-- Phase 2a Addendum 29 — persisted goal + cadence for the new Home tab.
-- Run in Supabase SQL Editor. Requires phase2a_schema.sql already applied.
--
-- Tester feedback this addresses:
--   "make it such that the choices on the onboarding page has implications
--   on their goals" + the new Home tab: "you get to see your weekly/monthly
--   goal that users can set, and it will show you the amount that they did
--   as well as how much they are expected to do for the next month...based
--   on the progressive overload principle."
--
--   weeklyGoal previously only lived in AsyncStorage (onboarding_profile),
--   so it was device-local and never visible to Supabase-backed logic. This
--   promotes it to a real profiles column (settable at onboarding, editable
--   from Home afterward) plus a cadence column driving how many days/week
--   the Home calendar suggests. Monthly goal is intentionally NOT stored —
--   it's always derived client-side from weekly_goal_floors (see
--   monthlyGoalFromWeekly() in utils/goals.ts) so the two can never disagree.
-- ============================================================================

alter table profiles
  add column if not exists weekly_goal_floors int,
  add column if not exists climb_cadence_per_week int default 3;

comment on column profiles.weekly_goal_floors is
  'Current weekly floor-climbing goal — set during onboarding from path/motivation/fitness answers (see computeWeeklyGoal() in utils/goals.ts), editable afterward from the Home tab.';
comment on column profiles.climb_cadence_per_week is
  'Suggested climbing sessions per week, derived from the onboarding path choice — drives which days the Home tab''s 31-day calendar marks as an expected climb day.';
