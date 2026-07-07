import { useState, useEffect, useCallback } from 'react';
import { View, Text, Modal, TouchableOpacity, ScrollView, ActivityIndicator, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { supabase } from '../config/supabase';
import MascotAvatar from './MascotAvatar';
import BadgeDetailModal from './BadgeDetailModal';
import { computeXP, computeLevelProgress } from '../utils/leveling';
import { BADGE_DEFS } from '../types';
import type { Profile, UserBadge, BadgeDef } from '../types';

interface Props {
  userId: string | null;
  visible: boolean;
  onClose: () => void;
}

/** Read-only view of someone else's profile — no follow graph yet, just
 * identity + stats + badges, reachable by tapping a name in the feed,
 * leaderboard, or search results. */
export default function PublicProfileModal({ userId, visible, onClose }: Props) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [badges, setBadges] = useState<UserBadge[]>([]);
  const [verifiedCount, setVerifiedCount] = useState(0);
  const [stats, setStats] = useState({ climbs: 0, floors: 0, tallest: 0 });
  const [loading, setLoading] = useState(true);
  const [selectedBadge, setSelectedBadge] = useState<BadgeDef | null>(null);

  const load = useCallback(async () => {
    if (!userId) return;
    setLoading(true);

    const [{ data: profileData }, { data: climbs }, { data: badgeData }, { count }] = await Promise.all([
      supabase.from('profiles').select('*').eq('user_id', userId).maybeSingle(),
      supabase.from('climbs').select('floors_climbed, climb_qty, partial_floors').eq('user_id', userId),
      supabase.from('user_badges').select('*').eq('user_id', userId),
      supabase.from('height_verifications').select('*', { count: 'exact', head: true }).eq('user_id', userId).eq('status', 'active'),
    ]);

    if (profileData) setProfile(profileData as Profile);
    if (badgeData) setBadges(badgeData as UserBadge[]);
    setVerifiedCount(count ?? 0);
    if (climbs) {
      const floors = climbs.reduce((s, c: any) => s + c.floors_climbed, 0);
      const tallest = climbs.reduce((m, c: any) => {
        const storeys = c.climb_qty > 0 ? Math.round((c.floors_climbed - (c.partial_floors ?? 0)) / c.climb_qty) : c.floors_climbed;
        return Math.max(m, storeys);
      }, 0);
      setStats({ climbs: climbs.length, floors, tallest });
    }
    setLoading(false);
  }, [userId]);

  useEffect(() => { if (visible) load(); }, [visible, load]);

  // Hidden badges only show up here once the person has actually earned them
  const visibleBadgeDefs = BADGE_DEFS.filter((d) => !d.hidden || badges.some((b) => b.badge_key === d.key));
  const earnedBadges = new Map(badges.map((b) => [b.badge_key, b.earned_at]));
  const levelInfo = computeLevelProgress(computeXP(stats.floors, badges.length, verifiedCount));
  const featuredBadgeDef = profile?.featured_badge ? BADGE_DEFS.find((d) => d.key === profile.featured_badge) : null;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          {loading ? (
            <View style={styles.center}><ActivityIndicator size="large" color="#2563EB" /></View>
          ) : (
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
              <View style={styles.header}>
                <View>
                  <MascotAvatar skinIdx={profile?.avatar_idx ?? 0} size={72} />
                  <View style={styles.levelChip}>
                    <Text style={styles.levelChipText}>Lv {levelInfo.level}</Text>
                  </View>
                </View>
                <View style={styles.nameRow}>
                  {featuredBadgeDef && (
                    <Ionicons name={featuredBadgeDef.icon as any} size={16} color="#F59E0B" style={{ marginRight: 5 }} />
                  )}
                  <Text style={styles.name}>{profile?.display_name ?? 'Climber'}</Text>
                </View>
              </View>

              <View style={styles.statsRow}>
                <View style={styles.statItem}>
                  <Text style={styles.statValue}>{stats.climbs}</Text>
                  <Text style={styles.statLabel}>Climbs</Text>
                </View>
                <View style={styles.statItem}>
                  <Text style={styles.statValue}>{stats.floors}</Text>
                  <Text style={styles.statLabel}>Floors</Text>
                </View>
                <View style={styles.statItem}>
                  <Text style={styles.statValue}>{stats.tallest || '—'}</Text>
                  <Text style={styles.statLabel}>Tallest</Text>
                </View>
              </View>

              <Text style={styles.sectionTitle}>Badges ({badges.length})</Text>
              <View style={styles.badgeGrid}>
                {visibleBadgeDefs.map((def) => {
                  const earned = badges.some((b) => b.badge_key === def.key);
                  return (
                    <TouchableOpacity
                      key={def.key}
                      style={[styles.badgeItem, !earned && styles.badgeLocked]}
                      onPress={() => setSelectedBadge(def)}
                      activeOpacity={0.7}
                    >
                      <Ionicons name={def.icon as any} size={22} color={earned ? '#60A5FA' : '#D1D5DB'} />
                      <Text style={[styles.badgeName, !earned && styles.badgeNameLocked]} numberOfLines={1}>{def.name}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </ScrollView>
          )}
        </View>
      </View>

      <BadgeDetailModal
        badge={selectedBadge}
        earned={!!selectedBadge && earnedBadges.has(selectedBadge.key)}
        earnedAt={selectedBadge ? earnedBadges.get(selectedBadge.key) : undefined}
        onClose={() => setSelectedBadge(null)}
      />
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'transparent' },
  backdrop: { height: '15%' },
  sheet: { height: '85%', backgroundColor: '#FFFFFF', borderTopLeftRadius: 20, borderTopRightRadius: 20, overflow: 'hidden' },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: '#D1D5DB', alignSelf: 'center', marginTop: 10 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: 20, paddingBottom: 48 },
  header: { alignItems: 'center', marginBottom: 20 },
  levelChip: {
    position: 'absolute', top: -4, left: -6,
    backgroundColor: '#7C3AED', borderRadius: 10, paddingVertical: 2, paddingHorizontal: 8,
    borderWidth: 2, borderColor: '#FFFFFF',
  },
  levelChipText: { fontSize: 10, fontWeight: '800', color: '#FFFFFF' },
  nameRow: { flexDirection: 'row', alignItems: 'center', marginTop: 10 },
  name: { fontSize: 20, fontWeight: '800', color: '#111827' },
  statsRow: { flexDirection: 'row', backgroundColor: '#F9FAFB', borderRadius: 14, paddingVertical: 16, marginBottom: 24 },
  statItem: { flex: 1, alignItems: 'center' },
  statValue: { fontSize: 20, fontWeight: '800', color: '#111827' },
  statLabel: { fontSize: 11, fontWeight: '600', color: '#6B7280', marginTop: 3, textTransform: 'uppercase', letterSpacing: 0.5 },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: '#6B7280', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 12 },
  badgeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  badgeItem: { width: 76, alignItems: 'center', paddingVertical: 10, backgroundColor: '#FFFFFF', borderRadius: 12, elevation: 1 },
  badgeLocked: { backgroundColor: '#F3F4F6', opacity: 0.5 },
  badgeName: { fontSize: 9.5, fontWeight: '600', color: '#374151', marginTop: 5, textAlign: 'center' },
  badgeNameLocked: { color: '#9CA3AF' },
});
