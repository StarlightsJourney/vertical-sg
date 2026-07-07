import { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Alert,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../config/supabase';
import storage from '../utils/storage';
import MascotAvatar from '../components/MascotAvatar';
import type { ClimbLog, UserBadge, Profile } from '../types';
import { BADGE_DEFS } from '../types';
import AuthPrompt from '../components/AuthPrompt';

const RECENT_CLIMBS_COLLAPSED = 3;
const DAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function formatClimbDateTime(iso: string): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `${date}, ${time}`;
}

/** Current consecutive-day streak, counting back from today (or yesterday,
 * so a climb from earlier today doesn't reset until the day is fully missed). */
function computeStreak(isoDates: string[]): number {
  const days = new Set(isoDates.map((d) => new Date(d).toDateString()));
  const today = new Date();
  let streak = 0;
  const cursor = new Date(today);

  if (!days.has(cursor.toDateString())) {
    cursor.setDate(cursor.getDate() - 1);
  }

  while (days.has(cursor.toDateString())) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
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

/** MacroFactor-style minimal weekly bar chart — plain Views, no chart library. */
function WeeklyChart({ dailyFloors, isDark }: { dailyFloors: number[]; isDark: boolean }) {
  const max = Math.max(1, ...dailyFloors);
  const today = new Date().getDay(); // 0 = Sunday

  return (
    <View style={c.chartWrap}>
      {dailyFloors.map((val, i) => {
        const dayIdx = (today - 6 + i + 7) % 7;
        const isToday = i === 6;
        const heightPct = val === 0 ? 0.03 : Math.max(0.06, val / max);
        return (
          <View key={i} style={c.barCol}>
            <Text style={[c.barValue, isDark && { color: '#9CA3AF' }, val === 0 && { opacity: 0 }]}>{val}</Text>
            <View style={c.barTrack}>
              <View style={[
                c.bar,
                { height: `${heightPct * 100}%`, backgroundColor: isToday ? '#2563EB' : (isDark ? '#374151' : '#DBEAFE') },
              ]} />
            </View>
            <Text style={[c.barLabel, isToday && { color: '#2563EB', fontWeight: '700' }, isDark && !isToday && { color: '#6B7280' }]}>
              {DAY_LABELS[dayIdx]}
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

export default function ProfileScreen({ isDark = false }: { isDark?: boolean }) {
  const { user, isAnonymous, loading: authLoading, signOut } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [editingHandle, setEditingHandle] = useState(false);
  const [handleInput, setHandleInput] = useState('');
  const [climbHistory, setClimbHistory] = useState<ClimbLog[]>([]);
  const [badges, setBadges] = useState<UserBadge[]>([]);
  const [climbStats, setClimbStats] = useState({ climbs: 0, floors: 0, tallest: 0 });
  const [streak, setStreak] = useState(0);
  const [dailyFloors, setDailyFloors] = useState<number[]>(new Array(7).fill(0));
  const [weeklyGoal, setWeeklyGoal] = useState<number | null>(null);
  const [verifiedCount, setVerifiedCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [authPromptVisible, setAuthPromptVisible] = useState(false);
  const [showAllClimbs, setShowAllClimbs] = useState(false);

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
      setClimbStats({ climbs: history.length, floors, tallest });
      setStreak(computeStreak(history.map((c) => c.climbedAt)));
      setDailyFloors(computeDailyFloors(history.map((c) => ({ climbedAt: c.climbedAt, floors: c.floors }))));
      setLoading(false);
      return;
    }

    try {
      // Fetch own profile (handle + avatar skin)
      const { data: profileData } = await supabase
        .from('profiles')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle();
      if (profileData) {
        setProfile(profileData as Profile);
        setHandleInput(profileData.display_name);
      }

      // Fetch climbs from Supabase — joined to blocks for the real address
      const { data: climbs } = await supabase
        .from('climbs')
        .select('*, blocks(blk_no, street)')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(500);

      if (climbs) {
        // Approximate the building's storey count (for tier coloring) by
        // backing out the partial floors before dividing by full-set qty.
        const storeysOf = (c: any) =>
          c.climb_qty > 0
            ? Math.round((c.floors_climbed - (c.partial_floors ?? 0)) / c.climb_qty)
            : c.floors_climbed;

        const history: ClimbLog[] = climbs.map((c: any) => ({
          block_id: c.block_id,
          blk_no: c.blocks?.blk_no ?? '',
          street: c.blocks?.street ?? '',
          storeys: storeysOf(c),
          floors: c.floors_climbed,
          climbedAt: c.created_at,
        }));
        setClimbHistory(history);
        const floors = climbs.reduce((s: number, c: any) => s + c.floors_climbed, 0);
        const tallest = climbs.reduce((m: number, c: any) => Math.max(m, storeysOf(c)), 0);
        setClimbStats({ climbs: climbs.length, floors, tallest });
        setStreak(computeStreak(climbs.map((c: any) => c.created_at)));
        setDailyFloors(computeDailyFloors(climbs.map((c: any) => ({ climbedAt: c.created_at, floors: c.floors_climbed }))));
      }

      // Fetch badges
      const { data: badgeData } = await supabase
        .from('user_badges')
        .select('*')
        .eq('user_id', user.id);
      if (badgeData) setBadges(badgeData as UserBadge[]);

      // Fetch verification count
      const { count } = await supabase
        .from('height_verifications')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('status', 'active');
      setVerifiedCount(count ?? 0);
    } catch (err) {
      console.error('Error loading profile data:', err);
    }

    setLoading(false);
  }, [user]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleChangeSkin = async () => {
    if (!user || !profile) return;
    const nextSkin = (profile.avatar_idx + 1) % 5;
    setProfile({ ...profile, avatar_idx: nextSkin }); // optimistic
    await supabase.from('profiles').update({ avatar_idx: nextSkin }).eq('user_id', user.id);
  };

  const handleSaveHandle = async () => {
    if (!user || !handleInput.trim()) { setEditingHandle(false); return; }
    setEditingHandle(false);
    setProfile((p) => (p ? { ...p, display_name: handleInput.trim() } : p));
    await supabase.from('profiles').update({ display_name: handleInput.trim() }).eq('user_id', user.id);
  };

  const earnedBadgeKeys = new Set(badges.map(b => b.badge_key));
  const weeklyFloors = dailyFloors.reduce((s, v) => s + v, 0);
  const weeklyClimbTotal = climbHistory.filter((c) => {
    const d = new Date(c.climbedAt);
    return Date.now() - d.getTime() < 7 * 86400000;
  }).length;
  const visibleClimbs = showAllClimbs ? climbHistory : climbHistory.slice(0, RECENT_CLIMBS_COLLAPSED);

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
        {/* Profile header */}
        <View style={s.header}>
          <TouchableOpacity
            style={s.avatarTouchable}
            onPress={isAnonymous ? undefined : handleChangeSkin}
            activeOpacity={isAnonymous ? 1 : 0.7}
          >
            <MascotAvatar skinIdx={profile?.avatar_idx ?? 0} size={72} />
            {!isAnonymous && (
              <View style={s.avatarEditBadge}>
                <Ionicons name="sync-outline" size={12} color="#FFF" />
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
              <Text style={[s.displayName, isDark && { color: '#F9FAFB' }]}>
                {isAnonymous ? 'Guest Climber' : (profile?.display_name ?? 'Climber')}
              </Text>
              {!isAnonymous && <Ionicons name="pencil" size={13} color="#9CA3AF" style={{ marginLeft: 6 }} />}
            </TouchableOpacity>
          )}

          <Text style={[s.email, isDark && { color: '#9CA3AF' }]}>
            {isAnonymous ? 'Not signed in' : (user?.email ?? '')}
          </Text>
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
          <View style={[s.statDivider, isDark && { backgroundColor: '#374151' }]} />
          <View style={s.statItem}>
            <View style={s.streakRow}>
              {streak > 0 && <Ionicons name="flame" size={16} color="#F59E0B" />}
              <Text style={[s.statNumber, isDark && { color: '#F9FAFB' }, streak > 0 && { color: '#F59E0B' }]}>
                {streak}
              </Text>
            </View>
            <Text style={s.statLabel}>Streak</Text>
          </View>
        </View>

        {/* Your Week — moved here from Social, with a MacroFactor-style trend chart */}
        <View style={s.section}>
          <Text style={[s.sectionTitle, isDark && { color: '#D1D5DB' }]}>Your Week</Text>
          <View style={[s.card, isDark && { backgroundColor: '#1F2937' }]}>
            <View style={s.weekStatsRow}>
              <View>
                <Text style={[s.weekBigNumber, isDark && { color: '#F9FAFB' }]}>{weeklyFloors}</Text>
                <Text style={s.weekBigLabel}>floors this week · {weeklyClimbTotal} climbs</Text>
              </View>
            </View>
            <WeeklyChart dailyFloors={dailyFloors} isDark={isDark} />

            {weeklyGoal != null && (
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
              const earned = earnedBadgeKeys.has(def.key);
              // Hidden badges stay a mystery until earned — discovered, not chased.
              const isMystery = def.hidden && !earned;
              return (
                <View
                  key={def.key}
                  style={[s.badgeItem, !earned && s.badgeLocked, isDark && !earned && { backgroundColor: '#1F2937' }]}
                >
                  <Ionicons
                    name={isMystery ? 'help-outline' : (def.icon as any)}
                    size={28}
                    color={earned ? '#60A5FA' : (isDark ? '#4B5563' : '#D1D5DB')}
                  />
                  <Text
                    style={[s.badgeName, isDark && { color: '#D1D5DB' }, !earned && s.badgeNameLocked]}
                    numberOfLines={1}
                  >
                    {isMystery ? '???' : def.name}
                  </Text>
                </View>
              );
            })}
          </ScrollView>
        </View>

        {/* Climb history (from My Climbs) */}
        <View style={s.section}>
          <Text style={[s.sectionTitle, isDark && { color: '#D1D5DB' }]}>Recent Climbs</Text>
          {climbHistory.length > 0 ? (
            <>
              {visibleClimbs.map((climb, i) => {
                const tierColor = getTierColor(climb.storeys);
                return (
                  <View key={i} style={[s.climbRow, isDark && { backgroundColor: '#1F2937' }]}>
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
                  </View>
                );
              })}
              {climbHistory.length > RECENT_CLIMBS_COLLAPSED && (
                <TouchableOpacity style={s.showMoreBtn} onPress={() => setShowAllClimbs(!showAllClimbs)}>
                  <Text style={s.showMoreText}>
                    {showAllClimbs ? 'Show less' : `Show ${climbHistory.length - RECENT_CLIMBS_COLLAPSED} more`}
                  </Text>
                  <Ionicons name={showAllClimbs ? 'chevron-up' : 'chevron-down'} size={14} color="#2563EB" />
                </TouchableOpacity>
              )}
            </>
          ) : (
            <View style={s.emptyState}>
              <Ionicons name="trending-up-outline" size={32} color={isDark ? '#4B5563' : '#D1D5DB'} />
              <Text style={[s.emptyText, isDark && { color: '#9CA3AF' }]}>
                Log a climb to see it here.
              </Text>
            </View>
          )}
        </View>

        {/* Sign out (accounts only) / Sign in (guests) */}
        {isAnonymous ? (
          <TouchableOpacity
            style={s.signInBtn}
            onPress={() => setAuthPromptVisible(true)}
            activeOpacity={0.8}
          >
            <Text style={s.signInBtnText}>Sign In / Create Account</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={s.signOutBtn}
            onPress={() => {
              Alert.alert('Sign out', 'Are you sure?', [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Sign Out', style: 'destructive', onPress: signOut },
              ]);
            }}
            activeOpacity={0.7}
          >
            <Text style={s.signOutText}>Sign Out</Text>
          </TouchableOpacity>
        )}
      </ScrollView>

      <AuthPrompt
        visible={authPromptVisible}
        reason="sync your climbs, earn badges, and verify buildings"
        onClose={() => setAuthPromptVisible(false)}
        onSuccess={loadData}
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
  signInBtn: {
    marginTop: 32,
    marginHorizontal: 16,
    backgroundColor: '#2563EB',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  signInBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
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
    paddingBottom: 48,
    paddingTop: 56,
  },
  header: {
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingBottom: 20,
  },
  avatarTouchable: {
    marginBottom: 12,
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
  streakRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
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
  showMoreBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 10,
  },
  showMoreText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#2563EB',
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
  signOutBtn: {
    marginTop: 32,
    marginHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: '#FEE2E2',
    alignItems: 'center',
  },
  signOutText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#EF4444',
  },
});
