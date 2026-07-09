import { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Linking } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../config/supabase';
import AuthPrompt from '../components/AuthPrompt';
import ChallengeDetailModal from '../components/ChallengeDetailModal';
import type { Challenge } from '../types';

const DIFFICULTY_COLOR: Record<string, string> = { easy: '#10B981', medium: '#F59E0B', hard: '#EF4444', insane: '#7C3AED' };

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
  { name: 'Trail Runners Singapore', category: 'Trail Running', description: 'Same crew, Strava club — join to see group activity and segments.', url: 'https://www.strava.com/clubs/575755' },
  { name: 'SG Hiking and Travel Group', category: 'Hiking', description: 'Weekend and weekday nature walks/hikes around Singapore, running 40+ years.', url: 'https://www.facebook.com/groups/sghikingandtravel/' },
  { name: 'Exploring Singapore Hiking Group', category: 'Hiking', description: 'Urban parks, nature reserves, and island trails — for newcomers and regulars.', url: 'https://www.facebook.com/groups/957889039371788/' },
  { name: 'Singapore Sport Climbing and Mountaineering Federation', category: 'Climbing', description: 'The national association for sport climbing and mountaineering in Singapore.', url: 'https://www.facebook.com/singaporesportclimbingandmountaineeringfederation/' },
  { name: 'Rock Climbing Singapore', category: 'Climbing', description: 'General climbing community group — gyms, outdoor trips, partner-finding.', url: 'https://www.facebook.com/groups/369770945505/' },
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

export default function GroupsScreen({ isDark = false }: { isDark?: boolean }) {
  const { user, isAnonymous } = useAuth();
  const [tab, setTab] = useState<Tab>('challenges');
  const [authPromptVisible, setAuthPromptVisible] = useState(false);

  const [weeklyChallenges, setWeeklyChallenges] = useState<Challenge[]>([]);
  const [monthlyChallenge, setMonthlyChallenge] = useState<Challenge | null>(null);
  const [myChallengeIds, setMyChallengeIds] = useState<Set<string>>(new Set());
  const [weeklyFloors, setWeeklyFloors] = useState(0);
  const [monthlyFloors, setMonthlyFloors] = useState(0);
  const [selectedChallenge, setSelectedChallenge] = useState<Challenge | null>(null);

  const loadChallenges = useCallback(async () => {
    const { data } = await supabase.from('challenges').select('*').eq('is_active', true);
    if (data) {
      const all = data as Challenge[];
      setWeeklyChallenges(all.filter((c) => c.period === 'weekly'));
      setMonthlyChallenge(all.find((c) => c.period === 'monthly') ?? null);
    }

    if (!user) return;
    const [{ data: joined }, { data: weeklyClimbs }, { data: monthlyClimbs }] = await Promise.all([
      supabase.from('challenge_participants').select('challenge_id').eq('user_id', user.id),
      supabase.from('climbs').select('floors_climbed').eq('user_id', user.id).gte('created_at', new Date(Date.now() - 7 * 86400000).toISOString()),
      supabase.from('climbs').select('floors_climbed').eq('user_id', user.id).gte('created_at', new Date(Date.now() - 30 * 86400000).toISOString()),
    ]);
    if (joined) setMyChallengeIds(new Set(joined.map((j: any) => j.challenge_id)));
    if (weeklyClimbs) setWeeklyFloors(weeklyClimbs.reduce((s, c: any) => s + c.floors_climbed, 0));
    if (monthlyClimbs) setMonthlyFloors(monthlyClimbs.reduce((s, c: any) => s + c.floors_climbed, 0));
  }, [user]);

  useEffect(() => { loadChallenges(); }, [loadChallenges]);

  const handleJoin = async (challengeId: string) => {
    if (isAnonymous) { setAuthPromptVisible(true); return; }
    if (!user) return;
    setMyChallengeIds((prev) => new Set(prev).add(challengeId));
    await supabase.from('challenge_participants').insert({ challenge_id: challengeId, user_id: user.id });
  };

  const renderChallengeCard = (ch: Challenge, progressFloors: number) => {
    const joined = myChallengeIds.has(ch.challenge_id);
    const pct = Math.min(100, Math.round((progressFloors / ch.target_floors) * 100));
    const completed = joined && pct >= 100;
    const isMonthly = ch.period === 'monthly';
    const color = DIFFICULTY_COLOR[ch.difficulty];
    return (
      <TouchableOpacity
        key={ch.challenge_id}
        style={[
          s.challengeCard,
          isDark && { backgroundColor: '#1F2937' },
          isMonthly && s.monthlyCard,
          isMonthly && isDark && { backgroundColor: '#2E1065' },
        ]}
        onPress={() => setSelectedChallenge(ch)}
        activeOpacity={0.85}
      >
        <View style={s.challengeTopRow}>
          <View style={[s.bigBadge, { backgroundColor: isMonthly ? 'rgba(255,255,255,0.18)' : color + '1F' }]}>
            <Ionicons name={ch.reward_icon as any} size={34} color={isMonthly ? '#FFFFFF' : color} />
            {completed && (
              <View style={s.bigBadgeCheck}>
                <Ionicons name="checkmark-circle" size={18} color="#10B981" />
              </View>
            )}
          </View>
          <View style={{ flex: 1 }}>
            <View style={[s.difficultyPill, { backgroundColor: isMonthly ? 'rgba(255,255,255,0.18)' : color + '1A', alignSelf: 'flex-start' }]}>
              <Text style={[s.difficultyText, { color: isMonthly ? '#FFFFFF' : color }]}>{ch.difficulty.toUpperCase()}</Text>
            </View>
            <Text style={[s.rewardLabelBig, isMonthly && { color: '#FFFFFF' }, !isMonthly && { color }]}>{ch.reward_label}</Text>
          </View>
        </View>
        <Text style={[s.challengeTitle, { marginBottom: 4 }, isDark && { color: '#F9FAFB' }, isMonthly && { color: '#FFFFFF' }]}>{ch.title}</Text>
        <Text style={[s.challengeCardDesc, isDark && { color: '#9CA3AF' }, isMonthly && { color: '#DDD6FE' }]} numberOfLines={2}>{ch.description}</Text>

        {joined && (
          <View style={{ marginTop: 2 }}>
            <View style={s.challengeTrack}>
              <View style={[s.challengeFill, { width: `${pct}%`, backgroundColor: isMonthly ? '#FFFFFF' : color }]} />
            </View>
            <Text style={[s.challengeProgressText, isMonthly && { color: '#DDD6FE' }]}>
              {completed ? 'Completed! 🎉' : `${progressFloors} / ${ch.target_floors} fl`}
            </Text>
          </View>
        )}
        {!joined && (
          <TouchableOpacity
            style={[s.joinBtn, isMonthly && { backgroundColor: '#FFFFFF' }]}
            onPress={() => handleJoin(ch.challenge_id)}
          >
            <Text style={[s.joinBtnText, isMonthly && { color: '#7C3AED' }]}>Join Challenge</Text>
          </TouchableOpacity>
        )}
      </TouchableOpacity>
    );
  };

  return (
    <View style={[s.container, isDark && { backgroundColor: '#111827' }]}>
      <View style={[s.header, isDark && { backgroundColor: '#111827', borderBottomColor: '#374151' }]}>
        <Text style={[s.headerTitle, isDark && { color: '#F9FAFB' }]}>Groups</Text>
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
            {monthlyChallenge && renderChallengeCard(monthlyChallenge, monthlyFloors)}
            {weeklyChallenges.map((ch) => renderChallengeCard(ch, weeklyFloors))}
          </>
        )}

        {tab === 'clubs' && (
          <>
            {(['Trail Running', 'Hiking', 'Climbing'] as const).map((category) => (
              <View key={category} style={s.groupSection}>
                <Text style={[s.groupSectionTitle, isDark && { color: '#F9FAFB' }]}>{category}</Text>
                {CLUBS.filter((c) => c.category === category).map((club) => (
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
            ))}
          </>
        )}

        {tab === 'events' && (
          <>
            {(['Local', 'Worldwide'] as const).map((scope) => (
              <View key={scope} style={s.groupSection}>
                <Text style={[s.groupSectionTitle, isDark && { color: '#F9FAFB' }]}>{scope === 'Local' ? 'Local (Singapore)' : 'Worldwide'}</Text>
                {EVENTS.filter((e) => e.scope === scope).map((ev) => (
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

      <AuthPrompt
        visible={authPromptVisible}
        reason="join challenges"
        onClose={() => setAuthPromptVisible(false)}
      />

      <ChallengeDetailModal
        challenge={selectedChallenge}
        visible={!!selectedChallenge}
        onClose={() => setSelectedChallenge(null)}
        joined={!!selectedChallenge && myChallengeIds.has(selectedChallenge.challenge_id)}
        progressFloors={selectedChallenge?.period === 'monthly' ? monthlyFloors : weeklyFloors}
        onJoin={() => selectedChallenge && handleJoin(selectedChallenge.challenge_id)}
        isDark={isDark}
      />
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F9FAFB' },
  header: {
    paddingTop: 56,
    paddingBottom: 12,
    paddingHorizontal: 20,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E7EB',
  },
  headerTitle: { fontSize: 28, fontWeight: '800', color: '#111827', letterSpacing: -0.5 },

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

  scrollContent: { padding: 16, paddingBottom: 32 },

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
  eventsFootnote: { fontSize: 11.5, color: '#9CA3AF', textAlign: 'center', marginTop: 4, lineHeight: 16 },

  challengeCard: {
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
  monthlyCard: { backgroundColor: '#7C3AED' },
  challengeTopRow: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 12 },
  bigBadge: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bigBadgeCheck: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
  },
  rewardLabelBig: { fontSize: 12.5, fontWeight: '800', marginTop: 6 },
  difficultyPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  difficultyText: { fontSize: 10.5, fontWeight: '800', letterSpacing: 0.4 },
  challengeTitle: { fontSize: 16, fontWeight: '700', color: '#111827', marginBottom: 12 },
  challengeCardDesc: { fontSize: 12.5, color: '#6B7280', lineHeight: 17, marginBottom: 12 },
  challengeTrack: { height: 8, borderRadius: 4, backgroundColor: 'rgba(0,0,0,0.08)', overflow: 'hidden' },
  challengeFill: { height: '100%', borderRadius: 4 },
  challengeProgressText: { fontSize: 12, fontWeight: '600', color: '#6B7280', marginTop: 6 },
  joinBtn: { backgroundColor: '#2563EB', borderRadius: 10, paddingVertical: 11, alignItems: 'center' },
  joinBtnText: { color: '#FFFFFF', fontWeight: '700', fontSize: 13.5 },
});
