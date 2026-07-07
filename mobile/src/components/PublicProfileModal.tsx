import { useState, useEffect, useCallback } from 'react';
import { View, Text, Modal, TouchableOpacity, ScrollView, ActivityIndicator, Image, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { supabase } from '../config/supabase';
import { useAuth } from '../contexts/AuthContext';
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

interface PostItem {
  climb_id: string;
  floors_climbed: number;
  caption: string | null;
  photo_path: string | null;
  created_at: string;
  blk_no: string;
  street: string;
}

function formatRelativeTime(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/** Read-only view of someone else's profile — identity, stats, their posts,
 * and a follow button. Reachable by tapping a name in the feed, leaderboard,
 * or search results. */
export default function PublicProfileModal({ userId, visible, onClose }: Props) {
  const { user } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [badges, setBadges] = useState<UserBadge[]>([]);
  const [verifiedCount, setVerifiedCount] = useState(0);
  const [stats, setStats] = useState({ climbs: 0, floors: 0, tallest: 0 });
  const [posts, setPosts] = useState<PostItem[]>([]);
  const [followerCount, setFollowerCount] = useState(0);
  const [isFollowing, setIsFollowing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [selectedBadge, setSelectedBadge] = useState<BadgeDef | null>(null);

  const load = useCallback(async () => {
    if (!userId) return;
    setLoading(true);

    const [
      { data: profileData },
      { data: climbs },
      { data: badgeData },
      { count },
      { data: followData },
      { data: myFollow },
    ] = await Promise.all([
      supabase.from('profiles').select('*').eq('user_id', userId).maybeSingle(),
      supabase.from('climbs').select('climb_id, floors_climbed, climb_qty, partial_floors, caption, photo_path, created_at, blocks(blk_no, street)').eq('user_id', userId),
      supabase.from('user_badges').select('*').eq('user_id', userId),
      supabase.from('height_verifications').select('*', { count: 'exact', head: true }).eq('user_id', userId).eq('status', 'active'),
      supabase.from('follow_counts').select('followers_count').eq('user_id', userId).maybeSingle(),
      user ? supabase.from('follows').select('follower_id').eq('follower_id', user.id).eq('followee_id', userId).maybeSingle() : Promise.resolve({ data: null }),
    ]);

    if (profileData) setProfile(profileData as Profile);
    if (badgeData) setBadges(badgeData as UserBadge[]);
    setVerifiedCount(count ?? 0);
    setFollowerCount((followData as any)?.followers_count ?? 0);
    setIsFollowing(!!myFollow);

    if (climbs) {
      const floors = climbs.reduce((s, c: any) => s + c.floors_climbed, 0);
      const tallest = climbs.reduce((m, c: any) => {
        const storeys = c.climb_qty > 0 ? Math.round((c.floors_climbed - (c.partial_floors ?? 0)) / c.climb_qty) : c.floors_climbed;
        return Math.max(m, storeys);
      }, 0);
      setStats({ climbs: climbs.length, floors, tallest });

      // "Posts" = climbs they chose to add a caption or photo to — plain
      // climb-logging stays private-feeling by not surfacing every log here.
      const withContent = (climbs as any[])
        .filter((c) => c.caption || c.photo_path)
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .map((c) => ({
          climb_id: c.climb_id,
          floors_climbed: c.floors_climbed,
          caption: c.caption,
          photo_path: c.photo_path,
          created_at: c.created_at,
          blk_no: c.blocks?.blk_no ?? '',
          street: c.blocks?.street ?? '',
        }));
      setPosts(withContent);
    }
    setLoading(false);
  }, [userId, user]);

  useEffect(() => { if (visible) load(); }, [visible, load]);

  const handleToggleFollow = async () => {
    if (!user || !userId) return;
    setIsFollowing((prev) => !prev); // optimistic
    setFollowerCount((prev) => prev + (isFollowing ? -1 : 1));

    if (isFollowing) {
      await supabase.from('follows').delete().eq('follower_id', user.id).eq('followee_id', userId);
    } else {
      await supabase.from('follows').insert({ follower_id: user.id, followee_id: userId });
    }
  };

  const earnedBadges = new Map(badges.map((b) => [b.badge_key, b.earned_at]));
  const levelInfo = computeLevelProgress(computeXP(stats.floors, badges.length, verifiedCount));
  const featuredBadgeDef = profile?.featured_badge ? BADGE_DEFS.find((d) => d.key === profile.featured_badge) : null;
  const isSelf = user?.id === userId;

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
                <Text style={styles.name}>{profile?.display_name ?? 'Climber'}</Text>
                <Text style={styles.followerCount}>{followerCount} follower{followerCount !== 1 ? 's' : ''}</Text>

                {!isSelf && user && (
                  <TouchableOpacity
                    style={[styles.followBtn, isFollowing && styles.followBtnActive]}
                    onPress={handleToggleFollow}
                    activeOpacity={0.8}
                  >
                    <Ionicons name={isFollowing ? 'checkmark' : 'person-add-outline'} size={16} color={isFollowing ? '#374151' : '#FFF'} />
                    <Text style={[styles.followBtnText, isFollowing && { color: '#374151' }]}>
                      {isFollowing ? 'Added' : 'Add'}
                    </Text>
                  </TouchableOpacity>
                )}
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

              {/* Featured badge only — the full collection is for their own
                  profile; here it's just the one thing they chose to show. */}
              <Text style={styles.sectionTitle}>Badge</Text>
              {featuredBadgeDef ? (
                <TouchableOpacity style={styles.featuredBadgeRow} onPress={() => setSelectedBadge(featuredBadgeDef)} activeOpacity={0.7}>
                  <Ionicons name={featuredBadgeDef.icon as any} size={26} color="#F59E0B" />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.featuredBadgeName}>{featuredBadgeDef.name}</Text>
                    <Text style={styles.featuredBadgeSub}>{badges.length} badge{badges.length !== 1 ? 's' : ''} earned in total</Text>
                  </View>
                </TouchableOpacity>
              ) : (
                <Text style={styles.emptyText}>{badges.length} badge{badges.length !== 1 ? 's' : ''} earned — no featured badge chosen yet.</Text>
              )}

              <Text style={[styles.sectionTitle, { marginTop: 24 }]}>Posts ({posts.length})</Text>
              {posts.length > 0 ? (
                posts.map((post) => (
                  <View key={post.climb_id} style={styles.postCard}>
                    <Text style={styles.postBody}>
                      Climbed <Text style={styles.postFloors}>{post.floors_climbed} floors</Text>
                      {post.blk_no ? ` at Blk ${post.blk_no} ${post.street}` : ''}
                    </Text>
                    {post.caption && <Text style={styles.postCaption}>{post.caption}</Text>}
                    {post.photo_path && (
                      <Image
                        source={{ uri: supabase.storage.from('building-photos').getPublicUrl(post.photo_path).data.publicUrl }}
                        style={styles.postPhoto}
                      />
                    )}
                    <Text style={styles.postTime}>{formatRelativeTime(post.created_at)}</Text>
                  </View>
                ))
              ) : (
                <Text style={styles.emptyText}>No posts yet — climbs with a photo or note show up here.</Text>
              )}
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
  name: { fontSize: 20, fontWeight: '800', color: '#111827', marginTop: 10 },
  followerCount: { fontSize: 12.5, color: '#9CA3AF', fontWeight: '500', marginTop: 2 },
  followBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#2563EB', borderRadius: 20, paddingVertical: 8, paddingHorizontal: 18, marginTop: 12,
  },
  followBtnActive: { backgroundColor: '#F3F4F6' },
  followBtnText: { fontSize: 13, fontWeight: '700', color: '#FFFFFF' },
  statsRow: { flexDirection: 'row', backgroundColor: '#F9FAFB', borderRadius: 14, paddingVertical: 16, marginBottom: 24 },
  statItem: { flex: 1, alignItems: 'center' },
  statValue: { fontSize: 20, fontWeight: '800', color: '#111827' },
  statLabel: { fontSize: 11, fontWeight: '600', color: '#6B7280', marginTop: 3, textTransform: 'uppercase', letterSpacing: 0.5 },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: '#6B7280', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 12 },
  featuredBadgeRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#FFF7ED', borderRadius: 12, padding: 14,
  },
  featuredBadgeName: { fontSize: 15, fontWeight: '700', color: '#111827' },
  featuredBadgeSub: { fontSize: 12, color: '#9CA3AF', marginTop: 2 },
  emptyText: { fontSize: 13, color: '#9CA3AF', lineHeight: 19 },
  postCard: { backgroundColor: '#F9FAFB', borderRadius: 12, padding: 14, marginBottom: 10 },
  postBody: { fontSize: 13.5, color: '#374151', marginBottom: 4 },
  postFloors: { fontWeight: '700', color: '#10B981' },
  postCaption: { fontSize: 13.5, color: '#111827', marginTop: 4 },
  postPhoto: { width: '100%', height: 150, borderRadius: 10, marginTop: 8, backgroundColor: '#E5E7EB' },
  postTime: { fontSize: 11, color: '#9CA3AF', marginTop: 8 },
});
