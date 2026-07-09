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
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../config/supabase';
import storage from '../utils/storage';
import MascotAvatar from '../components/MascotAvatar';
import BadgeDetailModal from '../components/BadgeDetailModal';
import SettingsModal from '../components/SettingsModal';
import { computeXP, computeLevelProgress } from '../utils/leveling';
import type { ClimbLog, UserBadge, Profile, BadgeDef } from '../types';
import { BADGE_DEFS } from '../types';
import AuthPrompt from '../components/AuthPrompt';

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

/** MacroFactor-style minimal bar chart — plain Views, no chart library. Used for both the weekly (day-by-day) and monthly (week-by-week) views. */
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
              <View style={[
                c.bar,
                { height: `${heightPct * 100}%`, backgroundColor: isHighlight ? '#2563EB' : (isDark ? '#374151' : '#DBEAFE') },
              ]} />
            </View>
            <Text style={[c.barLabel, isHighlight && { color: '#2563EB', fontWeight: '700' }, isDark && !isHighlight && { color: '#6B7280' }]}>
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
    setProfile({ ...profile, avatar_idx: idx }); // optimistic
    await supabase.from('profiles').update({ avatar_idx: idx }).eq('user_id', user.id);
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
        {/* LinkedIn-style banner with avatar overlapping the bottom edge —
            a legendary featured badge (e.g. Everest Gauntlet) replaces the
            plain color with an animated cycling one, Discord-Nitro-style. */}
        <Animated.View style={[s.banner, isDark && { backgroundColor: '#1E3A8A' }, isLegendary && { backgroundColor: legendaryColor }]}>
          <TouchableOpacity style={s.bannerSettingsBtn} onPress={() => setSettingsVisible(true)} activeOpacity={0.7} hitSlop={8}>
            <Ionicons name="settings-outline" size={22} color="#FFFFFF" />
          </TouchableOpacity>
        </Animated.View>

        {/* Profile header */}
        <View style={s.header}>
          <TouchableOpacity
            style={s.avatarTouchable}
            onPress={() => setSettingsVisible(true)}
            activeOpacity={0.7}
          >
            <Animated.View style={[s.avatarFrame, isLegendary && { borderColor: legendaryColor }]}>
              <MascotAvatar skinIdx={profile?.avatar_idx ?? 0} size={72} />
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
                <Ionicons name={featuredBadgeDef.icon as any} size={17} color="#F59E0B" style={{ marginRight: 6 }} />
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
            style={[s.signInBanner, isDark && { backgroundColor: '#1F2937' }]}
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
            {/* Stats card */}
            <View style={[s.statsCard, isDark && { backgroundColor: '#1F2937' }]}>
              <View style={s.statItem}>
                <Text style={[s.statNumber, isDark && { color: '#F9FAFB' }]}>{climbStats.climbs}</Text>
                <Text style={s.statLabel}>Climbs</Text>
              </View>
              <View style={[s.statDivider, isDark && { backgroundColor: '#374151' }]} />
              <View style={s.statItem}>
                <Text style={[s.statNumber, isDark && { color: '#F9FAFB' }]}>{climbStats.floors}</Text>
                <Text style={s.statLabel}>Floors</Text>
              </View>
              <View style={[s.statDivider, isDark && { backgroundColor: '#374151' }]} />
              <View style={s.statItem}>
                <Text style={[s.statNumber, isDark && { color: '#F9FAFB' }]}>
                  {climbStats.tallest > 0 ? climbStats.tallest : '—'}
                </Text>
                <Text style={s.statLabel}>Tallest</Text>
              </View>
            </View>

            <View style={[s.statsCard, { marginTop: 10 }, isDark && { backgroundColor: '#1F2937' }]}>
              <View style={s.statItem}>
                <Text style={[s.statNumber, isDark && { color: '#F9FAFB' }]}>{Math.round(climbStats.floors * 2.8)}m</Text>
                <Text style={s.statLabel}>Elevation</Text>
              </View>
              <View style={[s.statDivider, isDark && { backgroundColor: '#374151' }]} />
              <View style={s.statItem}>
                <Text style={[s.statNumber, isDark && { color: '#F9FAFB' }]}>
                  {climbStats.durationSeconds > 0 ? formatDuration(climbStats.durationSeconds) : '—'}
                </Text>
                <Text style={s.statLabel}>Time Spent</Text>
              </View>
            </View>

            {/* Weekly / monthly streak chips */}
            <View style={s.streakChipsRow}>
              <View style={[s.streakChip, isDark && { backgroundColor: '#1F2937' }]}>
                {weeklyStreak > 0 && <Ionicons name="flame" size={18} color="#F59E0B" />}
                <Text style={[s.streakChipNumber, isDark && { color: '#F9FAFB' }, weeklyStreak > 0 && { color: '#F59E0B' }]}>{weeklyStreak}</Text>
                <Text style={s.streakChipLabel}>week streak</Text>
              </View>
              <View style={[s.streakChip, isDark && { backgroundColor: '#1F2937' }]}>
                {monthlyStreak > 0 && <Ionicons name="flame" size={18} color="#7C3AED" />}
                <Text style={[s.streakChipNumber, isDark && { color: '#F9FAFB' }, monthlyStreak > 0 && { color: '#7C3AED' }]}>{monthlyStreak}</Text>
                <Text style={s.streakChipLabel}>month streak</Text>
              </View>
            </View>

            {/* Your Week / Your Month — MacroFactor-style trend chart */}
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
              <View style={[s.card, isDark && { backgroundColor: '#1F2937' }]}>
                <View style={s.weekStatsRow}>
                  <View>
                    <Text style={[s.weekBigNumber, isDark && { color: '#F9FAFB' }]}>
                      {viewPeriod === 'week' ? weeklyFloors : monthlyFloors}
                    </Text>
                    <Text style={s.weekBigLabel}>
                      floors this {viewPeriod} · {viewPeriod === 'week' ? weeklyClimbTotal : monthlyClimbTotal} climbs
                    </Text>
                  </View>
                </View>
                {viewPeriod === 'week' ? (
                  <BarChart values={dailyFloors} labels={weekdayLabels} highlightIndex={6} isDark={isDark} />
                ) : (
                  <BarChart values={monthlyBuckets} labels={['3wk ago', '2wk ago', 'Last wk', 'This wk']} highlightIndex={3} isDark={isDark} />
                )}

                {viewPeriod === 'week' && weeklyGoal != null && (
                  <View style={s.goalBlock}>
                    <View style={s.goalRow}>
                      <Text style={[s.goalLabel, isDark && { color: '#9CA3AF' }]}>Weekly goal</Text>
                      <Text style={[s.goalValue, isDark && { color: '#F9FAFB' }]}>{weeklyFloors} / {weeklyGoal} fl</Text>
                    </View>
                    <View style={[s.goalTrack, isDark && { backgroundColor: '#374151' }]}>
                      <View style={[s.goalFill, { width: `${Math.min(100, Math.round((weeklyFloors / weeklyGoal) * 100))}%` }]} />
                    </View>
                  </View>
                )}
              </View>
            </View>

            {/* Badges section */}
            <View style={s.section}>
              <View style={s.sectionHeaderRow}>
                <Text style={[s.sectionTitle, { marginBottom: 0 }, isDark && { color: '#D1D5DB' }]}>Badges</Text>
                <Text style={s.badgeCount}>{badges.length} of {BADGE_DEFS.length} earned</Text>
              </View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.badgesRow}>
                {BADGE_DEFS.map((def) => {
                  const earned = earnedBadges.has(def.key);
                  // Hidden badges stay a mystery until earned — discovered, not chased.
                  const isMystery = def.hidden && !earned;
                  return (
                    <TouchableOpacity
                      key={def.key}
                      style={[s.badgeItem, !earned && s.badgeLocked, isDark && { backgroundColor: '#1F2937' }]}
                      onPress={() => setSelectedBadge(def)}
                      activeOpacity={0.7}
                    >
                      <Ionicons
                        name={isMystery ? 'help-outline' : (def.icon as any)}
                        size={28}
                        color={earned ? '#60A5FA' : (isDark ? '#4B5563' : '#D1D5DB')}
                      />
                      <Text
                        style={[
                          s.badgeName,
                          earned && isDark && { color: '#F9FAFB' },
                          !earned && (isDark ? { color: '#6B7280' } : s.badgeNameLocked),
                        ]}
                        numberOfLines={1}
                      >
                        {isMystery ? '???' : def.name}
                      </Text>
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
                  <View key={climb.climb_id ?? i} style={[s.climbRow, isDark && { backgroundColor: '#1F2937' }]}>
                    <View style={[s.tierDot, { backgroundColor: tierColor }]} />
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
    backgroundColor: '#EFF6FF',
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
    height: 96,
    backgroundColor: '#2563EB',
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
    backgroundColor: '#7C3AED',
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
    backgroundColor: '#7C3AED',
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
  statsCard: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    marginHorizontal: 16,
    borderRadius: 16,
    paddingVertical: 20,
    paddingHorizontal: 12,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
  },
  streakChipsRow: {
    flexDirection: 'row',
    gap: 10,
    marginHorizontal: 16,
    marginTop: 10,
  },
  streakChip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    paddingVertical: 12,
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
  },
  streakChipNumber: {
    fontSize: 16,
    fontWeight: '800',
    color: '#111827',
  },
  streakChipLabel: {
    fontSize: 11.5,
    fontWeight: '600',
    color: '#9CA3AF',
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
  statNumber: {
    fontSize: 22,
    fontWeight: '800',
    color: '#111827',
  },
  statLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#6B7280',
    marginTop: 4,
  },
  statDivider: {
    width: 1,
    backgroundColor: '#E5E7EB',
    marginVertical: 4,
  },
  section: {
    marginTop: 24,
    paddingHorizontal: 16,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 18,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
  },
  weekStatsRow: { marginBottom: 4 },
  weekBigNumber: { fontSize: 30, fontWeight: '800', color: '#111827' },
  weekBigLabel: { fontSize: 12.5, color: '#6B7280', fontWeight: '500', marginTop: 2 },
  goalBlock: { marginTop: 18 },
  goalRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  goalLabel: { fontSize: 12.5, color: '#6B7280', fontWeight: '600' },
  goalValue: { fontSize: 12.5, color: '#111827', fontWeight: '700' },
  goalTrack: { height: 8, borderRadius: 4, backgroundColor: '#E5E7EB', overflow: 'hidden' },
  goalFill: { height: '100%', backgroundColor: '#F59E0B', borderRadius: 4 },
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
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
  },
  badgeLocked: {
    backgroundColor: '#F3F4F6',
    opacity: 0.5,
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
    marginBottom: 6,
  },
  tierDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
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
