import { useState, useEffect, useCallback } from 'react';
import { View, Text, Modal, TouchableOpacity, ScrollView, TextInput, ActivityIndicator, StyleSheet, KeyboardAvoidingView, Platform, type ImageSourcePropType } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { supabase } from '../config/supabase';
import { useAuth } from '../contexts/AuthContext';
import MascotAvatar from './MascotAvatar';
import { avatarUriFor } from '../utils/avatarUri';
import AuthPrompt from './AuthPrompt';
import SceneryBanner from './SceneryBanner';
import type { SceneryVariant } from './SceneryBanner';
import { PRIMARY_BLUE } from './ChallengeDetailModal';
import type { OfficialClub, ClubMembership, ClubPost, ClubPostReaction, Profile } from '../types';

const CLUB_SCENERY: Record<OfficialClub['category'], SceneryVariant> = {
  'Trail Running': 'sunrise',
  Hiking: 'mountains',
  Climbing: 'mountains',
  Announcements: 'skyline',
};

// Real photo per category — falls back to the illustrated scene above when
// absent (Announcements has no photo, see GroupsScreen's banner instead).
// Single source of truth: the club grid card in GroupsScreen.tsx imports
// this same map so the photo never differs between the card and this modal.
// Bundled local assets (assets/groups/), not hotlinked from Wikimedia at
// runtime — the live CDN rate-limits on-demand thumbnail requests, which a
// one-off curl/browser check won't reveal but real usage hits reliably.
export const CLUB_PHOTO: Partial<Record<OfficialClub['category'], ImageSourcePropType>> = {
  'Trail Running': require('../../assets/groups/club_trail_running.jpg'),
  Hiking: require('../../assets/groups/club_hiking.jpg'),
  Climbing: require('../../assets/groups/club_climbing.jpg'),
};

interface Props {
  club: OfficialClub | null;
  visible: boolean;
  onClose: () => void;
  isDark?: boolean;
}

const QUICK_EMOJI = ['👍', '🔥', '👏', '❤️', '🎉'];

function mondayOfThisWeek(): Date {
  const d = new Date();
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + diff);
  return d;
}
function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function formatRelativeTime(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

interface LeaderboardRow { user_id: string; floors: number; }

export default function ClubDetailModal({ club, visible, onClose, isDark = false }: Props) {
  const { user, isAnonymous } = useAuth();
  const [loading, setLoading] = useState(true);
  const [memberships, setMemberships] = useState<ClubMembership[]>([]);
  const [posts, setPosts] = useState<ClubPost[]>([]);
  const [reactions, setReactions] = useState<ClubPostReaction[]>([]);
  const [profilesMap, setProfilesMap] = useState<Record<string, Profile>>({});
  const [leaderboard, setLeaderboard] = useState<LeaderboardRow[]>([]);
  const [composerText, setComposerText] = useState('');
  const [posting, setPosting] = useState(false);
  const [authPromptVisible, setAuthPromptVisible] = useState(false);

  const myMembership = memberships.find((m) => m.user_id === user?.id);
  const canPost = myMembership?.role === 'organizer' || myMembership?.role === 'admin';

  const load = useCallback(async () => {
    if (!club) return;
    setLoading(true);
    const weekStart = toDateStr(mondayOfThisWeek());

    const [{ data: members }, { data: postRows }] = await Promise.all([
      supabase.from('club_memberships').select('*').eq('club_id', club.club_id),
      supabase.from('club_posts').select('*').eq('club_id', club.club_id).gte('week_start', weekStart).order('created_at', { ascending: false }),
    ]);
    const memberList = (members ?? []) as ClubMembership[];
    setMemberships(memberList);
    const postList = (postRows ?? []) as ClubPost[];
    setPosts(postList);

    const memberIds = memberList.map((m) => m.user_id);
    const postIds = postList.map((p) => p.post_id);
    const authorIds = postList.map((p) => p.author_id);
    const allProfileIds = [...new Set([...memberIds, ...authorIds])];

    const [{ data: reactionRows }, { data: profiles }, { data: climbs }] = await Promise.all([
      postIds.length > 0
        ? supabase.from('club_post_reactions').select('*').in('post_id', postIds)
        : Promise.resolve({ data: [] as ClubPostReaction[] }),
      allProfileIds.length > 0
        ? supabase.from('profiles').select('*').in('user_id', allProfileIds)
        : Promise.resolve({ data: [] as Profile[] }),
      memberIds.length > 0
        ? supabase.from('climbs').select('user_id, floors_climbed, created_at').in('user_id', memberIds).gte('created_at', mondayOfThisWeek().toISOString())
        : Promise.resolve({ data: [] as any[] }),
    ]);
    setReactions((reactionRows ?? []) as ClubPostReaction[]);
    if (profiles) {
      const map: Record<string, Profile> = {};
      for (const p of profiles as Profile[]) map[p.user_id] = p;
      setProfilesMap(map);
    }
    const totals: Record<string, number> = {};
    for (const c of (climbs ?? []) as any[]) totals[c.user_id] = (totals[c.user_id] ?? 0) + c.floors_climbed;
    setLeaderboard(
      Object.entries(totals)
        .map(([user_id, floors]) => ({ user_id, floors }))
        .sort((a, b) => b.floors - a.floors)
        .slice(0, 8),
    );
    setLoading(false);
  }, [club]);

  useEffect(() => { if (visible) load(); }, [visible, load]);

  if (!club) return null;

  const handleJoin = async () => {
    if (isAnonymous) { setAuthPromptVisible(true); return; }
    if (!user) return;
    setMemberships((prev) => [...prev, { club_id: club.club_id, user_id: user.id, role: 'member', joined_at: new Date().toISOString() }]);
    await supabase.from('club_memberships').insert({ club_id: club.club_id, user_id: user.id, role: 'member' });
  };

  const handlePost = async () => {
    if (!user || !composerText.trim()) return;
    setPosting(true);
    const { data, error } = await supabase.from('club_posts').insert({
      club_id: club.club_id, author_id: user.id, body: composerText.trim(), week_start: toDateStr(mondayOfThisWeek()),
    }).select().single();
    setPosting(false);
    if (!error && data) {
      setPosts((prev) => [data as ClubPost, ...prev]);
      setComposerText('');
    }
  };

  const toggleReaction = async (postId: string, emoji: string) => {
    if (!user) { setAuthPromptVisible(true); return; }
    const existing = reactions.find((r) => r.post_id === postId && r.user_id === user.id && r.emoji === emoji);
    if (existing) {
      setReactions((prev) => prev.filter((r) => !(r.post_id === postId && r.user_id === user.id && r.emoji === emoji)));
      await supabase.from('club_post_reactions').delete().eq('post_id', postId).eq('user_id', user.id).eq('emoji', emoji);
    } else {
      setReactions((prev) => [...prev, { post_id: postId, user_id: user.id, emoji, created_at: new Date().toISOString() }]);
      await supabase.from('club_post_reactions').insert({ post_id: postId, user_id: user.id, emoji });
    }
  };

  const nameFor = (id: string) => profilesMap[id]?.display_name ?? `Climber${id.slice(0, 4)}`;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={[st.container, isDark && { backgroundColor: '#111827' }]}>
        <View style={[st.header, isDark && { borderBottomColor: '#374151', backgroundColor: '#111827' }]}>
          <TouchableOpacity onPress={onClose} hitSlop={10}>
            <Ionicons name="arrow-back" size={24} color={isDark ? '#F9FAFB' : '#111827'} />
          </TouchableOpacity>
          <Text style={[st.headerTitle, isDark && { color: '#F9FAFB' }]} numberOfLines={1}>{club.name}</Text>
          <View style={{ width: 24 }} />
        </View>

        {loading ? (
          <ActivityIndicator size="large" color={PRIMARY_BLUE} style={{ marginTop: 60 }} />
        ) : (
          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}>
          <ScrollView contentContainerStyle={st.body} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            {/* AI-generated (vector) club profile scene — no live image-generation tool available, so this is a crafted illustrated banner standing in for one. */}
            <SceneryBanner variant={CLUB_SCENERY[club.category]} photoUri={CLUB_PHOTO[club.category]} height={130} borderRadius={16}>
              <View style={st.bannerOverlay}>
                <Text style={st.bannerTitle}>{club.name}</Text>
              </View>
            </SceneryBanner>

            <Text style={[st.categoryPill, isDark && { backgroundColor: '#1F2937', color: '#93C5FD' }]}>{club.category}</Text>
            <Text style={[st.description, isDark && { color: '#D1D5DB' }]}>{club.description}</Text>
            <View style={st.metaRow}>
              <Ionicons name="people-outline" size={14} color="#9CA3AF" />
              <Text style={st.metaText}>{memberships.length} member{memberships.length !== 1 ? 's' : ''}</Text>
            </View>

            {myMembership ? (
              <View style={[st.memberBadge, isDark && { backgroundColor: '#1F2937' }]}>
                <Ionicons name="checkmark-circle" size={16} color="#10B981" />
                <Text style={[st.memberBadgeText, isDark && { color: '#D1D5DB' }]}>
                  You're a member{myMembership.role !== 'member' ? ` · ${myMembership.role}` : ''}
                </Text>
              </View>
            ) : (
              <TouchableOpacity style={st.joinBtn} onPress={handleJoin}>
                <Text style={st.joinBtnText}>Join Club</Text>
              </TouchableOpacity>
            )}

            {club.category !== 'Announcements' && (
              <>
                <Text style={[st.sectionTitle, isDark && { color: '#F9FAFB' }]}>This Week's Leaderboard</Text>
                {leaderboard.length === 0 ? (
                  <Text style={[st.emptyText, isDark && { color: '#6B7280' }]}>No climbs logged by members yet this week.</Text>
                ) : (
                  <View style={[st.card, isDark && { backgroundColor: '#1F2937' }]}>
                    {leaderboard.map((row, i) => (
                      <View key={row.user_id} style={[st.lbRow, i > 0 && st.lbRowBorder, i > 0 && isDark && { borderTopColor: '#374151' }]}>
                        <Text style={[st.lbRank, i < 3 && st.lbRankTop]}>{i + 1}</Text>
                        <MascotAvatar skinIdx={profilesMap[row.user_id]?.avatar_idx ?? 0} photoUri={avatarUriFor(profilesMap[row.user_id])} size={28} />
                        <Text style={[st.lbName, isDark && { color: '#F9FAFB' }]}>{row.user_id === user?.id ? 'You' : nameFor(row.user_id)}</Text>
                        <Text style={st.lbFloors}>{row.floors} fl</Text>
                      </View>
                    ))}
                  </View>
                )}
              </>
            )}

            <Text style={[st.sectionTitle, isDark && { color: '#F9FAFB' }]}>{club.category === 'Announcements' ? 'Updates' : 'Weekly Channel'}</Text>
            <Text style={[st.channelHint, isDark && { color: '#6B7280' }]}>
              {club.category === 'Announcements'
                ? 'Official posts from the Vertical team. Everyone can react with emoji — posts reset every Monday.'
                : 'Organizers post logistics, schedule and route updates here. Everyone can react with emoji — replies reset every Monday.'}
            </Text>

            {canPost && (
              <View style={[st.composer, isDark && { backgroundColor: '#1F2937' }]}>
                <TextInput
                  style={[st.composerInput, isDark && { color: '#F9FAFB' }]}
                  placeholder="Post a logistics/schedule/route update..."
                  placeholderTextColor="#9CA3AF"
                  value={composerText}
                  onChangeText={setComposerText}
                  multiline
                  maxLength={280}
                />
                <TouchableOpacity
                  style={[st.composerBtn, (!composerText.trim() || posting) && { opacity: 0.5 }]}
                  onPress={handlePost}
                  disabled={!composerText.trim() || posting}
                >
                  <Text style={st.composerBtnText}>{posting ? 'Posting...' : 'Post'}</Text>
                </TouchableOpacity>
              </View>
            )}

            {posts.length === 0 ? (
              <Text style={[st.emptyText, isDark && { color: '#6B7280' }]}>No updates posted this week yet.</Text>
            ) : (
              posts.map((post) => {
                const postReactions = reactions.filter((r) => r.post_id === post.post_id);
                const grouped: Record<string, number> = {};
                for (const r of postReactions) grouped[r.emoji] = (grouped[r.emoji] ?? 0) + 1;
                return (
                  <View key={post.post_id} style={[st.postCard, isDark && { backgroundColor: '#1F2937' }]}>
                    <View style={st.postHeader}>
                      <Text style={[st.postAuthor, isDark && { color: '#F9FAFB' }]}>{nameFor(post.author_id)}</Text>
                      <Text style={st.postTime}>{formatRelativeTime(post.created_at)}</Text>
                    </View>
                    <Text style={[st.postBody, isDark && { color: '#D1D5DB' }]}>{post.body}</Text>
                    <View style={st.reactionRow}>
                      {QUICK_EMOJI.map((emoji) => {
                        const mine = postReactions.some((r) => r.user_id === user?.id && r.emoji === emoji);
                        const count = grouped[emoji] ?? 0;
                        return (
                          <TouchableOpacity
                            key={emoji}
                            style={[st.reactionChip, mine && st.reactionChipActive, isDark && { backgroundColor: mine ? '#2563EB33' : '#111827' }]}
                            onPress={() => toggleReaction(post.post_id, emoji)}
                          >
                            <Text style={st.reactionEmoji}>{emoji}</Text>
                            {count > 0 && <Text style={[st.reactionCount, isDark && { color: '#D1D5DB' }]}>{count}</Text>}
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </View>
                );
              })
            )}
          </ScrollView>
          </KeyboardAvoidingView>
        )}
      </View>
      <AuthPrompt visible={authPromptVisible} reason="join clubs and react to posts" onClose={() => setAuthPromptVisible(false)} />
    </Modal>
  );
}

const st = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F9FAFB' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: 56, paddingBottom: 14, paddingHorizontal: 16,
    backgroundColor: '#FFFFFF', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E5E7EB',
  },
  headerTitle: { fontSize: 17, fontWeight: '800', color: '#111827', flex: 1, textAlign: 'center', marginHorizontal: 8 },
  body: { padding: 20, paddingBottom: 60 },
  bannerOverlay: { position: 'absolute', left: 16, right: 16, bottom: 14 },
  bannerTitle: { fontSize: 19, fontWeight: '800', color: '#FFFFFF', textShadowColor: 'rgba(0,0,0,0.35)', textShadowRadius: 6 },
  categoryPill: {
    alignSelf: 'flex-start', fontSize: 11, fontWeight: '800', color: '#2563EB',
    backgroundColor: '#EFF6FF', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4, marginTop: 8, marginBottom: 6, overflow: 'hidden',
  },
  description: { fontSize: 14, color: '#374151', lineHeight: 20, marginBottom: 10 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 14 },
  metaText: { fontSize: 12.5, color: '#9CA3AF', fontWeight: '600' },
  memberBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#F0FDF4', borderRadius: 10, padding: 10, marginBottom: 24 },
  memberBadgeText: { fontSize: 12.5, fontWeight: '700', color: '#065F46' },
  joinBtn: { backgroundColor: PRIMARY_BLUE, borderRadius: 12, paddingVertical: 13, alignItems: 'center', marginTop: 14, marginBottom: 24 },
  joinBtnText: { color: '#FFFFFF', fontWeight: '700', fontSize: 14.5 },
  sectionTitle: { fontSize: 15, fontWeight: '800', color: '#111827', marginBottom: 8 },
  emptyText: { fontSize: 12.5, color: '#9CA3AF', marginBottom: 20 },
  card: { backgroundColor: '#FFFFFF', borderRadius: 14, padding: 4, marginBottom: 24 },
  lbRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9, paddingHorizontal: 10 },
  lbRowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#F3F4F6' },
  lbRank: { width: 18, fontSize: 13, fontWeight: '700', color: '#9CA3AF', textAlign: 'center' },
  lbRankTop: { color: '#F59E0B' },
  lbName: { flex: 1, fontSize: 13.5, fontWeight: '600', color: '#111827' },
  lbFloors: { fontSize: 12.5, fontWeight: '700', color: '#10B981' },
  channelHint: { fontSize: 12, color: '#9CA3AF', lineHeight: 17, marginBottom: 14 },
  composer: { backgroundColor: '#FFFFFF', borderRadius: 14, padding: 12, marginBottom: 16 },
  composerInput: { fontSize: 13.5, color: '#111827', minHeight: 44, textAlignVertical: 'top' },
  composerBtn: { alignSelf: 'flex-end', backgroundColor: '#2563EB', borderRadius: 8, paddingHorizontal: 16, paddingVertical: 8, marginTop: 8 },
  composerBtnText: { color: '#FFFFFF', fontWeight: '700', fontSize: 12.5 },
  postCard: { backgroundColor: '#FFFFFF', borderRadius: 14, padding: 14, marginBottom: 10 },
  postHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  postAuthor: { fontSize: 13, fontWeight: '700', color: '#111827' },
  postTime: { fontSize: 11, color: '#9CA3AF' },
  postBody: { fontSize: 13.5, color: '#374151', lineHeight: 19, marginBottom: 10 },
  reactionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  reactionChip: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#F3F4F6', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5 },
  reactionChipActive: { backgroundColor: '#DBEAFE' },
  reactionEmoji: { fontSize: 13 },
  reactionCount: { fontSize: 11, fontWeight: '700', color: '#374151' },
});
