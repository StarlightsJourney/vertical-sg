import { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, Image, StyleSheet, ScrollView, TouchableOpacity, Linking, Modal, TextInput, Alert, LayoutAnimation, NativeSyntheticEvent, NativeScrollEvent, KeyboardAvoidingView, Platform } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../config/supabase';
import AuthPrompt from '../components/AuthPrompt';
import ChallengeDetailModal, { challengeColor, PRIMARY_BLUE } from '../components/ChallengeDetailModal';
import MedalBadge, { medalEmblemFor } from '../components/MedalBadge';
import SceneryBanner from '../components/SceneryBanner';
import ClubIcon from '../components/ClubIcon';
import ClubDetailModal from '../components/ClubDetailModal';
import PublicProfileModal from '../components/PublicProfileModal';
import { displayChallengeTitle as displayTitle, displayChallengeDescription as displayDescription } from '../utils/challengeDisplay';
import { wikimediaThumb } from '../utils/wikimediaThumb';
import { medalColorForBadgeKey } from '../utils/medalColor';
import { BADGE_DEFS } from '../types';
import type { Challenge, UserClub, UserEvent, Profile, OfficialClub } from '../types';

function formatDateRange(startIso: string, endIso: string): string {
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  return `${new Date(startIso).toLocaleDateString(undefined, opts)} – ${new Date(endIso).toLocaleDateString(undefined, opts)}`;
}

function formatShortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function isSpecial(ch: Challenge): boolean {
  return !!BADGE_DEFS.find((b) => b.key === ch.badge_key)?.special;
}

// Same color source Profile uses for the same badge — official challenges
// with a real badge_key get the shared tier/special color; user-created
// challenges (no badge_key, no real badge) fall back to a hash-based
// palette purely for visual variety between them.
function medalColorForChallenge(ch: Challenge): string {
  if (ch.badge_key) return medalColorForBadgeKey(ch.badge_key, isSpecial(ch));
  return challengeColor(ch.challenge_id);
}

interface NormalizedEvent {
  name: string;
  location: string;
  blurb: string;
  scope: 'Local' | 'Worldwide';
  url: string | null;
  date: string | null;
  distance?: string;
  eventType?: string;
  photoUri?: string;
  isUser: boolean;
  creatorName?: string;
  eventId?: string;
}

const CLUB_COLOR: Record<OfficialClub['category'], string> = {
  'Trail Running': '#059669',
  Hiking: '#0D9488',
  Climbing: '#7C3AED',
  Announcements: '#F59E0B',
};

// Real photos (openly-licensed, Wikimedia Commons) as circular club logos
// instead of a vector icon attempt — attribution: trail running photo by
// Petar Milošević (CC BY-SA 3.0), rock climbing wall photo is US Air Force
// public domain, Bukit Timah photo by Chainwit. (CC BY 4.0, reused from the
// Local Training listing above). No photo for Announcements — it's shown as
// its own banner, not a grid card, so the small SVG megaphone (ClubIcon) is
// only ever seen at icon size in search results.
const CLUB_PHOTO: Partial<Record<OfficialClub['category'], string>> = {
  'Trail Running': 'https://upload.wikimedia.org/wikipedia/commons/2/25/Trail_running.JPG',
  Hiking: 'https://upload.wikimedia.org/wikipedia/commons/3/30/A_hike_to_the_Bukit_Timah_Summit_%282025%29_-_img_03.jpg',
  Climbing: 'https://upload.wikimedia.org/wikipedia/commons/e/eb/Rock_climbing_wall.jpg',
};
const ANNOUNCEMENTS_PHOTO = 'https://upload.wikimedia.org/wikipedia/commons/3/3f/Singapore_city_skyline_at_night.JPG';

interface EventItem {
  name: string;
  location: string;
  blurb: string;
  scope: 'Local' | 'Worldwide';
  url: string;
  date: string | null;
  distance: string;
  eventType: 'Vertical Marathon' | 'Vertical Challenge' | 'Trail Run' | 'Training';
  /** For recurring weekly training sessions: 0=Sun..6=Sat. When set, `date` is recomputed to the next upcoming occurrence at render time instead of relying on a fixed date that goes stale. */
  weekday?: number;
  /** Real photo of the actual venue (openly-licensed, e.g. Wikimedia Commons) — used instead of the generic illustrated banner when we have one for this specific place. */
  photoUri?: string;
}

/** Next upcoming date (today counts) for a given weekday, so recurring training listings always show a current date instead of drifting stale. */
function nextOccurrenceOfWeekday(weekday: number): string {
  const now = new Date();
  const diff = (weekday - now.getDay() + 7) % 7;
  const d = new Date(now);
  d.setDate(now.getDate() + diff);
  return d.toISOString().slice(0, 10);
}

// Curated, real Singapore + regional races — not scraped live (no live
// scraper in this app), but researched and verified as active events at time
// of writing. Dates shift year to year; tap through for the current one.
// Real photos are openly-licensed (Wikimedia Commons, CC BY / CC BY-SA) —
// attribution is required by the license: KL Tower photo by Jorge Láscar,
// Guoco Tower by Bjoertvedt, Frasers Tower by TheGreatSG'rean, Ping An
// Finance Centre by Dinkun Chen — all CC BY / CC BY-SA, see Wikimedia
// Commons file pages for full attribution text.
const RACES: EventItem[] = [
  { name: 'KL Tower Run International Challenge', location: 'Kuala Lumpur, Malaysia', blurb: '1,608 steps, 292m of ascent inside Malaysia\'s iconic tower.', scope: 'Worldwide', url: 'https://www.jomrun.com/event/Kuala-Lumpur-Tower-Run-International-Challenge-2026', date: '2026-08-22', distance: '1,608 steps · 292m', eventType: 'Vertical Marathon', photoUri: 'https://upload.wikimedia.org/wikipedia/commons/d/d5/Menara_Kuala_Lumpur_%28Kuala_Lumpur_Tower%29_%2818972745702%29.jpg' },
  { name: 'Vertical Challenge', location: 'Frasers Tower, Singapore', blurb: '1,256 steps to the top — Singapore Championship edition.', scope: 'Local', url: 'https://www.fraserstower.com.sg/content/frasers-tower/home/happening/verticalchallenge2025.html', date: '2026-09-12', distance: '1,256 steps · 201m', eventType: 'Vertical Challenge', photoUri: 'https://upload.wikimedia.org/wikipedia/commons/8/8a/Fraser_Tower.jpg' },
  { name: 'National Vertical Marathon', location: 'Guoco Tower, Singapore', blurb: 'Race up Singapore\'s tallest tower. Organized annually by NTU Sports Club.', scope: 'Local', url: 'https://towerrunning.sg/', date: '2026-11-14', distance: '1,455 steps · 234m', eventType: 'Vertical Marathon', photoUri: 'https://upload.wikimedia.org/wikipedia/commons/1/1c/Singapore_-_Guoco_Tower_IMG_9657.jpg' },
  { name: 'PingAn International Vertical Marathon', location: 'Shenzhen, China', blurb: '3,201 stairs, 541m of altitude gain to the observation deck.', scope: 'Worldwide', url: 'https://www.towerrunning.com/2025/11/27/announcement-towerrunning-200-internatiinal-vertical-marathon-pingan-shenzhen-january-10-2026/', date: '2027-01-10', distance: '3,201 steps · 541m', eventType: 'Vertical Marathon', photoUri: 'https://upload.wikimedia.org/wikipedia/commons/a/a4/PING_AN_FINANCE_CENTER%2C_SHENZHEN.jpg' },
  { name: 'Towerrunning Tour', location: 'Worldwide circuit', blurb: 'The season-long international towerrunning series — races in dozens of cities.', scope: 'Worldwide', url: 'https://www.towerrunning.com/towerrunning-tour-2026/', date: null, distance: 'Varies by city', eventType: 'Vertical Marathon' },
];

// "Local club events" — recurring weekly training sessions curated from each
// club/community's own posted schedule (Facebook group, gym site). Not a
// live scraper (this app has none), but each entry's `weekday` is used to
// compute the next upcoming date at render time (nextOccurrenceOfWeekday),
// so the listed date is always current instead of a fixed date going stale
// — tap through to the source for full schedule details.
// Real photos are openly-licensed (Wikimedia Commons): Bukit Timah by
// Chainwit. (CC BY 4.0), MacRitchie by Calvin Teo (CC BY-SA), Henderson
// Waves/Southern Ridges by Schristia (CC BY 2.0), Bishan-AMK Park by
// Wirbel1980 (CC BY-SA), Kallang Wave Mall by LN9267 (CC BY-SA) — see
// Wikimedia Commons file pages for full attribution text.
const LOCAL_TRAINING: EventItem[] = ([
  { name: 'Trail Runners SG Hill Repeats', location: 'Bukit Timah Nature Reserve', blurb: 'Weekly Saturday hill-repeat session, open to all paces — meet at the visitor centre.', scope: 'Local', url: 'https://www.facebook.com/groups/TrailRunnersSingapore/', date: null, weekday: 6, distance: '5–8km repeats', eventType: 'Training', photoUri: 'https://upload.wikimedia.org/wikipedia/commons/3/30/A_hike_to_the_Bukit_Timah_Summit_%282025%29_-_img_03.jpg' },
  { name: 'SG Hiking Group Weekend Trail Walk', location: 'MacRitchie Reservoir', blurb: 'Casual weekend nature walk along the TreeTop Walk loop — beginner friendly.', scope: 'Local', url: 'https://www.facebook.com/groups/sghikingandtravel/', date: null, weekday: 0, distance: '~10km loop', eventType: 'Training', photoUri: 'https://upload.wikimedia.org/wikipedia/commons/f/fb/MacRitchie_Reservoir.jpg' },
  { name: 'Adidas Runners SG Track Session', location: 'Bishan-Ang Mo Kio Park', blurb: 'Structured interval track session, part of the weekly crew calendar.', scope: 'Local', url: 'https://www.runmagazine.asia/adidas-runners-singapore/', date: null, weekday: 2, distance: 'Interval sets', eventType: 'Training', photoUri: 'https://upload.wikimedia.org/wikipedia/commons/4/4f/Bishan-Ang_Mo_Kio_Park.jpg' },
  { name: 'Climb Central Bouldering Meetup', location: 'Climb Central, Kallang Wave Mall', blurb: 'Community bouldering night — partner-finding and route projects.', scope: 'Local', url: 'https://www.climbcentral.sg/', date: null, weekday: 3, distance: 'Indoor bouldering', eventType: 'Training', photoUri: 'https://upload.wikimedia.org/wikipedia/commons/f/fa/Kallang_Wave_Mall_06-08-2025.jpg' },
  { name: 'Exploring SG Hiking Night Hike', location: 'Southern Ridges', blurb: 'Evening hike across the Southern Ridges boardwalks — bring a headlamp.', scope: 'Local', url: 'https://www.facebook.com/groups/957889039371788/', date: null, weekday: 5, distance: '~10km', eventType: 'Training', photoUri: 'https://upload.wikimedia.org/wikipedia/commons/8/85/Henderson_Waves%2C_Singapore.jpg' },
] as EventItem[]).map((e) => ({ ...e, date: nextOccurrenceOfWeekday(e.weekday!) }));

type Tab = 'challenges' | 'clubs' | 'events';

export default function GroupsScreen({ isDark = false }: { isDark?: boolean }) {
  const { user, isAnonymous } = useAuth();
  const [tab, setTab] = useState<Tab>('challenges');
  const [authPromptVisible, setAuthPromptVisible] = useState(false);
  const [searchVisible, setSearchVisible] = useState(false);
  const [searchTab, setSearchTab] = useState<'friends' | 'clubs'>('friends');
  const [searchQuery, setSearchQuery] = useState('');
  const [friendResults, setFriendResults] = useState<Profile[]>([]);
  const [viewingProfileId, setViewingProfileId] = useState<string | null>(null);

  const [weeklyChallenges, setWeeklyChallenges] = useState<Challenge[]>([]);
  const [monthlyChallenges, setMonthlyChallenges] = useState<Challenge[]>([]);
  const [limitedTimeChallenges, setLimitedTimeChallenges] = useState<Challenge[]>([]);
  const [myChallengeIds, setMyChallengeIds] = useState<Set<string>>(new Set());
  const [weeklyFloors, setWeeklyFloors] = useState(0);
  const [monthlyFloors, setMonthlyFloors] = useState(0);
  const [limitedTimeProgress, setLimitedTimeProgress] = useState<Record<string, number>>({});
  const [selectedChallenge, setSelectedChallenge] = useState<Challenge | null>(null);

  const [officialClubs, setOfficialClubs] = useState<OfficialClub[]>([]);
  const [selectedClub, setSelectedClub] = useState<OfficialClub | null>(null);
  const [userClubs, setUserClubs] = useState<UserClub[]>([]);
  const [userEvents, setUserEvents] = useState<UserEvent[]>([]);
  const [creatorNames, setCreatorNames] = useState<Record<string, string>>({});

  const [createClubVisible, setCreateClubVisible] = useState(false);
  const [createEventVisible, setCreateEventVisible] = useState(false);
  const [createChallengeVisible, setCreateChallengeVisible] = useState(false);
  const [challengeVisibilityDefault, setChallengeVisibilityDefault] = useState<'public' | 'peers'>('public');
  const [viewAllSection, setViewAllSection] = useState<'training' | 'races' | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<NormalizedEvent | null>(null);

  // Sticky header, hide-on-scroll-down / show-on-scroll-up tab bar
  // (Strava-style). Two earlier attempts both had real bugs: a JS-driven
  // height interpolation coupled to onLayout measurement (stutter, and the
  // bar could get stuck near-zero-height), then an opacity/translateY-only
  // native-driven version (smooth, but left the bar's background box
  // visible with nothing in it, since only its *contents* were faded, not
  // its layout footprint). This version uses LayoutAnimation + a plain
  // boolean instead of Animated at all: the bar is genuinely
  // mounted/unmounted, and LayoutAnimation smooths the resulting layout
  // shift on the native side — this is the same mechanism (and precedent)
  // already used for NotificationsModal's swipe-to-dismiss animation.
  const [tabBarVisible, setTabBarVisible] = useState(true);
  const lastScrollY = useRef(0);
  const handleScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const y = e.nativeEvent.contentOffset.y;
    const delta = y - lastScrollY.current;
    const showBar = () => {
      if (!tabBarVisible) { LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut); setTabBarVisible(true); }
    };
    const hideBar = () => {
      if (tabBarVisible) { LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut); setTabBarVisible(false); }
    };
    if (y <= 10) showBar();
    else if (delta > 8) hideBar();
    else if (delta < -8) showBar();
    lastScrollY.current = y;
  };

  const loadChallenges = useCallback(async () => {
    const { data } = await supabase.from('challenges').select('*').eq('is_active', true);
    let all: Challenge[] = [];
    if (data) {
      all = data as Challenge[];
      const now = new Date();
      setLimitedTimeChallenges(
        all.filter((c) => c.starts_at && c.ends_at && new Date(c.ends_at) >= now)
          .sort((a, b) => new Date(a.ends_at!).getTime() - new Date(b.ends_at!).getTime()),
      );
      setMonthlyChallenges(all.filter((c) => c.period === 'monthly' && !c.starts_at));
      setWeeklyChallenges(all.filter((c) => c.period === 'weekly' && !c.starts_at));
    }

    if (!user) return;
    const [{ data: joined }, { data: climbs }] = await Promise.all([
      supabase.from('challenge_participants').select('challenge_id').eq('user_id', user.id),
      supabase.from('climbs').select('floors_climbed, created_at').eq('user_id', user.id).gte('created_at', new Date(Date.now() - 60 * 86400000).toISOString()),
    ]);
    if (joined) setMyChallengeIds(new Set(joined.map((j: any) => j.challenge_id)));
    if (climbs) {
      const now = Date.now();
      setWeeklyFloors(climbs.filter((c: any) => now - new Date(c.created_at).getTime() < 7 * 86400000).reduce((s, c: any) => s + c.floors_climbed, 0));
      setMonthlyFloors(climbs.filter((c: any) => now - new Date(c.created_at).getTime() < 30 * 86400000).reduce((s, c: any) => s + c.floors_climbed, 0));

      const ltProgress: Record<string, number> = {};
      for (const ch of all.filter((c) => c.starts_at && c.ends_at)) {
        const start = new Date(ch.starts_at!).getTime();
        const end = new Date(ch.ends_at!).getTime();
        ltProgress[ch.challenge_id] = climbs
          .filter((c: any) => { const t = new Date(c.created_at).getTime(); return t >= start && t <= end; })
          .reduce((s, c: any) => s + c.floors_climbed, 0);
      }
      setLimitedTimeProgress(ltProgress);
    }
  }, [user]);

  const loadUserContent = useCallback(async () => {
    const [{ data: clubs }, { data: events }, { data: official }] = await Promise.all([
      supabase.from('user_clubs').select('*').order('created_at', { ascending: false }),
      supabase.from('user_events').select('*').order('created_at', { ascending: false }),
      supabase.from('official_clubs').select('*').order('name', { ascending: true }),
    ]);
    if (clubs) setUserClubs(clubs as UserClub[]);
    if (events) setUserEvents(events as UserEvent[]);
    if (official) setOfficialClubs(official as OfficialClub[]);

    const creatorIds = [...new Set([...(clubs ?? []).map((c: any) => c.creator_id), ...(events ?? []).map((e: any) => e.creator_id)])];
    if (creatorIds.length > 0) {
      const { data: profiles } = await supabase.from('profiles').select('*').in('user_id', creatorIds);
      if (profiles) {
        const map: Record<string, string> = {};
        for (const p of profiles as Profile[]) map[p.user_id] = p.display_name;
        setCreatorNames(map);
      }
    }
  }, []);

  useEffect(() => { loadChallenges(); }, [loadChallenges]);
  useEffect(() => { loadUserContent(); }, [loadUserContent]);

  useEffect(() => {
    if (!searchVisible || searchTab !== 'friends' || !user || searchQuery.trim().length === 0) { setFriendResults([]); return; }
    let cancelled = false;
    supabase.from('profiles').select('*').ilike('display_name', `%${searchQuery.trim()}%`).neq('user_id', user.id).limit(20).then(({ data }) => {
      if (!cancelled && data) setFriendResults(data as Profile[]);
    });
    return () => { cancelled = true; };
  }, [searchVisible, searchTab, searchQuery, user]);

  const handleJoin = async (challengeId: string) => {
    if (isAnonymous) { setAuthPromptVisible(true); return; }
    if (!user) return;
    setMyChallengeIds((prev) => new Set(prev).add(challengeId));
    await supabase.from('challenge_participants').insert({ challenge_id: challengeId, user_id: user.id });
  };

  const requireAuth = (action: () => void) => {
    if (isAnonymous) { setAuthPromptVisible(true); return; }
    action();
  };

  const handleReportClub = (clubId: string) => {
    Alert.alert('Report this club?', '', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Report', style: 'destructive', onPress: () => supabase.rpc('report_user_club', { p_club_id: clubId }) },
    ]);
  };
  const handleReportEvent = (eventId: string) => {
    Alert.alert('Report this event?', '', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Report', style: 'destructive', onPress: () => supabase.rpc('report_user_event', { p_event_id: eventId }) },
    ]);
  };

  const progressFor = (ch: Challenge): number => {
    if (ch.starts_at && ch.ends_at) return limitedTimeProgress[ch.challenge_id] ?? 0;
    return ch.period === 'monthly' ? monthlyFloors : weeklyFloors;
  };

  const matchesSearch = (text: string) => searchQuery.trim().length === 0 || text.toLowerCase().includes(searchQuery.trim().toLowerCase());

  // Compact card — 2 fit per row. Title, short description, time-limit line,
  // then a full-width Join button (or progress bar once joined). Join button
  // is always the same brand color across every challenge — accent color is
  // reserved for the medal only.
  const renderChallengeCard = (ch: Challenge) => {
    const progressFloors = progressFor(ch);
    const joined = myChallengeIds.has(ch.challenge_id);
    const pct = Math.min(100, Math.round((progressFloors / ch.target_floors) * 100));
    const completed = joined && pct >= 100;
    const color = medalColorForChallenge(ch);
    const isLimitedTime = !!(ch.starts_at && ch.ends_at);
    return (
      <TouchableOpacity
        key={ch.challenge_id}
        style={[s.gridCard, isDark && { backgroundColor: '#1F2937' }]}
        onPress={() => setSelectedChallenge(ch)}
        activeOpacity={0.85}
      >
        <View style={{ alignItems: 'center', width: '100%' }}>
          <View style={{ position: 'relative' }}>
            <MedalBadge color={color} emblem={medalEmblemFor(ch.reward_icon, ch.badge_key, ch.generic_name)} size={52} />
            {completed && (
              <View style={s.bigBadgeCheck}>
                <Ionicons name="checkmark-circle" size={15} color="#10B981" />
              </View>
            )}
          </View>
          {ch.visibility === 'peers' ? (
            <View style={[s.communityPill, { backgroundColor: '#F5F3FF' }]}>
              <Text style={[s.communityPillText, { color: '#7C3AED' }]}>Peers Only</Text>
            </View>
          ) : ch.creator_id && (
            <View style={s.communityPill}>
              <Text style={s.communityPillText}>Community</Text>
            </View>
          )}
          <Text style={[s.gridTitle, isDark && { color: '#F9FAFB' }]} numberOfLines={2}>{displayTitle(ch)}</Text>
          <Text style={[s.gridDesc, isDark && { color: '#9CA3AF' }]} numberOfLines={2}>{displayDescription(ch)}</Text>
          <Text style={s.gridDateText} numberOfLines={1}>
            {isLimitedTime ? formatDateRange(ch.starts_at!, ch.ends_at!) : (ch.period === 'monthly' ? 'Resets monthly' : 'Resets weekly')}
          </Text>
        </View>

        {joined ? (
          <View style={{ marginTop: 8, width: '100%' }}>
            <View style={s.challengeTrack}>
              <View style={[s.challengeFill, { width: `${pct}%`, backgroundColor: color }]} />
            </View>
            <Text style={s.challengeProgressText}>
              {completed ? 'Completed!' : `${progressFloors} / ${ch.target_floors} fl`}
            </Text>
          </View>
        ) : (
          <TouchableOpacity style={s.gridJoinBtn} onPress={() => handleJoin(ch.challenge_id)}>
            <Text style={s.joinBtnText}>Join</Text>
          </TouchableOpacity>
        )}
      </TouchableOpacity>
    );
  };

  // Special/featured challenges (Everest Gauntlet, Double Eight-Thousander) —
  // full-width scenic "cover photo" card, Strava-style: image on top, all
  // challenge details below it (not overlaid on the image).
  const renderFeaturedChallenge = (ch: Challenge) => {
    const progressFloors = progressFor(ch);
    const joined = myChallengeIds.has(ch.challenge_id);
    const pct = Math.min(100, Math.round((progressFloors / ch.target_floors) * 100));
    const completed = joined && pct >= 100;
    const color = medalColorForChallenge(ch);
    return (
      <TouchableOpacity key={ch.challenge_id} style={[s.featCard, isDark && { backgroundColor: '#1F2937' }]} onPress={() => setSelectedChallenge(ch)} activeOpacity={0.9}>
        <SceneryBanner variant="mountains" height={150} borderRadius={0}>
          <View style={s.featEyebrowWrap}>
            <Text style={s.featEyebrow}>FEATURED CHALLENGE</Text>
          </View>
          <View style={s.featMedalWrap}>
            <MedalBadge color={color} emblem="trophy" size={60} />
          </View>
        </SceneryBanner>
        <View style={s.featBody}>
          <Text style={[s.featTitle, isDark && { color: '#F9FAFB' }]}>{ch.title}</Text>
          <Text style={[s.featDesc, isDark && { color: '#9CA3AF' }]} numberOfLines={3}>{ch.description}</Text>
          <View style={s.featPillRow}>
            <View style={[s.featPill, isDark && { backgroundColor: '#111827' }]}>
              <Ionicons name="time-outline" size={12} color={isDark ? '#D1D5DB' : '#6B7280'} />
              <Text style={[s.featPillText, isDark && { color: '#D1D5DB' }]}>{ch.period === 'monthly' ? 'Resets monthly' : 'Resets weekly'}</Text>
            </View>
            <View style={[s.featPill, isDark && { backgroundColor: '#111827' }]}>
              <Text style={[s.featPillText, isDark && { color: '#D1D5DB' }]}>{ch.target_floors} FLOORS</Text>
            </View>
          </View>
          {joined ? (
            <View>
              <View style={s.challengeTrack}>
                <View style={[s.challengeFill, { width: `${pct}%`, backgroundColor: color }]} />
              </View>
              <Text style={s.challengeProgressText}>{completed ? 'Completed!' : `${progressFloors} / ${ch.target_floors} fl`}</Text>
            </View>
          ) : (
            <TouchableOpacity style={s.featJoinBtn} onPress={() => handleJoin(ch.challenge_id)}>
              <Text style={s.joinBtnText}>Join Challenge</Text>
            </TouchableOpacity>
          )}
        </View>
      </TouchableOpacity>
    );
  };

  const allChallenges = [...limitedTimeChallenges, ...monthlyChallenges, ...weeklyChallenges];
  const featuredChallenges = allChallenges.filter(isSpecial).sort((a, b) => b.target_floors - a.target_floors);
  const gridChallengePriority = (c: Challenge) => (c.starts_at && c.ends_at ? 0 : c.creator_id ? 1 : 2);
  const gridChallenges = allChallenges
    .filter((c) => !isSpecial(c))
    .sort((a, b) => gridChallengePriority(a) - gridChallengePriority(b));

  const visibleUserClubs = userClubs.filter((c) => matchesSearch(c.name));
  const announcementsClub = officialClubs.find((c) => c.category === 'Announcements');
  const sportClubs = officialClubs.filter((c) => c.category !== 'Announcements');

  const renderEventCard = (ev: EventItem | (UserEvent & { isUser: true }), width?: number) => {
    const isUser = 'event_id' in ev;
    const key = isUser ? ev.event_id : ev.name;
    const date = isUser ? ev.event_date : ev.date;
    const distance = isUser ? undefined : ev.distance;
    const eventType = isUser ? undefined : ev.eventType;
    const url = ev.url;
    const photoUri = isUser ? undefined : ev.photoUri;
    const openDetail = () => setSelectedEvent({
      name: ev.name, location: ev.location, blurb: ev.blurb, scope: ev.scope, url, date,
      distance, eventType, photoUri, isUser,
      creatorName: isUser ? (creatorNames[ev.creator_id] ?? 'a climber') : undefined,
      eventId: isUser ? ev.event_id : undefined,
    });
    return (
      <TouchableOpacity
        key={key}
        style={[s.eventCard, width ? { width } : { width: '100%' }, isDark && { backgroundColor: '#1F2937' }]}
        onPress={openDetail}
        activeOpacity={0.85}
      >
        <SceneryBanner variant={ev.scope === 'Worldwide' ? 'skyline' : 'sunrise'} height={110} borderRadius={0} photoUri={photoUri}>
          {date && (
            <View style={s.eventDateBadge}>
              <Text style={s.eventDateBadgeText}>{formatShortDate(date)}</Text>
            </View>
          )}
        </SceneryBanner>
        <View style={s.eventBody}>
          <View style={{ flex: 1 }}>
            <Text style={[s.eventTitle, isDark && { color: '#F9FAFB' }]} numberOfLines={1}>{ev.name}</Text>
            <View style={s.eventLocationRow}>
              <Ionicons name="location-outline" size={12} color="#9CA3AF" />
              <Text style={s.eventLocationText} numberOfLines={1}>{ev.location}</Text>
            </View>
            <Text style={[s.eventBlurb, isDark && { color: '#9CA3AF' }]} numberOfLines={2}>{ev.blurb}</Text>
            <View style={s.eventTagRow}>
              {distance && (
                <View style={[s.eventTag, isDark && { backgroundColor: '#111827' }]}>
                  <Text style={[s.eventTagText, isDark && { color: '#D1D5DB' }]}>{distance}</Text>
                </View>
              )}
              {eventType && (
                <View style={[s.eventTag, isDark && { backgroundColor: '#111827' }]}>
                  <Text style={[s.eventTagText, isDark && { color: '#D1D5DB' }]}>{eventType}</Text>
                </View>
              )}
              <View style={[s.eventTag, isDark && { backgroundColor: '#111827' }]}>
                <Text style={[s.eventTagText, isDark && { color: '#D1D5DB' }]}>{ev.scope}</Text>
              </View>
            </View>
            {isUser && (
              <Text style={s.linkCardCreator}>Added by {creatorNames[ev.creator_id] ?? 'a climber'}</Text>
            )}
          </View>
          {isUser && (
            <TouchableOpacity onPress={() => handleReportEvent(ev.event_id)} hitSlop={8} style={{ padding: 4 }}>
              <Ionicons name="ellipsis-horizontal" size={16} color="#9CA3AF" />
            </TouchableOpacity>
          )}
        </View>
      </TouchableOpacity>
    );
  };

  const sortByDate = <T extends { date?: string | null; event_date?: string | null }>(items: T[]) =>
    [...items].sort((a, b) => {
      const da = a.date ?? a.event_date ?? null;
      const db = b.date ?? b.event_date ?? null;
      if (da && db) return new Date(da).getTime() - new Date(db).getTime();
      if (da) return -1;
      if (db) return 1;
      return 0;
    });

  const trainingItems = sortByDate(LOCAL_TRAINING.filter((e) => matchesSearch(e.name)));
  const userTrainingLike = sortByDate(userEvents.filter((e) => matchesSearch(e.name) && e.scope === 'Local').map((e) => ({ ...e, isUser: true as const })));
  const raceItems = sortByDate(RACES.filter((e) => matchesSearch(e.name)));
  const userRaceLike = sortByDate(userEvents.filter((e) => matchesSearch(e.name) && e.scope === 'Worldwide').map((e) => ({ ...e, isUser: true as const })));

  const renderHorizontalSection = (title: string, curated: EventItem[], userItems: (UserEvent & { isUser: true })[], key: 'training' | 'races') => {
    const combined: Array<EventItem | (UserEvent & { isUser: true })> = [...userItems, ...curated];
    return (
      <View style={s.groupSection}>
        <View style={s.sectionHeaderRow}>
          <Text style={[s.groupSectionTitle, isDark && { color: '#F9FAFB' }, { marginBottom: 0 }]}>{title}</Text>
          <TouchableOpacity onPress={() => setViewAllSection(key)}>
            <Text style={s.viewAllText}>View All</Text>
          </TouchableOpacity>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.hScrollContent} decelerationRate="fast" snapToInterval={264}>
          {combined.slice(0, 8).map((ev) => renderEventCard(ev, 250))}
        </ScrollView>
      </View>
    );
  };

  return (
    <View style={[s.container, isDark && { backgroundColor: '#111827' }]}>
      {/* Sticky header — always visible */}
      <View style={[s.header, isDark && { backgroundColor: '#111827', borderBottomColor: '#374151' }]}>
        <Text style={[s.headerTitle, isDark && { color: '#F9FAFB' }]}>Groups</Text>
        <TouchableOpacity style={s.headerSearchBtn} onPress={() => setSearchVisible(true)} activeOpacity={0.7}>
          <Ionicons name="search-outline" size={22} color={isDark ? '#D1D5DB' : '#374151'} />
        </TouchableOpacity>
      </View>

      {/* Tab bar hides on scroll-down, reappears on scroll-up — genuinely
          mounted/unmounted (LayoutAnimation smooths the transition), so
          nothing is left behind when it's gone. */}
      {tabBarVisible && (
        <View style={[s.tabBar, isDark && { backgroundColor: '#1F2937' }]}>
          {(['challenges', 'clubs', 'events'] as Tab[]).map((t) => (
            <TouchableOpacity
              key={t}
              style={[s.tabBtn, tab === t && s.tabBtnActive, tab === t && isDark && { backgroundColor: '#374151' }]}
              onPress={() => setTab(t)}
            >
              <Text style={[s.tabBtnText, tab === t && s.tabBtnTextActive, isDark && { color: tab === t ? '#F9FAFB' : '#9CA3AF' }]}>
                {t === 'challenges' ? 'Challenges' : t === 'clubs' ? 'Clubs' : 'Events'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      <ScrollView contentContainerStyle={s.scrollContent} showsVerticalScrollIndicator={false} onScroll={handleScroll} scrollEventThrottle={16}>
        {tab === 'challenges' && (
          <>
            {featuredChallenges.map(renderFeaturedChallenge)}

            <TouchableOpacity
              style={[s.peerCta, isDark && { backgroundColor: '#1F2937' }]}
              onPress={() => requireAuth(() => { setChallengeVisibilityDefault('peers'); setCreateChallengeVisible(true); })}
              activeOpacity={0.9}
            >
              <View style={s.peerCtaIcon}>
                <Ionicons name="people-circle-outline" size={26} color={PRIMARY_BLUE} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[s.peerCtaTitle, isDark && { color: '#F9FAFB' }]}>Challenge Your Crew</Text>
                <Text style={[s.peerCtaSubtitle, isDark && { color: '#9CA3AF' }]}>Create a private challenge just for your peers or club — not shown to the wider community.</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={isDark ? '#6B7280' : '#9CA3AF'} />
            </TouchableOpacity>

            {gridChallenges.length > 0 && (
              <View style={s.gridWrap}>
                {gridChallenges.map((ch) => renderChallengeCard(ch))}
              </View>
            )}
          </>
        )}

        {tab === 'clubs' && (
          <>
            {/* Same layout as "Challenge Your Crew" — icon + title/subtitle + chevron */}
            <TouchableOpacity
              style={[s.peerCta, isDark && { backgroundColor: '#1F2937' }]}
              onPress={() => requireAuth(() => setCreateClubVisible(true))}
              activeOpacity={0.9}
            >
              <View style={s.peerCtaIcon}>
                <Ionicons name="people-circle-outline" size={26} color={PRIMARY_BLUE} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[s.peerCtaTitle, isDark && { color: '#F9FAFB' }]}>Create your own Vertical Club</Text>
                <Text style={[s.peerCtaSubtitle, isDark && { color: '#9CA3AF' }]}>Rally your own crew around trail running, hiking, or climbing.</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={isDark ? '#6B7280' : '#9CA3AF'} />
            </TouchableOpacity>

            {announcementsClub && (
              <TouchableOpacity onPress={() => setSelectedClub(announcementsClub)} activeOpacity={0.9} style={{ marginHorizontal: -16, marginBottom: 20 }}>
                <SceneryBanner variant="skyline" height={130} borderRadius={0} photoUri={ANNOUNCEMENTS_PHOTO}>
                  <View style={s.ctaBannerOverlay}>
                    <View style={s.announceHeaderRow}>
                      <Image source={require('../../assets/icon.png')} style={s.announceAppIcon} />
                      <View style={s.announceBadgeRow}>
                        <Ionicons name="megaphone" size={13} color="#FFFFFF" />
                        <Text style={s.announceBadgeText}>OFFICIAL</Text>
                      </View>
                    </View>
                    <Text style={s.ctaBannerTitle}>{announcementsClub.name}</Text>
                    <Text style={s.ctaBannerSubtitle}>Official updates from the Vertical team</Text>
                  </View>
                  <View style={s.announceJoinBtn}>
                    <Text style={s.announceJoinBtnText}>Join</Text>
                  </View>
                </SceneryBanner>
              </TouchableOpacity>
            )}

            <Text style={[s.groupSectionTitle, isDark && { color: '#F9FAFB' }]}>Clubs</Text>
            <View style={s.gridWrap}>
              {sportClubs.filter((c) => matchesSearch(c.name)).map((club) => (
                <TouchableOpacity key={club.club_id} style={[s.gridCard, isDark && { backgroundColor: '#1F2937' }]} onPress={() => setSelectedClub(club)} activeOpacity={0.85}>
                  {CLUB_PHOTO[club.category] ? (
                    <Image source={{ uri: wikimediaThumb(CLUB_PHOTO[club.category]!, 250) }} style={s.clubIconCircle} resizeMode="cover" />
                  ) : (
                    <View style={[s.clubIconCircle, { backgroundColor: CLUB_COLOR[club.category] + '1F', alignItems: 'center', justifyContent: 'center' }]}>
                      <ClubIcon category={club.category} color={CLUB_COLOR[club.category]} size={26} />
                    </View>
                  )}
                  <Text style={[s.gridTitle, isDark && { color: '#F9FAFB' }]}>{club.name}</Text>
                  <Text style={[s.gridDesc, isDark && { color: '#9CA3AF' }]} numberOfLines={3}>{club.description}</Text>
                  <View style={s.gridJoinBtn}>
                    <Text style={s.joinBtnText}>View Club</Text>
                  </View>
                </TouchableOpacity>
              ))}
            </View>

            {visibleUserClubs.length > 0 && (
              <View style={s.groupSection}>
                <Text style={[s.groupSectionTitle, isDark && { color: '#F9FAFB' }]}>Community Submissions</Text>
                {visibleUserClubs.map((club) => (
                  <TouchableOpacity
                    key={club.club_id}
                    style={[s.linkCard, isDark && { backgroundColor: '#1F2937' }]}
                    onPress={() => club.url && Linking.openURL(club.url)}
                    activeOpacity={0.7}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[s.linkCardTitle, isDark && { color: '#F9FAFB' }]}>{club.name}</Text>
                      <Text style={[s.linkCardDesc, isDark && { color: '#9CA3AF' }]}>{club.description}</Text>
                      <Text style={s.linkCardCreator}>Added by {creatorNames[club.creator_id] ?? 'a climber'}</Text>
                    </View>
                    <TouchableOpacity onPress={() => handleReportClub(club.club_id)} hitSlop={8}>
                      <Ionicons name="ellipsis-horizontal" size={16} color="#9CA3AF" />
                    </TouchableOpacity>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </>
        )}

        {tab === 'events' && (
          <>
            <View style={s.createRow}>
              <TouchableOpacity style={s.createBtn} onPress={() => requireAuth(() => setCreateEventVisible(true))}>
                <Ionicons name="add" size={16} color={PRIMARY_BLUE} />
                <Text style={s.createBtnText}>Add an Event</Text>
              </TouchableOpacity>
            </View>

            {renderHorizontalSection('Local Club Training', trainingItems, userTrainingLike, 'training')}
            {renderHorizontalSection('Races & Marathons', raceItems, userRaceLike, 'races')}

            <Text style={[s.eventsFootnote, isDark && { color: '#6B7280' }]}>
              Curated from club/race-organizer sites — dates shift, so tap through for the current schedule.
            </Text>
          </>
        )}
      </ScrollView>

      {/* --- View All (Local Training / Races) --- */}
      <Modal visible={!!viewAllSection} animationType="slide" onRequestClose={() => setViewAllSection(null)}>
        <View style={[s.searchModalContainer, isDark && { backgroundColor: '#111827' }]}>
          <View style={[s.searchModalHeader, isDark && { borderBottomColor: '#374151', backgroundColor: '#111827' }]}>
            <TouchableOpacity onPress={() => setViewAllSection(null)} hitSlop={10}>
              <Ionicons name="arrow-back" size={24} color={isDark ? '#F9FAFB' : '#111827'} />
            </TouchableOpacity>
            <Text style={[s.searchModalTitle, isDark && { color: '#F9FAFB' }]}>{viewAllSection === 'training' ? 'Local Club Training' : 'Races & Marathons'}</Text>
            <View style={{ width: 24 }} />
          </View>
          <ScrollView contentContainerStyle={{ padding: 16 }}>
            {viewAllSection === 'training' && [...userTrainingLike, ...trainingItems].map((ev) => renderEventCard(ev))}
            {viewAllSection === 'races' && [...userRaceLike, ...raceItems].map((ev) => renderEventCard(ev))}
          </ScrollView>
        </View>
      </Modal>

      {/* --- Search panel: back arrow + title, Friends/Clubs sub-nav --- */}
      <Modal visible={searchVisible} animationType="slide" onRequestClose={() => { setSearchVisible(false); setSearchQuery(''); }}>
        <View style={[s.searchModalContainer, isDark && { backgroundColor: '#111827' }]}>
          <View style={[s.searchModalHeader, isDark && { borderBottomColor: '#374151', backgroundColor: '#111827' }]}>
            <TouchableOpacity onPress={() => { setSearchVisible(false); setSearchQuery(''); }} hitSlop={10}>
              <Ionicons name="arrow-back" size={24} color={isDark ? '#F9FAFB' : '#111827'} />
            </TouchableOpacity>
            <Text style={[s.searchModalTitle, isDark && { color: '#F9FAFB' }]}>Search</Text>
            <View style={{ width: 24 }} />
          </View>

          <View style={[s.searchSubNav, isDark && { backgroundColor: '#1F2937' }]}>
            {(['friends', 'clubs'] as const).map((t) => (
              <TouchableOpacity
                key={t}
                style={[s.searchSubNavBtn, searchTab === t && s.tabBtnActive, searchTab === t && isDark && { backgroundColor: '#374151' }]}
                onPress={() => setSearchTab(t)}
              >
                <Text style={[s.tabBtnText, searchTab === t && s.tabBtnTextActive, isDark && { color: searchTab === t ? '#F9FAFB' : '#9CA3AF' }]}>
                  {t === 'friends' ? 'Friends' : 'Clubs'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <View style={[s.searchBox, isDark && { backgroundColor: '#1F2937' }]}>
            <Ionicons name="search" size={16} color="#9CA3AF" />
            <TextInput
              style={[s.searchInput, isDark && { color: '#F9FAFB' }]}
              placeholder={searchTab === 'friends' ? 'Search climbers by name...' : 'Search clubs...'}
              placeholderTextColor="#9CA3AF"
              value={searchQuery}
              onChangeText={setSearchQuery}
              autoFocus
            />
          </View>

          <ScrollView contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
            {searchTab === 'friends' ? (
              searchQuery.trim().length === 0 ? (
                <Text style={[s.searchEmptyText, isDark && { color: '#6B7280' }]}>Search for a climber by name.</Text>
              ) : friendResults.length === 0 ? (
                <Text style={[s.searchEmptyText, isDark && { color: '#6B7280' }]}>No climbers found.</Text>
              ) : (
                friendResults.map((p) => (
                  <TouchableOpacity key={p.user_id} style={[s.searchResultRow, isDark && { backgroundColor: '#1F2937' }]} onPress={() => setViewingProfileId(p.user_id)} activeOpacity={0.7}>
                    <View style={[s.searchAvatarStub, isDark && { backgroundColor: '#374151' }]}>
                      <Ionicons name="person" size={18} color={isDark ? '#9CA3AF' : '#6B7280'} />
                    </View>
                    <Text style={[s.searchResultName, isDark && { color: '#F9FAFB' }]}>{p.display_name}</Text>
                  </TouchableOpacity>
                ))
              )
            ) : (
              [...officialClubs, ...userClubs].filter((c) => matchesSearch(c.name)).length === 0 ? (
                <Text style={[s.searchEmptyText, isDark && { color: '#6B7280' }]}>No clubs found.</Text>
              ) : (
                <>
                  {officialClubs.filter((c) => matchesSearch(c.name)).map((club) => (
                    <TouchableOpacity key={club.club_id} style={[s.searchResultRow, isDark && { backgroundColor: '#1F2937' }]} onPress={() => { setSearchVisible(false); setSelectedClub(club); }} activeOpacity={0.7}>
                      <View style={[s.searchAvatarStub, { backgroundColor: CLUB_COLOR[club.category] + '1F' }]}>
                        <ClubIcon category={club.category} color={CLUB_COLOR[club.category]} size={18} />
                      </View>
                      <Text style={[s.searchResultName, isDark && { color: '#F9FAFB' }]}>{club.name}</Text>
                    </TouchableOpacity>
                  ))}
                  {userClubs.filter((c) => matchesSearch(c.name)).map((club) => (
                    <TouchableOpacity key={club.club_id} style={[s.searchResultRow, isDark && { backgroundColor: '#1F2937' }]} onPress={() => club.url && Linking.openURL(club.url)} activeOpacity={0.7}>
                      <View style={[s.searchAvatarStub, isDark && { backgroundColor: '#374151' }]}>
                        <Ionicons name="people" size={18} color={isDark ? '#9CA3AF' : '#6B7280'} />
                      </View>
                      <Text style={[s.searchResultName, isDark && { color: '#F9FAFB' }]}>{club.name}</Text>
                    </TouchableOpacity>
                  ))}
                </>
              )
            )}
          </ScrollView>
        </View>
      </Modal>

      <AuthPrompt
        visible={authPromptVisible}
        reason="create or join challenges, clubs, and events"
        onClose={() => setAuthPromptVisible(false)}
      />

      <ChallengeDetailModal
        challenge={selectedChallenge}
        visible={!!selectedChallenge}
        onClose={() => setSelectedChallenge(null)}
        joined={!!selectedChallenge && myChallengeIds.has(selectedChallenge.challenge_id)}
        progressFloors={selectedChallenge ? progressFor(selectedChallenge) : 0}
        onJoin={() => selectedChallenge && handleJoin(selectedChallenge.challenge_id)}
        isDark={isDark}
        displayTitleOverride={selectedChallenge ? displayTitle(selectedChallenge) : undefined}
        displayDescriptionOverride={selectedChallenge ? displayDescription(selectedChallenge) : undefined}
      />

      <ClubDetailModal club={selectedClub} visible={!!selectedClub} onClose={() => setSelectedClub(null)} isDark={isDark} />
      <PublicProfileModal userId={viewingProfileId} visible={!!viewingProfileId} onClose={() => setViewingProfileId(null)} />
      <EventDetailModal
        event={selectedEvent}
        visible={!!selectedEvent}
        onClose={() => setSelectedEvent(null)}
        isDark={isDark}
        onReport={selectedEvent?.eventId ? () => { handleReportEvent(selectedEvent.eventId!); setSelectedEvent(null); } : undefined}
      />

      <CreateClubModal
        visible={createClubVisible}
        onClose={() => setCreateClubVisible(false)}
        isDark={isDark}
        onCreated={(club) => { setUserClubs((prev) => [club, ...prev]); }}
        userId={user?.id}
      />
      <CreateEventModal
        visible={createEventVisible}
        onClose={() => setCreateEventVisible(false)}
        isDark={isDark}
        onCreated={(ev) => { setUserEvents((prev) => [ev, ...prev]); }}
        userId={user?.id}
      />
      <CreateChallengeModal
        visible={createChallengeVisible}
        onClose={() => setCreateChallengeVisible(false)}
        isDark={isDark}
        defaultVisibility={challengeVisibilityDefault}
        onCreated={(ch) => { setWeeklyChallenges((prev) => ch.period === 'weekly' ? [ch, ...prev] : prev); setMonthlyChallenges((prev) => ch.period === 'monthly' ? [ch, ...prev] : prev); }}
        userId={user?.id}
      />
    </View>
  );
}

// --- Event detail — shown in-app before ever leaving the app, instead of
// jumping straight to Linking.openURL on tap ---
function EventDetailModal({ event, visible, onClose, isDark, onReport }: {
  event: NormalizedEvent | null; visible: boolean; onClose: () => void; isDark: boolean; onReport?: () => void;
}) {
  if (!event) return null;
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={[ed.container, isDark && { backgroundColor: '#111827' }]}>
        <ScrollView showsVerticalScrollIndicator={false}>
          <SceneryBanner variant={event.scope === 'Worldwide' ? 'skyline' : 'sunrise'} height={220} borderRadius={0} photoUri={event.photoUri}>
            <TouchableOpacity style={ed.closeBtn} onPress={onClose}>
              <Ionicons name="close" size={24} color="#FFFFFF" />
            </TouchableOpacity>
            {event.date && (
              <View style={ed.dateBadge}>
                <Text style={ed.dateBadgeText}>{formatShortDate(event.date)}</Text>
              </View>
            )}
          </SceneryBanner>

          <View style={ed.body}>
            <Text style={[ed.title, isDark && { color: '#F9FAFB' }]}>{event.name}</Text>
            <View style={ed.locationRow}>
              <Ionicons name="location-outline" size={14} color="#9CA3AF" />
              <Text style={ed.locationText}>{event.location}</Text>
            </View>

            <View style={ed.tagRow}>
              {event.distance && (
                <View style={[ed.tag, isDark && { backgroundColor: '#1F2937' }]}>
                  <Text style={[ed.tagText, isDark && { color: '#D1D5DB' }]}>{event.distance}</Text>
                </View>
              )}
              {event.eventType && (
                <View style={[ed.tag, isDark && { backgroundColor: '#1F2937' }]}>
                  <Text style={[ed.tagText, isDark && { color: '#D1D5DB' }]}>{event.eventType}</Text>
                </View>
              )}
              <View style={[ed.tag, isDark && { backgroundColor: '#1F2937' }]}>
                <Text style={[ed.tagText, isDark && { color: '#D1D5DB' }]}>{event.scope}</Text>
              </View>
            </View>

            <Text style={[ed.sectionLabel, isDark && { color: '#9CA3AF' }]}>About</Text>
            <Text style={[ed.blurb, isDark && { color: '#D1D5DB' }]}>{event.blurb}</Text>

            {event.isUser && (
              <Text style={ed.creatorText}>Added by {event.creatorName}</Text>
            )}

            {event.url && (
              <TouchableOpacity style={ed.openBtn} onPress={() => Linking.openURL(event.url!)}>
                <Ionicons name="open-outline" size={16} color="#FFFFFF" />
                <Text style={ed.openBtnText}>Open Official Page</Text>
              </TouchableOpacity>
            )}

            {onReport && (
              <TouchableOpacity style={ed.reportBtn} onPress={onReport}>
                <Text style={ed.reportBtnText}>Report this event</Text>
              </TouchableOpacity>
            )}
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

const ed = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F9FAFB' },
  closeBtn: { position: 'absolute', top: 52, right: 16, padding: 6 },
  dateBadge: { position: 'absolute', bottom: 16, right: 16, backgroundColor: 'rgba(255,255,255,0.92)', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 },
  dateBadgeText: { fontSize: 13, fontWeight: '800', color: '#111827' },
  body: { padding: 20, paddingBottom: 48 },
  title: { fontSize: 21, fontWeight: '800', color: '#111827', marginBottom: 8 },
  locationRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 14 },
  locationText: { fontSize: 13.5, color: '#6B7280', fontWeight: '500' },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 22 },
  tag: { backgroundColor: '#F3F4F6', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 },
  tagText: { fontSize: 11, fontWeight: '700', color: '#374151' },
  sectionLabel: { fontSize: 12, fontWeight: '700', color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 },
  blurb: { fontSize: 14.5, color: '#374151', lineHeight: 21, marginBottom: 20 },
  creatorText: { fontSize: 12, color: '#9CA3AF', fontStyle: 'italic', marginBottom: 20 },
  openBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: PRIMARY_BLUE, borderRadius: 12, paddingVertical: 15, marginBottom: 12 },
  openBtnText: { color: '#FFFFFF', fontWeight: '700', fontSize: 14.5 },
  reportBtn: { alignItems: 'center', paddingVertical: 10 },
  reportBtnText: { fontSize: 12.5, color: '#9CA3AF', fontWeight: '600' },
});

// --- Creation modals ---

function CreateClubModal({ visible, onClose, isDark, onCreated, userId }: {
  visible: boolean; onClose: () => void; isDark: boolean; onCreated: (c: UserClub) => void; userId?: string;
}) {
  const [name, setName] = useState('');
  const [category, setCategory] = useState<'Trail Running' | 'Hiking' | 'Climbing' | 'Other'>('Trail Running');
  const [description, setDescription] = useState('');
  const [url, setUrl] = useState('');
  const [saving, setSaving] = useState(false);

  const reset = () => { setName(''); setDescription(''); setUrl(''); setCategory('Trail Running'); };

  const handleCreate = async () => {
    if (!userId || !name.trim() || !description.trim()) return;
    setSaving(true);
    const { data, error } = await supabase.from('user_clubs').insert({
      creator_id: userId, name: name.trim(), category, description: description.trim(), url: url.trim() || null,
    }).select().single();
    setSaving(false);
    if (error) { Alert.alert('Error', error.message); return; }
    onCreated(data as UserClub);
    reset();
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView style={fm.overlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={onClose} />
        <ScrollView style={[fm.sheet, isDark && { backgroundColor: '#1F2937' }]} keyboardShouldPersistTaps="handled">
          <Text style={[fm.title, isDark && { color: '#F9FAFB' }]}>Add a Club</Text>
          <TextInput style={[fm.input, isDark && fm.inputDark]} placeholder="Club name" placeholderTextColor="#9CA3AF" value={name} onChangeText={setName} maxLength={60} />
          <View style={fm.pillRow}>
            {(['Trail Running', 'Hiking', 'Climbing', 'Other'] as const).map((cat) => (
              <TouchableOpacity key={cat} style={[fm.pill, category === cat && fm.pillActive]} onPress={() => setCategory(cat)}>
                <Text style={[fm.pillText, category === cat && fm.pillTextActive]}>{cat}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <TextInput style={[fm.input, fm.textArea, isDark && fm.inputDark]} placeholder="Description" placeholderTextColor="#9CA3AF" value={description} onChangeText={setDescription} multiline maxLength={200} />
          <TextInput style={[fm.input, isDark && fm.inputDark]} placeholder="Link (Facebook, Instagram, WhatsApp, etc., optional)" placeholderTextColor="#9CA3AF" value={url} onChangeText={setUrl} autoCapitalize="none" />
          <TouchableOpacity style={[fm.submitBtn, (!name.trim() || !description.trim() || saving) && { opacity: 0.5 }]} onPress={handleCreate} disabled={!name.trim() || !description.trim() || saving}>
            <Text style={fm.submitBtnText}>{saving ? 'Adding...' : 'Add Club'}</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function CreateEventModal({ visible, onClose, isDark, onCreated, userId }: {
  visible: boolean; onClose: () => void; isDark: boolean; onCreated: (e: UserEvent) => void; userId?: string;
}) {
  const [name, setName] = useState('');
  const [location, setLocation] = useState('');
  const [blurb, setBlurb] = useState('');
  const [scope, setScope] = useState<'Local' | 'Worldwide'>('Local');
  const [eventDate, setEventDate] = useState('');
  const [url, setUrl] = useState('');
  const [saving, setSaving] = useState(false);

  const reset = () => { setName(''); setLocation(''); setBlurb(''); setUrl(''); setScope('Local'); setEventDate(''); };

  const handleCreate = async () => {
    if (!userId || !name.trim() || !location.trim() || !blurb.trim()) return;
    // Loose YYYY-MM-DD check — good enough to catch obvious typos without a
    // full date-picker dependency; a malformed date is just treated as none.
    const validDate = /^\d{4}-\d{2}-\d{2}$/.test(eventDate.trim()) && !isNaN(new Date(eventDate.trim()).getTime());
    setSaving(true);
    const { data, error } = await supabase.from('user_events').insert({
      creator_id: userId, name: name.trim(), location: location.trim(), blurb: blurb.trim(), scope,
      event_date: validDate ? eventDate.trim() : null, url: url.trim() || null,
    }).select().single();
    setSaving(false);
    if (error) { Alert.alert('Error', error.message); return; }
    onCreated(data as UserEvent);
    reset();
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView style={fm.overlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={onClose} />
        <ScrollView style={[fm.sheet, isDark && { backgroundColor: '#1F2937' }]} keyboardShouldPersistTaps="handled">
          <Text style={[fm.title, isDark && { color: '#F9FAFB' }]}>Add an Event</Text>
          <Text style={fm.hint}>Use a real, findable location — vague or joke locations get reported and hidden.</Text>
          <TextInput style={[fm.input, isDark && fm.inputDark]} placeholder="Event name" placeholderTextColor="#9CA3AF" value={name} onChangeText={setName} maxLength={60} />
          <TextInput style={[fm.input, isDark && fm.inputDark]} placeholder="Location (address or landmark)" placeholderTextColor="#9CA3AF" value={location} onChangeText={setLocation} maxLength={80} />
          <View style={fm.pillRow}>
            {(['Local', 'Worldwide'] as const).map((sc) => (
              <TouchableOpacity key={sc} style={[fm.pill, scope === sc && fm.pillActive]} onPress={() => setScope(sc)}>
                <Text style={[fm.pillText, scope === sc && fm.pillTextActive]}>{sc}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <TextInput style={[fm.input, fm.textArea, isDark && fm.inputDark]} placeholder="Description" placeholderTextColor="#9CA3AF" value={blurb} onChangeText={setBlurb} multiline maxLength={200} />
          <TextInput style={[fm.input, isDark && fm.inputDark]} placeholder="Date (YYYY-MM-DD, optional)" placeholderTextColor="#9CA3AF" value={eventDate} onChangeText={setEventDate} keyboardType="numbers-and-punctuation" />
          <TextInput style={[fm.input, isDark && fm.inputDark]} placeholder="Link (optional)" placeholderTextColor="#9CA3AF" value={url} onChangeText={setUrl} autoCapitalize="none" />
          <TouchableOpacity style={[fm.submitBtn, (!name.trim() || !location.trim() || !blurb.trim() || saving) && { opacity: 0.5 }]} onPress={handleCreate} disabled={!name.trim() || !location.trim() || !blurb.trim() || saving}>
            <Text style={fm.submitBtnText}>{saving ? 'Adding...' : 'Add Event'}</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function CreateChallengeModal({ visible, onClose, isDark, onCreated, userId, defaultVisibility }: {
  visible: boolean; onClose: () => void; isDark: boolean; onCreated: (c: Challenge) => void; userId?: string; defaultVisibility: 'public' | 'peers';
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [period, setPeriod] = useState<'weekly' | 'monthly'>('weekly');
  const [targetFloors, setTargetFloors] = useState('100');
  const [visibility, setVisibility] = useState<'public' | 'peers'>(defaultVisibility);
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (visible) setVisibility(defaultVisibility); }, [visible, defaultVisibility]);

  const reset = () => { setTitle(''); setDescription(''); setPeriod('weekly'); setTargetFloors('100'); };

  const handleCreate = async () => {
    const target = parseInt(targetFloors, 10);
    if (!userId || !title.trim() || !description.trim() || !target || target <= 0) return;
    setSaving(true);
    // No badge_key — custom challenges don't grant a real badge (there's no
    // matching BADGE_DEFS entry to award), just the target/progress tracking.
    // difficulty is kept internally (not-null column, not shown anywhere) —
    // just a fixed default since the app no longer ranks challenges by it.
    const { data, error } = await supabase.from('challenges').insert({
      title: title.trim(), description: description.trim(), difficulty: 'medium', period,
      target_floors: target, reward_icon: 'trophy-outline', reward_label: 'Custom Challenge',
      organizer: 'A fellow climber', creator_id: userId, is_active: true, visibility,
    }).select().single();
    setSaving(false);
    if (error) { Alert.alert('Error', error.message); return; }
    onCreated(data as Challenge);
    reset();
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView style={fm.overlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={onClose} />
        <ScrollView style={[fm.sheet, isDark && { backgroundColor: '#1F2937' }]} keyboardShouldPersistTaps="handled">
          <Text style={[fm.title, isDark && { color: '#F9FAFB' }]}>{visibility === 'peers' ? 'Challenge Your Crew' : 'Create a Challenge'}</Text>
          <View style={fm.pillRow}>
            {(['public', 'peers'] as const).map((v) => (
              <TouchableOpacity key={v} style={[fm.pill, visibility === v && fm.pillActive]} onPress={() => setVisibility(v)}>
                <Text style={[fm.pillText, visibility === v && fm.pillTextActive]}>{v === 'public' ? 'Public (Community)' : 'Peers Only'}</Text>
              </TouchableOpacity>
            ))}
          </View>
          {visibility === 'peers' && (
            <Text style={fm.hint}>Only you and people you follow (or who follow you) will see this challenge.</Text>
          )}
          <TextInput style={[fm.input, isDark && fm.inputDark]} placeholder="Challenge title" placeholderTextColor="#9CA3AF" value={title} onChangeText={setTitle} maxLength={60} />
          <TextInput style={[fm.input, fm.textArea, isDark && fm.inputDark]} placeholder="What does it take to complete this?" placeholderTextColor="#9CA3AF" value={description} onChangeText={setDescription} multiline maxLength={200} />
          <View style={fm.pillRow}>
            {(['weekly', 'monthly'] as const).map((p) => (
              <TouchableOpacity key={p} style={[fm.pill, period === p && fm.pillActive]} onPress={() => setPeriod(p)}>
                <Text style={[fm.pillText, period === p && fm.pillTextActive]}>{p.toUpperCase()}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <TextInput style={[fm.input, isDark && fm.inputDark]} placeholder="Target floors (e.g. 300)" placeholderTextColor="#9CA3AF" value={targetFloors} onChangeText={setTargetFloors} keyboardType="number-pad" />
          <Text style={fm.hint}>Custom challenges track progress but don't award a profile badge — that's reserved for official challenges.</Text>
          <TouchableOpacity style={[fm.submitBtn, (!title.trim() || !description.trim() || saving) && { opacity: 0.5 }]} onPress={handleCreate} disabled={!title.trim() || !description.trim() || saving}>
            <Text style={fm.submitBtnText}>{saving ? 'Creating...' : 'Create Challenge'}</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const fm = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: { maxHeight: '85%', backgroundColor: '#FFFFFF', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 32 },
  title: { fontSize: 18, fontWeight: '800', color: '#111827', marginBottom: 14 },
  input: { backgroundColor: '#F3F4F6', borderRadius: 12, padding: 14, fontSize: 14, color: '#111827', marginBottom: 10 },
  inputDark: { backgroundColor: '#111827', color: '#F9FAFB' },
  textArea: { minHeight: 70, textAlignVertical: 'top' },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 },
  pill: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10, backgroundColor: '#F3F4F6' },
  pillActive: { backgroundColor: PRIMARY_BLUE },
  pillText: { fontSize: 12, fontWeight: '700', color: '#6B7280' },
  pillTextActive: { color: '#FFFFFF' },
  hint: { fontSize: 11.5, color: '#9CA3AF', lineHeight: 16, marginBottom: 14 },
  submitBtn: { backgroundColor: PRIMARY_BLUE, borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginBottom: 20 },
  submitBtnText: { color: '#FFFFFF', fontWeight: '700', fontSize: 14.5 },
});

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F9FAFB' },
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
  headerTitle: { fontSize: 28, fontWeight: '800', color: '#111827', letterSpacing: -0.5 },
  headerSearchBtn: { padding: 4 },

  tabBar: {
    flexDirection: 'row',
    backgroundColor: '#F3F4F6',
    borderRadius: 12,
    padding: 3,
    marginHorizontal: 16,
    marginTop: 10,
    marginBottom: 10,
  },
  tabBtn: { flex: 1, paddingVertical: 9, alignItems: 'center', borderRadius: 9 },
  tabBtnActive: { backgroundColor: '#FFFFFF', elevation: 1 },
  tabBtnText: { fontSize: 13, fontWeight: '700', color: '#9CA3AF' },
  tabBtnTextActive: { color: '#111827' },

  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginHorizontal: 16,
    marginTop: 4,
  },
  searchInput: { flex: 1, fontSize: 14, color: '#111827' },
  searchModalContainer: { flex: 1, backgroundColor: '#F9FAFB' },
  searchModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 56,
    paddingBottom: 14,
    paddingHorizontal: 16,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E7EB',
  },
  searchModalTitle: { fontSize: 17, fontWeight: '800', color: '#111827' },
  searchSubNav: {
    flexDirection: 'row',
    backgroundColor: '#F3F4F6',
    borderRadius: 12,
    padding: 3,
    marginHorizontal: 16,
    marginTop: 14,
  },
  searchSubNavBtn: { flex: 1, paddingVertical: 9, alignItems: 'center', borderRadius: 9 },
  searchEmptyText: { fontSize: 13, color: '#9CA3AF', textAlign: 'center', marginTop: 30 },
  searchResultRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#FFFFFF', borderRadius: 12, padding: 12, marginBottom: 8 },
  searchAvatarStub: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#F3F4F6', alignItems: 'center', justifyContent: 'center' },
  searchResultName: { fontSize: 14, fontWeight: '600', color: '#111827' },

  scrollContent: { padding: 16, paddingBottom: 110 },

  createRow: { alignItems: 'flex-end', marginBottom: 12 },
  createBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  createBtnText: { fontSize: 13, fontWeight: '700', color: PRIMARY_BLUE },

  groupSection: { marginBottom: 20 },
  sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  groupSectionTitle: { fontSize: 15, fontWeight: '700', color: '#111827', marginBottom: 10 },
  viewAllText: { fontSize: 12.5, fontWeight: '700', color: PRIMARY_BLUE },
  hScrollContent: { gap: 12, paddingRight: 4 },

  linkCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
  },
  linkCardTitle: { fontSize: 14, fontWeight: '700', color: '#111827' },
  linkCardDesc: { fontSize: 12.5, color: '#6B7280', marginTop: 3, lineHeight: 17 },
  linkCardCreator: { fontSize: 11, color: '#9CA3AF', marginTop: 4, fontStyle: 'italic' },
  eventsFootnote: { fontSize: 11.5, color: '#9CA3AF', textAlign: 'center', marginTop: 4, lineHeight: 16 },

  communityPill: { alignSelf: 'center', backgroundColor: '#EFF6FF', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, marginTop: 8, marginBottom: 2 },
  communityPillText: { fontSize: 10, fontWeight: '800', color: PRIMARY_BLUE },
  bigBadgeCheck: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
  },
  challengeTrack: { height: 8, borderRadius: 4, backgroundColor: 'rgba(0,0,0,0.08)', overflow: 'hidden' },
  challengeFill: { height: '100%', borderRadius: 4 },
  challengeProgressText: { fontSize: 11, fontWeight: '600', color: '#6B7280', marginTop: 5 },
  joinBtnText: { color: '#FFFFFF', fontWeight: '700', fontSize: 13.5 },

  // 2-column challenge/club grid
  gridWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 20 },
  gridCard: {
    width: '48%',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 14,
    alignItems: 'stretch',
    marginBottom: 4,
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
  },
  gridTitle: { fontSize: 13, fontWeight: '700', color: '#111827', textAlign: 'center', marginTop: 4 },
  gridDesc: { fontSize: 11, color: '#6B7280', textAlign: 'center', marginTop: 4, lineHeight: 15, minHeight: 30 },
  gridDateText: { fontSize: 10.5, color: '#9CA3AF', fontWeight: '600', marginTop: 4, marginBottom: 4, textAlign: 'center' },
  gridJoinBtn: { backgroundColor: PRIMARY_BLUE, borderRadius: 10, paddingVertical: 10, alignItems: 'center', marginTop: 8, width: '100%' },
  clubIconCircle: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', alignSelf: 'center', marginBottom: 4 },

  // Full-width featured/special challenge card — image on top, details below
  // Full-bleed — negative margin cancels scrollContent's 16px padding so
  // this spans the true device width, not just the content column.
  featCard: { marginHorizontal: -16, borderRadius: 0, overflow: 'hidden', marginBottom: 16, backgroundColor: '#FFFFFF', elevation: 2, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 8 },
  featEyebrowWrap: { position: 'absolute', top: 14, left: 16 },
  featEyebrow: { fontSize: 11, fontWeight: '800', color: '#FFFFFF', letterSpacing: 0.6, textShadowColor: 'rgba(0,0,0,0.4)', textShadowRadius: 4 },
  featMedalWrap: { position: 'absolute', bottom: -30, left: 16 },
  featBody: { padding: 20, paddingTop: 38 },
  featTitle: { fontSize: 19, fontWeight: '800', color: '#111827', marginBottom: 6 },
  featDesc: { fontSize: 13.5, color: '#6B7280', lineHeight: 19, marginBottom: 14 },
  featPillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  featPill: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#F3F4F6', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 },
  featPillText: { fontSize: 10.5, fontWeight: '800', color: '#6B7280', letterSpacing: 0.3 },
  featJoinBtn: { backgroundColor: PRIMARY_BLUE, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },

  // Peer/club challenge CTA — a plain card like everything else, not a
  // differently-colored banner; only the icon carries an accent color.
  peerCta: { marginHorizontal: -16, borderRadius: 0, flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#FFFFFF', padding: 20, marginBottom: 20, elevation: 1, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 6 },
  peerCtaIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#EFF6FF', alignItems: 'center', justifyContent: 'center' },
  peerCtaTitle: { fontSize: 15, fontWeight: '800', color: '#111827' },
  peerCtaSubtitle: { fontSize: 12, color: '#6B7280', marginTop: 2, lineHeight: 16 },


  // Clubs/Events CTA banner overlay text
  ctaBannerOverlay: { position: 'absolute', left: 18, right: 18, bottom: 16 },
  ctaBannerTitle: { fontSize: 20, fontWeight: '800', color: '#FFFFFF', textShadowColor: 'rgba(0,0,0,0.35)', textShadowRadius: 6 },
  ctaBannerSubtitle: { fontSize: 12.5, color: 'rgba(255,255,255,0.9)', marginTop: 4, fontWeight: '500' },
  announceHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  announceAppIcon: { width: 22, height: 22, borderRadius: 6 },
  announceBadgeRow: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(0,0,0,0.25)', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  announceBadgeText: { fontSize: 10, fontWeight: '800', color: '#FFFFFF', letterSpacing: 0.5 },
  announceJoinBtn: { position: 'absolute', right: 16, bottom: 16, backgroundColor: '#FFFFFF', borderRadius: 10, paddingHorizontal: 16, paddingVertical: 9 },
  announceJoinBtnText: { color: PRIMARY_BLUE, fontWeight: '800', fontSize: 13 },

  // Event cover cards
  eventCard: { borderRadius: 18, overflow: 'hidden', marginBottom: 14, backgroundColor: '#FFFFFF', elevation: 1, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.08, shadowRadius: 6 },
  eventDateBadge: { position: 'absolute', top: 12, right: 12, backgroundColor: 'rgba(255,255,255,0.92)', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 },
  eventDateBadgeText: { fontSize: 11.5, fontWeight: '800', color: '#111827' },
  eventBody: { flexDirection: 'row', padding: 14, gap: 8 },
  eventTitle: { fontSize: 15, fontWeight: '800', color: '#111827' },
  eventLocationRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3 },
  eventLocationText: { fontSize: 12, color: '#6B7280', fontWeight: '500' },
  eventBlurb: { fontSize: 12.5, color: '#6B7280', marginTop: 6, lineHeight: 17 },
  eventTagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  eventTag: { backgroundColor: '#F3F4F6', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  eventTagText: { fontSize: 10.5, fontWeight: '700', color: '#374151' },
});
