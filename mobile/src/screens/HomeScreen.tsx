import { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, ActivityIndicator, Alert } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../config/supabase';
import storage from '../utils/storage';
import MascotAvatar from '../components/MascotAvatar';
import { avatarUriFor } from '../utils/avatarUri';
import { monthlyGoalFromWeekly, nextMonthGoal } from '../utils/goals';
import SettingsModal from '../components/SettingsModal';
import HelpFeedbackModal from '../components/HelpFeedbackModal';
import AuthPrompt from '../components/AuthPrompt';
import type { Profile } from '../types';

const ACCENT = '#2563EB';
const DAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

interface Props {
  isDark?: boolean;
  themeMode?: 'light' | 'dark' | 'auto';
  onSetThemeMode?: (mode: 'light' | 'dark' | 'auto') => void;
  onNavigateToProfile?: () => void;
  isActive?: boolean;
}

/** Monday-aligned start of the week containing `d`. */
function mondayOfWeek(d: Date): Date {
  const monday = new Date(d);
  const day = monday.getDay();
  monday.setDate(monday.getDate() + (day === 0 ? -6 : 1 - day));
  monday.setHours(0, 0, 0, 0);
  return monday;
}

/** Weekday indices (0=Sun..6=Sat), evenly spread across the week, for a
 * given cadence — e.g. cadence=3 → [0,2,4] (Sun/Tue/Thu). Generalizes to
 * any cadence rather than hardcoding a lookup per value. */
function suggestedWeekdays(cadence: number): Set<number> {
  const n = Math.max(1, Math.min(7, cadence));
  const step = 7 / n;
  const days = new Set<number>();
  for (let i = 0; i < n; i++) days.add(Math.floor(i * step));
  return days;
}

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function HomeScreen({ isDark = false, themeMode = 'auto', onSetThemeMode, onNavigateToProfile, isActive }: Props) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [helpVisible, setHelpVisible] = useState(false);
  const [authPromptVisible, setAuthPromptVisible] = useState(false);
  const [myProfile, setMyProfile] = useState<Profile | null>(null);
  const [weeklyFloors, setWeeklyFloors] = useState(0);
  const [monthlyFloors, setMonthlyFloors] = useState(0);
  const [dayFloors, setDayFloors] = useState<Record<string, number>>({}); // dateKey -> floors, this month only
  const [weeklyGoal, setWeeklyGoal] = useState(200);
  const [cadence, setCadence] = useState(3);
  const [reminders, setReminders] = useState<Set<string>>(new Set());
  const [editingGoal, setEditingGoal] = useState(false);
  const [goalInput, setGoalInput] = useState('');
  const [savingGoal, setSavingGoal] = useState(false);

  const loadData = useCallback(async () => {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfWeek = mondayOfWeek(now);
    const earliestNeeded = startOfWeek < startOfMonth ? startOfWeek : startOfMonth;

    // Local fallback goal/cadence (onboarding_profile), used for anonymous
    // sessions and as the value shown before a Supabase profile row loads.
    const onboardingRaw = await storage.getItem('onboarding_profile');
    let localGoal: number | null = null;
    let localCadence: number | null = null;
    if (onboardingRaw) {
      try {
        const parsed = JSON.parse(onboardingRaw);
        localGoal = parsed.weeklyGoal ?? null;
        localCadence = parsed.cadence ?? null;
      } catch {}
    }

    const remindersList = await storage.getClimbReminders();
    setReminders(new Set(remindersList));

    const bucketByDay = (rows: { climbedAt: string; floors: number }[]) => {
      let week = 0;
      let month = 0;
      const byDay: Record<string, number> = {};
      for (const r of rows) {
        const d = new Date(r.climbedAt);
        if (d >= startOfWeek) week += r.floors;
        if (d >= startOfMonth) {
          month += r.floors;
          const key = dateKey(d);
          byDay[key] = (byDay[key] ?? 0) + r.floors;
        }
      }
      setWeeklyFloors(week);
      setMonthlyFloors(month);
      setDayFloors(byDay);
    };

    if (!user) {
      const history = await storage.getClimbHistory();
      bucketByDay(history.map((c) => ({ climbedAt: c.climbedAt, floors: c.floors })));
      setWeeklyGoal(localGoal ?? 200);
      setCadence(localCadence ?? 3);
      setLoading(false);
      return;
    }

    try {
      const [{ data: profileData }, { data: climbs }] = await Promise.all([
        supabase.from('profiles').select('*').eq('user_id', user.id).maybeSingle(),
        supabase.from('climbs').select('floors_climbed, created_at').eq('user_id', user.id).gte('created_at', earliestNeeded.toISOString()),
      ]);

      if (profileData) {
        setMyProfile(profileData as Profile);
        setWeeklyGoal((profileData as Profile).weekly_goal_floors ?? localGoal ?? 200);
        setCadence((profileData as Profile).climb_cadence_per_week ?? localCadence ?? 3);
      } else {
        setWeeklyGoal(localGoal ?? 200);
        setCadence(localCadence ?? 3);
      }

      if (climbs) {
        bucketByDay(climbs.map((c: any) => ({ climbedAt: c.created_at, floors: c.floors_climbed })));
      }
    } catch (err) {
      console.error('Error loading Home data:', err);
    }

    setLoading(false);
  }, [user]);

  useEffect(() => { loadData(); }, [loadData]);
  // Refetch silently whenever this tab becomes active — same pattern as
  // every other tab (Map/Social/Groups), so a climb logged elsewhere shows
  // up here without a full app reload.
  useEffect(() => { if (isActive) loadData(); }, [isActive, loadData]);

  const monthlyGoal = monthlyGoalFromWeekly(weeklyGoal);
  const weeklyPct = Math.min(100, Math.round((weeklyFloors / Math.max(1, weeklyGoal)) * 100));
  const monthlyPct = Math.min(100, Math.round((monthlyFloors / Math.max(1, monthlyGoal)) * 100));
  const projectedNextMonth = nextMonthGoal(monthlyGoal, monthlyFloors);

  const openEditGoal = () => {
    setGoalInput(String(weeklyGoal));
    setEditingGoal(true);
  };

  const saveGoal = async () => {
    const parsed = parseInt(goalInput, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      Alert.alert('Enter a number', 'Weekly goal should be a positive number of floors.');
      return;
    }
    setSavingGoal(true);
    try {
      setWeeklyGoal(parsed);
      const onboardingRaw = await storage.getItem('onboarding_profile');
      const merged = onboardingRaw ? JSON.parse(onboardingRaw) : {};
      await storage.setItem('onboarding_profile', JSON.stringify({ ...merged, weeklyGoal: parsed }));
      if (user) {
        await supabase.from('profiles').update({ weekly_goal_floors: parsed }).eq('user_id', user.id);
      }
      setEditingGoal(false);
    } finally {
      setSavingGoal(false);
    }
  };

  // Settings handlers (Home has its own gear → Settings, so it owns these)
  const handleChangeSkin = async (idx: number) => {
    if (!user || !myProfile) return;
    setMyProfile({ ...myProfile, avatar_idx: idx, avatar_photo_path: null });
    await supabase.from('profiles').update({ avatar_idx: idx, avatar_photo_path: null }).eq('user_id', user.id);
  };
  const handlePhotoChanged = (path: string | null) => {
    setMyProfile((p) => (p ? { ...p, avatar_photo_path: path } : p));
  };

  const toggleReminder = (key: string, isPast: boolean) => {
    if (isPast) return; // reminders are only meaningful for today/future
    setReminders((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      storage.setClimbReminders([...next]);
      return next;
    });
  };

  // --- Calendar grid for the current month ---
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstWeekday = new Date(year, month, 1).getDay(); // 0=Sun
  const suggested = suggestedWeekdays(cadence);
  const todayKey = dateKey(now);
  const monthLabel = now.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

  const cells: Array<{ day: number; key: string; weekday: number } | null> = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let day = 1; day <= daysInMonth; day++) {
    const d = new Date(year, month, day);
    cells.push({ day, key: dateKey(d), weekday: d.getDay() });
  }

  if (loading) {
    return (
      <View style={[s.container, s.center, isDark && { backgroundColor: '#111827' }]}>
        <ActivityIndicator size="large" color={ACCENT} />
      </View>
    );
  }

  return (
    <View style={[s.container, isDark && { backgroundColor: '#111827' }]}>
      <View style={[s.header, isDark && { backgroundColor: '#111827', borderBottomColor: '#374151' }]}>
        <Text style={[s.headerTitle, isDark && { color: '#F9FAFB' }]}>Home</Text>
        <View style={s.headerActions}>
          <TouchableOpacity onPress={() => setHelpVisible(true)} activeOpacity={0.7} hitSlop={6}>
            <Ionicons name="help-circle-outline" size={24} color={isDark ? '#D1D5DB' : '#374151'} />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setSettingsVisible(true)} activeOpacity={0.7} hitSlop={6}>
            <Ionicons name="settings-outline" size={22} color={isDark ? '#D1D5DB' : '#374151'} />
          </TouchableOpacity>
          <TouchableOpacity onPress={onNavigateToProfile} activeOpacity={0.7}>
            <MascotAvatar skinIdx={myProfile?.avatar_idx ?? 0} photoUri={avatarUriFor(myProfile)} size={34} />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView contentContainerStyle={s.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Goal card */}
        <View style={[s.card, isDark && { backgroundColor: '#1F2937' }]}>
          <View style={s.cardHeaderRow}>
            <Text style={[s.cardTitle, isDark && { color: '#F9FAFB' }]}>Your Goal</Text>
            <TouchableOpacity onPress={openEditGoal} activeOpacity={0.7} style={s.editBtn}>
              <Ionicons name="create-outline" size={14} color={ACCENT} />
              <Text style={s.editBtnText}>Edit</Text>
            </TouchableOpacity>
          </View>

          <View style={s.goalRow}>
            <Text style={[s.goalLabel, isDark && { color: '#9CA3AF' }]}>This week</Text>
            <Text style={[s.goalValue, isDark && { color: '#F9FAFB' }]}>{weeklyFloors} / {weeklyGoal} fl</Text>
          </View>
          <View style={[s.track, isDark && { backgroundColor: '#374151' }]}>
            <View style={[s.fill, { width: `${weeklyPct}%`, backgroundColor: ACCENT }]} />
          </View>

          <View style={[s.goalRow, { marginTop: 14 }]}>
            <Text style={[s.goalLabel, isDark && { color: '#9CA3AF' }]}>This month</Text>
            <Text style={[s.goalValue, isDark && { color: '#F9FAFB' }]}>{monthlyFloors} / {monthlyGoal} fl</Text>
          </View>
          <View style={[s.track, isDark && { backgroundColor: '#374151' }]}>
            <View style={[s.fill, { width: `${monthlyPct}%`, backgroundColor: '#10B981' }]} />
          </View>

          <View style={[s.projectionBox, isDark && { backgroundColor: '#111827' }]}>
            <Ionicons name="trending-up-outline" size={16} color={ACCENT} />
            <Text style={[s.projectionText, isDark && { color: '#D1D5DB' }]}>
              Next month's target: <Text style={{ fontWeight: '800', color: ACCENT }}>{projectedNextMonth} fl</Text>
              {monthlyPct >= 100 ? ' — you hit this month\'s goal, so it steps up (progressive overload).' : monthlyPct >= 70 ? ' — close enough to hold steady and consolidate.' : ' — eased off a bit since this month fell short.'}
            </Text>
          </View>
        </View>

        {/* Calendar card */}
        <View style={[s.card, isDark && { backgroundColor: '#1F2937' }]}>
          <Text style={[s.cardTitle, isDark && { color: '#F9FAFB' }]}>{monthLabel}</Text>
          <Text style={[s.calendarHint, isDark && { color: '#9CA3AF' }]}>
            Filled = climbed that day. Ringed = a suggested climb day ({cadence}/week). Tap a day to set a reminder.
          </Text>

          <View style={s.weekLabelRow}>
            {DAY_LABELS.map((l, i) => (
              <Text key={i} style={[s.weekLabel, isDark && { color: '#6B7280' }]}>{l}</Text>
            ))}
          </View>

          <View style={s.calendarGrid}>
            {cells.map((cell, i) => {
              if (!cell) return <View key={i} style={s.dayCell} />;
              const floors = dayFloors[cell.key] ?? 0;
              const climbed = floors > 0;
              const isToday = cell.key === todayKey;
              const isPast = cell.key < todayKey;
              const isSuggested = !isPast && suggested.has(cell.weekday);
              const hasReminder = reminders.has(cell.key);
              return (
                <TouchableOpacity
                  key={i}
                  style={s.dayCell}
                  activeOpacity={0.7}
                  onPress={() => toggleReminder(cell.key, isPast)}
                >
                  <View
                    style={[
                      s.dayCircle,
                      climbed && { backgroundColor: ACCENT },
                      !climbed && isSuggested && s.dayCircleSuggested,
                      isToday && s.dayCircleToday,
                    ]}
                  >
                    <Text style={[
                      s.dayNumber,
                      climbed && { color: '#FFFFFF' },
                      !climbed && isDark && { color: '#D1D5DB' },
                    ]}>
                      {cell.day}
                    </Text>
                  </View>
                  {hasReminder && (
                    <Ionicons name="notifications" size={9} color="#F59E0B" style={s.reminderDot} />
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      </ScrollView>

      {editingGoal && (
        <View style={s.modalOverlay}>
          <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={() => setEditingGoal(false)} />
          <View style={[s.modalCard, isDark && { backgroundColor: '#1F2937' }]}>
            <Text style={[s.modalTitle, isDark && { color: '#F9FAFB' }]}>Weekly goal</Text>
            <Text style={[s.modalSub, isDark && { color: '#9CA3AF' }]}>Floors per week. Your monthly goal and next-month projection are calculated from this automatically.</Text>
            <TextInput
              style={[s.modalInput, isDark && { backgroundColor: '#111827', color: '#F9FAFB', borderColor: '#374151' }]}
              value={goalInput}
              onChangeText={setGoalInput}
              keyboardType="number-pad"
              maxLength={5}
              autoFocus
            />
            <View style={s.modalActions}>
              <TouchableOpacity style={s.modalCancelBtn} onPress={() => setEditingGoal(false)}>
                <Text style={s.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.modalSaveBtn, savingGoal && { opacity: 0.6 }]} onPress={saveGoal} disabled={savingGoal}>
                {savingGoal ? <ActivityIndicator size="small" color="#FFF" /> : <Text style={s.modalSaveText}>Save</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}

      <SettingsModal
        visible={settingsVisible}
        onClose={() => setSettingsVisible(false)}
        isDark={isDark}
        themeMode={themeMode}
        onSetThemeMode={onSetThemeMode ?? (() => {})}
        profile={myProfile}
        onChangeSkin={handleChangeSkin}
        onPhotoChanged={handlePhotoChanged}
        onRequestSignIn={() => { setSettingsVisible(false); setAuthPromptVisible(true); }}
      />
      <HelpFeedbackModal visible={helpVisible} onClose={() => setHelpVisible(false)} isDark={isDark} />
      <AuthPrompt visible={authPromptVisible} reason="sync your climbs and settings across devices" onClose={() => setAuthPromptVisible(false)} />
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F9FAFB' },
  center: { alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: 56, paddingBottom: 12, paddingHorizontal: 20,
    backgroundColor: '#FFFFFF', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E5E7EB',
  },
  headerTitle: { fontSize: 28, fontWeight: '800', color: '#111827', letterSpacing: -0.5 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  scrollContent: { padding: 16, paddingBottom: 48 },

  card: {
    backgroundColor: '#FFFFFF', borderRadius: 16, padding: 18, marginBottom: 16,
    elevation: 1, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 6,
  },
  cardHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  cardTitle: { fontSize: 16, fontWeight: '800', color: '#111827' },
  editBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 4, paddingHorizontal: 8 },
  editBtnText: { fontSize: 12.5, fontWeight: '700', color: ACCENT },

  goalRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  goalLabel: { fontSize: 13, color: '#6B7280', fontWeight: '600' },
  goalValue: { fontSize: 13, color: '#111827', fontWeight: '700' },
  track: { height: 8, borderRadius: 4, backgroundColor: '#E5E7EB', overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 4 },

  projectionBox: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    backgroundColor: '#EFF6FF', borderRadius: 12, padding: 12, marginTop: 16,
  },
  projectionText: { flex: 1, fontSize: 12.5, color: '#374151', lineHeight: 18 },

  calendarHint: { fontSize: 12, color: '#9CA3AF', lineHeight: 16, marginBottom: 14 },
  weekLabelRow: { flexDirection: 'row', marginBottom: 6 },
  weekLabel: { flex: 1, textAlign: 'center', fontSize: 11, fontWeight: '700', color: '#9CA3AF' },
  calendarGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  dayCell: { width: `${100 / 7}%`, aspectRatio: 1, alignItems: 'center', justifyContent: 'center', position: 'relative' },
  dayCircle: {
    width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center',
  },
  dayCircleSuggested: { borderWidth: 1.5, borderColor: ACCENT, borderStyle: 'dashed' },
  dayCircleToday: { borderWidth: 1.5, borderColor: '#F59E0B' },
  dayNumber: { fontSize: 12, fontWeight: '600', color: '#374151' },
  reminderDot: { position: 'absolute', top: 2, right: 10 },

  modalOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  modalCard: { backgroundColor: '#FFFFFF', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 32 },
  modalTitle: { fontSize: 17, fontWeight: '800', color: '#111827', marginBottom: 6 },
  modalSub: { fontSize: 12.5, color: '#6B7280', lineHeight: 18, marginBottom: 14 },
  modalInput: {
    backgroundColor: '#F3F4F6', borderWidth: 1.5, borderColor: '#E5E7EB', borderRadius: 12,
    padding: 14, fontSize: 20, fontWeight: '700', color: '#111827', textAlign: 'center', marginBottom: 16,
  },
  modalActions: { flexDirection: 'row', gap: 10 },
  modalCancelBtn: { flex: 1, alignItems: 'center', paddingVertical: 14, borderRadius: 12, backgroundColor: '#F3F4F6' },
  modalCancelText: { fontWeight: '700', color: '#6B7280' },
  modalSaveBtn: { flex: 1, alignItems: 'center', paddingVertical: 14, borderRadius: 12, backgroundColor: ACCENT },
  modalSaveText: { fontWeight: '700', color: '#FFFFFF' },
});
