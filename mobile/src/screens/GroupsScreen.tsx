import { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Linking, Modal, TextInput, Alert } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../config/supabase';
import AuthPrompt from '../components/AuthPrompt';
import ChallengeDetailModal, { challengeColor } from '../components/ChallengeDetailModal';
import type { Challenge, UserClub, UserEvent, Profile } from '../types';

const CLUB_CATEGORIES = ['All', 'Trail Running', 'Hiking', 'Climbing'] as const;

function formatDateRange(startIso: string, endIso: string): string {
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  return `${new Date(startIso).toLocaleDateString(undefined, opts)} – ${new Date(endIso).toLocaleDateString(undefined, opts)}`;
}

interface Club {
  name: string;
  category: 'Trail Running' | 'Hiking' | 'Climbing';
  description: string;
  url: string;
}

// Curated, real Singapore communities — not scraped live (no live scraper in
// this app), but researched and verified as active groups at time of writing.
const CLUBS: Club[] = [
  { name: 'Trail Runners Singapore', category: 'Trail Running', description: 'Facebook community for SG trail runners — routes, meetups, race chatter.', url: 'https://www.facebook.com/groups/TrailRunnersSingapore/' },
  { name: 'Adidas Runners Singapore', category: 'Trail Running', description: 'Long-running crew, part of a global 50-city running movement.', url: 'https://www.runmagazine.asia/adidas-runners-singapore/' },
  { name: 'SG Hiking and Travel Group', category: 'Hiking', description: 'Weekend and weekday nature walks/hikes around Singapore, running 40+ years.', url: 'https://www.facebook.com/groups/sghikingandtravel/' },
  { name: 'Exploring Singapore Hiking Group', category: 'Hiking', description: 'Urban parks, nature reserves, and island trails — for newcomers and regulars.', url: 'https://www.facebook.com/groups/957889039371788/' },
  { name: 'Singapore Sport Climbing and Mountaineering Federation', category: 'Climbing', description: 'The national association for sport climbing and mountaineering in Singapore.', url: 'https://www.facebook.com/singaporesportclimbingandmountaineeringfederation/' },
  { name: 'Rock Climbing Singapore', category: 'Climbing', description: 'General climbing community group — gyms, outdoor trips, partner-finding.', url: 'https://www.facebook.com/groups/369770945505/' },
  { name: 'Climb Central Singapore', category: 'Climbing', description: 'Five gyms islandwide — high-wall climbing with a growing bouldering scene.', url: 'https://www.climbcentral.sg/' },
  { name: 'Boulder Planet', category: 'Climbing', description: 'Bouldering gym and community, welcoming to newcomers.', url: 'https://www.boulderplanet.sg/' },
];

interface EventItem {
  name: string;
  location: string;
  blurb: string;
  scope: 'Local' | 'Worldwide';
  url: string;
}

// Real recurring races — dates shift year to year, so check the organizer
// link for the current schedule rather than trusting a hardcoded date here.
const EVENTS: EventItem[] = [
  { name: 'National Vertical Marathon', location: 'Guoco Tower, Singapore', blurb: 'Race up Singapore\'s tallest tower. Organized annually by NTU Sports Club.', scope: 'Local', url: 'https://towerrunning.sg/' },
  { name: 'Vertical Challenge', location: 'Frasers Tower, Singapore', blurb: '1,256 steps to the top — Singapore Championship edition.', scope: 'Local', url: 'https://www.fraserstower.com.sg/content/frasers-tower/home/happening/verticalchallenge2025.html' },
  { name: 'Towerrunning Tour', location: 'Worldwide circuit', blurb: 'The season-long international towerrunning series — races in dozens of cities.', scope: 'Worldwide', url: 'https://www.towerrunning.com/towerrunning-tour-2026/' },
  { name: 'KL Tower Run International Challenge', location: 'Kuala Lumpur, Malaysia', blurb: '1,608 steps, 292m of ascent inside Malaysia\'s iconic tower.', scope: 'Worldwide', url: 'https://www.jomrun.com/event/Kuala-Lumpur-Tower-Run-International-Challenge-2026' },
  { name: 'PingAn International Vertical Marathon', location: 'Shenzhen, China', blurb: '3,201 stairs, 541m of altitude gain to the observation deck.', scope: 'Worldwide', url: 'https://www.towerrunning.com/2025/11/27/announcement-towerrunning-200-internatiinal-vertical-marathon-pingan-shenzhen-january-10-2026/' },
];

type Tab = 'challenges' | 'clubs' | 'events';

/** Sporty hero banner, built from plain Views/Ionicons — no image asset. */
function CoverBanner({ icon, title, subtitle, color }: { icon: string; title: string; subtitle: string; color: string }) {
  return (
    <View style={[cb.wrap, { backgroundColor: color }]}>
      <View style={[cb.circle, cb.circleA]} />
      <View style={[cb.circle, cb.circleB]} />
      <View style={[cb.circle, cb.circleC]} />
      <Ionicons name={icon as any} size={30} color="rgba(255,255,255,0.95)" />
      <Text style={cb.title}>{title}</Text>
      <Text style={cb.subtitle}>{subtitle}</Text>
    </View>
  );
}

const cb = StyleSheet.create({
  wrap: {
    borderRadius: 18,
    padding: 20,
    marginBottom: 16,
    overflow: 'hidden',
    alignItems: 'flex-start',
  },
  circle: { position: 'absolute', borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.12)' },
  circleA: { width: 120, height: 120, top: -50, right: -30 },
  circleB: { width: 70, height: 70, bottom: -30, right: 40 },
  circleC: { width: 40, height: 40, bottom: 10, right: 120 },
  title: { fontSize: 19, fontWeight: '800', color: '#FFFFFF', marginTop: 10 },
  subtitle: { fontSize: 12.5, color: 'rgba(255,255,255,0.85)', marginTop: 3, fontWeight: '500' },
});

export default function GroupsScreen({ isDark = false }: { isDark?: boolean }) {
  const { user, isAnonymous } = useAuth();
  const [tab, setTab] = useState<Tab>('challenges');
  const [authPromptVisible, setAuthPromptVisible] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchVisible, setSearchVisible] = useState(false);
  const [clubCategory, setClubCategory] = useState<typeof CLUB_CATEGORIES[number]>('All');

  const [weeklyChallenges, setWeeklyChallenges] = useState<Challenge[]>([]);
  const [monthlyChallenges, setMonthlyChallenges] = useState<Challenge[]>([]);
  const [limitedTimeChallenges, setLimitedTimeChallenges] = useState<Challenge[]>([]);
  const [myChallengeIds, setMyChallengeIds] = useState<Set<string>>(new Set());
  const [weeklyFloors, setWeeklyFloors] = useState(0);
  const [monthlyFloors, setMonthlyFloors] = useState(0);
  const [limitedTimeProgress, setLimitedTimeProgress] = useState<Record<string, number>>({});
  const [selectedChallenge, setSelectedChallenge] = useState<Challenge | null>(null);

  const [userClubs, setUserClubs] = useState<UserClub[]>([]);
  const [userEvents, setUserEvents] = useState<UserEvent[]>([]);
  const [creatorNames, setCreatorNames] = useState<Record<string, string>>({});

  const [createClubVisible, setCreateClubVisible] = useState(false);
  const [createEventVisible, setCreateEventVisible] = useState(false);
  const [createChallengeVisible, setCreateChallengeVisible] = useState(false);

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
    const [{ data: clubs }, { data: events }] = await Promise.all([
      supabase.from('user_clubs').select('*').order('created_at', { ascending: false }),
      supabase.from('user_events').select('*').order('created_at', { ascending: false }),
    ]);
    if (clubs) setUserClubs(clubs as UserClub[]);
    if (events) setUserEvents(events as UserEvent[]);

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

  // Compact card — 2 fit per row. Used for everything except the single
  // biggest (by target_floors) challenge, which gets the full-width cover
  // treatment instead (renderHeroChallenge below), Strava-style.
  const renderChallengeCard = (ch: Challenge) => {
    const progressFloors = progressFor(ch);
    const joined = myChallengeIds.has(ch.challenge_id);
    const pct = Math.min(100, Math.round((progressFloors / ch.target_floors) * 100));
    const completed = joined && pct >= 100;
    const color = challengeColor(ch.challenge_id);
    const isLimitedTime = !!(ch.starts_at && ch.ends_at);
    return (
      <TouchableOpacity
        key={ch.challenge_id}
        style={[s.gridCard, isDark && { backgroundColor: '#1F2937' }]}
        onPress={() => setSelectedChallenge(ch)}
        activeOpacity={0.85}
      >
        <View style={[s.gridBadge, { backgroundColor: color + '1F' }]}>
          <Ionicons name={ch.reward_icon as any} size={26} color={color} />
          {completed && (
            <View style={s.bigBadgeCheck}>
              <Ionicons name="checkmark-circle" size={15} color="#10B981" />
            </View>
          )}
        </View>
        {ch.creator_id && (
          <View style={s.communityPill}>
            <Text style={s.communityPillText}>Community</Text>
          </View>
        )}
        <Text style={[s.gridTitle, isDark && { color: '#F9FAFB' }]} numberOfLines={2}>{ch.title}</Text>
        <Text style={s.gridDateText} numberOfLines={1}>
          {isLimitedTime ? formatDateRange(ch.starts_at!, ch.ends_at!) : (ch.period === 'monthly' ? 'Resets monthly' : 'Resets weekly')}
        </Text>

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
          <TouchableOpacity style={[s.gridJoinBtn, { backgroundColor: color }]} onPress={() => handleJoin(ch.challenge_id)}>
            <Text style={s.joinBtnText}>Join</Text>
          </TouchableOpacity>
        )}
      </TouchableOpacity>
    );
  };

  // Full-width cover for the single biggest challenge (by target_floors) —
  // the "craziest" one, without ranking it via a difficulty label.
  const renderHeroChallenge = (ch: Challenge) => {
    const progressFloors = progressFor(ch);
    const joined = myChallengeIds.has(ch.challenge_id);
    const pct = Math.min(100, Math.round((progressFloors / ch.target_floors) * 100));
    const completed = joined && pct >= 100;
    const color = challengeColor(ch.challenge_id);
    const isLimitedTime = !!(ch.starts_at && ch.ends_at);
    return (
      <TouchableOpacity style={[s.heroCard, { backgroundColor: color }]} onPress={() => setSelectedChallenge(ch)} activeOpacity={0.9}>
        <Text style={s.heroEyebrow}>FEATURED CHALLENGE</Text>
        <View style={s.heroTopRow}>
          <View style={s.heroBadge}>
            <Ionicons name={ch.reward_icon as any} size={38} color="#FFFFFF" />
            {completed && (
              <View style={s.bigBadgeCheck}>
                <Ionicons name="checkmark-circle" size={18} color="#10B981" />
              </View>
            )}
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.heroTitle}>{ch.title}</Text>
            <Text style={s.heroDateText}>
              {isLimitedTime ? formatDateRange(ch.starts_at!, ch.ends_at!) : `${ch.target_floors} floors, ${ch.period}`}
            </Text>
          </View>
        </View>
        <Text style={s.heroDesc} numberOfLines={2}>{ch.description}</Text>
        {joined ? (
          <View>
            <View style={s.heroTrack}>
              <View style={[s.heroFill, { width: `${pct}%` }]} />
            </View>
            <Text style={s.heroProgressText}>{completed ? 'Completed!' : `${progressFloors} / ${ch.target_floors} fl`}</Text>
          </View>
        ) : (
          <TouchableOpacity style={s.heroJoinBtn} onPress={() => handleJoin(ch.challenge_id)}>
            <Text style={[s.joinBtnText, { color }]}>Join Challenge</Text>
          </TouchableOpacity>
        )}
      </TouchableOpacity>
    );
  };

  const visibleClubs = CLUBS.filter((c) => (clubCategory === 'All' || c.category === clubCategory) && matchesSearch(c.name));
  const visibleUserClubs = userClubs.filter((c) => (clubCategory === 'All' || c.category === clubCategory) && matchesSearch(c.name));
  const visibleEvents = EVENTS.filter((e) => matchesSearch(e.name));
  const visibleUserEvents = userEvents.filter((e) => matchesSearch(e.name));

  // The single biggest challenge (by target_floors) gets the full-width
  // cover treatment; everything else fills a 2-column grid, ordered
  // limited-time first, then community-created, then the default set —
  // not by difficulty, just recency/specialness.
  const allChallenges = [...limitedTimeChallenges, ...monthlyChallenges, ...weeklyChallenges];
  const heroChallenge = allChallenges.reduce<Challenge | null>((max, c) => (!max || c.target_floors > max.target_floors ? c : max), null);
  const gridChallengePriority = (c: Challenge) => (c.starts_at && c.ends_at ? 0 : c.creator_id ? 1 : 2);
  const gridChallenges = allChallenges
    .filter((c) => c.challenge_id !== heroChallenge?.challenge_id)
    .sort((a, b) => gridChallengePriority(a) - gridChallengePriority(b));

  return (
    <View style={[s.container, isDark && { backgroundColor: '#111827' }]}>
      <View style={[s.header, isDark && { backgroundColor: '#111827', borderBottomColor: '#374151' }]}>
        <Text style={[s.headerTitle, isDark && { color: '#F9FAFB' }]}>Groups</Text>
        {tab !== 'challenges' && (
          <TouchableOpacity style={s.headerSearchBtn} onPress={() => setSearchVisible(true)} activeOpacity={0.7}>
            <Ionicons name="search-outline" size={22} color={isDark ? '#D1D5DB' : '#374151'} />
          </TouchableOpacity>
        )}
      </View>

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

      <ScrollView contentContainerStyle={s.scrollContent} showsVerticalScrollIndicator={false}>
        {tab === 'challenges' && (
          <>
            <View style={s.createRow}>
              <TouchableOpacity style={s.createBtn} onPress={() => requireAuth(() => setCreateChallengeVisible(true))}>
                <Ionicons name="add" size={16} color="#2563EB" />
                <Text style={s.createBtnText}>Create a Challenge</Text>
              </TouchableOpacity>
            </View>

            {heroChallenge && renderHeroChallenge(heroChallenge)}

            {gridChallenges.length > 0 && (
              <View style={s.gridWrap}>
                {gridChallenges.map((ch) => renderChallengeCard(ch))}
              </View>
            )}
          </>
        )}

        {tab === 'clubs' && (
          <>
            <CoverBanner icon="people" title="Find Your Crew" subtitle="Trail running, hiking, and climbing communities across Singapore" color="#10B981" />

            <View style={s.createRow}>
              <TouchableOpacity style={s.createBtn} onPress={() => requireAuth(() => setCreateClubVisible(true))}>
                <Ionicons name="add" size={16} color="#2563EB" />
                <Text style={s.createBtnText}>Add a Club</Text>
              </TouchableOpacity>
            </View>

            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.categoryRow}>
              {CLUB_CATEGORIES.map((cat) => (
                <TouchableOpacity
                  key={cat}
                  style={[s.categoryChip, clubCategory === cat && s.categoryChipActive, isDark && { backgroundColor: '#1F2937' }, clubCategory === cat && isDark && { backgroundColor: '#2563EB' }]}
                  onPress={() => setClubCategory(cat)}
                >
                  <Text style={[s.categoryChipText, clubCategory === cat && s.categoryChipTextActive, isDark && { color: clubCategory === cat ? '#FFFFFF' : '#D1D5DB' }]}>{cat}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

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

            <View style={s.groupSection}>
              <Text style={[s.groupSectionTitle, isDark && { color: '#F9FAFB' }]}>Curated</Text>
              {visibleClubs.map((club) => (
                <TouchableOpacity
                  key={club.name + club.url}
                  style={[s.linkCard, isDark && { backgroundColor: '#1F2937' }]}
                  onPress={() => Linking.openURL(club.url)}
                  activeOpacity={0.7}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={[s.linkCardTitle, isDark && { color: '#F9FAFB' }]}>{club.name}</Text>
                    <Text style={[s.linkCardDesc, isDark && { color: '#9CA3AF' }]}>{club.description}</Text>
                  </View>
                  <Ionicons name="open-outline" size={18} color="#9CA3AF" />
                </TouchableOpacity>
              ))}
            </View>
          </>
        )}

        {tab === 'events' && (
          <>
            <CoverBanner icon="trophy" title="Race & Ascend" subtitle="Vertical marathons and stair-climb events, local and worldwide" color="#F59E0B" />

            <View style={s.createRow}>
              <TouchableOpacity style={s.createBtn} onPress={() => requireAuth(() => setCreateEventVisible(true))}>
                <Ionicons name="add" size={16} color="#2563EB" />
                <Text style={s.createBtnText}>Add an Event</Text>
              </TouchableOpacity>
            </View>

            {visibleUserEvents.length > 0 && (
              <View style={s.groupSection}>
                <Text style={[s.groupSectionTitle, isDark && { color: '#F9FAFB' }]}>Community Submissions</Text>
                {visibleUserEvents.map((ev) => (
                  <TouchableOpacity
                    key={ev.event_id}
                    style={[s.linkCard, isDark && { backgroundColor: '#1F2937' }]}
                    onPress={() => ev.url && Linking.openURL(ev.url)}
                    activeOpacity={0.7}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[s.linkCardTitle, isDark && { color: '#F9FAFB' }]}>{ev.name}</Text>
                      <Text style={s.linkCardLocation}>{ev.location}{ev.event_date ? ` · ${new Date(ev.event_date).toLocaleDateString()}` : ''}</Text>
                      <Text style={[s.linkCardDesc, isDark && { color: '#9CA3AF' }]}>{ev.blurb}</Text>
                      <Text style={s.linkCardCreator}>Added by {creatorNames[ev.creator_id] ?? 'a climber'}</Text>
                    </View>
                    <TouchableOpacity onPress={() => handleReportEvent(ev.event_id)} hitSlop={8}>
                      <Ionicons name="ellipsis-horizontal" size={16} color="#9CA3AF" />
                    </TouchableOpacity>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {(['Local', 'Worldwide'] as const).map((scope) => (
              <View key={scope} style={s.groupSection}>
                <Text style={[s.groupSectionTitle, isDark && { color: '#F9FAFB' }]}>{scope === 'Local' ? 'Local (Singapore)' : 'Worldwide'}</Text>
                {visibleEvents.filter((e) => e.scope === scope).map((ev) => (
                  <TouchableOpacity
                    key={ev.name + ev.url}
                    style={[s.linkCard, isDark && { backgroundColor: '#1F2937' }]}
                    onPress={() => Linking.openURL(ev.url)}
                    activeOpacity={0.7}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[s.linkCardTitle, isDark && { color: '#F9FAFB' }]}>{ev.name}</Text>
                      <Text style={s.linkCardLocation}>{ev.location}</Text>
                      <Text style={[s.linkCardDesc, isDark && { color: '#9CA3AF' }]}>{ev.blurb}</Text>
                    </View>
                    <Ionicons name="open-outline" size={18} color="#9CA3AF" />
                  </TouchableOpacity>
                ))}
              </View>
            ))}
            <Text style={[s.eventsFootnote, isDark && { color: '#6B7280' }]}>
              Dates shift year to year — tap through to the organizer's page for the current schedule.
            </Text>
          </>
        )}
      </ScrollView>

      <Modal visible={searchVisible} animationType="slide" onRequestClose={() => setSearchVisible(false)}>
        <View style={[s.searchModalContainer, isDark && { backgroundColor: '#111827' }]}>
          <View style={[s.searchModalHeader, isDark && { borderBottomColor: '#374151' }]}>
            <View style={[s.searchBox, { flex: 1, marginHorizontal: 0, marginTop: 0 }, isDark && { backgroundColor: '#1F2937' }]}>
              <Ionicons name="search" size={16} color="#9CA3AF" />
              <TextInput
                style={[s.searchInput, isDark && { color: '#F9FAFB' }]}
                placeholder={`Search ${tab}...`}
                placeholderTextColor="#9CA3AF"
                value={searchQuery}
                onChangeText={setSearchQuery}
                autoFocus
              />
            </View>
            <TouchableOpacity onPress={() => { setSearchVisible(false); setSearchQuery(''); }} style={{ marginLeft: 12 }}>
              <Text style={s.searchCancelText}>Done</Text>
            </TouchableOpacity>
          </View>
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
        onCreated={(ch) => { setWeeklyChallenges((prev) => ch.period === 'weekly' ? [ch, ...prev] : prev); setMonthlyChallenges((prev) => ch.period === 'monthly' ? [ch, ...prev] : prev); }}
        userId={user?.id}
      />
    </View>
  );
}

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
      <View style={fm.overlay}>
        <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={onClose} />
        <View style={[fm.sheet, isDark && { backgroundColor: '#1F2937' }]}>
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
        </View>
      </View>
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
  const [url, setUrl] = useState('');
  const [saving, setSaving] = useState(false);

  const reset = () => { setName(''); setLocation(''); setBlurb(''); setUrl(''); setScope('Local'); };

  const handleCreate = async () => {
    if (!userId || !name.trim() || !location.trim() || !blurb.trim()) return;
    setSaving(true);
    const { data, error } = await supabase.from('user_events').insert({
      creator_id: userId, name: name.trim(), location: location.trim(), blurb: blurb.trim(), scope, url: url.trim() || null,
    }).select().single();
    setSaving(false);
    if (error) { Alert.alert('Error', error.message); return; }
    onCreated(data as UserEvent);
    reset();
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={fm.overlay}>
        <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={onClose} />
        <View style={[fm.sheet, isDark && { backgroundColor: '#1F2937' }]}>
          <Text style={[fm.title, isDark && { color: '#F9FAFB' }]}>Add an Event</Text>
          <TextInput style={[fm.input, isDark && fm.inputDark]} placeholder="Event name" placeholderTextColor="#9CA3AF" value={name} onChangeText={setName} maxLength={60} />
          <TextInput style={[fm.input, isDark && fm.inputDark]} placeholder="Location" placeholderTextColor="#9CA3AF" value={location} onChangeText={setLocation} maxLength={80} />
          <View style={fm.pillRow}>
            {(['Local', 'Worldwide'] as const).map((sc) => (
              <TouchableOpacity key={sc} style={[fm.pill, scope === sc && fm.pillActive]} onPress={() => setScope(sc)}>
                <Text style={[fm.pillText, scope === sc && fm.pillTextActive]}>{sc}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <TextInput style={[fm.input, fm.textArea, isDark && fm.inputDark]} placeholder="Description" placeholderTextColor="#9CA3AF" value={blurb} onChangeText={setBlurb} multiline maxLength={200} />
          <TextInput style={[fm.input, isDark && fm.inputDark]} placeholder="Link (optional)" placeholderTextColor="#9CA3AF" value={url} onChangeText={setUrl} autoCapitalize="none" />
          <TouchableOpacity style={[fm.submitBtn, (!name.trim() || !location.trim() || !blurb.trim() || saving) && { opacity: 0.5 }]} onPress={handleCreate} disabled={!name.trim() || !location.trim() || !blurb.trim() || saving}>
            <Text style={fm.submitBtnText}>{saving ? 'Adding...' : 'Add Event'}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

function CreateChallengeModal({ visible, onClose, isDark, onCreated, userId }: {
  visible: boolean; onClose: () => void; isDark: boolean; onCreated: (c: Challenge) => void; userId?: string;
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [period, setPeriod] = useState<'weekly' | 'monthly'>('weekly');
  const [targetFloors, setTargetFloors] = useState('100');
  const [saving, setSaving] = useState(false);

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
      organizer: 'A fellow climber', creator_id: userId, is_active: true,
    }).select().single();
    setSaving(false);
    if (error) { Alert.alert('Error', error.message); return; }
    onCreated(data as Challenge);
    reset();
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={fm.overlay}>
        <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={onClose} />
        <View style={[fm.sheet, isDark && { backgroundColor: '#1F2937' }]}>
          <Text style={[fm.title, isDark && { color: '#F9FAFB' }]}>Create a Challenge</Text>
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
        </View>
      </View>
    </Modal>
  );
}

const fm = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#FFFFFF', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 32 },
  title: { fontSize: 18, fontWeight: '800', color: '#111827', marginBottom: 14 },
  input: { backgroundColor: '#F3F4F6', borderRadius: 12, padding: 14, fontSize: 14, color: '#111827', marginBottom: 10 },
  inputDark: { backgroundColor: '#111827', color: '#F9FAFB' },
  textArea: { minHeight: 70, textAlignVertical: 'top' },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 },
  pill: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10, backgroundColor: '#F3F4F6' },
  pillActive: { backgroundColor: '#2563EB' },
  pillText: { fontSize: 12, fontWeight: '700', color: '#6B7280' },
  pillTextActive: { color: '#FFFFFF' },
  hint: { fontSize: 11.5, color: '#9CA3AF', lineHeight: 16, marginBottom: 14 },
  submitBtn: { backgroundColor: '#2563EB', borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
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
    marginTop: 12,
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
    marginTop: 12,
  },
  searchInput: { flex: 1, fontSize: 14, color: '#111827' },
  searchModalContainer: { flex: 1, backgroundColor: '#F9FAFB' },
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
  searchCancelText: { fontSize: 14, fontWeight: '600', color: '#2563EB' },

  scrollContent: { padding: 16, paddingBottom: 110 },

  createRow: { alignItems: 'flex-end', marginBottom: 12 },
  createBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  createBtnText: { fontSize: 13, fontWeight: '700', color: '#2563EB' },

  categoryRow: { gap: 8, paddingBottom: 4, marginBottom: 12 },
  categoryChip: { backgroundColor: '#FFFFFF', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8 },
  categoryChipActive: { backgroundColor: '#2563EB' },
  categoryChipText: { fontSize: 12.5, fontWeight: '700', color: '#6B7280' },
  categoryChipTextActive: { color: '#FFFFFF' },

  groupSection: { marginBottom: 20 },
  groupSectionTitle: { fontSize: 15, fontWeight: '700', color: '#111827', marginBottom: 10 },

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
  linkCardLocation: { fontSize: 11.5, fontWeight: '600', color: '#2563EB', marginTop: 2 },
  linkCardDesc: { fontSize: 12.5, color: '#6B7280', marginTop: 3, lineHeight: 17 },
  linkCardCreator: { fontSize: 11, color: '#9CA3AF', marginTop: 4, fontStyle: 'italic' },
  eventsFootnote: { fontSize: 11.5, color: '#9CA3AF', textAlign: 'center', marginTop: 4, lineHeight: 16 },

  communityPill: { alignSelf: 'flex-start', backgroundColor: '#EFF6FF', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, marginBottom: 6 },
  communityPillText: { fontSize: 10, fontWeight: '800', color: '#2563EB' },
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

  // 2-column challenge grid
  gridWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  gridCard: {
    width: '48%',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 14,
    alignItems: 'center',
    marginBottom: 4,
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
  },
  gridBadge: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  gridTitle: { fontSize: 13, fontWeight: '700', color: '#111827', textAlign: 'center', minHeight: 34 },
  gridDateText: { fontSize: 10.5, color: '#9CA3AF', fontWeight: '600', marginTop: 3, marginBottom: 4 },
  gridJoinBtn: { borderRadius: 8, paddingVertical: 8, paddingHorizontal: 18, marginTop: 6 },

  // Full-width featured/hero challenge
  heroCard: { borderRadius: 20, padding: 20, marginBottom: 16 },
  heroEyebrow: { fontSize: 11, fontWeight: '800', color: 'rgba(255,255,255,0.85)', letterSpacing: 0.6, marginBottom: 12 },
  heroTopRow: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 12 },
  heroBadge: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroTitle: { fontSize: 19, fontWeight: '800', color: '#FFFFFF' },
  heroDateText: { fontSize: 12.5, color: 'rgba(255,255,255,0.85)', fontWeight: '600', marginTop: 3 },
  heroDesc: { fontSize: 13.5, color: 'rgba(255,255,255,0.9)', lineHeight: 19, marginBottom: 16 },
  heroTrack: { height: 10, borderRadius: 5, backgroundColor: 'rgba(255,255,255,0.25)', overflow: 'hidden' },
  heroFill: { height: '100%', borderRadius: 5, backgroundColor: '#FFFFFF' },
  heroProgressText: { fontSize: 12.5, fontWeight: '700', color: '#FFFFFF', marginTop: 8 },
  heroJoinBtn: { backgroundColor: '#FFFFFF', borderRadius: 12, paddingVertical: 13, alignItems: 'center' },
});
