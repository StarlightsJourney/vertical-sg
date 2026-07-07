import { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Image,
  TextInput,
  ActivityIndicator,
  Alert,
  RefreshControl,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as ImagePicker from 'expo-image-picker';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../config/supabase';
import { base64ToUint8Array } from '../utils/base64';
import AuthPrompt from '../components/AuthPrompt';

interface FeedItem {
  climb_id: string;
  user_id: string;
  floors_climbed: number;
  caption: string | null;
  photo_path: string | null;
  created_at: string;
  blk_no: string;
  street: string;
  kudosCount: number;
  kudosByMe: boolean;
}

interface LeaderboardRow {
  user_id: string;
  total_climbs: number;
  total_floors: number;
  best_single_climb: number;
}

// Client-side only — never written to the database. Real "other users" need
// real accounts, which isn't something to fake in a live database. This is
// purely so the feed doesn't look empty while you're the only one testing it.
// Remove MOCK_FEED_ITEMS (and the one line that appends it in loadFeed) once
// there's real multi-user activity, or right away if you'd rather not see it.
const MOCK_FEED_ITEMS: FeedItem[] = [
  {
    climb_id: 'mock-1',
    user_id: 'mock-user-aaaa',
    floors_climbed: 96,
    caption: 'First time trying this one — legs are jelly 😅',
    photo_path: null,
    created_at: new Date(Date.now() - 45 * 60000).toISOString(),
    blk_no: '212',
    street: 'Toa Payoh Lorong 8',
    kudosCount: 4,
    kudosByMe: false,
  },
  {
    climb_id: 'mock-2',
    user_id: 'mock-user-bbbb',
    floors_climbed: 156,
    caption: 'Chasing the weekly goal, 2 more sessions to go.',
    photo_path: null,
    created_at: new Date(Date.now() - 3 * 3600000).toISOString(),
    blk_no: '88',
    street: 'Redhill Close',
    kudosCount: 11,
    kudosByMe: true,
  },
  {
    climb_id: 'mock-3',
    user_id: 'mock-user-cccc',
    floors_climbed: 40,
    caption: null,
    photo_path: null,
    created_at: new Date(Date.now() - 26 * 3600000).toISOString(),
    blk_no: '5',
    street: 'Tanjong Pagar Plaza',
    kudosCount: 0,
    kudosByMe: false,
  },
];

function formatRelativeTime(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function SocialScreen({ isDark = false }: { isDark?: boolean }) {
  const { user, isAnonymous, loading: authLoading } = useAuth();
  const [weeklyFloors, setWeeklyFloors] = useState(0);
  const [weeklyClimbs, setWeeklyClimbs] = useState(0);
  const [authPromptVisible, setAuthPromptVisible] = useState(false);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [feedLoading, setFeedLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [leaderboard, setLeaderboard] = useState<LeaderboardRow[]>([]);

  // "Add photo/note" modal state
  const [editingClimbId, setEditingClimbId] = useState<string | null>(null);
  const [captionText, setCaptionText] = useState('');
  const [postPhotoBase64, setPostPhotoBase64] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);

  // "+" FAB — pick one of your recent climbs to post about
  const [pickerVisible, setPickerVisible] = useState(false);
  const [unpostedClimbs, setUnpostedClimbs] = useState<FeedItem[]>([]);
  const [pickerLoading, setPickerLoading] = useState(false);

  const loadWeekly = useCallback(async () => {
    if (!user) return;
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data } = await supabase
      .from('climbs')
      .select('floors_climbed')
      .eq('user_id', user.id)
      .gte('created_at', weekAgo);
    if (data) {
      setWeeklyClimbs(data.length);
      setWeeklyFloors(data.reduce((s, c) => s + (c.floors_climbed || 0), 0));
    }
  }, [user]);

  const loadFeed = useCallback(async () => {
    const { data: climbs } = await supabase
      .from('climbs')
      .select('climb_id, user_id, floors_climbed, caption, photo_path, created_at, blocks(blk_no, street)')
      .order('created_at', { ascending: false })
      .limit(30);

    if (!climbs || climbs.length === 0) {
      // Mock items interleave by time even when there's no real data yet —
      // see the comment on MOCK_FEED_ITEMS above.
      setFeed([...MOCK_FEED_ITEMS].sort((a, b) => b.created_at.localeCompare(a.created_at)));
      setFeedLoading(false);
      setRefreshing(false);
      return;
    }

    const climbIds = climbs.map((c: any) => c.climb_id);
    const { data: kudos } = await supabase
      .from('climb_kudos')
      .select('climb_id, user_id')
      .in('climb_id', climbIds);

    const items: FeedItem[] = climbs.map((c: any) => {
      const rowsForClimb = (kudos ?? []).filter((k: any) => k.climb_id === c.climb_id);
      return {
        climb_id: c.climb_id,
        user_id: c.user_id,
        floors_climbed: c.floors_climbed,
        caption: c.caption,
        photo_path: c.photo_path,
        created_at: c.created_at,
        blk_no: c.blocks?.blk_no ?? '',
        street: c.blocks?.street ?? '',
        kudosCount: rowsForClimb.length,
        kudosByMe: user ? rowsForClimb.some((k: any) => k.user_id === user.id) : false,
      };
    });

    const merged = [...items, ...MOCK_FEED_ITEMS].sort((a, b) => b.created_at.localeCompare(a.created_at));
    setFeed(merged);
    setFeedLoading(false);
    setRefreshing(false);
  }, [user]);

  const loadLeaderboard = useCallback(async () => {
    const { data } = await supabase
      .from('leaderboard_weekly')
      .select('*')
      .order('total_floors', { ascending: false })
      .limit(5);
    if (data) setLeaderboard(data as LeaderboardRow[]);
  }, []);

  useEffect(() => { loadWeekly(); }, [loadWeekly]);
  useEffect(() => { loadFeed(); }, [loadFeed]);
  useEffect(() => { loadLeaderboard(); }, [loadLeaderboard]);

  const handleRefresh = () => {
    setRefreshing(true);
    loadFeed();
    loadWeekly();
    loadLeaderboard();
  };

  const handleToggleKudos = async (item: FeedItem) => {
    if (isAnonymous) {
      setAuthPromptVisible(true);
      return;
    }
    if (!user) return;

    // Optimistic update (works for mock items too — they just don't persist)
    setFeed((prev) => prev.map((f) => f.climb_id === item.climb_id
      ? { ...f, kudosByMe: !f.kudosByMe, kudosCount: f.kudosCount + (f.kudosByMe ? -1 : 1) }
      : f));

    if (item.climb_id.startsWith('mock-')) return; // preview-only, nothing to persist

    if (item.kudosByMe) {
      await supabase.from('climb_kudos').delete().eq('climb_id', item.climb_id).eq('user_id', user.id);
    } else {
      await supabase.from('climb_kudos').insert({ climb_id: item.climb_id, user_id: user.id });
    }
  };

  const openAddPost = (climbId: string) => {
    if (isAnonymous) {
      setAuthPromptVisible(true);
      return;
    }
    setEditingClimbId(climbId);
    setCaptionText('');
    setPostPhotoBase64(null);
  };

  const handleOpenComposer = async () => {
    if (isAnonymous) {
      setAuthPromptVisible(true);
      return;
    }
    if (!user) return;

    setPickerVisible(true);
    setPickerLoading(true);
    const { data } = await supabase
      .from('climbs')
      .select('climb_id, user_id, floors_climbed, caption, photo_path, created_at, blocks(blk_no, street)')
      .eq('user_id', user.id)
      .is('caption', null)
      .is('photo_path', null)
      .order('created_at', { ascending: false })
      .limit(20);

    setUnpostedClimbs((data ?? []).map((c: any) => ({
      climb_id: c.climb_id,
      user_id: c.user_id,
      floors_climbed: c.floors_climbed,
      caption: c.caption,
      photo_path: c.photo_path,
      created_at: c.created_at,
      blk_no: c.blocks?.blk_no ?? '',
      street: c.blocks?.street ?? '',
      kudosCount: 0,
      kudosByMe: false,
    })));
    setPickerLoading(false);
  };

  const pickPostPhoto = async (source: 'camera' | 'library') => {
    const perm = source === 'camera'
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Access needed', 'Enable access in Settings to add a photo.');
      return;
    }
    const result = source === 'camera'
      ? await ImagePicker.launchCameraAsync({ quality: 0.8, base64: true })
      : await ImagePicker.launchImageLibraryAsync({ quality: 0.8, base64: true });
    if (!result.canceled && result.assets?.[0]?.base64) {
      setPostPhotoBase64(result.assets[0].base64);
    }
  };

  const submitPost = async () => {
    if (!editingClimbId || !user) return;
    setPosting(true);
    try {
      let photoPath: string | null = null;
      if (postPhotoBase64) {
        photoPath = `feed/${user.id}-${Date.now()}.jpg`;
        const bytes = base64ToUint8Array(postPhotoBase64);
        const { error: uploadError } = await supabase.storage
          .from('building-photos')
          .upload(photoPath, bytes, { contentType: 'image/jpeg' });
        if (uploadError) {
          Alert.alert('Upload Failed', uploadError.message);
          setPosting(false);
          return;
        }
      }

      const { error } = await supabase
        .from('climbs')
        .update({ caption: captionText.trim() || null, photo_path: photoPath })
        .eq('climb_id', editingClimbId)
        .eq('user_id', user.id);

      if (error) {
        Alert.alert('Error', error.message);
      } else {
        setEditingClimbId(null);
        setPickerVisible(false);
        loadFeed();
      }
    } finally {
      setPosting(false);
    }
  };

  if (authLoading) return null;

  return (
    <View style={[s.container, isDark && { backgroundColor: '#111827' }]}>
      <View style={[s.header, isDark && { backgroundColor: '#111827', borderBottomColor: '#374151' }]}>
        <Text style={[s.headerTitle, isDark && { color: '#F9FAFB' }]}>Social</Text>
      </View>

      <FlatList
        data={feed}
        keyExtractor={(item) => item.climb_id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor="#2563EB" />}
        ListHeaderComponent={
          <>
            {user && (
              <View style={[s.card, isDark && { backgroundColor: '#1F2937' }]}>
                <Text style={[s.cardTitle, isDark && { color: '#F9FAFB' }]}>Your Week</Text>
                <View style={s.statsRow}>
                  <View style={s.statItem}>
                    <Text style={[s.statValue, isDark && { color: '#F9FAFB' }]}>{weeklyClimbs}</Text>
                    <Text style={s.statLabel}>Climbs</Text>
                  </View>
                  <View style={s.statItem}>
                    <Text style={[s.statValue, isDark && { color: '#F9FAFB' }]}>{weeklyFloors}</Text>
                    <Text style={s.statLabel}>Floors</Text>
                  </View>
                </View>
              </View>
            )}

            {leaderboard.length > 0 && (
              <View style={[s.card, isDark && { backgroundColor: '#1F2937' }]}>
                <Text style={[s.cardTitle, isDark && { color: '#F9FAFB' }]}>This Week's Leaderboard</Text>
                {leaderboard.map((row, i) => {
                  const isMe = user && row.user_id === user.id;
                  return (
                    <View key={row.user_id} style={[s.lbRow, isMe && s.lbRowMe]}>
                      <Text style={[s.lbRank, i < 3 && s.lbRankTop]}>{i + 1}</Text>
                      <Text style={[s.lbName, isDark && { color: '#F9FAFB' }]}>
                        {isMe ? 'You' : `Climber${row.user_id.slice(0, 4)}`}
                      </Text>
                      <Text style={s.lbFloors}>{row.total_floors} fl</Text>
                    </View>
                  );
                })}
              </View>
            )}

            {feedLoading && (
              <ActivityIndicator size="small" color="#2563EB" style={{ marginVertical: 20 }} />
            )}
          </>
        }
        ListEmptyComponent={
          !feedLoading ? (
            <View style={s.emptyFeed}>
              <Ionicons name="footsteps-outline" size={36} color={isDark ? '#4B5563' : '#D1D5DB'} />
              <Text style={[s.emptyFeedText, isDark && { color: '#9CA3AF' }]}>
                No climbs logged yet — be the first to show up here.
              </Text>
            </View>
          ) : null
        }
        renderItem={({ item }) => (
          <View style={[s.feedCard, isDark && { backgroundColor: '#1F2937' }]}>
            <View style={s.feedHeader}>
              <View style={s.feedAvatar}>
                <Text style={s.feedAvatarText}>{item.user_id.slice(0, 1).toUpperCase()}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[s.feedName, isDark && { color: '#F9FAFB' }]}>
                  Climber{item.user_id.slice(0, 4)}
                </Text>
                <Text style={s.feedTime}>{formatRelativeTime(item.created_at)}</Text>
              </View>
            </View>

            <Text style={[s.feedBody, isDark && { color: '#D1D5DB' }]}>
              climbed <Text style={s.feedFloors}>{item.floors_climbed} floors</Text>
              {item.blk_no ? ` at Blk ${item.blk_no} ${item.street}` : ''}
            </Text>

            {item.caption && (
              <Text style={[s.feedCaption, isDark && { color: '#F9FAFB' }]}>{item.caption}</Text>
            )}

            {item.photo_path && (
              <Image
                source={{ uri: supabase.storage.from('building-photos').getPublicUrl(item.photo_path).data.publicUrl }}
                style={s.feedPhoto}
              />
            )}

            <View style={s.feedActions}>
              <TouchableOpacity style={s.kudosBtn} onPress={() => handleToggleKudos(item)} activeOpacity={0.7}>
                <Ionicons name={item.kudosByMe ? 'hand-right' : 'hand-right-outline'} size={18} color={item.kudosByMe ? '#F59E0B' : '#6B7280'} />
                <Text style={[s.kudosText, item.kudosByMe && { color: '#F59E0B' }]}>
                  {item.kudosCount > 0 ? item.kudosCount : 'Kudos'}
                </Text>
              </TouchableOpacity>

              {user && item.user_id === user.id && !item.caption && !item.photo_path && (
                <TouchableOpacity onPress={() => openAddPost(item.climb_id)}>
                  <Text style={s.addPostLink}>Add photo or note</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        )}
        contentContainerStyle={s.scrollContent}
        showsVerticalScrollIndicator={false}
      />

      {/* "+" FAB — compose a post from one of your recent climbs */}
      <TouchableOpacity style={s.fab} onPress={handleOpenComposer} activeOpacity={0.85}>
        <Ionicons name="add" size={28} color="#FFF" />
      </TouchableOpacity>

      {/* Climb picker for the FAB */}
      {pickerVisible && (
        <View style={s.postModalOverlay}>
          <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={() => setPickerVisible(false)} />
          <View style={[s.postModal, isDark && { backgroundColor: '#1F2937' }, { maxHeight: '70%' }]}>
            <Text style={[s.postModalTitle, isDark && { color: '#F9FAFB' }]}>Share a climb</Text>
            {pickerLoading ? (
              <ActivityIndicator size="small" color="#2563EB" style={{ marginVertical: 24 }} />
            ) : unpostedClimbs.length > 0 ? (
              <FlatList
                data={unpostedClimbs}
                keyExtractor={(item) => item.climb_id}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={[s.pickerRow, isDark && { borderBottomColor: '#374151' }]}
                    onPress={() => { setPickerVisible(false); openAddPost(item.climb_id); }}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[s.pickerRowTitle, isDark && { color: '#F9FAFB' }]}>
                        {item.floors_climbed} floors{item.blk_no ? ` — Blk ${item.blk_no} ${item.street}` : ''}
                      </Text>
                      <Text style={s.pickerRowTime}>{formatRelativeTime(item.created_at)}</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={16} color="#9CA3AF" />
                  </TouchableOpacity>
                )}
              />
            ) : (
              <Text style={[s.emptyFeedText, isDark && { color: '#9CA3AF' }, { paddingVertical: 24 }]}>
                No climbs to share yet — every climb you log without a note or photo shows up here to choose from. Go log one on the map!
              </Text>
            )}
          </View>
        </View>
      )}

      {/* Add photo/note modal */}
      {editingClimbId && (
        <View style={s.postModalOverlay}>
          <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={() => setEditingClimbId(null)} />
          <View style={[s.postModal, isDark && { backgroundColor: '#1F2937' }]}>
            <Text style={[s.postModalTitle, isDark && { color: '#F9FAFB' }]}>Add to this climb</Text>
            <TextInput
              style={[s.postInput, isDark && { backgroundColor: '#111827', color: '#F9FAFB' }]}
              placeholder="Say something about this climb..."
              placeholderTextColor="#9CA3AF"
              value={captionText}
              onChangeText={setCaptionText}
              multiline
              maxLength={200}
            />
            <TouchableOpacity
              style={s.postPhotoBtn}
              onPress={() => {
                Alert.alert('Add Photo', '', [
                  { text: 'Take Photo', onPress: () => pickPostPhoto('camera') },
                  { text: 'Choose from Library', onPress: () => pickPostPhoto('library') },
                  { text: 'Cancel', style: 'cancel' },
                ]);
              }}
            >
              {postPhotoBase64 ? (
                <Image source={{ uri: `data:image/jpeg;base64,${postPhotoBase64}` }} style={s.postPhotoPreview} />
              ) : (
                <>
                  <Ionicons name="camera-outline" size={20} color="#6B7280" />
                  <Text style={s.postPhotoBtnText}>Attach a photo</Text>
                </>
              )}
            </TouchableOpacity>
            <View style={s.postModalActions}>
              <TouchableOpacity style={s.postCancelBtn} onPress={() => setEditingClimbId(null)}>
                <Text style={s.postCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.postSubmitBtn, posting && { opacity: 0.6 }]}
                onPress={submitPost}
                disabled={posting}
              >
                {posting ? <ActivityIndicator size="small" color="#FFF" /> : <Text style={s.postSubmitText}>Post</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}

      <AuthPrompt
        visible={authPromptVisible}
        reason="give kudos and post to the feed"
        onClose={() => setAuthPromptVisible(false)}
      />
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F9FAFB',
  },
  header: {
    paddingTop: 56,
    paddingBottom: 12,
    paddingHorizontal: 20,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E7EB',
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: '800',
    color: '#111827',
    letterSpacing: -0.5,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 32,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 12,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 16,
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 8,
  },
  statValue: {
    fontSize: 28,
    fontWeight: '800',
    color: '#111827',
  },
  statLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#6B7280',
    marginTop: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  lbRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 9,
    gap: 10,
  },
  lbRowMe: {
    backgroundColor: '#EFF6FF',
    marginHorizontal: -12,
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  lbRank: {
    width: 20,
    fontSize: 13,
    fontWeight: '700',
    color: '#9CA3AF',
    textAlign: 'center',
  },
  lbRankTop: { color: '#F59E0B' },
  lbName: { flex: 1, fontSize: 14, fontWeight: '600', color: '#111827' },
  lbFloors: { fontSize: 13, fontWeight: '700', color: '#10B981' },
  emptyFeed: {
    alignItems: 'center',
    paddingVertical: 40,
  },
  emptyFeedText: {
    fontSize: 13,
    color: '#9CA3AF',
    marginTop: 10,
    textAlign: 'center',
  },
  feedCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
  },
  feedHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 10,
  },
  feedAvatar: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: '#EFF6FF',
    alignItems: 'center', justifyContent: 'center',
  },
  feedAvatarText: { fontSize: 14, fontWeight: '700', color: '#2563EB' },
  feedName: { fontSize: 14, fontWeight: '700', color: '#111827' },
  feedTime: { fontSize: 11, color: '#9CA3AF', marginTop: 1 },
  feedBody: { fontSize: 14, color: '#374151', lineHeight: 20, marginBottom: 4 },
  feedFloors: { fontWeight: '700', color: '#10B981' },
  feedCaption: { fontSize: 14, color: '#111827', marginTop: 6, lineHeight: 19 },
  feedPhoto: { width: '100%', height: 180, borderRadius: 12, marginTop: 10, backgroundColor: '#F3F4F6' },
  feedActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#E5E7EB',
  },
  kudosBtn: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  kudosText: { fontSize: 13, fontWeight: '600', color: '#6B7280' },
  addPostLink: { fontSize: 12, fontWeight: '600', color: '#2563EB' },
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 24,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#2563EB',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
  },
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E7EB',
  },
  pickerRowTitle: { fontSize: 14, fontWeight: '600', color: '#111827' },
  pickerRowTime: { fontSize: 11, color: '#9CA3AF', marginTop: 2 },
  postModalOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  postModal: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: 32,
  },
  postModalTitle: { fontSize: 17, fontWeight: '700', color: '#111827', marginBottom: 14 },
  postInput: {
    backgroundColor: '#F3F4F6', borderRadius: 12, padding: 14, fontSize: 14,
    color: '#111827', minHeight: 70, marginBottom: 14, textAlignVertical: 'top',
  },
  postPhotoBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: '#F3F4F6', borderRadius: 12, padding: 14, marginBottom: 16, minHeight: 60,
  },
  postPhotoBtnText: { fontSize: 13, color: '#6B7280', fontWeight: '500' },
  postPhotoPreview: { width: '100%', height: 160, borderRadius: 10 },
  postModalActions: { flexDirection: 'row', gap: 10 },
  postCancelBtn: { flex: 1, padding: 14, borderRadius: 12, backgroundColor: '#F3F4F6', alignItems: 'center' },
  postCancelText: { fontWeight: '600', color: '#6B7280', fontSize: 14 },
  postSubmitBtn: { flex: 2, padding: 14, borderRadius: 12, backgroundColor: '#2563EB', alignItems: 'center' },
  postSubmitText: { fontWeight: '700', color: '#FFFFFF', fontSize: 14 },
});
