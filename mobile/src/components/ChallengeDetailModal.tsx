import { View, Text, StyleSheet, Modal, TouchableOpacity, ScrollView, Share } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import type { Challenge } from '../types';

interface Props {
  challenge: Challenge | null;
  visible: boolean;
  onClose: () => void;
  joined: boolean;
  progressFloors: number;
  onJoin: () => void;
  isDark?: boolean;
}

const DIFFICULTY_COLOR: Record<string, string> = { easy: '#10B981', medium: '#F59E0B', hard: '#EF4444', insane: '#7C3AED' };

function daysUntil(iso: string): number {
  return Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000));
}

export default function ChallengeDetailModal({ challenge, visible, onClose, joined, progressFloors, onJoin, isDark = false }: Props) {
  if (!challenge) return null;

  const color = DIFFICULTY_COLOR[challenge.difficulty] ?? '#6B7280';
  const pct = Math.min(100, Math.round((progressFloors / challenge.target_floors) * 100));
  const completed = joined && pct >= 100;
  const isLimitedTime = !!(challenge.starts_at && challenge.ends_at);

  const handleShare = () => {
    Share.share({
      message: `I'm taking on "${challenge.title}" on Vertical — ${challenge.description} Join me!`,
      title: challenge.title,
    });
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={[st.container, isDark && { backgroundColor: '#111827' }]}>
        <ScrollView showsVerticalScrollIndicator={false}>
          {/* Hero */}
          <View style={[st.hero, { backgroundColor: color }]}>
            <TouchableOpacity style={st.closeBtn} onPress={onClose}>
              <Ionicons name="close" size={24} color="#FFFFFF" />
            </TouchableOpacity>
            <View style={st.heroBadge}>
              <Ionicons name={challenge.reward_icon as any} size={48} color="#FFFFFF" />
              {completed && (
                <View style={st.heroBadgeCheck}>
                  <Ionicons name="checkmark-circle" size={22} color="#10B981" />
                </View>
              )}
            </View>
            <Text style={st.heroRewardLabel}>{challenge.reward_label}</Text>
          </View>

          <View style={st.body}>
            <Text style={[st.title, isDark && { color: '#F9FAFB' }]}>{challenge.title}</Text>

            <View style={st.orgRow}>
              <Ionicons name="flag-outline" size={14} color="#9CA3AF" />
              <Text style={st.orgText}>Organized by {challenge.organizer}</Text>
            </View>

            <View style={st.pillRow}>
              <View style={[st.pill, { backgroundColor: color + '1A' }]}>
                <Text style={[st.pillText, { color }]}>{challenge.difficulty.toUpperCase()}</Text>
              </View>
              {isLimitedTime ? (
                <View style={[st.pill, { backgroundColor: '#FEE2E2' }]}>
                  <Text style={[st.pillText, { color: '#EF4444' }]}>{daysUntil(challenge.ends_at!)}D LEFT</Text>
                </View>
              ) : (
                <View style={[st.pill, isDark && { backgroundColor: '#374151' }]}>
                  <Text style={[st.pillText, { color: isDark ? '#D1D5DB' : '#6B7280' }]}>
                    {challenge.period === 'monthly' ? 'MONTHLY' : 'WEEKLY'}
                  </Text>
                </View>
              )}
              <View style={[st.pill, isDark && { backgroundColor: '#374151' }]}>
                <Text style={[st.pillText, { color: isDark ? '#D1D5DB' : '#6B7280' }]}>{challenge.target_floors} FLOORS</Text>
              </View>
            </View>

            <Text style={[st.sectionLabel, isDark && { color: '#9CA3AF' }]}>Challenge Details</Text>
            <Text style={[st.description, isDark && { color: '#D1D5DB' }]}>{challenge.description}</Text>

            {challenge.badge_key && (
              <View style={[st.rewardNote, isDark && { backgroundColor: '#1F2937' }]}>
                <Ionicons name="ribbon-outline" size={16} color="#F59E0B" />
                <Text style={[st.rewardNoteText, isDark && { color: '#D1D5DB' }]}>
                  Completing this awards the <Text style={{ fontWeight: '800' }}>{challenge.reward_label}</Text> — a real badge on your profile.
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
              <TouchableOpacity style={[st.joinBtn, { backgroundColor: color }]} onPress={onJoin}>
                <Text style={st.joinBtnText}>Join Challenge</Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity style={[st.shareBtn, isDark && { backgroundColor: '#1F2937' }]} onPress={handleShare}>
              <Ionicons name="share-social-outline" size={18} color={isDark ? '#D1D5DB' : '#374151'} />
              <Text style={[st.shareBtnText, isDark && { color: '#D1D5DB' }]}>Share Challenge</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

const st = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F9FAFB' },
  hero: { paddingTop: 56, paddingBottom: 28, alignItems: 'center' },
  closeBtn: { position: 'absolute', top: 52, right: 16, padding: 6, zIndex: 1 },
  heroBadge: {
    width: 92,
    height: 92,
    borderRadius: 46,
    backgroundColor: 'rgba(255,255,255,0.22)',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 16,
  },
  heroBadgeCheck: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
  },
  heroRewardLabel: { fontSize: 14, fontWeight: '700', color: '#FFFFFF', marginTop: 12, opacity: 0.95 },
  body: { padding: 20, paddingBottom: 48 },
  title: { fontSize: 22, fontWeight: '800', color: '#111827', marginBottom: 8 },
  orgRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 16 },
  orgText: { fontSize: 13, color: '#9CA3AF', fontWeight: '500' },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 24 },
  pill: { backgroundColor: '#F3F4F6', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 },
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
  joinBtn: { borderRadius: 12, paddingVertical: 15, alignItems: 'center', marginBottom: 12 },
  joinBtnText: { color: '#FFFFFF', fontWeight: '700', fontSize: 15 },
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
