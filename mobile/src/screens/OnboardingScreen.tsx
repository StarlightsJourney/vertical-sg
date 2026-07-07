import { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Animated,
  ScrollView,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useLocation } from '../hooks/useLocation';
import { fetchBlocksInBounds } from '../services/blocks';
import { logClimb } from '../services/climbs';
import { useAuth } from '../contexts/AuthContext';
import storage from '../utils/storage';
import type { Block } from '../types';

interface Props {
  onComplete: () => void;
}

type Step = 'welcome' | 'path' | 'goal' | 'fitness' | 'profile' | 'building' | 'celebrate';

const STEP_PCT: Record<Step, number> = {
  welcome: 12, path: 40, goal: 58, fitness: 72, profile: 85, building: 93, celebrate: 100,
};

const TIERS = ['#4A90D9', '#FF9500', '#FF3B30', '#8B0000', '#7C3AED'];

const PATH_OPTIONS = [
  { label: 'Athlete', desc: 'Training vertical gain on purpose', color: '#7C3AED' },
  { label: 'Explorer', desc: 'Curious what’s climbable nearby', color: '#4A90D9' },
  { label: 'Competitor', desc: 'Here for the leaderboard', color: '#FF3B30' },
  { label: 'Just Curious', desc: 'Not sure yet — showing me around', color: '#FF9500' },
];

const GOAL_OPTIONS = [
  { label: 'Train for a race', desc: 'Building vertical endurance', color: '#FF3B30' },
  { label: 'Stay fit', desc: 'A workout that fits between errands', color: '#4A90D9' },
  { label: 'Explore my neighbourhood', desc: 'Find the tall blocks near me', color: '#FF9500' },
  { label: 'Chase the leaderboard', desc: 'Competitive, numbers-driven', color: '#7C3AED' },
];

const FITNESS_OPTIONS = [
  { label: '1 – 5 floors', desc: 'Building up from here', color: '#4A90D9' },
  { label: '6 – 15 floors', desc: 'Comfortable, not effortless', color: '#FF9500' },
  { label: '16 – 30 floors', desc: 'You do this on purpose already', color: '#FF3B30' },
  { label: '30+ floors', desc: 'Show-off', color: '#7C3AED' },
];

const GOAL_BASE_FLOORS = [120, 200, 320];
const AVATAR_MARKS = ['B1', '▲', '◆', '●', '■'];

function Mascot() {
  const bob = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(bob, { toValue: 1, duration: 1300, useNativeDriver: true }),
        Animated.timing(bob, { toValue: 0, duration: 1300, useNativeDriver: true }),
      ]),
    ).start();
  }, []);

  const translateY = bob.interpolate({ inputRange: [0, 1], outputRange: [0, -8] });

  return (
    <Animated.View style={[m.wrap, { transform: [{ translateY }] }]}>
      <View style={m.stairs}>
        <View style={[m.stair, { height: 14, backgroundColor: '#E5E7EB' }]} />
        <View style={[m.stair, { height: 26, backgroundColor: '#D1D5DB' }]} />
        <View style={[m.stair, { height: 38, backgroundColor: '#E5E7EB' }]} />
      </View>
      <View style={m.body}>
        <View style={[m.cheek, { left: 10 }]} />
        <View style={[m.cheek, { right: 10 }]} />
        <View style={m.eyesRow}>
          <View style={m.eye} />
          <View style={m.eye} />
        </View>
        <View style={m.smile} />
      </View>
    </Animated.View>
  );
}

export default function OnboardingScreen({ onComplete }: Props) {
  const { user } = useAuth();
  const location = useLocation();
  const [step, setStep] = useState<Step>('welcome');
  const [pathIdx, setPathIdx] = useState(0);
  const [goalIdx, setGoalIdx] = useState(0);
  const [fitnessIdx, setFitnessIdx] = useState(0);
  const [avatarIdx, setAvatarIdx] = useState(0);
  const [handle, setHandle] = useState(`Climber${Math.floor(1000 + Math.random() * 9000)}`);
  const [nearbyBlocks, setNearbyBlocks] = useState<Block[]>([]);
  const [blocksLoading, setBlocksLoading] = useState(false);
  const [selectedBlock, setSelectedBlock] = useState<Block | null>(null);
  const [climbing, setClimbing] = useState(false);
  const [weeklyGoal, setWeeklyGoal] = useState(200);

  const goTo = (s: Step) => setStep(s);

  const loadNearbyBlocks = useCallback(async () => {
    if (location.loading) return;
    setBlocksLoading(true);
    try {
      const delta = 0.02; // roughly ~2km box around the user
      const blocks = await fetchBlocksInBounds({
        minLat: location.latitude - delta,
        minLng: location.longitude - delta,
        maxLat: location.latitude + delta,
        maxLng: location.longitude + delta,
        sortBy: 'storeys',
        limit: 30,
      });
      const withCoords = blocks.filter((b) => b.lat != null && b.lng != null);
      // Pick a small varied spread rather than just the top 3 tallest
      const picks = [withCoords[0], withCoords[Math.floor(withCoords.length / 2)], withCoords[withCoords.length - 1]]
        .filter((b, i, arr) => b && arr.findIndex((x) => x?.block_id === b.block_id) === i);
      setNearbyBlocks(picks as Block[]);
    } catch {
      setNearbyBlocks([]);
    }
    setBlocksLoading(false);
  }, [location.loading, location.latitude, location.longitude]);

  useEffect(() => {
    if (step === 'building') loadNearbyBlocks();
  }, [step, loadNearbyBlocks]);

  const handleClimbIt = async () => {
    if (!selectedBlock || !user) return;
    setClimbing(true);

    await logClimb(user.id, selectedBlock.block_id, selectedBlock.blk_no, selectedBlock.street, selectedBlock.storeys, 1, 0);

    const base = GOAL_BASE_FLOORS[fitnessIdx] ?? 200;
    const boost = goalIdx === 0 ? 1.3 : goalIdx === 3 ? 1.15 : 1;
    setWeeklyGoal(Math.round((base * boost) / 10) * 10);

    setClimbing(false);
    goTo('celebrate');
  };

  const finish = async () => {
    await storage.setItem('onboarding_completed', 'true');
    await storage.setItem('onboarding_profile', JSON.stringify({
      path: PATH_OPTIONS[pathIdx].label,
      goal: GOAL_OPTIONS[goalIdx].label,
      handle,
      avatarIdx,
      weeklyGoal,
    }));
    onComplete();
  };

  const pct = STEP_PCT[step];

  return (
    <View style={styles.container}>
      <View style={styles.progressWrap}>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${pct}%` }]} />
        </View>
        <Text style={styles.progressPct}>{pct}%</Text>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {step === 'welcome' && (
          <View style={styles.stepBox}>
            <Mascot />
            <Text style={styles.h1}>Meet Klimber.</Text>
            <Text style={styles.tagline}>Find climbs easier. Forever.</Text>
            <Text style={styles.sub}>
              Every staircase in Singapore is a workout nobody's mapped yet — Klimber helps you find yours, one HDB block at a time.
            </Text>
            <TouchableOpacity style={styles.primaryBtn} onPress={() => goTo('path')}>
              <Text style={styles.primaryBtnText}>Get Started</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.textLinkBtn} onPress={onComplete}>
              <Text style={styles.textLinkText}>I already have an account</Text>
            </TouchableOpacity>
          </View>
        )}

        {step === 'path' && (
          <View style={styles.stepBox}>
            <Text style={styles.eyebrow}>Your path</Text>
            <Text style={styles.h2}>What kind of climber are you?</Text>
            <Text style={styles.sub}>This shapes everything else — badges, goals, who you'll see on the leaderboard.</Text>
            {PATH_OPTIONS.map((opt, i) => (
              <OptionRow key={opt.label} opt={opt} selected={pathIdx === i} onPress={() => setPathIdx(i)} />
            ))}
            <TouchableOpacity style={styles.primaryBtn} onPress={() => goTo('goal')}>
              <Text style={styles.primaryBtnText}>Continue</Text>
            </TouchableOpacity>
          </View>
        )}

        {step === 'goal' && (
          <View style={styles.stepBox}>
            <Text style={styles.eyebrow}>Your motivation</Text>
            <Text style={styles.h2}>Why are you here?</Text>
            <Text style={styles.sub}>Be honest — we'll build your first goal around this.</Text>
            {GOAL_OPTIONS.map((opt, i) => (
              <OptionRow key={opt.label} opt={opt} selected={goalIdx === i} onPress={() => setGoalIdx(i)} />
            ))}
            <TouchableOpacity style={styles.primaryBtn} onPress={() => goTo('fitness')}>
              <Text style={styles.primaryBtnText}>Continue</Text>
            </TouchableOpacity>
          </View>
        )}

        {step === 'fitness' && (
          <View style={styles.stepBox}>
            <Text style={styles.eyebrow}>Quick check</Text>
            <Text style={styles.h2}>How many floors, no stopping?</Text>
            <Text style={styles.sub}>One honest guess. This calibrates your starting goal — not a test you can fail.</Text>
            {FITNESS_OPTIONS.map((opt, i) => (
              <OptionRow key={opt.label} opt={opt} selected={fitnessIdx === i} onPress={() => setFitnessIdx(i)} />
            ))}
            <TouchableOpacity style={styles.primaryBtn} onPress={() => goTo('profile')}>
              <Text style={styles.primaryBtnText}>Continue</Text>
            </TouchableOpacity>
          </View>
        )}

        {step === 'profile' && (
          <View style={styles.stepBox}>
            <Text style={styles.eyebrow}>Make it yours</Text>
            <Text style={styles.h2}>Pick a mark and a handle.</Text>
            <Text style={styles.sub}>No real name needed — climbers go by a handle here.</Text>
            <View style={styles.avatarRow}>
              {AVATAR_MARKS.map((mark, i) => (
                <TouchableOpacity
                  key={mark}
                  style={[styles.avatarBox, avatarIdx === i && { borderColor: '#111827' }]}
                  onPress={() => setAvatarIdx(i)}
                >
                  <Text style={[styles.avatarText, { color: TIERS[i] }]}>{mark}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TextInput style={styles.input} value={handle} onChangeText={setHandle} maxLength={20} />
            <TouchableOpacity style={styles.primaryBtn} onPress={() => goTo('building')}>
              <Text style={styles.primaryBtnText}>Continue</Text>
            </TouchableOpacity>
          </View>
        )}

        {step === 'building' && (
          <View style={styles.stepBox}>
            <Text style={styles.eyebrow}>Near you</Text>
            <Text style={styles.h2}>Pick your first climb.</Text>
            <Text style={styles.sub}>Real blocks near your location right now — tap one to try it.</Text>
            {blocksLoading ? (
              <ActivityIndicator size="small" color="#2563EB" style={{ marginVertical: 24 }} />
            ) : nearbyBlocks.length > 0 ? (
              nearbyBlocks.map((b) => (
                <TouchableOpacity
                  key={b.block_id}
                  style={[styles.buildingRow, selectedBlock?.block_id === b.block_id && styles.buildingRowSelected]}
                  onPress={() => setSelectedBlock(b)}
                >
                  <Text style={[styles.buildingStoreys, { color: getTierColor(b.storeys) }]}>{b.storeys}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.buildingName}>Blk {b.blk_no} {b.street}</Text>
                    <Text style={styles.buildingMeta}>{b.storeys} floors · ~{b.est_height_m}m</Text>
                  </View>
                </TouchableOpacity>
              ))
            ) : (
              <Text style={styles.sub}>Couldn't find nearby blocks — you can pick one from the map instead.</Text>
            )}
            <TouchableOpacity
              style={[styles.primaryBtn, (!selectedBlock || climbing) && { opacity: 0.5 }]}
              onPress={handleClimbIt}
              disabled={!selectedBlock || climbing}
            >
              {climbing ? <ActivityIndicator size="small" color="#FFF" /> : <Text style={styles.primaryBtnText}>Climb it</Text>}
            </TouchableOpacity>
            {nearbyBlocks.length === 0 && !blocksLoading && (
              <TouchableOpacity style={styles.textLinkBtn} onPress={finish}>
                <Text style={styles.textLinkText}>Skip for now</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {step === 'celebrate' && (
          <View style={styles.stepBox}>
            <View style={styles.celebrateIcon}>
              <Ionicons name="checkmark-circle" size={64} color="#10B981" />
            </View>
            <Text style={styles.h2Center}>Building Climbed!</Text>
            <View style={styles.xpPill}>
              <Text style={styles.xpPillText}>+10 XP · {selectedBlock ? `Blk ${selectedBlock.blk_no}` : ''}</Text>
            </View>
            <View style={styles.celebrateStatsRow}>
              <View style={styles.cstat}>
                <Text style={styles.cstatValue}>1</Text>
                <Text style={styles.cstatLabel}>Day streak</Text>
              </View>
              <View style={styles.cstat}>
                <Text style={styles.cstatValue}>{selectedBlock?.storeys ?? 0}</Text>
                <Text style={styles.cstatLabel}>Floors today</Text>
              </View>
            </View>
            <View style={styles.goalRow}>
              <Text style={styles.goalRowText}>This week</Text>
              <Text style={styles.goalRowText}>{selectedBlock?.storeys ?? 0} / {weeklyGoal} fl</Text>
            </View>
            <View style={styles.goalTrack}>
              <View style={[styles.goalFill, { width: `${Math.min(100, Math.round(((selectedBlock?.storeys ?? 0) / weeklyGoal) * 100))}%` }]} />
            </View>
            <TouchableOpacity style={styles.primaryBtn} onPress={finish}>
              <Text style={styles.primaryBtnText}>Start Climbing</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function getTierColor(storeys: number): string {
  if (storeys <= 10) return TIERS[0];
  if (storeys <= 20) return TIERS[1];
  if (storeys <= 30) return TIERS[2];
  if (storeys <= 39) return TIERS[3];
  return TIERS[4];
}

function OptionRow({ opt, selected, onPress }: { opt: { label: string; desc: string; color: string }; selected: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity
      style={[styles.optRow, selected && { borderColor: opt.color, backgroundColor: opt.color + '14' }]}
      onPress={onPress}
      activeOpacity={0.8}
    >
      <View style={{ flex: 1 }}>
        <Text style={styles.optLabel}>{opt.label}</Text>
        <Text style={styles.optDesc}>{opt.desc}</Text>
      </View>
      <View style={[styles.optCheck, selected && { borderColor: opt.color, backgroundColor: opt.color }]}>
        {selected && <Ionicons name="checkmark" size={12} color="#FFF" />}
      </View>
    </TouchableOpacity>
  );
}

const m = StyleSheet.create({
  wrap: { alignItems: 'center', marginBottom: 16 },
  stairs: { flexDirection: 'row', alignItems: 'flex-end', gap: 3, position: 'absolute', bottom: -6, left: '50%', marginLeft: -45 },
  stair: { width: 28, borderTopLeftRadius: 4, borderTopRightRadius: 4 },
  body: {
    width: 96, height: 100, borderRadius: 48,
    backgroundColor: '#7C3AED',
    alignItems: 'center', justifyContent: 'center',
  },
  cheek: { position: 'absolute', top: 46, width: 14, height: 10, borderRadius: 7, backgroundColor: '#A78BFA' },
  eyesRow: { flexDirection: 'row', gap: 18, marginBottom: 10 },
  eye: { width: 9, height: 9, borderRadius: 5, backgroundColor: '#12161A' },
  smile: {
    width: 26, height: 13, borderBottomLeftRadius: 13, borderBottomRightRadius: 13,
    borderWidth: 2.5, borderColor: '#12161A', borderTopWidth: 0,
  },
});

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F9FAFB' },
  progressWrap: { paddingTop: 56, paddingHorizontal: 24, paddingBottom: 12 },
  progressTrack: { height: 6, borderRadius: 3, backgroundColor: '#E5E7EB', overflow: 'hidden', marginBottom: 6 },
  progressFill: { height: '100%', borderRadius: 3, backgroundColor: '#7C3AED' },
  progressPct: { fontSize: 11, fontWeight: '700', color: '#9CA3AF', textAlign: 'right' },
  scrollContent: { padding: 24, paddingTop: 8, paddingBottom: 48, flexGrow: 1 },
  stepBox: { flex: 1 },
  eyebrow: { fontSize: 11, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', color: '#9CA3AF', marginBottom: 10 },
  h1: { fontSize: 26, fontWeight: '800', color: '#111827', textAlign: 'center', marginBottom: 6 },
  h2: { fontSize: 21, fontWeight: '800', color: '#111827', marginBottom: 8 },
  h2Center: { fontSize: 22, fontWeight: '800', color: '#111827', textAlign: 'center', marginBottom: 14 },
  tagline: { fontSize: 15, fontWeight: '700', color: '#FF9500', textAlign: 'center', marginBottom: 16 },
  sub: { fontSize: 14, color: '#6B7280', lineHeight: 20, marginBottom: 20, textAlign: 'left' },
  primaryBtn: { backgroundColor: '#111827', borderRadius: 12, paddingVertical: 15, alignItems: 'center', marginTop: 8 },
  primaryBtnText: { color: '#FFF', fontSize: 15, fontWeight: '700' },
  textLinkBtn: { marginTop: 14, alignItems: 'center', paddingVertical: 6 },
  textLinkText: { color: '#9CA3AF', fontWeight: '600', fontSize: 13 },
  optRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderWidth: 1.5, borderColor: '#E5E7EB', borderRadius: 12, padding: 14, marginBottom: 10,
    backgroundColor: '#FFFFFF',
  },
  optLabel: { fontSize: 15, fontWeight: '700', color: '#111827' },
  optDesc: { fontSize: 12.5, color: '#6B7280', marginTop: 2 },
  optCheck: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: '#E5E7EB', alignItems: 'center', justifyContent: 'center' },
  avatarRow: { flexDirection: 'row', gap: 10, marginBottom: 18 },
  avatarBox: {
    flex: 1, aspectRatio: 1, borderRadius: 10, borderWidth: 1.5, borderColor: '#E5E7EB',
    backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { fontSize: 16, fontWeight: '800' },
  input: {
    backgroundColor: '#FFFFFF', borderWidth: 1.5, borderColor: '#E5E7EB', borderRadius: 12,
    padding: 14, fontSize: 15, color: '#111827', marginBottom: 8,
  },
  buildingRow: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: '#FFFFFF', borderWidth: 1.5, borderColor: '#E5E7EB', borderRadius: 12, padding: 14, marginBottom: 10,
  },
  buildingRowSelected: { borderColor: '#FF9500', backgroundColor: '#FFF7ED' },
  buildingStoreys: { fontSize: 22, fontWeight: '800', width: 40, textAlign: 'center' },
  buildingName: { fontSize: 14, fontWeight: '700', color: '#111827' },
  buildingMeta: { fontSize: 12, color: '#6B7280', marginTop: 2 },
  celebrateIcon: { alignItems: 'center', marginBottom: 8 },
  xpPill: {
    alignSelf: 'center', backgroundColor: '#FFF7ED', borderWidth: 1, borderColor: '#FED7AA',
    paddingVertical: 7, paddingHorizontal: 16, borderRadius: 999, marginBottom: 20,
  },
  xpPillText: { color: '#C2410C', fontWeight: '800', fontSize: 13 },
  celebrateStatsRow: { flexDirection: 'row', gap: 10, marginBottom: 20 },
  cstat: { flex: 1, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 10, padding: 14, alignItems: 'center' },
  cstatValue: { fontSize: 20, fontWeight: '800', color: '#111827' },
  cstatLabel: { fontSize: 10.5, color: '#6B7280', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 3 },
  goalRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  goalRowText: { fontSize: 12.5, color: '#6B7280', fontWeight: '600' },
  goalTrack: { height: 8, borderRadius: 4, backgroundColor: '#E5E7EB', overflow: 'hidden', marginBottom: 22 },
  goalFill: { height: '100%', backgroundColor: '#FF9500', borderRadius: 4 },
});
