import type { BadgeDef } from '../types';

// Single source of truth for challenge-badge medal colors — used by both
// GroupsScreen (challenge cards) and ProfileScreen (badges grid). They used
// to compute this independently (Groups via a hash-based per-challenge-id
// palette, Profile via this tier map), which caused two visible bugs: two
// different monthly badges could coincidentally get the same hash color,
// and the same badge could show a different color in Groups vs Profile.
const MONTHLY_BADGE_TIER_COLORS: Record<string, string> = {
  century_sprint_challenge: '#93C5FD',
  elevation_chaser_challenge: '#60A5FA',
  iron_legs_challenge: '#3B82F6',
  long_haul_challenge: '#1D4ED8',
};

/** Medal color for a challenge-category badge — special (legendary) badges get gold,
 * monthly-resetting badges get their tier shade, everything else a plain blue. */
export function medalColorFor(def: Pick<BadgeDef, 'key' | 'special' | 'resets'>): string {
  if (def.special) return '#F59E0B';
  if (def.resets === 'monthly') return MONTHLY_BADGE_TIER_COLORS[def.key] ?? '#3B82F6';
  return '#2563EB';
}

/** Same lookup, but keyed by badge_key string directly (for call sites that only have the challenge's badge_key, not a full BadgeDef). */
export function medalColorForBadgeKey(badgeKey: string | null | undefined, special: boolean): string {
  if (!badgeKey) return '#2563EB';
  if (special) return '#F59E0B';
  return MONTHLY_BADGE_TIER_COLORS[badgeKey] ?? '#2563EB';
}
