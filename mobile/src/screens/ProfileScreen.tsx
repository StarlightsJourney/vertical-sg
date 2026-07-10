import { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Alert,
  Animated,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../config/supabase';
import storage from '../utils/storage';
import MascotAvatar from '../components/MascotAvatar';
import { avatarUriFor } from '../utils/avatarUri';
import BadgeDetailModal from '../components/BadgeDetailModal';
import SettingsModal from '../components/SettingsModal';
import StatCard from '../components/StatCard';
import { StatCell, GridDivider } from '../components/StatGrid';
import RadialProgress from '../components/RadialProgress';
import TrendSparkline from '../components/TrendSparkline';
import MedalBadge, { medalEmblemFor } from '../components/MedalBadge';
import { computeXP, computeLevelProgress } from '../utils/leveling';
import type { ClimbLog, UserBadge, Profile, BadgeDef } from '../types';
import { BADGE_DEFS } from '../types';
import AuthPrompt from '../components/AuthPrompt';

// This screen commits to exactly one accent color, used purposefully (progress
// fills, the trend line, active-state chrome, the level chip) instead of a
// different tint per card. It's the app's existing primary blue, reused here
// for consistency with the rest of the app rather than inventing a new hue.
const ACCENT = '#2563EB';

const DAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function formatClimbDateTime(iso: string): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `${date}, ${time}`;
}

/** Monday-aligned start of the week containing `d`. */
function mondayOfWeek(d: Date): Date {
  const monday = new Date(d);
  const day = monday.getDay(); // 0 = Sunday
  monday.setDate(monday.getDate() + (day === 0 ? -6 : 1 - day));
  monday.setHours(0, 0, 0, 0);
  return monday;
}

/** Consecutive calendar weeks (Mon–Sun), counting back from this week, with at least one climb. */
function computeWeeklyStreak(isoDates: string[]): number {
  const weekKeys = new Set(isoDates.map((d) => mondayOfWeek(new Date(d)).getTime()));
  let streak = 0;
  const cursor = mondayOfWeek(new Date());
  while (weekKeys.has(cursor.getTime())) {
    streak++;
    cursor.setDate(cursor.getDate() - 7);
  }
  return streak;
}

/** Consecutive calendar months, counting back from this month, with at least one climb. */
function computeMonthlyStreak(isoDates: string[]): number {
  const monthKeys = new Set(isoDates.map((d) => {
    const dt = new Date(d);
    return dt.getFullYear() * 12 + dt.getMonth();
  }));
  const now = new Date();
  let streak = 0;
  let cursor = now.getFullYear() * 12 + now.getMonth();
  while (monthKeys.has(cursor)) {
    streak++;
    cursor--;
  }
  return streak;
}

/** Floors climbed per day for the last 7 days (oldest first, today last). */
function computeDailyFloors(climbs: { climbedAt: string; floors: number }[]): number[] {
  const days: number[] = new Array(7).fill(0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (const c of climbs) {
    const d = new Date(c.climbedAt);
    d.setHours(0, 0, 0, 0);
    const diffDays = Math.round((today.getTime() - d.getTime()) / 86400000);
    if (diffDays >= 0 && diffDays < 7) {
      days[6 - diffDays] += c.floors;
    }
  }
  return days;
}

function getTierColor(storeys: number): string {
  if (storeys <= 10) return '#4A90D9';
  if (storeys <= 20) return '#FF9500';
  if (storeys <= 30) return '#FF3B30';
  if (storeys <= 39) return '#8B0000';
  return '#7C3AED';
}

// The four "resets: monthly" HDB Elevation badges are deliberately meant to
// read as tiers of one family (same medal emblem, via medalEmblemFor's
// `generic` flag) rather than unique achievements — only the shade shifts,
// lightest target to toughest, like Overwatch season-tier rings.
const MONTHLY_BADGE_TIER_COLORS: Record<string, string> = {
  century_sprint_challenge: '#93C5FD',
  elevation_chaser_challenge: '#60A5FA',
  iron_legs_challenge: '#3B82F6',
  long_haul_challenge: '#1D4ED8',
};

/** Medal color for a challenge-category badge — special (legendary) badges get gold,
 * monthly-resetting badges get their tier shade, everything else a plain blue. */
function medalColorFor(def: BadgeDef): string {
  if (def.special) return '#F59E0B';
  if (def.resets === 'monthly') return MONTHLY_BADGE_TIER_COLORS[def.key] ?? '#3B82F6';
  return '#2563EB';
}

/** Floors climbed per week for the last N weeks (oldest first, this week last). */
function computeWeeklyBuckets(climbs: { climbedAt: string; floors: number }[], weeks: number): number[] {
  const buckets: number[] = new Array(weeks).fill(0);
  const now = Date.now();
  for (const c of climbs) {
    const diffDays = Math.floor((now - new Date(c.climbedAt).getTime()) / 86400000);
    const weekIdx = Math.floor(diffDays / 7); // 0 = this week, 1 = last week, ...
    if (weekIdx >= 0 && weekIdx < weeks) buckets[weeks - 1 - weekIdx] += c.floors;
  }
  return buckets;
}

/** Longest run of *consecutive* Mon–Sun weeks with at least one climb, anywhere
 * in the history — unlike computeWeeklyStreak this isn't anchored to "now", so
 * a streak from three months ago still counts as a personal record. */
function computeLongestWeeklyStreak(isoDates: string[]): number {
  if (isoDates.length === 0) return 0;
  const weekKeys = Array.from(new Set(isoDates.map((d) => mondayOfWeek(new Date(d)).getTime()))).sort((a, b) => a - b);
  let longest = 1;
  let current = 1;
  for (let i = 1; i < weekKeys.length; i++) {
    const weeksApart = Math.round((weekKeys[i] - weekKeys[i - 1]) / (7 * 86400000));
    current = weeksApart === 1 ? current + 1 : 1;
    longest = Math.max(longest, current);
  }
  return longest;
}

/** Most floors ever climbed in a single calendar day, for the "best day" record. */
function computeBestDayFloors(climbs: { climbedAt: string; floors: number }[]): { floors: number; dateLabel: string } | null {
  if (climbs.length === 0) return null;
  const totals = new Map<string, number>();
  for (const c of climbs) {
    const d = new Date(c.climbedAt);
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    totals.set(key, (totals.get(key) ?? 0) + c.floors);
  }
  let bestKey = '';
  let bestFloors = -1;
  for (const [key, floors] of totals) {
    if (floors > bestFloors) { bestFloors = floors; bestKey = key; }
  }
  const [y, m, day] = bestKey.split('-').map(Number);
  const dateLabel = new Date(y, m, day).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return { floors: bestFloors, dateLabel };
}

/** The most-climbed building (mode of blk_no+street), for the "favorite building" record. */
function computeFavoriteBuilding(climbs: { blk_no: string; street: string }[]): { label: string; count: number } | null {
  const counts = new Map<string, { label: string; count: number }>();
  for (const c of climbs) {
    if (!c.blk_no) continue;
    const key = `${c.blk_no}|${c.street}`;
    const existing = counts.get(key);
    if (existing) existing.count++;
    else counts.set(key, { label: `Blk ${c.blk_no} ${c.street}`, count: 1 });
  }
  let best: { label: string; count: number } | null = null;
  for (const entry of counts.values()) {
    if (!best || entry.count > best.count) best = entry;
  }
  return best;
}

/** Calendar-month bucket key (not a rolling 30-day window) — used to compare "this month" vs "last month" like-for-like. */
function calendarMonthKey(d: Date): number {
  return d.getFullYear() * 12 + d.getMonth();
}

function formatDuration(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const mins = Math.floor((totalSeconds % 3600) / 60);
  if (hours === 0) return `${mins}m`;
  return `${hours}h ${mins}m`;
}

// Discord-Nitro-style animated color cycle for legendary featured badges
// (e.g. the Everest Gauntlet) — the profile banner and avatar frame shift
// through this palette on a loop instead of sitting on a plain color.
const LEGENDARY_PALETTE = ['#7C3AED', '#DB2777', '#EA580C', '#CA8A04', '#16A34A', '#0891B2', '#2563EB', '#7C3AED'];

function useCyclingColor(colors: string[], stepMs: number, active: boolean) {
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!active) return;
    progress.setValue(0);
    const loop = Animated.loop(
      Animated.timing(progress, { toValue: colors.length - 1, duration: stepMs * (colors.length - 1), useNativeDriver: false }),
    );
    loop.start();
    return () => loop.stop();
  }, [active]);

  return progress.interpolate({ inputRange: colors.map((_, i) => i), outputRange: colors });
}

/** Minimal flat-bar chart — plain Views, no chart library, no gradient. The
 *  current period's bar is solid accent color; every other bar is plain
 *  neutral gray, so the one thing that stands out is exactly the one thing
 *  that should. Used for both the weekly (day-by-day) and monthly (week-by-week) views. */
function BarChart({ values, labels, highlightIndex, isDark }: { values: number[]; labels: string[]; highlightIndex: number; isDark: boolean }) {
  const max = Math.max(1, ...values);

  return (
    <View style={c.chartWrap}>
      {values.map((val, i) => {
        const isHighlight = i === highlightIndex;
        const heightPct = val === 0 ? 0.03 : Math.max(0.06, val / max);
        return (
          <View key={i} style={c.barCol}>
            <Text style={[c.barValue, isDark && { color: '#9CA3AF' }, val === 0 && { opacity: 0 }]}>{val}</Text>
            <View style={c.barTrack}>
              <View
                style={[
                  c.bar,
                  { height: `${heightPct * 100}%` },
                  isHighlight
                    ? { backgroundColor: ACCENT }
                    : { backgroundColor: isDark ? '#374151' : '#E5E7EB' },
                ]}
              />
            </View>
            <Text style={[c.barLabel, isHighlight && { color: ACCENT, fontWeight: '700' }, isDark && !isHighlight && { color: '#6B7280' }]}>
              {labels[i]}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

const c = StyleSheet.create({
  chartWrap: { flexDirection: 'row', height: 120, alignItems: 'flex-end', gap: 6, marginTop: 4 },
  barCol: { flex: 1, alignItems: 'center', height: '100%', justifyContent: 'flex-end' },
  barValue: { fontSize: 10, fontWeight: '700', color: '#9CA3AF', marginBottom: 3 },
  barTrack: { width: '100%', flex: 1, justifyContent: 'flex-end' },
  bar: { width: '100%', borderRadius: 4, minHeight: 3 },
  barLabel: { fontSize: 11, fontWeight: '600', color: '#9CA3AF', marginTop: 6 },
});

interface ProfileScreenProps {
  isDark?: boolean;
  themeMode?: 'light' | 'dark' | 'auto';
  onSetThemeMode?: (mode: 'light' | 'dark' | 'auto') => void;
  isActive?: boolean;
}

export default function ProfileScreen({ isDark = false, themeMode = 'auto', onSetThemeMode, isActive }: ProfileScreenProps) {
  const { user, isAnonymous, loading: authLoading } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [editingHandle, setEditingHandle] = useState(false);
  const [handleInput, setHandleInput] = useState('');
  const [climbHistory, setClimbHistory] = useState<ClimbLog[]>([]);
  const [badges, setBadges] = useState<UserBadge[]>([]);
  const [climbStats, setClimbStats] = useState({ climbs: 0, floors: 0, tallest: 0, durationSeconds: 0 });
  const [weeklyStreak, setWeeklyStreak] = useState(0);
  const [monthlyStreak, setMonthlyStreak] = useState(0);
  const [dailyFloors, setDailyFloors] = useState<number[]>(new Array(7).fill(0));
  const [weeklyGoal, setWeeklyGoal] = useState<number | null>(null);
  const [viewPeriod, setViewPeriod] = useState<'week' | 'month'>('week');
  const [verifiedCount, setVerifiedCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [authPromptVisible, setAuthPromptVisible] = useState(false);
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [profileTab, setProfileTab] = useState<'overview' | 'climbs'>('overview');
  const [selectedBadge, setSelectedBadge] = useState<BadgeDef | null>(null);

  const loadData = useCallback(async () => {
    // Weekly goal from onboarding, if it was ever set
    const onboardingRaw = await storage.getItem('onboarding_profile');
    if (onboardingRaw) {
      try { setWeeklyGoal(JSON.parse(onboardingRaw).weeklyGoal ?? null); } catch {}
    }

    if (!user) {
      // Fall back to local AsyncStorage for anonymous users
      const history = await storage.getClimbHistory();
      setClimbHistory(history);
      const floors = history.reduce((s, c) => s + c.floors, 0);
      const tallest = history.reduce((m, c) => Math.max(m, c.storeys), 0);
      setClimbStats({ climbs: history.length, floors, tallest, durationSeconds: 0 });
      setWeeklyStreak(computeWeeklyStreak(history.map((c) => c.climbedAt)));
      setMonthlyStreak(computeMonthlyStreak(history.map((c) => c.climbedAt)));
      setDailyFloors(computeDailyFloors(history.map((c) => ({ climbedAt: c.climbedAt, floors: c.floors }))));
      setLoading(false);
      return;
    }

    try {
      // All four are independent — firing them in parallel instead of one
      // after another cut the initial load (and every tab-refocus reload)
      // from 4 sequential round trips down to the slowest single one.
      const [{ data: profileData }, { data: climbs }, { data: badgeData }, { count }] = await Promise.all([
        supabase.from('profiles').select('*').eq('user_id', user.id).maybeSingle(),
        supabase.from('climbs').select('*, blocks(blk_no, street)').eq('user_id', user.id).order('created_at', { ascending: false }).limit(500),
        supabase.from('user_badges').select('*').eq('user_id', user.id),
        supabase.from('height_verifications').select('*', { count: 'exact', head: true }).eq('user_id', user.id).eq('status', 'active'),
      ]);

      if (profileData) {
        setProfile(profileData as Profile);
        setHandleInput(profileData.display_name);
      }

      if (climbs) {
        // Approximate the building's storey count (for tier coloring) by
        // backing out the partial floors before dividing by full-set qty.
        const storeysOf = (c: any) =>
          c.climb_qty > 0
            ? Math.round((c.floors_climbed - (c.partial_floors ?? 0)) / c.climb_qty)
            : c.floors_climbed;

        const history: ClimbLog[] = climbs.map((c: any) => ({
          climb_id: c.climb_id,
          block_id: c.block_id,
          blk_no: c.blocks?.blk_no ?? '',
          street: c.blocks?.street ?? '',
          storeys: storeysOf(c),
          floors: c.floors_climbed,
          climbedAt: c.created_at,
          durationSeconds: c.duration_seconds ?? undefined,
        }));
        setClimbHistory(history);
        const floors = climbs.reduce((s: number, c: any) => s + c.floors_climbed, 0);
        const tallest = climbs.reduce((m: number, c: any) => Math.max(m, storeysOf(c)), 0);
        const durationSeconds = climbs.reduce((s: number, c: any) => s + (c.duration_seconds ?? 0), 0);
        setClimbStats({ climbs: climbs.length, floors, tallest, durationSeconds });
        setWeeklyStreak(computeWeeklyStreak(climbs.map((c: any) => c.created_at)));
        setMonthlyStreak(computeMonthlyStreak(climbs.map((c: any) => c.created_at)));
        setDailyFloors(computeDailyFloors(climbs.map((c: any) => ({ climbedAt: c.created_at, floors: c.floors_climbed }))));
      }

      if (badgeData) setBadges(badgeData as UserBadge[]);
      setVerifiedCount(count ?? 0);
    } catch (err) {
      console.error('Error loading profile data:', err);
    }

    setLoading(false);
  }, [user]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Tabs stay mounted (hidden, not unmounted) after the first visit, so
  // without this a climb logged on Map wouldn't show up here until the app
  // fully reloaded — refetch every time this tab becomes the active one.
  // loadData doesn't flip `loading` back to true, so this is a silent
  // background refresh, not a spinner flash.
  useEffect(() => {
    if (isActive) loadData();
  }, [isActive, loadData]);

  const handleChangeSkin = async (idx: number) => {
    if (!user || !profile) return;
    // Picking a mascot skin is an explicit "use the mascot, not my photo" —
    // clear any uploaded photo so it doesn't keep taking priority everywhere.
    setProfile({ ...profile, avatar_idx: idx, avatar_photo_path: null }); // optimistic
    await supabase.from('profiles').update({ avatar_idx: idx, avatar_photo_path: null }).eq('user_id', user.id);
  };

  const handlePhotoChanged = (path: string | null) => {
    setProfile((p) => (p ? { ...p, avatar_photo_path: path } : p));
  };

  const handleDeleteClimb = (climb: ClimbLog, index: number) => {
    Alert.alert('Delete this climb?', 'This removes it from your stats and history. This can\'t be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          const next = climbHistory.filter((_, i) => i !== index);
          setClimbHistory(next);
          setClimbStats({
            climbs: next.length,
            floors: next.reduce((s, c) => s + c.floors, 0),
            tallest: next.reduce((m, c) => Math.max(m, c.storeys), 0),
            durationSeconds: next.reduce((s, c) => s + (c.durationSeconds ?? 0), 0),
          });
          setWeeklyStreak(computeWeeklyStreak(next.map((c) => c.climbedAt)));
          setMonthlyStreak(computeMonthlyStreak(next.map((c) => c.climbedAt)));
          setDailyFloors(computeDailyFloors(next.map((c) => ({ climbedAt: c.climbedAt, floors: c.floors }))));

          if (climb.climb_id && user) {
            await supabase.from('climbs').delete().eq('climb_id', climb.climb_id).eq('user_id', user.id);
          } else {
            // Local-only climb (no climb_id) — could be a rare pre-auth-bootstrap
            // read, or an offline-queued entry. Key off climb_id, not `user`,
            // so it's still cleaned out of AsyncStorage even once `user` is set.
            // addClimb unshifts, so replay oldest-first to preserve newest-first order.
            await storage.clearClimbHistory();
            for (const c of [...next].reverse()) await storage.addClimb(c);
          }
        },
      },
    ]);
  };

  const handleSaveHandle = async () => {
    if (!user || !handleInput.trim()) { setEditingHandle(false); return; }
    setEditingHandle(false);
    setProfile((p) => (p ? { ...p, display_name: handleInput.trim() } : p));
    await supabase.from('profiles').update({ display_name: handleInput.trim() }).eq('user_id', user.id);
  };

  const handleSetFeatured = async (badgeKey: string) => {
    if (!user) return;
    const next = profile?.featured_badge === badgeKey ? null : badgeKey;
    setProfile((p) => (p ? { ...p, featured_badge: next } : p));
    await supabase.from('profiles').update({ featured_badge: next }).eq('user_id', user.id);
  };

  const earnedBadges = new Map(badges.map((b) => [b.badge_key, b.earned_at]));
  const weeklyFloors = dailyFloors.reduce((s, v) => s + v, 0);
  const weeklyClimbTotal = climbHistory.filter((c) => {
    const d = new Date(c.climbedAt);
    return Date.now() - d.getTime() < 7 * 86400000;
  }).length;
  const monthlyClimbs = climbHistory.filter((c) => Date.now() - new Date(c.climbedAt).getTime() < 30 * 86400000);
  const monthlyFloors = monthlyClimbs.reduce((s, c) => s + c.floors, 0);
  const monthlyClimbTotal = monthlyClimbs.length;
  const weekdayLabels = Array.from({ length: 7 }, (_, i) => DAY_LABELS[(new Date().getDay() - 6 + i + 7) % 7]);
  const monthlyBuckets = computeWeeklyBuckets(climbHistory.map((c) => ({ climbedAt: c.climbedAt, floors: c.floors })), 4);

  // --- Personal records + trend analytics — all derived client-side from the
  // climb history already fetched above, no extra queries. ---
  const hasClimbs = climbHistory.length > 0;
  const bestClimbFloors = hasClimbs ? Math.max(...climbHistory.map((c) => c.floors)) : 0;
  const longestWeeklyStreak = computeLongestWeeklyStreak(climbHistory.map((c) => c.climbedAt));
  const bestDay = computeBestDayFloors(climbHistory.map((c) => ({ climbedAt: c.climbedAt, floors: c.floors })));
  const favoriteBuilding = computeFavoriteBuilding(climbHistory);

  const trendWeeks = computeWeeklyBuckets(climbHistory.map((c) => ({ climbedAt: c.climbedAt, floors: c.floors })), 8);
  const hasTrendData = trendWeeks.some((v) => v > 0);

  const thisMonthKey = calendarMonthKey(new Date());
  const thisMonthFloors = climbHistory
    .filter((c) => calendarMonthKey(new Date(c.climbedAt)) === thisMonthKey)
    .reduce((s, c) => s + c.floors, 0);
  const lastMonthFloors = climbHistory
    .filter((c) => calendarMonthKey(new Date(c.climbedAt)) === thisMonthKey - 1)
    .reduce((s, c) => s + c.floors, 0);
  const monthDelta = thisMonthFloors - lastMonthFloors;
  const monthDeltaPct = lastMonthFloors > 0
    ? Math.round((monthDelta / lastMonthFloors) * 100)
    : (thisMonthFloors > 0 ? 100 : 0);

  const xp = computeXP(climbStats.floors, badges.length, verifiedCount);
  const levelInfo = computeLevelProgress(xp);
  const featuredBadgeDef = profile?.featured_badge ? BADGE_DEFS.find((d) => d.key === profile.featured_badge) : null;
  const isLegendary = !!featuredBadgeDef?.special;
  const legendaryColor = useCyclingColor(LEGENDARY_PALETTE, 1400, isLegendary);

  if (authLoading || loading) {
    return (
      <View style={[s.container, isDark && { backgroundColor: '#111827' }, s.centerContent]}>
        <ActivityIndicator size="large" color="#2563EB" />
      </View>
    );
  }

  // Anonymous users can still see their own climb history and stats (climbs
  // are already tied to their anonymous id in Supabase) — sign-in is only
  // needed for things that inherently require an account: syncing across
  // devices, verification credit, and badges.
  return (
    <View style={[s.container, isDark && { backgroundColor: '#111827' }]}>
      <ScrollView
        style={s.scroll}
        contentContainerStyle={s.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Header band with avatar overlapping the bottom edge — a flat, single
            near-black neutral rather than a purple/blue gradient, so the one
            accent color is left free to do real work further down the screen.
            A legendary featured badge (e.g. Everest Gauntlet) is the one
            deliberate exception: it earns an animated cycling color,
            Discord-Nitro-style, as a reward moment rather than a default look. */}
        {isLegendary ? (
          <Animated.View style={[s.banner, { backgroundColor: legendaryColor }]}>
            <LinearGradient
              colors={['rgba(255,255,255,0.22)', 'rgba(0,0,0,0.28)']}
              style={StyleSheet.absoluteFill}
            />
            <TouchableOpacity style={s.bannerSettingsBtn} onPress={() => setSettingsVisible(true)} activeOpacity={0.7} hitSlop={8}>
              <Ionicons name="settings-outline" size={22} color="#FFFFFF" />
            </TouchableOpacity>
          </Animated.View>
        ) : (
          <View style={[s.banner, isDark && { backgroundColor: '#1F2937' }]}>
            <TouchableOpacity style={s.bannerSettingsBtn} onPress={() => setSettingsVisible(true)} activeOpacity={0.7} hitSlop={8}>
              <Ionicons name="settings-outline" size={22} color="#FFFFFF" />
            </TouchableOpacity>
          </View>
        )}

        {/* Profile header */}
        <View style={s.header}>
          <TouchableOpacity
            style={s.avatarTouchable}
            onPress={() => setSettingsVisible(true)}
            activeOpacity={0.7}
          >
            <Animated.View style={[s.avatarFrame, { borderColor: isDark ? '#111827' : '#F9FAFB' }, isLegendary && { borderColor: legendaryColor }]}>
              <MascotAvatar skinIdx={profile?.avatar_idx ?? 0} photoUri={avatarUriFor(profile)} size={72} />
            </Animated.View>
            <View style={s.avatarEditBadge}>
              <Ionicons name="settings-outline" size={13} color="#FFF" />
            </View>
            {!isAnonymous && (
              <View style={s.levelChip}>
                <Text style={s.levelChipText}>Lv {levelInfo.level}</Text>
              </View>
            )}
          </TouchableOpacity>

          {editingHandle ? (
            <View style={s.handleEditRow}>
              <TextInput
                style={[s.handleInput, isDark && { color: '#F9FAFB', borderBottomColor: '#374151' }]}
                value={handleInput}
                onChangeText={setHandleInput}
                maxLength={20}
                autoFocus
                onSubmitEditing={handleSaveHandle}
              />
              <TouchableOpacity onPress={handleSaveHandle}>
                <Ionicons name="checkmark-circle" size={24} color="#10B981" />
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity
              style={s.displayNameRow}
              onPress={() => !isAnonymous && setEditingHandle(true)}
              disabled={isAnonymous}
            >
              {featuredBadgeDef && (
                <Ionicons name={featuredBadgeDef.icon as any} size={17} color="#D97706" style={{ marginRight: 6 }} />
              )}
              <Text style={[s.displayName, isDark && { color: '#F9FAFB' }]}>
                {isAnonymous ? 'Guest Climber' : (profile?.display_name ?? 'Climber')}
              </Text>
              {!isAnonymous && <Ionicons name="pencil" size={13} color="#9CA3AF" style={{ marginLeft: 6 }} />}
            </TouchableOpacity>
          )}

          <Text style={[s.email, isDark && { color: '#9CA3AF' }]}>
            {isAnonymous ? 'Not signed in' : (user?.email ?? '')}
          </Text>

          {!isAnonymous && (
            <View style={s.xpBlock}>
              <View style={s.xpTrack}>
                <View style={[s.xpFill, { width: `${levelInfo.progressPct}%` }]} />
              </View>
              <Text style={s.xpLabel}>{levelInfo.xpIntoLevel} / {levelInfo.xpForNextLevel} XP to Level {levelInfo.level + 1}</Text>
            </View>
          )}

          {verifiedCount > 0 && (
            <View style={s.verifiedBadge}>
              <Ionicons name="checkmark-circle" size={14} color="#10B981" />
              <Text style={s.verifiedText}>{verifiedCount} building{verifiedCount > 1 ? 's' : ''} verified</Text>
            </View>
          )}
        </View>

        {/* Soft sign-in nudge for anonymous users — climbs already work without
            an account, this is just for syncing across devices + badges/verification */}
        {isAnonymous && (
          <TouchableOpacity
            style={[s.signInBanner, isDark && { backgroundColor: '#1F2937', borderColor: 'rgba(37,99,235,0.35)' }]}
            onPress={() => setAuthPromptVisible(true)}
            activeOpacity={0.8}
          >
            <Ionicons name="cloud-upload-outline" size={20} color="#2563EB" />
            <Text style={[s.signInBannerText, isDark && { color: '#D1D5DB' }]}>
              Sign in to sync across devices, earn badges, and verify buildings
            </Text>
            <Ionicons name="chevron-forward" size={16} color="#2563EB" />
          </TouchableOpacity>
        )}

        {/* Overview / Climbs sub-navigation */}
        <View style={[s.tabBar, isDark && { backgroundColor: '#1F2937' }]}>
          {(['overview', 'climbs'] as const).map((t) => (
            <TouchableOpacity
              key={t}
              style={[s.tabBtn, profileTab === t && s.tabBtnActive, profileTab === t && isDark && { backgroundColor: '#374151' }]}
              onPress={() => setProfileTab(t)}
            >
              <Text style={[s.tabBtnText, profileTab === t && s.tabBtnTextActive, isDark && { color: profileTab === t ? '#F9FAFB' : '#9CA3AF' }]}>
                {t === 'overview' ? 'Overview' : `Climbs (${climbStats.climbs})`}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {profileTab === 'overview' && (
          <>
            {/* Hero numbers, up top — the single most useful figure (floors this
                period) rendered huge, with the day/week bar chart and weekly-goal
                ring right underneath. Everything here uses the one accent color. */}
            <View style={s.section}>
              <View style={s.sectionHeaderRow}>
                <Text style={[s.sectionTitle, { marginBottom: 0 }, isDark && { color: '#D1D5DB' }]}>
                  {viewPeriod === 'week' ? 'Your Week' : 'Your Month'}
                </Text>
                <View style={[s.periodToggle, isDark && { backgroundColor: '#111827' }]}>
                  {(['week', 'month'] as const).map((p) => (
                    <TouchableOpacity
                      key={p}
                      style={[s.periodToggleBtn, viewPeriod === p && s.periodToggleBtnActive, viewPeriod === p && isDark && { backgroundColor: '#374151' }]}
                      onPress={() => setViewPeriod(p)}
                    >
                      <Text style={[s.periodToggleText, viewPeriod === p && s.periodToggleTextActive, isDark && { color: viewPeriod === p ? '#F9FAFB' : '#9CA3AF' }]}>
                        {p === 'week' ? 'Week' : 'Month'}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
              <View style={[s.card, isDark && s.cardDark]}>
                <View style={s.weekStatsRow}>
                  <Text style={[s.heroNumber, isDark && { color: '#F9FAFB' }]}>
                    {viewPeriod === 'week' ? weeklyFloors : monthlyFloors}
                  </Text>
                  <Text style={[s.heroLabel, isDark && { color: '#9CA3AF' }]}>
                    floors this {viewPeriod} · {viewPeriod === 'week' ? weeklyClimbTotal : monthlyClimbTotal} climbs
                  </Text>
                </View>
                {viewPeriod === 'week' ? (
                  <BarChart values={dailyFloors} labels={weekdayLabels} highlightIndex={6} isDark={isDark} />
                ) : (
                  <BarChart values={monthlyBuckets} labels={['3wk ago', '2wk ago', 'Last wk', 'This wk']} highlightIndex={3} isDark={isDark} />
                )}

                {viewPeriod === 'week' && weeklyGoal != null && (
                  <View style={s.goalBlock}>
                    <View style={s.goalRingRow}>
                      <RadialProgress
                        progress={weeklyFloors / weeklyGoal}
                        size={64}
                        strokeWidth={7}
                        color={ACCENT}
                        trackColor={isDark ? '#374151' : '#E5E7EB'}
                      >
                        <Text style={[s.goalRingPct, isDark && { color: '#F9FAFB' }]}>
                          {Math.min(100, Math.round((weeklyFloors / weeklyGoal) * 100))}%
                        </Text>
                      </RadialProgress>
                      <View style={s.goalRingText}>
                        <Text style={[s.goalLabel, isDark && { color: '#9CA3AF' }]}>Weekly goal</Text>
                        <Text style={[s.goalValue, isDark && { color: '#F9FAFB' }]}>{weeklyFloors} / {weeklyGoal} floors</Text>
                      </View>
                    </View>
                  </View>
                )}
              </View>
            </View>

            {/* 8-week trend — a real line chart (gridlines, one accent line, faint
                area fill), not a decorative sparkline blob, plus a this-month-vs-
                last-month delta chip. Both derived client-side from the same climb
                history already loaded above (no extra queries). */}
            <View style={s.section}>
              <View style={s.sectionHeaderRow}>
                <Text style={[s.sectionTitle, { marginBottom: 0 }, isDark && { color: '#D1D5DB' }]}>8-Week Trend</Text>
                {hasTrendData && (thisMonthFloors > 0 || lastMonthFloors > 0) && (
                  <View style={[
                    s.deltaPill,
                    monthDelta > 0 && { backgroundColor: 'rgba(16,185,129,0.12)' },
                    monthDelta < 0 && { backgroundColor: 'rgba(239,68,68,0.12)' },
                    monthDelta === 0 && { backgroundColor: isDark ? '#374151' : '#F3F4F6' },
                  ]}>
                    <Ionicons
                      name={monthDelta > 0 ? 'arrow-up' : monthDelta < 0 ? 'arrow-down' : 'remove'}
                      size={12}
                      color={monthDelta > 0 ? '#10B981' : monthDelta < 0 ? '#EF4444' : (isDark ? '#9CA3AF' : '#6B7280')}
                    />
                    <Text style={[
                      s.deltaPillText,
                      { color: monthDelta > 0 ? '#10B981' : monthDelta < 0 ? '#EF4444' : (isDark ? '#9CA3AF' : '#6B7280') },
                    ]}>
                      {monthDelta === 0 ? 'flat vs last mo.' : `${Math.abs(monthDeltaPct)}% vs last mo.`}
                    </Text>
                  </View>
                )}
              </View>
              <View style={[s.card, isDark && s.cardDark]}>
                {hasTrendData ? (
                  <>
                    <TrendSparkline values={trendWeeks} color={ACCENT} isDark={isDark} height={120} />
                    <View style={s.trendAxisRow}>
                      <Text style={[s.trendAxisLabel, isDark && { color: '#4B5563' }]}>8 wks ago</Text>
                      <Text style={[s.trendAxisLabel, isDark && { color: '#4B5563' }]}>This week</Text>
                    </View>
                  </>
                ) : (
                  <View style={s.emptyState}>
                    <Ionicons name="analytics-outline" size={32} color={isDark ? '#4B5563' : '#D1D5DB'} />
                    <Text style={[s.emptyText, isDark && { color: '#9CA3AF' }]}>
                      Log climbs across a few weeks to see your trend.
                    </Text>
                  </View>
                )}
              </View>
            </View>

            {/* Totals — one dense grid instead of five separately-tinted tiles.
                A hero triplet (climbs/floors/tallest) up top, secondary metrics
                below, both separated by hairlines rather than color. */}
            <View style={s.section}>
              <Text style={[s.sectionTitle, isDark && { color: '#D1D5DB' }]}>Totals</Text>
              <View style={[s.card, isDark && s.cardDark]}>
                <View style={s.heroStatsRow}>
                  <StatCell value={climbStats.climbs} label="Climbs" isDark={isDark} size="lg" />
                  <GridDivider isDark={isDark} />
                  <StatCell value={climbStats.floors} label="Floors" isDark={isDark} size="lg" />
                  <GridDivider isDark={isDark} />
                  <StatCell value={climbStats.tallest > 0 ? climbStats.tallest : '—'} label="Tallest" isDark={isDark} size="lg" />
                </View>
                <GridDivider isDark={isDark} horizontal />
                <View style={s.secondaryStatsRow}>
                  <StatCell value={`${Math.round(climbStats.floors * 2.8)}m`} label="Elevation" isDark={isDark} />
                  <GridDivider isDark={isDark} />
                  <StatCell value={climbStats.durationSeconds > 0 ? formatDuration(climbStats.durationSeconds) : '—'} label="Time" isDark={isDark} />
                </View>
                <GridDivider isDark={isDark} horizontal />
                <View style={s.secondaryStatsRow}>
                  <StatCell value={weeklyStreak} label="Week streak" isDark={isDark} />
                  <GridDivider isDark={isDark} />
                  <StatCell value={monthlyStreak} label="Month streak" isDark={isDark} />
                </View>
              </View>
            </View>

            {/* Personal records — a Strava-"Records"-style flat list, not four
                more colorful tiles: best/longest/most, all derived from climb history. */}
            <View style={s.section}>
              <Text style={[s.sectionTitle, isDark && { color: '#D1D5DB' }]}>Personal Records</Text>
              {hasClimbs ? (
                <View style={[s.card, s.recordsCard, isDark && s.cardDark]}>
                  <StatCard icon="trophy-outline" value={`${bestClimbFloors} fl`} label="Best single climb" isDark={isDark} />
                  <StatCard icon="ribbon-outline" value={`${longestWeeklyStreak} wk`} label="Longest streak" isDark={isDark} />
                  <StatCard icon="flash-outline" value={bestDay ? `${bestDay.floors} fl` : '—'} label="Best day" caption={bestDay?.dateLabel} isDark={isDark} />
                  <StatCard icon="business-outline" value={favoriteBuilding ? `${favoriteBuilding.count}×` : '—'} label="Favorite building" caption={favoriteBuilding?.label} isDark={isDark} isLast />
                </View>
              ) : (
                <View style={s.emptyState}>
                  <Ionicons name="trophy-outline" size={32} color={isDark ? '#4B5563' : '#D1D5DB'} />
                  <Text style={[s.emptyText, isDark && { color: '#9CA3AF' }]}>
                    Log your first climb to unlock personal records.
                  </Text>
                </View>
              )}
            </View>

            {/* Badges section — same earn/renewal/mystery logic as before; the
                chrome around it is now flat neutral cards with a hairline border
                instead of a colored gradient wash, so the medal/tier colors (which
                carry real meaning) are what actually stands out. */}
            <View style={s.section}>
              <View style={s.sectionHeaderRow}>
                <Text style={[s.sectionTitle, { marginBottom: 0 }, isDark && { color: '#D1D5DB' }]}>Badges</Text>
                <Text style={[s.badgeCount, isDark && { color: '#6B7280' }]}>{badges.length} of {BADGE_DEFS.length} earned</Text>
              </View>
              <View style={[s.badgeProgressTrack, isDark && { backgroundColor: '#374151' }]}>
                <View
                  style={[s.badgeProgressFill, { width: `${BADGE_DEFS.length > 0 ? Math.round((badges.length / BADGE_DEFS.length) * 100) : 0}%`, backgroundColor: ACCENT }]}
                />
              </View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.badgesRow}>
                {BADGE_DEFS.map((def) => {
                  const earnedAt = earnedBadges.get(def.key);
                  const earned = earnedAt !== undefined;
                  // Hidden badges stay a mystery until earned — discovered, not chased.
                  const isMystery = def.hidden && !earned;
                  const isMonthly = def.resets === 'monthly';
                  // Overwatch-style seasonal badge: only "active" while earned_at falls
                  // within the current calendar month. Earned-but-expired badges still
                  // show up (they've genuinely earned it before) but read as dimmed
                  // until the challenge is re-completed this month.
                  const isActiveThisSeason = earned && (!isMonthly || calendarMonthKey(new Date(earnedAt!)) === thisMonthKey);
                  const isRenewalPending = earned && isMonthly && !isActiveThisSeason;
                  const isChallengeMedal = def.category === 'challenge';
                  const medalColor = isRenewalPending ? (isDark ? '#4B5563' : '#B0B7C3') : medalColorFor(def);
                  const emblem = medalEmblemFor(def.icon, def.key, isMonthly);

                  return (
                    <TouchableOpacity key={def.key} onPress={() => setSelectedBadge(def)} activeOpacity={0.7}>
                      {isActiveThisSeason ? (
                        <View
                          style={[
                            s.badgeItem,
                            s.badgeItemEarned,
                            isDark && s.badgeItemEarnedDark,
                            isMonthly && s.badgeItemGlow,
                            isMonthly && { borderColor: medalColor },
                          ]}
                        >
                          {isChallengeMedal ? (
                            <MedalBadge color={medalColor} emblem={emblem} size={34} />
                          ) : (
                            <Ionicons name={def.icon as any} size={28} color={ACCENT} />
                          )}
                          <Text style={[s.badgeName, isDark && { color: '#F9FAFB' }]} numberOfLines={1}>
                            {def.name}
                          </Text>
                        </View>
                      ) : isRenewalPending ? (
                        <View style={[s.badgeItem, s.badgeRenewal, isDark && { backgroundColor: '#1F2937', borderColor: '#374151' }]}>
                          {isChallengeMedal ? (
                            <MedalBadge color={medalColor} emblem={emblem} size={34} />
                          ) : (
                            <Ionicons name={def.icon as any} size={28} color={isDark ? '#4B5563' : '#D1D5DB'} />
                          )}
                          <Text style={[s.badgeName, isDark ? { color: '#9CA3AF' } : s.badgeNameLocked]} numberOfLines={1}>
                            {def.name}
                          </Text>
                          <Text style={[s.badgeRenewalCaption, isDark && { color: '#6B7280' }]} numberOfLines={2}>
                            Renews monthly — complete it again
                          </Text>
                        </View>
                      ) : (
                        <View style={[s.badgeItem, s.badgeLocked, isDark && { backgroundColor: '#1F2937' }]}>
                          <Ionicons
                            name={isMystery ? 'help-outline' : (def.icon as any)}
                            size={28}
                            color={isDark ? '#4B5563' : '#D1D5DB'}
                          />
                          <Text style={[s.badgeName, isDark ? { color: '#6B7280' } : s.badgeNameLocked]} numberOfLines={1}>
                            {isMystery ? '???' : def.name}
                          </Text>
                        </View>
                      )}
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </View>
          </>
        )}

        {profileTab === 'climbs' && (
          <View style={s.section}>
            {climbHistory.length > 0 ? (
              climbHistory.map((climb, i) => {
                const tierColor = getTierColor(climb.storeys);
                return (
                  <View key={climb.climb_id ?? i} style={[s.climbRow, isDark && s.climbRowDark]}>
                    <View style={[s.tierBar, { backgroundColor: tierColor }]} />
                    <View style={s.climbContent}>
                      <Text style={[s.climbAddr, isDark && { color: '#F9FAFB' }]} numberOfLines={1}>
                        {climb.blk_no ? `Blk ${climb.blk_no} ${climb.street}` : 'Unknown building'}
                      </Text>
                      <Text style={s.climbDate}>{formatClimbDateTime(climb.climbedAt)}</Text>
                    </View>
                    <View style={s.climbRight}>
                      <Text style={[s.climbFloors, { color: tierColor }]}>{climb.floors}</Text>
                      <Text style={s.climbFloorsLabel}>fl</Text>
                    </View>
                    <TouchableOpacity style={s.climbDeleteBtn} onPress={() => handleDeleteClimb(climb, i)} hitSlop={8}>
                      <Ionicons name="trash-outline" size={17} color="#EF4444" />
                    </TouchableOpacity>
                  </View>
                );
              })
            ) : (
              <View style={s.emptyState}>
                <Ionicons name="trending-up-outline" size={32} color={isDark ? '#4B5563' : '#D1D5DB'} />
                <Text style={[s.emptyText, isDark && { color: '#9CA3AF' }]}>
                  Log a climb to see it here.
                </Text>
              </View>
            )}
          </View>
        )}
      </ScrollView>

      <AuthPrompt
        visible={authPromptVisible}
        reason="sync your climbs, earn badges, and verify buildings"
        onClose={() => setAuthPromptVisible(false)}
        onSuccess={loadData}
      />

      <BadgeDetailModal
        badge={selectedBadge}
        earned={!!selectedBadge && earnedBadges.has(selectedBadge.key)}
        earnedAt={selectedBadge ? earnedBadges.get(selectedBadge.key) : undefined}
        isFeatured={!!selectedBadge && profile?.featured_badge === selectedBadge.key}
        onSetFeatured={selectedBadge && earnedBadges.has(selectedBadge.key) ? () => handleSetFeatured(selectedBadge.key) : undefined}
        onClose={() => setSelectedBadge(null)}
      />

      <SettingsModal
        visible={settingsVisible}
        onClose={() => setSettingsVisible(false)}
        isDark={isDark}
        themeMode={themeMode}
        onSetThemeMode={onSetThemeMode ?? (() => {})}
        profile={profile}
        onChangeSkin={handleChangeSkin}
        onPhotoChanged={handlePhotoChanged}
        onRequestSignIn={() => setAuthPromptVisible(true)}
      />
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F9FAFB',
  },
  centerContent: {
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  signInBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: 'rgba(37,99,235,0.22)',
    marginHorizontal: 16,
    marginBottom: 16,
    padding: 14,
    borderRadius: 12,
  },
  signInBannerText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '500',
    color: '#2563EB',
    lineHeight: 18,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 110,
  },
  banner: {
    height: 128,
  },
  bannerSettingsBtn: {
    position: 'absolute',
    top: 52,
    right: 16,
    padding: 4,
  },
  header: {
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingBottom: 20,
    marginTop: -44,
  },
  avatarTouchable: {
    marginBottom: 12,
  },
  avatarFrame: {
    borderRadius: 41,
    borderWidth: 3,
    borderColor: 'transparent',
    padding: 2,
  },
  avatarEditBadge: {
    position: 'absolute',
    bottom: 0,
    right: -2,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#2563EB',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#F9FAFB',
  },
  levelChip: {
    position: 'absolute',
    top: -4,
    left: -6,
    backgroundColor: '#2563EB',
    borderRadius: 10,
    paddingVertical: 2,
    paddingHorizontal: 8,
    borderWidth: 2,
    borderColor: '#F9FAFB',
  },
  levelChipText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  xpBlock: {
    width: '70%',
    marginTop: 10,
  },
  xpTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: '#E5E7EB',
    overflow: 'hidden',
    marginBottom: 5,
  },
  xpFill: {
    height: '100%',
    borderRadius: 3,
    backgroundColor: '#2563EB',
  },
  xpLabel: {
    fontSize: 10.5,
    fontWeight: '600',
    color: '#9CA3AF',
    textAlign: 'center',
  },
  displayNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  displayName: {
    fontSize: 22,
    fontWeight: '800',
    color: '#111827',
  },
  handleEditRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  handleInput: {
    fontSize: 20,
    fontWeight: '800',
    color: '#111827',
    borderBottomWidth: 1.5,
    borderBottomColor: '#E5E7EB',
    minWidth: 120,
    textAlign: 'center',
    paddingVertical: 2,
  },
  email: {
    fontSize: 14,
    color: '#6B7280',
    marginTop: 4,
  },
  verifiedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    backgroundColor: 'rgba(16,185,129,0.1)',
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 12,
  },
  verifiedText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#10B981',
    marginLeft: 4,
  },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: '#F3F4F6',
    borderRadius: 12,
    padding: 3,
    marginHorizontal: 16,
    marginBottom: 16,
  },
  tabBtn: { flex: 1, paddingVertical: 9, alignItems: 'center', borderRadius: 9 },
  tabBtnActive: { backgroundColor: '#FFFFFF', elevation: 1 },
  tabBtnText: { fontSize: 13, fontWeight: '700', color: '#9CA3AF' },
  tabBtnTextActive: { color: '#111827' },
  section: {
    marginTop: 24,
    paddingHorizontal: 16,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 18,
    borderWidth: 1,
    borderColor: 'rgba(17,24,39,0.06)',
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
  },
  cardDark: {
    backgroundColor: '#1F2937',
    borderColor: 'rgba(255,255,255,0.06)',
  },
  recordsCard: {
    paddingVertical: 4,
  },
  weekStatsRow: { marginBottom: 4 },
  heroNumber: { fontSize: 36, fontWeight: '800', color: '#111827', letterSpacing: -0.5 },
  heroLabel: { fontSize: 13, color: '#6B7280', fontWeight: '500', marginTop: 3 },
  heroStatsRow: { flexDirection: 'row', alignItems: 'center' },
  secondaryStatsRow: { flexDirection: 'row', alignItems: 'center' },
  goalBlock: { marginTop: 18 },
  goalRingRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  goalRingPct: { fontSize: 14, fontWeight: '800', color: '#111827' },
  goalRingText: { flex: 1 },
  goalLabel: { fontSize: 12.5, color: '#6B7280', fontWeight: '600' },
  goalValue: { fontSize: 16, color: '#111827', fontWeight: '800', marginTop: 3 },
  deltaPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 20,
  },
  deltaPillText: {
    fontSize: 11.5,
    fontWeight: '700',
  },
  trendAxisRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 6,
  },
  trendAxisLabel: {
    fontSize: 10.5,
    fontWeight: '600',
    color: '#9CA3AF',
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#6B7280',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 12,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  badgeCount: {
    fontSize: 12,
    fontWeight: '600',
    color: '#9CA3AF',
  },
  badgeProgressTrack: {
    height: 5,
    borderRadius: 3,
    backgroundColor: '#E5E7EB',
    overflow: 'hidden',
    marginBottom: 14,
  },
  badgeProgressFill: {
    height: '100%',
    borderRadius: 3,
  },
  periodToggle: {
    flexDirection: 'row',
    backgroundColor: '#F3F4F6',
    borderRadius: 8,
    padding: 2,
  },
  periodToggleBtn: { paddingVertical: 5, paddingHorizontal: 12, borderRadius: 6 },
  periodToggleBtnActive: { backgroundColor: '#FFFFFF', elevation: 1 },
  periodToggleText: { fontSize: 12, fontWeight: '700', color: '#9CA3AF' },
  periodToggleTextActive: { color: '#111827' },
  badgesRow: {
    flexDirection: 'row',
    paddingBottom: 8,
  },
  badgeItem: {
    alignItems: 'center',
    width: 80,
    paddingVertical: 10,
    marginRight: 12,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(17,24,39,0.06)',
  },
  badgeLocked: {
    backgroundColor: '#F3F4F6',
    opacity: 0.5,
  },
  // Flat neutral card by default — the medal/tier color (applied inline per
  // badge) is what's meant to stand out here, not a colored card background.
  badgeItemEarned: {
    borderWidth: 1,
    borderColor: 'rgba(37,99,235,0.25)',
  },
  badgeItemEarnedDark: {
    backgroundColor: '#1F2937',
    borderColor: 'rgba(37,99,235,0.35)',
  },
  // Overwatch-season-style ring for an active (this-month) seasonal badge —
  // borderColor is supplied inline per-badge tier color; the shadow stays a
  // plain neutral lift rather than a colored glow.
  badgeItemGlow: {
    borderWidth: 1.5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.12,
    shadowRadius: 3,
    elevation: 2,
  },
  // Previously-earned-but-expired seasonal badge — still shown (not locked/mystery)
  // but desaturated, with a caption explaining it needs re-completing this month.
  badgeRenewal: {
    backgroundColor: '#F3F4F6',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    opacity: 0.85,
  },
  badgeRenewalCaption: {
    fontSize: 8,
    fontWeight: '600',
    color: '#9CA3AF',
    textAlign: 'center',
    marginTop: 3,
    lineHeight: 10,
  },
  badgeName: {
    fontSize: 10,
    fontWeight: '600',
    color: '#374151',
    marginTop: 6,
    textAlign: 'center',
  },
  badgeNameLocked: {
    color: '#9CA3AF',
  },
  climbRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 14,
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(17,24,39,0.06)',
    marginBottom: 6,
  },
  climbRowDark: {
    backgroundColor: '#1F2937',
    borderColor: 'rgba(255,255,255,0.06)',
  },
  tierBar: {
    width: 6,
    height: 32,
    borderRadius: 3,
    marginRight: 12,
  },
  climbContent: {
    flex: 1,
    marginRight: 8,
  },
  climbAddr: {
    fontSize: 14,
    fontWeight: '600',
    color: '#111827',
  },
  climbDate: {
    fontSize: 11,
    color: '#9CA3AF',
    fontWeight: '500',
    marginTop: 2,
  },
  climbRight: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  climbFloors: {
    fontSize: 16,
    fontWeight: '700',
  },
  climbFloorsLabel: {
    fontSize: 10,
    color: '#9CA3AF',
    fontWeight: '500',
    marginLeft: 2,
  },
  climbDeleteBtn: {
    marginLeft: 10,
    padding: 4,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 24,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    borderStyle: 'dashed',
  },
  emptyText: {
    fontSize: 13,
    color: '#9CA3AF',
    textAlign: 'center',
    marginTop: 8,
  },
});
