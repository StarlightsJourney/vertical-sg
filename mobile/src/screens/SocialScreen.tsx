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
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Modal,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../config/supabase';
import { getUnreadNotificationCount } from '../services/climbs';
import { base64ToUint8Array } from '../utils/base64';
import storage from '../utils/storage';
import AuthPrompt from '../components/AuthPrompt';
import MascotAvatar from '../components/MascotAvatar';
import { avatarUriFor } from '../utils/avatarUri';
import PhotoGridPicker from '../components/PhotoGridPicker';
import PhotoGallery from '../components/PhotoGallery';
import PublicProfileModal from '../components/PublicProfileModal';
import LeaderboardModal from '../components/LeaderboardModal';
import NotificationsModal from '../components/NotificationsModal';
import ChallengeDetailModal, { PRIMARY_BLUE } from '../components/ChallengeDetailModal';
import MedalBadge, { medalEmblemFor } from '../components/MedalBadge';
import { medalColorForChallenge, medalColorFor } from '../utils/medalColor';
import { displayChallengeTitle, displayChallengeDescription } from '../utils/challengeDisplay';
import type { Profile, Challenge } from '../types';
import { BADGE_DEFS } from '../types';

const HIDDEN_POSTS_KEY = 'hidden_feed_posts';


// eslint-disable-next-line @typescript-eslint/no-require-imports
const MOCK_PHOTOS = [
  require('../../assets/mock/mock-stairwell.png'),
  require('../../assets/mock/mock-hdb-facade.png'),
  require('../../assets/mock/mock-rooftop.png'),
];

interface FeedItem {
  climb_id: string;
  user_id: string;
  floors_climbed: number;
  caption: string | null;
  photo_path: string | null;
  /** Up to 6 Storage paths, in display order — kept in sync with photo_path
   * (mirrors photo_paths[0]) by every write path. Null/empty for mock items
   * and any pre-multi-photo rows without a migration backfill. */
  photo_paths?: string[] | null;
  /** Local require() source for mock items — takes priority over photo_path
   * when set, since mock items don't have a real Supabase Storage path. */
  photoSource?: any;
  created_at: string;
  /** When this climb was actually shared to the feed (photo attached) —
   * distinct from created_at (when the climb itself was logged/completed).
   * Null for rows that predate this column; the feed falls back to
   * created_at in that case. Not present on ClimbRecord (types/index.ts)
   * since it's feed-display-only, so it's declared locally here. */
  posted_at?: string | null;
  blk_no: string;
  street: string;
  kudosCount: number;
  kudosByMe: boolean;
  commentCount: number;
  trackingMethod: 'barometer' | 'pedometer' | 'manual';
}

interface ClimbComment {
  comment_id: string;
  user_id: string;
  body: string;
  created_at: string;
}

interface LeaderboardRow {
  user_id: string;
  total_climbs: number;
  total_floors: number;
  best_single_climb: number;
}

// Client-side preview only, same rationale as MOCK_FEED_ITEMS below — lets
// you see what the leaderboard looks like with other climbers on it while
// you're the only real account testing. Only shown when there's fewer than
// 3 real rows; never written to the database.
const MOCK_LEADERBOARD: LeaderboardRow[] = [
  { user_id: 'mock-user-aaaa', total_climbs: 12, total_floors: 480, best_single_climb: 96 },
  { user_id: 'mock-user-bbbb', total_climbs: 18, total_floors: 620, best_single_climb: 156 },
  { user_id: 'mock-user-cccc', total_climbs: 6, total_floors: 210, best_single_climb: 40 },
];
const MOCK_PROFILES: Record<string, Profile> = {
  'mock-user-aaaa': { user_id: 'mock-user-aaaa', display_name: 'Wei Ling', avatar_idx: 1, featured_badge: null, is_pro: false, created_at: '', updated_at: '' },
  'mock-user-bbbb': { user_id: 'mock-user-bbbb', display_name: 'Farid', avatar_idx: 2, featured_badge: null, is_pro: false, created_at: '', updated_at: '' },
  'mock-user-cccc': { user_id: 'mock-user-cccc', display_name: 'Priya', avatar_idx: 3, featured_badge: null, is_pro: false, created_at: '', updated_at: '' },
};

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
    photoSource: MOCK_PHOTOS[0],
    created_at: new Date(Date.now() - 45 * 60000).toISOString(),
    blk_no: '212',
    street: 'Toa Payoh Lorong 8',
    kudosCount: 4,
    kudosByMe: false,
    // Was 2, but the preview thread has no actual comments to show — a
    // nonzero count with an empty list is what tricked a tester into
    // thinking they could reply. Keep this at 0 unless MOCK_FEED_ITEMS
    // ever grows real hardcoded comments to match.
    commentCount: 0,
    trackingMethod: 'barometer',
  },
  {
    climb_id: 'mock-2',
    user_id: 'mock-user-bbbb',
    floors_climbed: 156,
    caption: 'Chasing the weekly goal, 2 more sessions to go.',
    photo_path: null,
    photoSource: MOCK_PHOTOS[2],
    created_at: new Date(Date.now() - 3 * 3600000).toISOString(),
    blk_no: '88',
    street: 'Redhill Close',
    kudosCount: 11,
    kudosByMe: true,
    commentCount: 0,
    trackingMethod: 'barometer',
  },
  {
    climb_id: 'mock-3',
    user_id: 'mock-user-cccc',
    floors_climbed: 40,
    caption: null,
    photo_path: null,
    photoSource: MOCK_PHOTOS[1],
    created_at: new Date(Date.now() - 26 * 3600000).toISOString(),
    blk_no: '5',
    street: 'Tanjong Pagar Plaza',
    kudosCount: 0,
    kudosByMe: false,
    commentCount: 0,
    trackingMethod: 'pedometer',
  },
];

/** Builds the mockProfile prop for PublicProfileModal when viewing one of
 * the preview-only climbers (see MOCK_PROFILES/MOCK_LEADERBOARD above) —
 * there's no real account/row behind these, so their stats come from the
 * same hardcoded leaderboard entry instead of a Supabase query. */
function mockProfileFor(userId: string) {
  const profile = MOCK_PROFILES[userId];
  const row = MOCK_LEADERBOARD.find((r) => r.user_id === userId);
  if (!profile || !row) return undefined;
  return { profile, stats: { climbs: row.total_climbs, floors: row.total_floors, tallest: row.best_single_climb } };
}

/** The timestamp a feed post should sort/display by: when it was actually
 * shared to the feed, falling back to when the climb itself was logged for
 * rows that predate the posted_at column (or were never explicitly posted,
 * e.g. mock items). */
function feedTimestamp(item: FeedItem): string {
  return item.posted_at ?? item.created_at;
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

interface SocialScreenProps {
  isDark?: boolean;
  onNavigateToProfile?: () => void;
  onNavigateToGroups?: () => void;
  isActive?: boolean;
}

export default function SocialScreen({ isDark = false, onNavigateToProfile, onNavigateToGroups, isActive }: SocialScreenProps) {
  const { user, isAnonymous, loading: authLoading } = useAuth();
  const [authPromptVisible, setAuthPromptVisible] = useState(false);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [feedLoading, setFeedLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [leaderboard, setLeaderboard] = useState<LeaderboardRow[]>([]);
  const [profilesMap, setProfilesMap] = useState<Record<string, Profile>>({});

  // "Add photo/note" modal state
  const [editingClimbId, setEditingClimbId] = useState<string | null>(null);
  const [captionText, setCaptionText] = useState('');
  const [postPhotosBase64, setPostPhotosBase64] = useState<string[]>([]);
  const [posting, setPosting] = useState(false);

  // "+" FAB — pick one of your recent climbs to post about
  const [pickerVisible, setPickerVisible] = useState(false);
  const [unpostedClimbs, setUnpostedClimbs] = useState<FeedItem[]>([]);
  const [pickerLoading, setPickerLoading] = useState(false);

  // Search for other climbers by handle — icon in the header opens a modal
  const [searchModalVisible, setSearchModalVisible] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Profile[]>([]);
  const [searching, setSearching] = useState(false);
  const [viewingProfileId, setViewingProfileId] = useState<string | null>(null);

  // Challenge detail (Strava-style)
  const [selectedChallenge, setSelectedChallenge] = useState<Challenge | null>(null);

  // Feed post 3-dot menu: who I follow, and posts I've locally hidden
  const [followingIds, setFollowingIds] = useState<Set<string>>(new Set());
  const [hiddenPostIds, setHiddenPostIds] = useState<Set<string>>(new Set());

  // Header: own avatar + notification bell
  const [myProfile, setMyProfile] = useState<Profile | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifVisible, setNotifVisible] = useState(false);

  // Leaderboard (compact card here, full view in a modal)
  const [leaderboardModalVisible, setLeaderboardModalVisible] = useState(false);

  // Challenges
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [myChallengeIds, setMyChallengeIds] = useState<Set<string>>(new Set());
  const [weeklyFloorsForChallenges, setWeeklyFloorsForChallenges] = useState(0);
  const [monthlyFloorsForChallenges, setMonthlyFloorsForChallenges] = useState(0);
  const [limitedTimeProgress, setLimitedTimeProgress] = useState<Record<string, number>>({});

  // Recommended climbers
  const [recommended, setRecommended] = useState<(LeaderboardRow & { profile?: Profile })[]>([]);

  // Comments on a feed post — only one card's thread expanded at a time
  const [expandedClimbId, setExpandedClimbId] = useState<string | null>(null);
  const [climbComments, setClimbComments] = useState<ClimbComment[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [newCommentText, setNewCommentText] = useState('');
  const [commentSubmitting, setCommentSubmitting] = useState(false);
  const [showAllComments, setShowAllComments] = useState(false);
  const COMMENTS_COLLAPSED = 2;

  /** Batch-fetch profiles for a set of user ids (merges into the existing map;
   * unknown/mock ids simply won't resolve and fall back to "Climber{id}"). */
  const loadProfilesFor = useCallback(async (userIds: string[]) => {
    const real = [...new Set(userIds)].filter((id) => !id.startsWith('mock-'));
    if (real.length === 0) return;
    const { data } = await supabase.from('profiles').select('*').in('user_id', real);
    if (data) {
      setProfilesMap((prev) => {
        const next = { ...prev };
        for (const p of data as Profile[]) next[p.user_id] = p;
        return next;
      });
    }
  }, []);

  const loadFeed = useCallback(async () => {
    // Feed = posts, not a raw activity log — only climbs with a photo attached
    // show up here (bare "climbed X floors" entries stay in Profile only).
    const { data: climbs } = await supabase
      .from('climbs')
      .select('climb_id, user_id, floors_climbed, caption, photo_path, photo_paths, tracking_method, created_at, posted_at, blocks(blk_no, street)')
      .not('photo_path', 'is', null)
      // Approximates ordering by coalesce(posted_at, created_at) desc —
      // Postgrest can't express a coalesce directly, so order by posted_at
      // first (nulls last) then created_at as the tiebreaker/fallback for
      // rows that predate the posted_at column.
      .order('posted_at', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })
      .limit(30);

    if (!climbs || climbs.length === 0) {
      // Mock items interleave by time even when there's no real data yet —
      // see the comment on MOCK_FEED_ITEMS above.
      setFeed([...MOCK_FEED_ITEMS].sort((a, b) => feedTimestamp(b).localeCompare(feedTimestamp(a))));
      setFeedLoading(false);
      setRefreshing(false);
      return;
    }

    const climbIds = climbs.map((c: any) => c.climb_id);
    const [{ data: kudos }, { data: comments }] = await Promise.all([
      supabase.from('climb_kudos').select('climb_id, user_id').in('climb_id', climbIds),
      supabase.from('climb_comments').select('climb_id').eq('status', 'active').in('climb_id', climbIds),
    ]);

    const items: FeedItem[] = climbs.map((c: any) => {
      const rowsForClimb = (kudos ?? []).filter((k: any) => k.climb_id === c.climb_id);
      const commentsForClimb = (comments ?? []).filter((cm: any) => cm.climb_id === c.climb_id);
      return {
        climb_id: c.climb_id,
        user_id: c.user_id,
        floors_climbed: c.floors_climbed,
        caption: c.caption,
        photo_path: c.photo_path,
        photo_paths: c.photo_paths,
        created_at: c.created_at,
        posted_at: c.posted_at ?? null,
        blk_no: c.blocks?.blk_no ?? '',
        street: c.blocks?.street ?? '',
        kudosCount: rowsForClimb.length,
        kudosByMe: user ? rowsForClimb.some((k: any) => k.user_id === user.id) : false,
        commentCount: commentsForClimb.length,
        trackingMethod: c.tracking_method ?? 'manual',
      };
    });

    const merged = [...items, ...MOCK_FEED_ITEMS].sort((a, b) => feedTimestamp(b).localeCompare(feedTimestamp(a)));
    setFeed(merged);
    setFeedLoading(false);
    setRefreshing(false);
    loadProfilesFor(items.map((i) => i.user_id));
  }, [user, loadProfilesFor]);

  const handleSearch = async (query: string) => {
    setSearchQuery(query);
    if (query.trim().length < 2) {
      setSearchResults([]);
      return;
    }
    setSearching(true);
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .ilike('display_name', `%${query.trim()}%`)
      .limit(15);
    setSearchResults((data ?? []) as Profile[]);
    setSearching(false);
  };

  const nameFor = (userId: string) => profilesMap[userId]?.display_name ?? `Climber${userId.slice(0, 4)}`;
  const skinFor = (userId: string) => profilesMap[userId]?.avatar_idx ?? 0;
  const photoFor = (userId: string) => avatarUriFor(profilesMap[userId]);

  const loadLeaderboard = useCallback(async () => {
    const { data } = await supabase
      .from('leaderboard_weekly')
      .select('*')
      .order('total_floors', { ascending: false })
      .limit(5);
    if (data) {
      const real = data as LeaderboardRow[];
      const merged = real.length < 3
        ? [...real, ...MOCK_LEADERBOARD].sort((a, b) => b.total_floors - a.total_floors).slice(0, 5)
        : real;
      setLeaderboard(merged);
      loadProfilesFor(real.map((r) => r.user_id));
      setProfilesMap((prev) => ({ ...MOCK_PROFILES, ...prev }));
    }
  }, [loadProfilesFor]);

  const loadHeader = useCallback(async () => {
    if (!user) return;
    const [{ data: profileData }, count] = await Promise.all([
      supabase.from('profiles').select('*').eq('user_id', user.id).maybeSingle(),
      getUnreadNotificationCount(user.id),
    ]);
    if (profileData) setMyProfile(profileData as Profile);
    setUnreadCount(count);
  }, [user]);

  const loadChallenges = useCallback(async () => {
    const { data: challengeData } = await supabase.from('challenges').select('*').eq('is_active', true);
    const all = (challengeData ?? []) as Challenge[];

    if (!user) {
      setChallenges(all.slice(0, 3));
      return;
    }

    const [{ data: joined }, { data: climbs }] = await Promise.all([
      supabase.from('challenge_participants').select('challenge_id').eq('user_id', user.id),
      supabase.from('climbs').select('floors_climbed, created_at').eq('user_id', user.id).gte('created_at', new Date(Date.now() - 60 * 86400000).toISOString()),
    ]);
    const joinedIds = new Set((joined ?? []).map((j: any) => j.challenge_id));
    setMyChallengeIds(joinedIds);

    let weeklyTotal = 0;
    let monthlyTotal = 0;
    const ltProgress: Record<string, number> = {};
    if (climbs) {
      const now = Date.now();
      weeklyTotal = climbs.filter((c: any) => now - new Date(c.created_at).getTime() < 7 * 86400000).reduce((s, c: any) => s + c.floors_climbed, 0);
      monthlyTotal = climbs.filter((c: any) => now - new Date(c.created_at).getTime() < 30 * 86400000).reduce((s, c: any) => s + c.floors_climbed, 0);
      setWeeklyFloorsForChallenges(weeklyTotal);
      setMonthlyFloorsForChallenges(monthlyTotal);

      for (const ch of all.filter((c) => c.starts_at && c.ends_at)) {
        const start = new Date(ch.starts_at!).getTime();
        const end = new Date(ch.ends_at!).getTime();
        ltProgress[ch.challenge_id] = climbs.filter((c: any) => { const t = new Date(c.created_at).getTime(); return t >= start && t <= end; }).reduce((s, c: any) => s + c.floors_climbed, 0);
      }
      setLimitedTimeProgress(ltProgress);
    }

    // Not-joined challenges are prioritized first (limited-time, then
    // unique/community/special, then the plain default set); joined-but-
    // in-progress ones are still included, showing their progress bar
    // instead of a Join button, so this section doesn't just disappear once
    // you've joined everything currently available. Completed challenges
    // are dropped entirely — there's nothing left to "suggest" about one
    // you've already finished.
    const progressFor = (ch: Challenge) => (ch.starts_at && ch.ends_at ? ltProgress[ch.challenge_id] ?? 0 : ch.period === 'monthly' ? monthlyTotal : weeklyTotal);
    const isCompleted = (ch: Challenge) => joinedIds.has(ch.challenge_id) && progressFor(ch) >= ch.target_floors;
    const priority = (c: Challenge) => (c.starts_at && c.ends_at ? 0 : c.creator_id || c.difficulty === 'insane' ? 1 : 2);
    const sorted = all
      .filter((c) => !isCompleted(c))
      .sort((a, b) => {
        const aJoined = joinedIds.has(a.challenge_id) ? 1 : 0;
        const bJoined = joinedIds.has(b.challenge_id) ? 1 : 0;
        if (aJoined !== bJoined) return aJoined - bJoined;
        return priority(a) - priority(b);
      });
    setChallenges(sorted.slice(0, 5));
  }, [user]);

  const loadRecommended = useCallback(async () => {
    // Wait for auth to resolve before fetching — otherwise this can run once
    // with user still null, which skips the "exclude myself" filter below
    // entirely (undefined !== any real id), and if that stale response
    // resolves after the later, correctly-filtered one, it clobbers it back
    // to a list that includes your own account.
    if (!user) return;
    const { data } = await supabase.from('leaderboard_weekly').select('*').order('total_floors', { ascending: false }).limit(10);
    if (!data) return;
    const others = (data as LeaderboardRow[]).filter((r) => r.user_id !== user?.id).slice(0, 5);
    if (others.length === 0) { setRecommended([]); return; }
    const { data: profs } = await supabase.from('profiles').select('*').in('user_id', others.map((r) => r.user_id));
    const profMap: Record<string, Profile> = {};
    for (const p of (profs ?? []) as Profile[]) profMap[p.user_id] = p;
    setRecommended(others.map((r) => ({ ...r, profile: profMap[r.user_id] })));
  }, [user]);

  const handleJoinChallenge = async (challengeId: string) => {
    if (isAnonymous) { setAuthPromptVisible(true); return; }
    if (!user) return;
    setMyChallengeIds((prev) => new Set(prev).add(challengeId)); // optimistic
    await supabase.from('challenge_participants').insert({ challenge_id: challengeId, user_id: user.id });
  };

  const loadFollowing = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase.from('follows').select('followee_id').eq('follower_id', user.id);
    if (data) setFollowingIds(new Set(data.map((f: any) => f.followee_id)));
  }, [user]);

  useEffect(() => { loadFeed(); }, [loadFeed]);
  useEffect(() => { loadLeaderboard(); }, [loadLeaderboard]);
  useEffect(() => { loadHeader(); }, [loadHeader]);
  useEffect(() => { loadChallenges(); }, [loadChallenges]);
  useEffect(() => { loadRecommended(); }, [loadRecommended]);
  useEffect(() => { loadFollowing(); }, [loadFollowing]);

  // This tab stays mounted after its first visit, so without this, changes
  // made elsewhere (e.g. setting a featured badge on Profile) wouldn't show
  // up here until a manual pull-to-refresh — refetch silently on refocus.
  useEffect(() => {
    if (!isActive) return;
    loadFeed();
    loadHeader();
  }, [isActive, loadFeed, loadHeader]);

  // Locally-hidden posts persist across launches but are per-device only —
  // "hide" just means "stop showing me this," not a report.
  useEffect(() => {
    storage.getItem(HIDDEN_POSTS_KEY).then((val) => {
      if (val) { try { setHiddenPostIds(new Set(JSON.parse(val))); } catch {} }
    });
  }, []);

  const handleRefresh = () => {
    setRefreshing(true);
    loadFeed();
    loadLeaderboard();
    loadHeader();
    loadChallenges();
    loadRecommended();
    loadFollowing();
  };

  const handleToggleFollow = async (targetUserId: string) => {
    if (isAnonymous) { setAuthPromptVisible(true); return; }
    if (!user) return;
    const isFollowing = followingIds.has(targetUserId);
    setFollowingIds((prev) => {
      const next = new Set(prev);
      if (isFollowing) next.delete(targetUserId); else next.add(targetUserId);
      return next;
    });
    if (isFollowing) {
      await supabase.from('follows').delete().eq('follower_id', user.id).eq('followee_id', targetUserId);
    } else {
      await supabase.from('follows').insert({ follower_id: user.id, followee_id: targetUserId });
    }
  };

  const handleHidePost = (climbId: string) => {
    setHiddenPostIds((prev) => {
      const next = new Set(prev).add(climbId);
      storage.setItem(HIDDEN_POSTS_KEY, JSON.stringify([...next]));
      return next;
    });
  };

  const handleReportPost = async (climbId: string) => {
    if (isAnonymous) { setAuthPromptVisible(true); return; }
    if (!user || climbId.startsWith('mock-')) {
      Alert.alert('Reported', 'Thanks — we\'ll take a look.');
      return;
    }
    await supabase.rpc('report_climb_post', { p_climb_id: climbId });
    Alert.alert('Reported', 'Thanks — we\'ll take a look.');
  };

  const openPostMenu = (item: FeedItem) => {
    const isFollowing = followingIds.has(item.user_id);
    Alert.alert('', nameFor(item.user_id), [
      {
        text: isFollowing ? 'Unfollow' : 'Follow',
        onPress: () => handleToggleFollow(item.user_id),
      },
      { text: 'Hide this post', onPress: () => handleHidePost(item.climb_id) },
      { text: 'Report post', style: 'destructive', onPress: () => handleReportPost(item.climb_id) },
      { text: 'Cancel', style: 'cancel' },
    ]);
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

  const handleToggleComments = async (climbId: string) => {
    if (expandedClimbId === climbId) {
      setExpandedClimbId(null);
      return;
    }
    setExpandedClimbId(climbId);
    setNewCommentText('');
    setShowAllComments(false);

    if (climbId.startsWith('mock-')) {
      setClimbComments([]); // preview items have no real thread to load
      return;
    }

    setCommentsLoading(true);
    const { data } = await supabase
      .from('climb_comments')
      .select('*')
      .eq('climb_id', climbId)
      .eq('status', 'active')
      .order('created_at', { ascending: true });
    setClimbComments((data ?? []) as ClimbComment[]);
    loadProfilesFor((data ?? []).map((c: any) => c.user_id));
    setCommentsLoading(false);
  };

  const handleSubmitComment = async () => {
    if (isAnonymous) {
      setAuthPromptVisible(true);
      return;
    }
    if (!user || !expandedClimbId || !newCommentText.trim()) return;
    if (expandedClimbId.startsWith('mock-')) {
      Alert.alert('Preview only', 'This is a sample post — comments here won\'t be saved.');
      return;
    }

    setCommentSubmitting(true);
    const { data, error } = await supabase
      .from('climb_comments')
      .insert({ climb_id: expandedClimbId, user_id: user.id, body: newCommentText.trim() })
      .select()
      .single();
    setCommentSubmitting(false);

    if (error) {
      Alert.alert('Error', error.message);
      return;
    }

    setClimbComments((prev) => [...prev, data as ClimbComment]);
    setNewCommentText('');
    setFeed((prev) => prev.map((f) => f.climb_id === expandedClimbId ? { ...f, commentCount: f.commentCount + 1 } : f));
  };

  const openAddPost = (climbId: string) => {
    if (isAnonymous) {
      setAuthPromptVisible(true);
      return;
    }
    setEditingClimbId(climbId);
    setCaptionText('');
    setPostPhotosBase64([]);
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
      commentCount: 0,
      trackingMethod: 'manual' as const,
    })));
    setPickerLoading(false);
  };

  const submitPost = async () => {
    if (!editingClimbId || !user) return;
    // A photo is required — text-only posts were getting skipped over in the
    // feed, so this is now the one non-negotiable part of sharing a climb.
    if (postPhotosBase64.length === 0) {
      Alert.alert('Photo required', 'Add a photo to share this climb — it\'s what gets people to actually stop and look.');
      return;
    }
    setPosting(true);
    try {
      const results = await Promise.all(postPhotosBase64.map(async (base64, i) => {
        const photoPath = `feed/${user.id}-${Date.now()}-${i}.jpg`;
        const bytes = base64ToUint8Array(base64);
        const { error: uploadError } = await supabase.storage
          .from('building-photos')
          .upload(photoPath, bytes, { contentType: 'image/jpeg' });
        return uploadError ? null : photoPath;
      }));
      const photoPaths = results.filter((p): p is string => !!p);
      if (photoPaths.length === 0) {
        Alert.alert('Upload Failed', 'None of the photos could be uploaded.');
        setPosting(false);
        return;
      }

      // posted_at is stamped now, distinct from the climb's created_at (when
      // it was originally logged/completed) — this is the moment it actually
      // became a feed post, which is what the feed should sort/display by.
      const { error } = await supabase
        .from('climbs')
        .update({ caption: captionText.trim() || null, photo_path: photoPaths[0], photo_paths: photoPaths, posted_at: new Date().toISOString() })
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

  const visibleFeed = feed.filter((f) => !hiddenPostIds.has(f.climb_id));
  const localLegendId = leaderboard[0]?.user_id;

  return (
    <View style={[s.container, isDark && { backgroundColor: '#111827' }]}>
      <View style={[s.header, isDark && { backgroundColor: '#111827', borderBottomColor: '#374151' }]}>
        <Text style={[s.headerTitle, isDark && { color: '#F9FAFB' }]}>Social</Text>
        <View style={s.headerActions}>
          <TouchableOpacity style={s.iconBtn} onPress={() => setSearchModalVisible(true)} activeOpacity={0.7}>
            <Ionicons name="search-outline" size={22} color={isDark ? '#D1D5DB' : '#374151'} />
          </TouchableOpacity>
          {!isAnonymous && (
            <TouchableOpacity style={s.bellBtn} onPress={() => setNotifVisible(true)} activeOpacity={0.7}>
              <Ionicons name="notifications-outline" size={22} color={isDark ? '#D1D5DB' : '#374151'} />
              {unreadCount > 0 && (
                <View style={s.bellBadge}>
                  <Text style={s.bellBadgeText}>{unreadCount > 9 ? '9+' : unreadCount}</Text>
                </View>
              )}
            </TouchableOpacity>
          )}
          <TouchableOpacity onPress={onNavigateToProfile} activeOpacity={0.7}>
            <MascotAvatar skinIdx={myProfile?.avatar_idx ?? 0} photoUri={avatarUriFor(myProfile)} size={34} />
          </TouchableOpacity>
        </View>
      </View>

      <FlatList
        data={visibleFeed}
        keyExtractor={(item) => item.climb_id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor="#2563EB" />}
        ListHeaderComponent={
          <>
            {leaderboard.length > 0 && (
              <View style={[s.card, isDark && { backgroundColor: '#1F2937' }]}>
                <TouchableOpacity style={s.cardTitleRow} onPress={() => setLeaderboardModalVisible(true)} activeOpacity={0.7}>
                  <Text style={[s.cardTitle, { marginBottom: 0 }, isDark && { color: '#F9FAFB' }]}>This Week's Leaderboard</Text>
                  <View style={s.seeAllRow}>
                    <Text style={s.seeAllText}>Friends vs public</Text>
                    <Ionicons name="chevron-forward" size={14} color="#2563EB" />
                  </View>
                </TouchableOpacity>
                {leaderboard.map((row, i) => {
                  const isMe = user && row.user_id === user.id;
                  return (
                    <TouchableOpacity
                      key={row.user_id}
                      style={[s.lbRow, isMe && s.lbRowMe, isMe && isDark && { backgroundColor: 'rgba(37,99,235,0.22)' }]}
                      onPress={() => !isMe && setViewingProfileId(row.user_id)}
                      disabled={!!isMe}
                    >
                      <Text style={[s.lbRank, i < 3 && s.lbRankTop]}>{i + 1}</Text>
                      <MascotAvatar skinIdx={skinFor(row.user_id)} photoUri={photoFor(row.user_id)} size={26} />
                      <Text style={[s.lbName, isDark && { color: '#F9FAFB' }]}>
                        {isMe ? 'You' : nameFor(row.user_id)}
                      </Text>
                      <Text style={s.lbFloors}>{row.total_floors} fl</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}

            {/* Suggested challenges — horizontal row, same medal/card
                treatment as the Groups tab's challenge grid (MedalBadge,
                shared medal color, generic-challenge display title/desc)
                so a challenge doesn't look different depending on which
                tab you see it from. */}
            {challenges.length > 0 && (
              <View style={s.challengesSection}>
                <Text style={[s.cardTitle, isDark && { color: '#F9FAFB' }]}>Suggested Challenges</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.challengeRow}>
                  {challenges.map((ch) => {
                    const joined = myChallengeIds.has(ch.challenge_id);
                    const isLimitedTime = !!(ch.starts_at && ch.ends_at);
                    const progressFloors = isLimitedTime ? (limitedTimeProgress[ch.challenge_id] ?? 0) : (ch.period === 'monthly' ? monthlyFloorsForChallenges : weeklyFloorsForChallenges);
                    const progressPct = Math.min(100, Math.round((progressFloors / ch.target_floors) * 100));
                    const completed = joined && progressPct >= 100;
                    const color = medalColorForChallenge(ch);
                    const cornerBadge: { icon: 'lock-closed' | 'people'; bg: string; fg: string } | null =
                      ch.visibility === 'peers'
                        ? { icon: 'lock-closed', bg: '#F5F3FF', fg: '#7C3AED' }
                        : ch.creator_id
                          ? { icon: 'people', bg: '#EFF6FF', fg: '#2563EB' }
                          : null;
                    const dateText = ch.starts_at && ch.ends_at
                      ? `Ends ${new Date(ch.ends_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
                      : ch.period === 'monthly' ? 'Resets monthly' : 'Resets weekly';
                    return (
                      <TouchableOpacity
                        key={ch.challenge_id}
                        style={[s.challengeCard, isDark && { backgroundColor: '#1F2937' }]}
                        onPress={() => setSelectedChallenge(ch)}
                        activeOpacity={0.85}
                      >
                        {cornerBadge && (
                          <View style={[s.challengeCornerBadge, { backgroundColor: cornerBadge.bg }]}>
                            <Ionicons name={cornerBadge.icon} size={11} color={cornerBadge.fg} />
                          </View>
                        )}
                        <View style={{ alignItems: 'center', width: '100%' }}>
                          <View style={{ position: 'relative' }}>
                            <MedalBadge color={color} emblem={medalEmblemFor(ch.reward_icon, ch.badge_key, ch.generic_name)} iconName={ch.reward_icon} size={52} />
                            {completed && (
                              <View style={s.bigBadgeCheck}>
                                <Ionicons name="checkmark-circle" size={15} color="#10B981" />
                              </View>
                            )}
                          </View>
                          <Text style={[s.challengeTitle, isDark && { color: '#F9FAFB' }, { marginTop: 10 }]} numberOfLines={2}>{displayChallengeTitle(ch)}</Text>
                          <Text style={[s.challengeCardDesc, isDark && { color: '#9CA3AF' }]} numberOfLines={2}>{displayChallengeDescription(ch)}</Text>
                          <Text style={s.challengeMeta}>{dateText}</Text>
                        </View>

                        <View style={s.challengeFooter}>
                          {joined ? (
                            <View style={{ width: '100%' }}>
                              <View style={s.challengeTrack}>
                                <View style={[s.challengeFill, { width: `${progressPct}%`, backgroundColor: color }]} />
                              </View>
                              <Text style={s.challengeProgressText}>
                                {completed ? 'Completed!' : `${progressFloors} / ${ch.target_floors} fl`}
                              </Text>
                            </View>
                          ) : (
                            <TouchableOpacity style={[s.joinBtn, { backgroundColor: PRIMARY_BLUE }]} onPress={() => handleJoinChallenge(ch.challenge_id)}>
                              <Text style={s.joinBtnText}>Join</Text>
                            </TouchableOpacity>
                          )}
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
                <TouchableOpacity style={s.exploreAllRow} onPress={onNavigateToGroups} activeOpacity={0.7}>
                  <Text style={s.exploreAllText}>Explore All Challenges</Text>
                  <Ionicons name="chevron-forward" size={14} color="#2563EB" />
                </TouchableOpacity>
              </View>
            )}

            {/* Recommended climbers */}
            {recommended.length > 0 && (
              <View style={s.section}>
                <Text style={[s.cardTitle, isDark && { color: '#F9FAFB' }]}>Recommended For You</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.recRow}>
                  {recommended.map((r) => (
                    <TouchableOpacity
                      key={r.user_id}
                      style={[s.recCard, isDark && { backgroundColor: '#1F2937' }]}
                      onPress={() => setViewingProfileId(r.user_id)}
                      activeOpacity={0.8}
                    >
                      <MascotAvatar skinIdx={r.profile?.avatar_idx ?? 0} photoUri={avatarUriFor(r.profile)} size={44} />
                      <Text style={[s.recName, isDark && { color: '#F9FAFB' }]} numberOfLines={1}>
                        {r.profile?.display_name ?? `Climber${r.user_id.slice(0, 4)}`}
                      </Text>
                      <Text style={s.recStat}>{r.total_floors} fl this week</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
            )}

            <Text style={[s.cardTitle, s.feedSectionTitle, isDark && { color: '#F9FAFB' }]}>Feed</Text>

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
        renderItem={({ item }) => {
          const poster = profilesMap[item.user_id];
          const featuredBadgeDef = poster?.featured_badge ? BADGE_DEFS.find((d) => d.key === poster.featured_badge) : null;
          const isLocalLegend = !!localLegendId && item.user_id === localLegendId;
          const isOwnPost = user?.id === item.user_id;
          const isMock = item.user_id.startsWith('mock-');

          return (
          <View style={[s.feedCard, isDark && { backgroundColor: '#1F2937' }]}>
            <View style={s.feedHeaderRow}>
              <TouchableOpacity
                style={s.feedHeader}
                onPress={() => !isOwnPost && setViewingProfileId(item.user_id)}
                activeOpacity={0.7}
              >
                <MascotAvatar skinIdx={skinFor(item.user_id)} photoUri={photoFor(item.user_id)} size={36} />
                <View style={{ flex: 1 }}>
                  <View style={s.feedNameRow}>
                    <Text style={[s.feedName, isDark && { color: '#F9FAFB' }]}>
                      {isOwnPost ? 'You' : nameFor(item.user_id)}
                    </Text>
                    {featuredBadgeDef && (
                      <MedalBadge
                        color={medalColorFor(featuredBadgeDef)}
                        emblem={medalEmblemFor(featuredBadgeDef.icon, featuredBadgeDef.key, featuredBadgeDef.resets === 'monthly')}
                        iconName={featuredBadgeDef.icon}
                        size={16}
                      />
                    )}
                    {poster?.is_pro && (
                      <View style={s.proChip}><Text style={s.proChipText}>PRO</Text></View>
                    )}
                    {isLocalLegend && (
                      <View style={s.legendChip}>
                        <Ionicons name="trophy" size={10} color="#B45309" />
                        <Text style={s.legendChipText}>Local Legend</Text>
                      </View>
                    )}
                  </View>
                  <Text style={s.feedTime}>{formatRelativeTime(feedTimestamp(item))}</Text>
                </View>
              </TouchableOpacity>

              {!isOwnPost && !isMock && (
                <TouchableOpacity style={s.menuBtn} onPress={() => openPostMenu(item)} hitSlop={8}>
                  <Ionicons name="ellipsis-horizontal" size={18} color={isDark ? '#9CA3AF' : '#6B7280'} />
                </TouchableOpacity>
              )}
            </View>

            <View style={s.feedBodyRow}>
              <Text style={[s.feedBody, isDark && { color: '#D1D5DB' }]}>
                climbed <Text style={s.feedFloors}>{item.floors_climbed} floors</Text>
                {item.blk_no ? ` at Blk ${item.blk_no} ${item.street}` : ''}
              </Text>
              {item.trackingMethod !== 'barometer' && (
                <View style={s.estimatedPill}>
                  <Ionicons name="information-circle-outline" size={11} color="#9CA3AF" />
                  <Text style={s.estimatedPillText}>Estimated</Text>
                </View>
              )}
            </View>

            {item.caption && (
              <Text style={[s.feedCaption, isDark && { color: '#F9FAFB' }]}>{item.caption}</Text>
            )}

            {item.photoSource ? (
              <Image source={item.photoSource} style={s.feedPhoto} />
            ) : (item.photo_paths?.length ?? 0) > 0 || item.photo_path ? (
              <View style={{ marginTop: 10 }}>
                <PhotoGallery paths={item.photo_paths?.length ? item.photo_paths : [item.photo_path!]} height={180} borderRadius={12} />
              </View>
            ) : null}

            <View style={s.feedActions}>
              <TouchableOpacity style={s.kudosBtn} onPress={() => handleToggleKudos(item)} activeOpacity={0.7}>
                <Ionicons name={item.kudosByMe ? 'hand-right' : 'hand-right-outline'} size={18} color={item.kudosByMe ? '#F59E0B' : '#6B7280'} />
                <Text style={[s.kudosText, item.kudosByMe && { color: '#F59E0B' }]}>
                  {item.kudosCount > 0 ? item.kudosCount : 'Kudos'}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity style={s.kudosBtn} onPress={() => handleToggleComments(item.climb_id)} activeOpacity={0.7}>
                <Ionicons name="chatbubble-outline" size={17} color="#6B7280" />
                <Text style={s.kudosText}>{item.commentCount > 0 ? item.commentCount : 'Comment'}</Text>
              </TouchableOpacity>

              {user && item.user_id === user.id && !item.caption && !item.photo_path && (
                <TouchableOpacity onPress={() => openAddPost(item.climb_id)}>
                  <Text style={s.addPostLink}>Add photo or note</Text>
                </TouchableOpacity>
              )}
            </View>

            {expandedClimbId === item.climb_id && (
              <View style={[s.commentsBlock, isDark && { borderTopColor: '#374151' }]}>
                {commentsLoading ? (
                  <ActivityIndicator size="small" color="#2563EB" style={{ marginVertical: 12 }} />
                ) : (
                  <>
                    {climbComments.length > 0 ? (
                      <>
                        {!showAllComments && climbComments.length > COMMENTS_COLLAPSED && (
                          <TouchableOpacity onPress={() => setShowAllComments(true)} style={{ marginBottom: 8 }}>
                            <Text style={s.viewAllCommentsText}>View all {climbComments.length} comments</Text>
                          </TouchableOpacity>
                        )}
                        {(showAllComments ? climbComments : climbComments.slice(-COMMENTS_COLLAPSED)).map((cm) => (
                          <View key={cm.comment_id} style={s.commentRow}>
                            <MascotAvatar skinIdx={profilesMap[cm.user_id]?.avatar_idx ?? 0} photoUri={photoFor(cm.user_id)} size={26} />
                            <View style={{ flex: 1 }}>
                              <View style={s.commentHeaderRow}>
                                <Text style={[s.commentUser, isDark && { color: '#F9FAFB' }]}>
                                  {profilesMap[cm.user_id]?.display_name ?? `Climber${cm.user_id.slice(0, 4)}`}
                                </Text>
                                <Text style={s.commentTime}>{formatRelativeTime(cm.created_at)}</Text>
                              </View>
                              <Text style={[s.commentBody, isDark && { color: '#D1D5DB' }]}>{cm.body}</Text>
                            </View>
                          </View>
                        ))}
                      </>
                    ) : (
                      <Text style={s.emptyFeedText}>No comments yet.</Text>
                    )}
                    {isMock && (
                      <Text style={s.mockPreviewLabel}>Sample post — preview only, comments aren't saved</Text>
                    )}
                    <View style={s.commentInputRow}>
                      <TextInput
                        style={[
                          s.commentInput,
                          isDark && { backgroundColor: '#111827', color: '#F9FAFB' },
                          isMock && s.commentInputDisabled,
                        ]}
                        placeholder={isMock ? 'Preview only — comments disabled' : 'Write a comment...'}
                        placeholderTextColor="#9CA3AF"
                        value={newCommentText}
                        onChangeText={setNewCommentText}
                        maxLength={280}
                        editable={!isMock}
                      />
                      <TouchableOpacity
                        style={[s.commentSendBtn, (!newCommentText.trim() || commentSubmitting || isMock) && { opacity: 0.5 }]}
                        onPress={handleSubmitComment}
                        disabled={!newCommentText.trim() || commentSubmitting || isMock}
                      >
                        {commentSubmitting ? <ActivityIndicator size="small" color="#FFF" /> : <Ionicons name="send" size={14} color="#FFF" />}
                      </TouchableOpacity>
                    </View>
                  </>
                )}
              </View>
            )}
          </View>
          );
        }}
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
        <KeyboardAvoidingView
          style={s.postModalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
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
            <View style={{ marginBottom: 12 }}>
              <PhotoGridPicker
                photos={postPhotosBase64}
                onChange={setPostPhotosBase64}
                emptyLabel="Attach a photo (required)"
                required
                isDark={isDark}
              />
            </View>
            <View style={s.postModalActions}>
              <TouchableOpacity style={s.postCancelBtn} onPress={() => setEditingClimbId(null)}>
                <Text style={s.postCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.postSubmitBtn, (posting || postPhotosBase64.length === 0) && { opacity: 0.5 }]}
                onPress={submitPost}
                disabled={posting || postPhotosBase64.length === 0}
              >
                {posting ? <ActivityIndicator size="small" color="#FFF" /> : <Text style={s.postSubmitText}>Post</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      )}

      <AuthPrompt
        visible={authPromptVisible}
        reason="give kudos and post to the feed"
        onClose={() => setAuthPromptVisible(false)}
      />

      <PublicProfileModal
        userId={viewingProfileId}
        visible={!!viewingProfileId}
        onClose={() => setViewingProfileId(null)}
        mockProfile={viewingProfileId?.startsWith('mock-') ? mockProfileFor(viewingProfileId) : undefined}
      />

      <LeaderboardModal
        visible={leaderboardModalVisible}
        onClose={() => setLeaderboardModalVisible(false)}
        onViewProfile={(id) => { setLeaderboardModalVisible(false); setViewingProfileId(id); }}
        isDark={isDark}
      />

      <NotificationsModal
        visible={notifVisible}
        onClose={() => setNotifVisible(false)}
        isDark={isDark}
        // The modal marks notifications read/dismissed on its own timeline
        // (tap, swipe, clear all) — mirror its live unread count here
        // instead of waiting for the next loadHeader() refetch/refocus,
        // so the bell badge clears the instant the user acts.
        onUnreadCountChange={setUnreadCount}
      />

      <ChallengeDetailModal
        challenge={selectedChallenge}
        visible={!!selectedChallenge}
        onClose={() => setSelectedChallenge(null)}
        joined={!!selectedChallenge && myChallengeIds.has(selectedChallenge.challenge_id)}
        progressFloors={
          selectedChallenge?.starts_at && selectedChallenge?.ends_at
            ? (limitedTimeProgress[selectedChallenge.challenge_id] ?? 0)
            : selectedChallenge?.period === 'monthly' ? monthlyFloorsForChallenges : weeklyFloorsForChallenges
        }
        onJoin={() => selectedChallenge && handleJoinChallenge(selectedChallenge.challenge_id)}
        isDark={isDark}
      />

      {/* Search climbers by handle */}
      <Modal visible={searchModalVisible} animationType="slide" onRequestClose={() => setSearchModalVisible(false)}>
        <View style={[s.searchModalContainer, isDark && { backgroundColor: '#111827' }]}>
          <View style={[s.searchModalHeader, isDark && { borderBottomColor: '#374151' }]}>
            <View style={[s.searchBox, { flex: 1, marginBottom: 0 }, isDark && { backgroundColor: '#1F2937' }]}>
              <Ionicons name="search" size={16} color="#9CA3AF" />
              <TextInput
                style={[s.searchInput, isDark && { color: '#F9FAFB' }]}
                placeholder="Find climbers by handle..."
                placeholderTextColor="#9CA3AF"
                value={searchQuery}
                onChangeText={handleSearch}
                autoFocus
              />
              {searching && <ActivityIndicator size="small" color="#2563EB" />}
            </View>
            <TouchableOpacity onPress={() => { setSearchModalVisible(false); setSearchQuery(''); setSearchResults([]); }} style={{ marginLeft: 12 }}>
              <Text style={s.searchCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={{ padding: 16 }}>
            {searchQuery.trim().length >= 2 ? (
              searchResults.length > 0 ? (
                searchResults.map((p) => (
                  <TouchableOpacity
                    key={p.user_id}
                    style={s.searchResultRow}
                    onPress={() => { setSearchModalVisible(false); setViewingProfileId(p.user_id); }}
                  >
                    <MascotAvatar skinIdx={p.avatar_idx} photoUri={avatarUriFor(p)} size={32} />
                    <Text style={[s.searchResultName, isDark && { color: '#F9FAFB' }]}>{p.display_name}</Text>
                  </TouchableOpacity>
                ))
              ) : !searching ? (
                <Text style={[s.emptyFeedText, isDark && { color: '#9CA3AF' }]}>No climbers found with that handle.</Text>
              ) : null
            ) : (
              <Text style={[s.emptyFeedText, isDark && { color: '#9CA3AF' }]}>Type at least 2 characters to search.</Text>
            )}
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F9FAFB',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
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
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  iconBtn: {
    padding: 4,
  },
  bellBtn: {
    position: 'relative',
    padding: 4,
  },
  bellBadge: {
    position: 'absolute',
    top: 0,
    right: 0,
    minWidth: 15,
    height: 15,
    borderRadius: 8,
    backgroundColor: '#EF4444',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
  },
  bellBadgeText: {
    fontSize: 9,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 110,
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
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 12,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: '#111827',
  },
  searchModalContainer: {
    flex: 1,
    backgroundColor: '#F9FAFB',
  },
  searchModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 56,
    paddingBottom: 14,
    paddingHorizontal: 16,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E7EB',
  },
  searchCancelText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#2563EB',
  },
  searchResultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
  },
  searchResultName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#111827',
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
  cardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  seeAllRow: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  seeAllText: { fontSize: 12, fontWeight: '600', color: '#2563EB' },
  section: { marginBottom: 16 },
  feedSectionTitle: { marginBottom: 4, marginTop: 4 },
  challengesSection: { marginBottom: 16 },
  challengeRow: { gap: 12, paddingRight: 8, paddingTop: 4 },
  // Fixed content slots (medal + always-present pill + title/desc
  // minHeights + fixed footer) keep every card the same height without a
  // forced minHeight or space-between — matching the Groups tab's grid.
  challengeCard: {
    width: 210,
    position: 'relative',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    alignItems: 'center',
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
  },
  challengeCornerBadge: {
    position: 'absolute', top: 12, left: 12, zIndex: 1,
    width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center',
  },
  bigBadgeCheck: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
  },
  communityPill: { alignSelf: 'center', backgroundColor: '#EFF6FF', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, marginTop: 8, marginBottom: 2 },
  communityPillText: { fontSize: 10, fontWeight: '800', color: '#2563EB' },
  challengeTitle: { fontSize: 13, fontWeight: '700', color: '#111827', marginTop: 8, textAlign: 'center', lineHeight: 17, minHeight: 34 },
  challengeCardDesc: { fontSize: 11, color: '#6B7280', textAlign: 'center', lineHeight: 15, marginTop: 4, minHeight: 30 },
  challengeMeta: { fontSize: 10.5, color: '#9CA3AF', fontWeight: '600', textAlign: 'center', marginTop: 6 },
  challengeFooter: { width: '100%', minHeight: 40, justifyContent: 'flex-end', marginTop: 8 },
  challengeTrack: {
    height: 8,
    borderRadius: 4,
    backgroundColor: '#F3F4F6',
    overflow: 'hidden',
  },
  challengeFill: { height: '100%', borderRadius: 4 },
  challengeProgressText: { fontSize: 11.5, fontWeight: '600', color: '#6B7280', marginTop: 6, textAlign: 'center' },
  joinBtn: {
    backgroundColor: '#2563EB',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 24,
    alignItems: 'center',
  },
  joinBtnText: { color: '#FFFFFF', fontWeight: '700', fontSize: 13.5 },
  exploreAllRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    marginTop: 12,
    paddingVertical: 6,
  },
  exploreAllText: { fontSize: 13, fontWeight: '700', color: '#2563EB' },
  recRow: { gap: 12, paddingRight: 8 },
  recCard: {
    width: 110,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 14,
    alignItems: 'center',
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
  },
  recName: { fontSize: 12.5, fontWeight: '700', color: '#111827', marginTop: 8, textAlign: 'center' },
  recStat: { fontSize: 11, color: '#10B981', fontWeight: '600', marginTop: 3, textAlign: 'center' },
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
  feedHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 10,
  },
  feedHeader: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  feedNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
  },
  feedName: { fontSize: 14, fontWeight: '700', color: '#111827' },
  feedTime: { fontSize: 11, color: '#9CA3AF', marginTop: 1 },
  menuBtn: { padding: 4 },
  proChip: {
    backgroundColor: '#111827',
    borderRadius: 5,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  proChipText: { fontSize: 9, fontWeight: '800', color: '#FBBF24', letterSpacing: 0.3 },
  legendChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: '#FFFBEB',
    borderRadius: 5,
    paddingHorizontal: 5,
    paddingVertical: 1.5,
  },
  legendChipText: { fontSize: 9.5, fontWeight: '700', color: '#B45309' },
  feedBodyRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginBottom: 4 },
  feedBody: { fontSize: 14, color: '#374151', lineHeight: 20 },
  estimatedPill: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  estimatedPillText: { fontSize: 10.5, color: '#9CA3AF', fontWeight: '600', fontStyle: 'italic' },
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
  commentsBlock: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#E5E7EB',
  },
  commentRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  commentHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  commentTime: { fontSize: 10.5, color: '#9CA3AF', fontWeight: '500' },
  viewAllCommentsText: { fontSize: 12.5, fontWeight: '600', color: '#9CA3AF' },
  commentUser: { fontSize: 12.5, fontWeight: '700', color: '#111827' },
  commentBody: { fontSize: 13, color: '#374151', marginTop: 1, lineHeight: 18 },
  commentInputRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 },
  commentInput: {
    flex: 1, backgroundColor: '#F3F4F6', borderRadius: 18, paddingHorizontal: 14, paddingVertical: 9,
    fontSize: 13, color: '#111827',
  },
  commentSendBtn: {
    width: 32, height: 32, borderRadius: 16, backgroundColor: '#2563EB',
    alignItems: 'center', justifyContent: 'center',
  },
  mockPreviewLabel: {
    fontSize: 11.5, fontWeight: '600', color: '#9CA3AF', fontStyle: 'italic', marginTop: 2, marginBottom: 6,
  },
  commentInputDisabled: { opacity: 0.5 },
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
  postModalActions: { flexDirection: 'row', gap: 10 },
  postCancelBtn: { flex: 1, padding: 14, borderRadius: 12, backgroundColor: '#F3F4F6', alignItems: 'center' },
  postCancelText: { fontWeight: '600', color: '#6B7280', fontSize: 14 },
  postSubmitBtn: { flex: 2, padding: 14, borderRadius: 12, backgroundColor: '#2563EB', alignItems: 'center' },
  postSubmitText: { fontWeight: '700', color: '#FFFFFF', fontSize: 14 },
});
