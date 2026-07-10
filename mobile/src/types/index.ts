// --- Existing types (Phase 0/1) ---

export interface Block {
  block_id: string;
  blk_no: string;
  street: string;
  town: string | null;
  storeys: number;
  est_height_m: number;
  height_source: 'estimated' | 'verified';
  year_completed: number | null;
  total_dwelling_units: number | null;
  lat: number | null;
  lng: number | null;
}

export interface BoundsRect {
  sw: [number, number];
  ne: [number, number];
}

export interface ClimbLog {
  climb_id?: string; // present for Supabase-backed climbs (signed-in users); absent for local-only anonymous history
  block_id: string;
  blk_no: string;
  street: string;
  storeys: number;
  floors: number; // actual floors climbed for this log entry (full sets × storeys + any partial)
  climbedAt: string; // ISO date string
  durationSeconds?: number; // only present for climbs tracked via ClimbTrackerModal
}

// --- Phase 2a types ---

export interface Profile {
  user_id: string;
  display_name: string;
  avatar_idx: number;
  featured_badge: string | null;
  is_pro: boolean;
  /** Storage path (building-photos bucket, avatars/ prefix) for a real uploaded photo — takes priority over the mascot skin when set. */
  avatar_photo_path?: string | null;
  created_at: string;
  updated_at: string;
}

export interface ClimbRecord {
  climb_id: string;
  user_id: string;
  block_id: string;
  climb_qty: number; // number of full sets (whole climbs of the building)
  partial_floors: number; // floors climbed on an incomplete final set, 0 if none
  floors_climbed: number; // climb_qty * storeys + partial_floors
  synced: boolean;
  caption: string | null;
  photo_path: string | null;
  /** How floors_climbed was actually determined — shown to other users so they know how much to trust the number. */
  tracking_method: 'barometer' | 'pedometer' | 'manual';
  duration_seconds: number | null;
  created_at: string;
}

export interface KudosRecord {
  kudos_id: string;
  climb_id: string;
  user_id: string;
  created_at: string;
}

export interface Challenge {
  challenge_id: string;
  title: string;
  description: string;
  difficulty: 'easy' | 'medium' | 'hard' | 'insane';
  period: 'weekly' | 'monthly';
  target_floors: number;
  reward_icon: string;
  reward_label: string;
  organizer: string;
  /** Real badge (BADGE_DEFS key) granted via award_badge() on completion — the reward is a real, permanent badge, not just card text. */
  badge_key: string | null;
  /** Both set → a genuinely limited-time challenge checked against this fixed window, not the rolling weekly/monthly one. */
  starts_at: string | null;
  ends_at: string | null;
  /** null = official/seeded challenge; otherwise a user-created one (no badge_key — custom challenges don't grant a real badge, there's no BADGE_DEFS entry to award). */
  creator_id: string | null;
  /** True for plain "climb N floors" challenges with no special mechanic — these get a computed display title (e.g. "July HDB Elevation Challenge — 1120m") instead of a unique brand name, reserved for genuinely special/harder challenges like Everest Gauntlet. */
  generic_name?: boolean;
  /** 'peers' = only visible to the creator + people who follow/are followed by them (reuses the `follows` table) — not shown to the wider community. */
  visibility?: 'public' | 'peers';
}

export interface OfficialClub {
  club_id: string;
  name: string;
  category: 'Trail Running' | 'Hiking' | 'Climbing' | 'Announcements';
  description: string;
  created_at: string;
}

export interface ClubMembership {
  club_id: string;
  user_id: string;
  role: 'member' | 'admin' | 'organizer';
  joined_at: string;
}

export interface ClubPost {
  post_id: string;
  club_id: string;
  author_id: string;
  body: string;
  week_start: string;
  created_at: string;
}

export interface ClubPostReaction {
  post_id: string;
  user_id: string;
  emoji: string;
  created_at: string;
}

export interface UserClub {
  club_id: string;
  creator_id: string;
  name: string;
  category: 'Trail Running' | 'Hiking' | 'Climbing' | 'Other';
  description: string;
  url: string | null;
  status: 'active' | 'hidden';
  created_at: string;
}

export interface UserEvent {
  event_id: string;
  creator_id: string;
  name: string;
  location: string;
  blurb: string;
  scope: 'Local' | 'Worldwide';
  event_date: string | null;
  url: string | null;
  status: 'active' | 'hidden';
  created_at: string;
}

export interface HeightVerification {
  verification_id: string;
  block_id: string;
  user_id: string;
  submitted_height_m: number;
  watch_photo_url: string | null;
  status: 'active' | 'removed';
  created_at: string;
  // Joined fields (from RPC/view)
  display_name?: string;
  verified_count?: number;
}

export type VerificationState = 'estimated' | 'pending' | 'verified' | 'disputed';

export interface BlockVerificationStatus {
  block_id: string;
  storeys: number;
  est_height_m: number;
  height_source: 'estimated' | 'verified';
  verification_count: number;
  dispute_count: number;
  verification_state: VerificationState;
}

export interface BuildingPhoto {
  photo_id: string;
  block_id: string;
  user_id: string;
  storage_path: string;
  photo_type: 'condition' | 'verification' | 'general';
  caption: string | null;
  status: 'active' | 'reported' | 'hidden';
  report_count: number;
  created_at: string;
}

export interface AppNotification {
  notification_id: string;
  user_id: string;
  type: 'verification_corroborated' | 'block_verified' | 'block_disputed' | 'photo_reported' | 'badge_earned' | 'pioneer';
  block_id: string | null;
  message: string;
  read: boolean;
  created_at: string;
}

export interface UserBadge {
  user_id: string;
  badge_key: string;
  earned_at: string;
}

// Badge definitions (client-side — used for display)
export interface BadgeDef {
  key: string;
  name: string;
  description: string;
  category: 'climb' | 'verification' | 'location' | 'pioneer' | 'challenge';
  icon: string; // Ionicons name
  /** Hidden badges render as "???" until earned — a surprise, not a checklist item. */
  hidden?: boolean;
  /** Legendary tier — featuring this badge gives your profile an animated color-cycling background/avatar frame instead of the plain banner. */
  special?: boolean;
  /** Overwatch-style seasonal badge — only counts as "active" while user_badges.earned_at falls within the current calendar month; re-complete the challenge to keep it lit. Expired-but-previously-earned badges still show (greyed) rather than disappearing. */
  resets?: 'monthly';
}

export const BADGE_DEFS: BadgeDef[] = [
  // Climb badges
  { key: 'first_climb', name: 'First Climb', description: 'Log your first climb', category: 'climb', icon: 'footsteps-outline' },
  { key: 'climbs_10', name: '10 Climbs', description: 'Log 10 climbs', category: 'climb', icon: 'trending-up-outline' },
  { key: 'climbs_50', name: '50 Climbs', description: 'Log 50 climbs', category: 'climb', icon: 'flame-outline' },
  { key: 'tall_tower', name: 'Tall Tower', description: 'Climb a 40+ storey block', category: 'climb', icon: 'business-outline' },
  { key: 'century', name: 'Century Club', description: 'Climb 100 floors in a single day', category: 'climb', icon: 'speedometer-outline' },
  { key: 'streak_5', name: '5-Day Streak', description: 'Climb on 5 consecutive days', category: 'climb', icon: 'calendar-outline' },
  { key: 'streak_30', name: '30-Day Streak', description: 'Climb on 30 consecutive days', category: 'climb', icon: 'calendar-outline' },

  // Verification badges
  { key: 'verified_1', name: 'Verified 1', description: 'Verify 1 building height', category: 'verification', icon: 'checkmark-circle-outline' },
  { key: 'verified_5', name: 'Verified 5', description: 'Verify 5 building heights', category: 'verification', icon: 'checkmark-done-outline' },
  { key: 'verified_10', name: 'Verified 10', description: 'Verify 10 building heights', category: 'verification', icon: 'ribbon-outline' },

  // Location badges (dynamic keys: 'town_explorer_{town}' and 'town_collector')
  { key: 'town_explorer', name: 'Town Explorer', description: 'Climb 5 blocks in a single town', category: 'location', icon: 'navigate-outline' },
  { key: 'town_collector', name: 'Town Collector', description: 'Climb in 10 different towns', category: 'location', icon: 'compass-outline' },

  // Pioneer badges — first person to ever log a climb at a given block
  { key: 'pioneer_1', name: 'Pioneer', description: 'Be the first to climb a building', category: 'pioneer', icon: 'flag-outline' },
  { key: 'pioneer_5', name: 'Trailblazer', description: 'Be the first to climb 5 buildings', category: 'pioneer', icon: 'flag' },
  { key: 'pioneer_10', name: 'Frontiersman', description: 'Be the first to climb 10 buildings', category: 'pioneer', icon: 'trophy-outline' },

  // Hidden badges — not shown until earned, discovered rather than chased
  { key: 'night_owl', name: 'Night Owl', description: 'Log a climb between midnight and 5am', category: 'climb', icon: 'moon-outline', hidden: true },
  { key: 'early_bird', name: 'Early Bird', description: 'Log a climb before 7am', category: 'climb', icon: 'sunny-outline', hidden: true },
  { key: 'century_sprint', name: 'Century Sprint', description: '40+ floors in a single climb', category: 'climb', icon: 'flash-outline', hidden: true },
  { key: 'weekend_warrior', name: 'Weekend Warrior', description: 'Climb on both Saturday and Sunday', category: 'climb', icon: 'calendar-number-outline', hidden: true },

  // Challenge badges — earned only by signing up for and completing a
  // time-boxed challenge (Groups tab), never by just hitting a passive
  // condition the way the badges above do.
  { key: 'century_sprint_challenge', name: 'HDB Elevation Badge I', description: 'Climb this month\'s lightest HDB elevation target', category: 'challenge', icon: 'trending-up-outline', resets: 'monthly' },
  { key: 'elevation_chaser_challenge', name: 'HDB Elevation Badge II', description: 'Climb this month\'s medium HDB elevation target', category: 'challenge', icon: 'trending-up-outline', resets: 'monthly' },
  { key: 'iron_legs_challenge', name: 'HDB Elevation Badge III', description: 'Climb this month\'s high HDB elevation target', category: 'challenge', icon: 'trending-up-outline', resets: 'monthly' },
  { key: 'everest_gauntlet_challenge', name: 'Everest Gauntlet Survivor', description: 'Climbed the height of Mount Everest in a single week', category: 'challenge', icon: 'trophy', special: true },
  { key: 'long_haul_challenge', name: 'HDB Elevation Badge IV', description: 'Climb this month\'s toughest HDB elevation target', category: 'challenge', icon: 'trending-up-outline', resets: 'monthly' },
  { key: 'sg61_countdown_challenge', name: 'SG61 Climber', description: 'Completed the SG61 Countdown Climb', category: 'challenge', icon: 'flag-outline' },
  { key: 'midyear_momentum_challenge', name: 'Momentum Badge', description: 'Completed the Mid-Year Momentum challenge', category: 'challenge', icon: 'rocket-outline' },
  { key: 'double_eightthousander_challenge', name: 'Double Eight-Thousander', description: 'Climbed the combined height of Everest and K2 in a single week', category: 'challenge', icon: 'trophy', special: true },
];
