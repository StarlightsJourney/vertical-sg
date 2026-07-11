// Shared goal-computation logic — used by OnboardingScreen (first goal) and
// HomeScreen (ongoing progressive-overload projection + calendar cadence),
// so the two never drift out of sync with each other.

// Index order for all four arrays below matches OnboardingScreen.tsx's
// PATH_OPTIONS/GOAL_OPTIONS/FITNESS_OPTIONS.

// Per-week floor baseline by "how many floors, no stopping?" fitness tier —
// index matches FITNESS_OPTIONS in OnboardingScreen.tsx (1–5, 6–15, 16–30, 30+).
const FITNESS_BASE_FLOORS = [120, 200, 320, 450];

// Motivation shapes intensity — training for a race or chasing the
// leaderboard asks for more than staying fit or exploring casually.
const MOTIVATION_BOOST = [1.3, 1.0, 1.0, 1.15];

// Path shapes both intensity (multiplier) and how often a climb is expected
// per week (cadence, used to space out the Home calendar's suggested days).
const PATH_MULTIPLIER = [1.15, 1.0, 1.2, 0.85]; // Athlete, Explorer, Competitor, Just Curious
const PATH_CADENCE = [5, 3, 4, 2];

export function computeWeeklyGoal(pathIdx: number, motivationIdx: number, fitnessIdx: number): number {
  const base = FITNESS_BASE_FLOORS[fitnessIdx] ?? 200;
  const boost = MOTIVATION_BOOST[motivationIdx] ?? 1;
  const pathMult = PATH_MULTIPLIER[pathIdx] ?? 1;
  return Math.round((base * boost * pathMult) / 10) * 10;
}

export function cadenceForPath(pathIdx: number): number {
  return PATH_CADENCE[pathIdx] ?? 3;
}

/** Average weeks-per-month is ~4.345 — round to the nearest 10 floors so the
 * monthly goal doesn't display an oddly specific number. */
export function monthlyGoalFromWeekly(weeklyGoal: number): number {
  return Math.max(10, Math.round((weeklyGoal * 4.345) / 10) * 10);
}

/** Progressive overload: met or beat this month's goal → raise it 10% for
 * next month. Landed in a reasonable range (70–100%) → hold steady and
 * consolidate. Fell well short → ease off instead of demanding more of a
 * goal that clearly wasn't realistic yet — sustainable progression, not a
 * guilt trip. */
export function nextMonthGoal(currentMonthlyGoal: number, actualFloorsThisMonth: number): number {
  if (currentMonthlyGoal <= 0) return actualFloorsThisMonth > 0 ? Math.round(actualFloorsThisMonth / 10) * 10 : 200;
  const pct = actualFloorsThisMonth / currentMonthlyGoal;
  const factor = pct >= 1 ? 1.1 : pct >= 0.7 ? 1.0 : 0.9;
  return Math.max(50, Math.round((currentMonthlyGoal * factor) / 10) * 10);
}
