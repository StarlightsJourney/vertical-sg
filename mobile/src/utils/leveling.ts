/**
 * XP = 1 per floor climbed + 50 per badge earned + 100 per building verified.
 * Level curve: level N is reached at 100*(N-1)^2 XP — fast early levels that
 * slow down (level 2 at 100 XP, level 3 needs 300 more, level 4 needs 500
 * more, level 5 needs 700 more, ...).
 */

export function computeXP(floorsClimbed: number, badgesEarned: number, buildingsVerified: number): number {
  return floorsClimbed + badgesEarned * 50 + buildingsVerified * 100;
}

export function xpForLevel(level: number): number {
  return 100 * Math.pow(level - 1, 2);
}

export function levelForXP(xp: number): number {
  return Math.floor(Math.sqrt(xp / 100)) + 1;
}

export interface LevelProgress {
  level: number;
  xp: number;
  xpIntoLevel: number;
  xpForNextLevel: number;
  progressPct: number;
}

export function computeLevelProgress(xp: number): LevelProgress {
  const level = levelForXP(xp);
  const floor = xpForLevel(level);
  const ceiling = xpForLevel(level + 1);
  const xpIntoLevel = xp - floor;
  const xpForNextLevel = ceiling - floor;
  return {
    level,
    xp,
    xpIntoLevel,
    xpForNextLevel,
    progressPct: xpForNextLevel > 0 ? Math.min(100, Math.round((xpIntoLevel / xpForNextLevel) * 100)) : 100,
  };
}
