import type { Challenge } from '../types';

// Plain "climb N floors" challenges get a computed, non-branded display
// title/description instead of the stored ones — reserved unique names/copy
// for genuinely special/harder challenges (Everest Gauntlet, Double
// Eight-Thousander). Computing both client-side (everywhere a challenge is
// shown — Groups tab, Map's "My Challenges" banner, etc.) means the
// target_floors and the copy describing it can never drift out of sync,
// and the title always reflects the current month.
export function displayChallengeTitle(ch: Challenge): string {
  if (!ch.generic_name) return ch.title;
  const month = new Date().toLocaleDateString(undefined, { month: 'long' });
  const meters = Math.round(ch.target_floors * 2.8);
  return `${month} HDB Elevation Challenge — ${meters}m`;
}

export function displayChallengeDescription(ch: Challenge): string {
  if (!ch.generic_name) return ch.description;
  const period = ch.period === 'monthly' ? 'this month' : 'this week';
  return `Climb ${ch.target_floors} floors ${period} to earn this badge. Resets every ${ch.period === 'monthly' ? 'month' : 'week'} — complete it again to keep it active.`;
}
