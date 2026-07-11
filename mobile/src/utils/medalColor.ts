import { BADGE_DEFS } from '../types';
import type { BadgeDef, Challenge } from '../types';

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

// A distinct medal color per badge category, so the Profile badge shelf reads
// as a systematic set (like tiers) rather than one flat blue — while still
// being deterministic, not per-badge arbitrary.
const CATEGORY_BADGE_COLORS: Record<string, string> = {
  climb: '#2563EB',
  verification: '#0D9488',
  location: '#7C3AED',
  pioneer: '#D97706',
  challenge: '#2563EB',
};

/** Medal color for any badge — special (legendary) badges get gold,
 * monthly-resetting challenge badges get their tier shade, otherwise the
 * badge's category color. */
export function medalColorFor(def: Pick<BadgeDef, 'key' | 'special' | 'resets' | 'category'>): string {
  if (def.special) return '#F59E0B';
  if (def.resets === 'monthly') return MONTHLY_BADGE_TIER_COLORS[def.key] ?? '#3B82F6';
  return CATEGORY_BADGE_COLORS[def.category ?? 'climb'] ?? '#2563EB';
}

/** Same lookup, but keyed by badge_key string directly (for call sites that only have the challenge's badge_key, not a full BadgeDef). */
export function medalColorForBadgeKey(badgeKey: string | null | undefined, special: boolean): string {
  if (!badgeKey) return '#2563EB';
  if (special) return '#F59E0B';
  return MONTHLY_BADGE_TIER_COLORS[badgeKey] ?? '#2563EB';
}

// Fallback palette for user-created challenges with no badge_key — a varied
// hash-based color, not a difficulty ranking, just visual variety.
const CHALLENGE_PALETTE = ['#2563EB', '#7C3AED', '#0D9488', '#DB2777', '#D97706', '#059669'];
export function challengeColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return CHALLENGE_PALETTE[hash % CHALLENGE_PALETTE.length];
}

export function isSpecialChallenge(ch: Pick<Challenge, 'badge_key'>): boolean {
  return !!BADGE_DEFS.find((b) => b.key === ch.badge_key)?.special;
}

/** Single source of truth for a challenge's medal color, wherever it's
 * rendered (Groups grid/featured cards, Social's suggested-challenges row,
 * the challenge detail modal) — badged challenges use the tier/special
 * lookup above, user-created ones with no badge fall back to the hash
 * palette. */
export function medalColorForChallenge(ch: Pick<Challenge, 'badge_key' | 'challenge_id'>): string {
  if (ch.badge_key) return medalColorForBadgeKey(ch.badge_key, isSpecialChallenge(ch));
  return challengeColor(ch.challenge_id);
}
