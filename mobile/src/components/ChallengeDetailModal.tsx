import { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, Modal, TouchableOpacity, ScrollView, Share, Dimensions, ActivityIndicator } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { supabase } from '../config/supabase';
import { useAuth } from '../contexts/AuthContext';
import MascotAvatar from './MascotAvatar';
import { avatarUriFor } from '../utils/avatarUri';
import MedalBadge, { medalEmblemFor } from './MedalBadge';
import SceneryBanner from './SceneryBanner';
import type { Challenge, Profile } from '../types';

interface Props {
  challenge: Challenge | null;
  visible: boolean;
  onClose: () => void;
  joined: boolean;
  progressFloors: number;
  onJoin: () => void;
  isDark?: boolean;
  /** Computed display name for generic (non-branded) challenges — falls back to challenge.title when absent. */
  displayTitleOverride?: string;
  /** Computed display description for generic challenges — falls back to challenge.description (which is otherwise stale/desynced from target_floors for generic ones). */
  displayDescriptionOverride?: string;
}

export const PRIMARY_BLUE = '#2563EB';

// A varied palette keyed off the challenge id — not a difficulty ranking,
// just visual variety so cards don't all look the same.
const CHALLENGE_PALETTE = ['#2563EB', '#7C3AED', '#0D9488', '#DB2777', '#D97706', '#059669'];
export function challengeColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return CHALLENGE_PALETTE[hash % CHALLENGE_PALETTE.length];
}

function formatDateRange(startIso: string, endIso: string): string {
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  return `${new Date(startIso).toLocaleDateString(undefined, opts)} – ${new Date(endIso).toLocaleDateString(undefined, opts)}`;
}

interface LbRow { user_id: string; floors: number; }

export default function ChallengeDetailModal({ challenge, visible, onClose, joined, progressFloors, onJoin, isDark = false, displayTitleOverride, displayDescriptionOverride }: Props) {
  const { user } = useAuth();
  const [leaderboard, setLeaderboard] = useState<LbRow[]>([]);
  const [profilesMap, setProfilesMap] = useState<Record<string, Profile>>({});
  const [lbLoading, setLbLoading] = useState(true);

  const loadLeaderboard = useCallback(async () => {
    if (!challenge) return;
    setLbLoading(true);
    const { data: participants } = await supabase.from('challenge_participants').select('user_id').eq('challenge_id', challenge.challenge_id);
    const userIds = [...new Set((participants ?? []).map((p: any) => p.user_id))];
    if (userIds.length === 0) { setLeaderboard([]); setLbLoading(false); return; }

    let climbsQuery = supabase.from('climbs').select('user_id, floors_climbed, created_at').in('user_id', userIds);
    if (challenge.starts_at && challenge.ends_at) {
      climbsQuery = climbsQuery.gte('created_at', challenge.starts_at).lte('created_at', challenge.ends_at);
    } else {
      const days = challenge.period === 'monthly' ? 30 : 7;
      climbsQuery = climbsQuery.gte('created_at', new Date(Date.now() - days * 86400000).toISOString());
    }

    const [{ data: climbs }, { data: profiles }] = await Promise.all([
      climbsQuery,
      supabase.from('profiles').select('*').in('user_id', userIds),
    ]);

    const totals: Record<string, number> = {};
    for (const c of (climbs ?? []) as any[]) totals[c.user_id] = (totals[c.user_id] ?? 0) + c.floors_climbed;
    for (const id of userIds) if (!(id in totals)) totals[id] = 0;

    if (profiles) {
      const map: Record<string, Profile> = {};
      for (const p of profiles as Profile[]) map[p.user_id] = p;
      setProfilesMap(map);
    }
    setLeaderboard(
      Object.entries(totals)
        .map(([user_id, floors]) => ({ user_id, floors }))
        .sort((a, b) => b.floors - a.floors)
        .slice(0, 10),
    );
    setLbLoading(false);
  }, [challenge]);

  useEffect(() => { if (visible && challenge) loadLeaderboard(); }, [visible, challenge?.challenge_id, loadLeaderboard]);

  if (!challenge) return null;

  const color = challengeColor(challenge.challenge_id);
  const pct = Math.min(100, Math.round((progressFloors / challenge.target_floors) * 100));
  const completed = joined && pct >= 100;
  const isLimitedTime = !!(challenge.starts_at && challenge.ends_at);
  const title = displayTitleOverride ?? challenge.title;
  const description = displayDescriptionOverride ?? challenge.description;
  const imageHeight = Math.round(Dimensions.get('window').height / 3);

  const handleShare = () => {
    Share.share({
      message: `I'm taking on "${title}" on Vertical — ${description} Join me!`,
      title,
    });
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={[st.container, isDark && { backgroundColor: '#111827' }]}>
        <SceneryBanner variant="mountains" height={imageHeight} borderRadius={0}>
          <TouchableOpacity style={st.closeBtn} onPress={onClose}>
            <Ionicons name="close" size={24} color="#FFFFFF" />
          </TouchableOpacity>
          <View style={st.heroMedalWrap}>
            <View style={{ position: 'relative' }}>
              <MedalBadge color={color} emblem={medalEmblemFor(challenge.reward_icon, challenge.badge_key, challenge.generic_name)} size={84} />
              {completed && (
                <View style={st.heroBadgeCheck}>
                  <Ionicons name="checkmark-circle" size={20} color="#10B981" />
                </View>
              )}
            </View>
          </View>
        </SceneryBanner>

        {/* Pull-up sheet: rounded top corners overlapping the image, drag handle for affordance */}
        <View style={[st.sheet, isDark && { backgroundColor: '#111827' }]}>
          <View style={[st.sheetHandle, isDark && { backgroundColor: '#4B5563' }]} />
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={st.body}>
            <Text style={[st.title, isDark && { color: '#F9FAFB' }]}>{title}</Text>

            <View style={st.orgRow}>
              <Ionicons name="flag-outline" size={14} color="#9CA3AF" />
              <Text style={st.orgText}>Organized by {challenge.organizer}</Text>
            </View>

            <View style={st.pillRow}>
              {isLimitedTime ? (
                <View style={[st.pill, { backgroundColor: color + '1A' }]}>
                  <Ionicons name="calendar-outline" size={12} color={color} />
                  <Text style={[st.pillText, { color, marginLeft: 4 }]}>{formatDateRange(challenge.starts_at!, challenge.ends_at!)}</Text>
                </View>
              ) : (
                <View style={[st.pill, isDark && { backgroundColor: '#374151' }]}>
                  <Text style={[st.pillText, { color: isDark ? '#D1D5DB' : '#6B7280' }]}>
                    {challenge.period === 'monthly' ? 'RESETS MONTHLY' : 'RESETS WEEKLY'}
                  </Text>
                </View>
              )}
              <View style={[st.pill, isDark && { backgroundColor: '#374151' }]}>
                <Text style={[st.pillText, { color: isDark ? '#D1D5DB' : '#6B7280' }]}>{challenge.target_floors} FLOORS</Text>
              </View>
            </View>

            <Text style={[st.sectionLabel, isDark && { color: '#9CA3AF' }]}>Challenge Details</Text>
            <Text style={[st.description, isDark && { color: '#D1D5DB' }]}>{description}</Text>

            {challenge.badge_key && (
              <View style={[st.rewardNote, isDark && { backgroundColor: '#1F2937' }]}>
                <Ionicons name="ribbon-outline" size={16} color="#F59E0B" />
                <Text style={[st.rewardNoteText, isDark && { color: '#D1D5DB' }]}>
                  Completing this awards the <Text style={{ fontWeight: '800' }}>{challenge.reward_label}</Text> — a real badge on your profile.
                  {challenge.generic_name ? ' Resets monthly — complete it again to keep it active.' : ''}
                </Text>
              </View>
            )}

            {joined && (
              <View style={st.progressBlock}>
                <View style={st.progressTrack}>
                  <View style={[st.progressFill, { width: `${pct}%`, backgroundColor: color }]} />
                </View>
                <Text style={[st.progressText, isDark && { color: '#9CA3AF' }]}>
                  {completed ? 'Completed!' : `${progressFloors} / ${challenge.target_floors} floors (${pct}%)`}
                </Text>
              </View>
            )}

            {!joined && (
              <TouchableOpacity style={st.joinBtn} onPress={onJoin}>
                <Text style={st.joinBtnText}>Join Challenge</Text>
              </TouchableOpacity>
            )}

            <Text style={[st.sectionLabel, isDark && { color: '#9CA3AF' }, { marginTop: 8 }]}>Leaderboard</Text>
            {lbLoading ? (
              <ActivityIndicator size="small" color={PRIMARY_BLUE} style={{ marginVertical: 16 }} />
            ) : leaderboard.length === 0 ? (
              <Text style={[st.lbEmpty, isDark && { color: '#6B7280' }]}>No one has joined yet — be the first.</Text>
            ) : (
              <View style={[st.lbCard, isDark && { backgroundColor: '#1F2937' }]}>
                {leaderboard.map((row, i) => (
                  <View key={row.user_id} style={[st.lbRow, i > 0 && st.lbRowBorder, i > 0 && isDark && { borderTopColor: '#374151' }]}>
                    <Text style={[st.lbRank, i < 3 && st.lbRankTop]}>{i + 1}</Text>
                    <MascotAvatar skinIdx={profilesMap[row.user_id]?.avatar_idx ?? 0} photoUri={avatarUriFor(profilesMap[row.user_id])} size={28} />
                    <Text style={[st.lbName, isDark && { color: '#F9FAFB' }]} numberOfLines={1}>
                      {row.user_id === user?.id ? 'You' : (profilesMap[row.user_id]?.display_name ?? `Climber${row.user_id.slice(0, 4)}`)}
                    </Text>
                    <Text style={st.lbFloors}>{row.floors} fl</Text>
                  </View>
                ))}
              </View>
            )}

            <TouchableOpacity style={[st.shareBtn, isDark && { backgroundColor: '#1F2937' }]} onPress={handleShare}>
              <Ionicons name="share-social-outline" size={18} color={isDark ? '#D1D5DB' : '#374151'} />
              <Text style={[st.shareBtnText, isDark && { color: '#D1D5DB' }]}>Share Challenge</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const st = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F9FAFB' },
  closeBtn: { position: 'absolute', top: 52, right: 16, padding: 6, zIndex: 1 },
  heroMedalWrap: { position: 'absolute', bottom: -34, left: 20 },
  heroBadgeCheck: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
  },
  sheet: {
    flex: 1,
    backgroundColor: '#F9FAFB',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    marginTop: -20,
  },
  sheetHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: '#D1D5DB', alignSelf: 'center', marginTop: 10 },
  body: { padding: 20, paddingTop: 30, paddingBottom: 48 },
  title: { fontSize: 22, fontWeight: '800', color: '#111827', marginBottom: 8 },
  orgRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 16 },
  orgText: { fontSize: 13, color: '#9CA3AF', fontWeight: '500' },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 24 },
  pill: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#F3F4F6', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 },
  pillText: { fontSize: 10.5, fontWeight: '800', letterSpacing: 0.4 },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#9CA3AF',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  description: { fontSize: 14.5, color: '#374151', lineHeight: 21, marginBottom: 16 },
  rewardNote: {
    flexDirection: 'row',
    gap: 10,
    backgroundColor: '#FFFBEB',
    borderRadius: 12,
    padding: 14,
    marginBottom: 24,
  },
  rewardNoteText: { flex: 1, fontSize: 12.5, color: '#374151', lineHeight: 18 },
  progressBlock: { marginBottom: 20 },
  progressTrack: { height: 10, borderRadius: 5, backgroundColor: '#F3F4F6', overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 5 },
  progressText: { fontSize: 13, fontWeight: '600', color: '#6B7280', marginTop: 8 },
  joinBtn: { backgroundColor: PRIMARY_BLUE, borderRadius: 12, paddingVertical: 15, alignItems: 'center', marginBottom: 12 },
  joinBtnText: { color: '#FFFFFF', fontWeight: '700', fontSize: 15 },
  lbEmpty: { fontSize: 12.5, color: '#9CA3AF', marginBottom: 20 },
  lbCard: { backgroundColor: '#FFFFFF', borderRadius: 14, padding: 4, marginBottom: 24 },
  lbRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9, paddingHorizontal: 10 },
  lbRowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#F3F4F6' },
  lbRank: { width: 18, fontSize: 13, fontWeight: '700', color: '#9CA3AF', textAlign: 'center' },
  lbRankTop: { color: '#F59E0B' },
  lbName: { flex: 1, fontSize: 13.5, fontWeight: '600', color: '#111827' },
  lbFloors: { fontSize: 12.5, fontWeight: '700', color: '#10B981' },
  shareBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#F3F4F6',
    borderRadius: 12,
    paddingVertical: 13,
  },
  shareBtnText: { fontSize: 14, fontWeight: '700', color: '#374151' },
});
