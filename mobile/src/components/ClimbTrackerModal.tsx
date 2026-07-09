import { useState, useEffect, useRef, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Modal, ActivityIndicator, TextInput, Image, Alert } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Barometer, Pedometer } from 'expo-sensors';
import * as ImagePicker from 'expo-image-picker';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../config/supabase';
import { base64ToUint8Array } from '../utils/base64';
import type { Block } from '../types';

interface Props {
  block: Block | null;
  visible: boolean;
  onClose: () => void;
  onSave: (
    floorsClimbed: number, caption?: string, photoPath?: string,
    trackingMethod?: 'barometer' | 'pedometer', durationSeconds?: number,
  ) => Promise<string | undefined>;
  onUseManualEntry: () => void;
  onNavigateToSocial?: () => void;
}

const METERS_PER_FLOOR = 2.8; // matches est_height_m = storeys * 2.8 elsewhere in the app
const MIN_DELTA_M = 0.1; // ignore barometer jitter below this per-sample noise floor
const STEPS_PER_FLOOR = 16; // typical HDB stairwell flight — used when there's no barometer
const MIN_VALID_SECONDS = 15; // shorter than this and it's almost certainly a mis-tap, not a real climb

type Phase = 'checking' | 'unavailable' | 'ready' | 'tracking' | 'summary' | 'saved';
type SensorMode = 'barometer' | 'pedometer';

const CLIMB_TIPS = [
  'Keep a steady pace — quick bursts burn out your legs fast.',
  'Use the handrail on tight turns to save momentum.',
  'Exhale on the push, inhale on the recovery step.',
  'Land on the balls of your feet to ease knee impact.',
  'Look a few steps ahead, not straight down at your feet.',
];

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function ClimbTrackerModal({ block, visible, onClose, onSave, onUseManualEntry, onNavigateToSocial }: Props) {
  const { user } = useAuth();
  const [phase, setPhase] = useState<Phase>('checking');
  const [sensorMode, setSensorMode] = useState<SensorMode>('barometer');
  const [paused, setPaused] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [elevationGain, setElevationGain] = useState(0);
  const [stepCount, setStepCount] = useState(0);
  const [tipIdx, setTipIdx] = useState(0);

  const [captionText, setCaptionText] = useState('');
  const [photoBase64, setPhotoBase64] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedFloors, setSavedFloors] = useState(0);
  const [savedClimbId, setSavedClimbId] = useState<string | undefined>(undefined);
  const [postedToFeed, setPostedToFeed] = useState(false);
  const [posting, setPosting] = useState(false);

  const baselinePressure = useRef<number | null>(null);
  const lastAltitude = useRef(0);
  const totalGain = useRef(0);
  const elapsedBeforePauseMs = useRef(0);
  const segmentStart = useRef(0);
  const stepsBase = useRef(0);
  const pausedRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tipTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const subRef = useRef<{ remove: () => void } | null>(null);

  const stopSensor = useCallback(() => {
    subRef.current?.remove();
    subRef.current = null;
  }, []);

  const stopTracking = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (tipTimerRef.current) clearInterval(tipTimerRef.current);
    timerRef.current = null;
    tipTimerRef.current = null;
    stopSensor();
  }, [stopSensor]);

  // Sensor availability check only — does NOT start the timer or begin
  // listening. Resolves to 'ready' (tap Start when you actually want to
  // begin) or 'unavailable'.
  useEffect(() => {
    if (!visible) return;

    let cancelled = false;
    setPhase('checking');
    setElapsed(0);
    setElevationGain(0);
    setStepCount(0);
    setTipIdx(0);
    setPaused(false);
    setCaptionText('');
    setPhotoBase64(null);
    setSavedClimbId(undefined);
    setPostedToFeed(false);
    baselinePressure.current = null;
    lastAltitude.current = 0;
    totalGain.current = 0;
    elapsedBeforePauseMs.current = 0;
    stepsBase.current = 0;
    pausedRef.current = false;

    (async () => {
      const baroAvailable = await Barometer.isAvailableAsync();
      if (cancelled) return;

      if (baroAvailable) {
        await Barometer.requestPermissionsAsync().catch(() => {});
        if (cancelled) return;
        setSensorMode('barometer');
      } else {
        const pedAvailable = await Pedometer.isAvailableAsync();
        if (cancelled) return;
        if (!pedAvailable) {
          setPhase('unavailable');
          return;
        }
        await Pedometer.requestPermissionsAsync().catch(() => {});
        if (cancelled) return;
        setSensorMode('pedometer');
      }

      setPhase('ready');
    })();

    return () => {
      cancelled = true;
      stopTracking();
    };
  }, [visible, stopTracking]);

  const startBarometerListener = useCallback(() => {
    Barometer.setUpdateInterval(1000);
    subRef.current = Barometer.addListener(({ pressure }) => {
      if (baselinePressure.current == null) {
        baselinePressure.current = pressure;
        return;
      }
      const altitude = 44330 * (1 - Math.pow(pressure / baselinePressure.current, 1 / 5.255));
      const delta = altitude - lastAltitude.current;
      if (delta > MIN_DELTA_M && !pausedRef.current) {
        totalGain.current += delta;
        setElevationGain(totalGain.current);
      }
      lastAltitude.current = altitude;
    });
  }, []);

  const startPedometerListener = useCallback(() => {
    subRef.current = Pedometer.watchStepCount(({ steps }) => {
      const total = stepsBase.current + steps;
      setStepCount(total);
      setElevationGain((total / STEPS_PER_FLOOR) * METERS_PER_FLOOR);
    });
  }, []);

  const handleStart = () => {
    segmentStart.current = Date.now();
    if (sensorMode === 'barometer') startBarometerListener();
    else startPedometerListener();

    timerRef.current = setInterval(() => {
      if (pausedRef.current) return;
      setElapsed(Math.floor((elapsedBeforePauseMs.current + (Date.now() - segmentStart.current)) / 1000));
    }, 1000);

    tipTimerRef.current = setInterval(() => {
      setTipIdx((i) => (i + 1) % CLIMB_TIPS.length);
    }, 9000);

    setPhase('tracking');
  };

  const handlePauseResume = () => {
    if (!paused) {
      // Pausing: fold the just-finished running segment into the accumulator.
      elapsedBeforePauseMs.current += Date.now() - segmentStart.current;
      pausedRef.current = true;
      setPaused(true);
      if (sensorMode === 'pedometer') {
        stepsBase.current = stepCount;
        stopSensor();
      }
    } else {
      segmentStart.current = Date.now();
      pausedRef.current = false;
      setPaused(false);
      if (sensorMode === 'pedometer') startPedometerListener();
    }
  };

  const handleStop = () => {
    stopTracking();
    if (elapsed < MIN_VALID_SECONDS) {
      Alert.alert(
        'That was really short',
        `Only ${elapsed}s tracked — this looks like a mis-tap rather than a real climb. Log it anyway?`,
        [
          { text: 'Discard', style: 'destructive', onPress: handleClose },
          { text: 'Log It Anyway', onPress: () => setPhase('summary') },
        ],
      );
      return;
    }
    setPhase('summary');
  };

  const handleClose = () => {
    stopTracking();
    onClose();
  };

  const pickPhoto = async (source: 'camera' | 'library') => {
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
      setPhotoBase64(result.assets[0].base64);
    }
  };

  const openPhotoPicker = () => {
    Alert.alert('Add Photo', '', [
      { text: 'Take Photo', onPress: () => pickPhoto('camera') },
      { text: 'Choose from Library', onPress: () => pickPhoto('library') },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const floorsClimbed = Math.round(elevationGain / METERS_PER_FLOOR);

  const uploadPhoto = async (base64: string): Promise<string | undefined> => {
    if (!user) return undefined;
    const photoPath = `feed/${user.id}-${Date.now()}.jpg`;
    const bytes = base64ToUint8Array(base64);
    const { error } = await supabase.storage.from('building-photos').upload(photoPath, bytes, { contentType: 'image/jpeg' });
    if (error) {
      Alert.alert('Upload Failed', error.message);
      return undefined;
    }
    return photoPath;
  };

  const handleSaveClimb = async () => {
    const finalFloors = Math.max(1, floorsClimbed);
    setSaving(true);
    try {
      let photoPath: string | undefined;
      if (photoBase64) {
        photoPath = await uploadPhoto(photoBase64);
      }
      const climbId = await onSave(finalFloors, captionText.trim() || undefined, photoPath, sensorMode, elapsed);
      setSavedClimbId(climbId);
      setPostedToFeed(!!photoPath);
      setSavedFloors(finalFloors);
      setPhase('saved');
    } finally {
      setSaving(false);
    }
  };

  // Adding a photo after the climb was already saved (without one) — posts
  // it to the feed retroactively via an update, same as the composer flow
  // on SocialScreen for climbs logged without a photo.
  const handlePostToFeedNow = async () => {
    if (!photoBase64 || !savedClimbId || !user) return;
    setPosting(true);
    try {
      const photoPath = await uploadPhoto(photoBase64);
      if (!photoPath) return;
      const { error } = await supabase.from('climbs').update({ photo_path: photoPath }).eq('climb_id', savedClimbId).eq('user_id', user.id);
      if (error) {
        Alert.alert('Error', error.message);
        return;
      }
      setPostedToFeed(true);
    } finally {
      setPosting(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={handleClose}>
      <View style={styles.container}>
        {phase === 'checking' && (
          <View style={styles.center}>
            <ActivityIndicator size="large" color="#2563EB" />
            <Text style={styles.checkingText}>Checking for a barometer...</Text>
          </View>
        )}

        {phase === 'unavailable' && (
          <View style={styles.center}>
            <Ionicons name="alert-circle-outline" size={48} color="#9CA3AF" />
            <Text style={styles.unavailableTitle}>No motion sensors found</Text>
            <Text style={styles.unavailableText}>
              This device has neither a barometer nor a step counter, so climbs can't be tracked automatically. You can still log the climb by entering sets manually.
            </Text>
            <TouchableOpacity style={styles.primaryBtn} onPress={() => { handleClose(); onUseManualEntry(); }}>
              <Text style={styles.primaryBtnText}>Enter Manually</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.textLink} onPress={handleClose}>
              <Text style={styles.textLinkText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        )}

        {phase === 'ready' && (
          <View style={styles.center}>
            <Ionicons name="footsteps-outline" size={48} color="#2563EB" />
            <Text style={styles.readyTitle}>Blk {block?.blk_no} {block?.street}</Text>
            <Text style={styles.readyText}>
              {sensorMode === 'barometer'
                ? 'Elevation will be tracked live with your barometer.'
                : 'No barometer detected — floors will be estimated from your step count.'}
            </Text>
            <Text style={styles.readyHint}>Tap start when you're at the bottom and ready to go.</Text>
            <TouchableOpacity style={styles.startClimbBtn} onPress={handleStart} activeOpacity={0.85}>
              <Text style={styles.startClimbBtnText}>Start Climb</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.textLink} onPress={handleClose}>
              <Text style={styles.textLinkText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        )}

        {phase === 'tracking' && (
          <View style={styles.trackingWrap}>
            <View style={styles.tipBanner}>
              <Ionicons name="bulb-outline" size={14} color="#F59E0B" />
              <Text style={styles.tipText} numberOfLines={2}>{CLIMB_TIPS[tipIdx]}</Text>
            </View>

            <View style={styles.trackingHeader}>
              <Text style={styles.trackingAddress}>Blk {block?.blk_no} {block?.street}</Text>
              <View style={[styles.liveDot, paused && { backgroundColor: '#F59E0B' }]} />
            </View>

            <View style={styles.center}>
              {paused && <Text style={styles.pausedLabel}>PAUSED</Text>}
              <Text style={styles.elapsedTime}>{formatElapsed(elapsed)}</Text>
              <Text style={styles.elapsedLabel}>ELAPSED</Text>

              <View style={styles.metricRow}>
                {sensorMode === 'barometer' ? (
                  <View style={styles.metric}>
                    <Text style={styles.metricValue}>{elevationGain.toFixed(1)}m</Text>
                    <Text style={styles.metricLabel}>Elevation Gain</Text>
                  </View>
                ) : (
                  <View style={styles.metric}>
                    <Text style={styles.metricValue}>{stepCount}</Text>
                    <Text style={styles.metricLabel}>Steps</Text>
                  </View>
                )}
                <View style={styles.metric}>
                  <Text style={styles.metricValue}>{floorsClimbed}</Text>
                  <Text style={styles.metricLabel}>Floors (est.)</Text>
                </View>
              </View>
              {sensorMode === 'pedometer' && (
                <Text style={styles.sensorNote}>No barometer detected — estimating floors from your step count.</Text>
              )}
            </View>

            <View style={styles.trackingControls}>
              <TouchableOpacity style={styles.pauseBtn} onPress={handlePauseResume} activeOpacity={0.8}>
                <Ionicons name={paused ? 'play' : 'pause'} size={24} color="#374151" />
              </TouchableOpacity>
              <TouchableOpacity style={styles.stopBtn} onPress={handleStop} activeOpacity={0.8}>
                <View style={styles.stopBtnInner} />
              </TouchableOpacity>
              <View style={{ width: 52 }} />
            </View>
            <Text style={styles.stopHint}>{paused ? 'Paused — tap play to resume' : 'Tap the square to finish'}</Text>
          </View>
        )}

        {phase === 'summary' && (
          <View style={styles.summaryScroll}>
            <View style={styles.center}>
              <Ionicons name="trophy" size={56} color="#F59E0B" />
              <Text style={styles.summaryTitle}>Climb Complete!</Text>

              <View style={styles.summaryStatsRow}>
                <View style={styles.summaryStat}>
                  <Text style={styles.summaryValue}>{formatElapsed(elapsed)}</Text>
                  <Text style={styles.summaryLabel}>Time</Text>
                </View>
                <View style={styles.summaryStat}>
                  <Text style={styles.summaryValue}>{elevationGain.toFixed(1)}m</Text>
                  <Text style={styles.summaryLabel}>Elevation</Text>
                </View>
                <View style={styles.summaryStat}>
                  <Text style={styles.summaryValue}>{floorsClimbed}</Text>
                  <Text style={styles.summaryLabel}>Floors</Text>
                </View>
              </View>
            </View>

            <View style={styles.summaryFormBlock}>
              <TextInput
                style={styles.summaryCaptionInput}
                placeholder="Say something about this climb..."
                placeholderTextColor="#9CA3AF"
                value={captionText}
                onChangeText={setCaptionText}
                multiline
                maxLength={200}
              />
              <TouchableOpacity style={styles.summaryPhotoBtn} onPress={openPhotoPicker}>
                {photoBase64 ? (
                  <Image source={{ uri: `data:image/jpeg;base64,${photoBase64}` }} style={styles.summaryPhotoPreview} />
                ) : (
                  <>
                    <Ionicons name="camera-outline" size={20} color="#6B7280" />
                    <Text style={styles.summaryPhotoBtnText}>Attach a photo to share to your feed</Text>
                  </>
                )}
              </TouchableOpacity>

              <TouchableOpacity style={[styles.primaryBtn, saving && { opacity: 0.6 }]} onPress={handleSaveClimb} disabled={saving}>
                {saving ? <ActivityIndicator size="small" color="#FFF" /> : <Text style={styles.primaryBtnText}>Save Climb</Text>}
              </TouchableOpacity>
              <TouchableOpacity style={styles.textLink} onPress={handleClose} disabled={saving}>
                <Text style={styles.textLinkText}>Discard</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {phase === 'saved' && (
          <View style={styles.center}>
            <Ionicons name="checkmark-circle" size={56} color="#10B981" />
            <Text style={styles.summaryTitle}>Saved!</Text>
            <Text style={styles.readyText}>{savedFloors} floors logged to your profile.</Text>

            {postedToFeed ? (
              <>
                <Text style={[styles.readyText, { marginTop: 4 }]}>It's on your feed for others to see.</Text>
                <TouchableOpacity style={styles.shareBtn} onPress={() => { onNavigateToSocial?.(); handleClose(); }} activeOpacity={0.85}>
                  <Ionicons name="people-outline" size={18} color="#FFF" />
                  <Text style={styles.primaryBtnText}>View in Feed</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <Text style={[styles.readyText, { marginTop: 4 }]}>No photo attached — this won't show on your feed.</Text>
                {photoBase64 ? (
                  <Image source={{ uri: `data:image/jpeg;base64,${photoBase64}` }} style={styles.savedPhotoPreview} />
                ) : (
                  <TouchableOpacity style={styles.summaryPhotoBtn} onPress={openPhotoPicker}>
                    <Ionicons name="camera-outline" size={20} color="#6B7280" />
                    <Text style={styles.summaryPhotoBtnText}>Attach a photo to share</Text>
                  </TouchableOpacity>
                )}
                {photoBase64 && (
                  <TouchableOpacity style={[styles.shareBtn, posting && { opacity: 0.6 }]} onPress={handlePostToFeedNow} disabled={posting} activeOpacity={0.85}>
                    {posting ? <ActivityIndicator size="small" color="#FFF" /> : (
                      <>
                        <Ionicons name="people-outline" size={18} color="#FFF" />
                        <Text style={styles.primaryBtnText}>Post to Feed</Text>
                      </>
                    )}
                  </TouchableOpacity>
                )}
              </>
            )}

            <TouchableOpacity style={styles.textLink} onPress={handleClose}>
              <Text style={styles.textLinkText}>Done</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  checkingText: { fontSize: 14, color: '#6B7280', marginTop: 14 },
  unavailableTitle: { fontSize: 19, fontWeight: '800', color: '#111827', marginTop: 16, marginBottom: 8 },
  unavailableText: { fontSize: 14, color: '#6B7280', textAlign: 'center', lineHeight: 20, marginBottom: 28 },

  readyTitle: { fontSize: 18, fontWeight: '800', color: '#111827', marginTop: 16, marginBottom: 10, textAlign: 'center' },
  readyText: { fontSize: 14, color: '#6B7280', textAlign: 'center', lineHeight: 20, marginBottom: 4 },
  readyHint: { fontSize: 12.5, color: '#9CA3AF', textAlign: 'center', marginTop: 8, marginBottom: 28 },
  startClimbBtn: {
    backgroundColor: '#10B981', borderRadius: 16, paddingVertical: 18, paddingHorizontal: 56, alignItems: 'center',
  },
  startClimbBtnText: { color: '#FFF', fontSize: 17, fontWeight: '800' },

  trackingWrap: { flex: 1, paddingTop: 56 },
  tipBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FFFBEB',
    marginHorizontal: 20,
    marginBottom: 16,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  tipText: { flex: 1, fontSize: 12.5, color: '#92400E', fontWeight: '500', lineHeight: 17 },
  sensorNote: { fontSize: 11.5, color: '#9CA3AF', textAlign: 'center', marginTop: 20, paddingHorizontal: 24, lineHeight: 16 },
  trackingHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 24 },
  trackingAddress: { fontSize: 14, fontWeight: '600', color: '#6B7280' },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#EF4444' },
  pausedLabel: { fontSize: 13, fontWeight: '800', color: '#F59E0B', letterSpacing: 1, marginBottom: 4 },
  elapsedTime: { fontSize: 56, fontWeight: '800', color: '#111827', fontVariant: ['tabular-nums'] },
  elapsedLabel: { fontSize: 12, fontWeight: '700', color: '#9CA3AF', letterSpacing: 1, marginTop: 4, marginBottom: 32 },
  metricRow: { flexDirection: 'row', gap: 40 },
  metric: { alignItems: 'center' },
  metricValue: { fontSize: 28, fontWeight: '800', color: '#2563EB' },
  metricLabel: { fontSize: 11, fontWeight: '600', color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 4 },
  trackingControls: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 24, marginBottom: 8,
  },
  pauseBtn: {
    width: 52, height: 52, borderRadius: 26, backgroundColor: '#F3F4F6',
    alignItems: 'center', justifyContent: 'center',
  },
  stopBtn: {
    width: 76, height: 76, borderRadius: 38, backgroundColor: '#FEE2E2',
    alignItems: 'center', justifyContent: 'center',
  },
  stopBtnInner: { width: 28, height: 28, borderRadius: 6, backgroundColor: '#EF4444' },
  stopHint: { textAlign: 'center', fontSize: 12, color: '#9CA3AF', marginBottom: 48, fontWeight: '600' },

  summaryScroll: { flex: 1, paddingTop: 56, justifyContent: 'space-between' },
  summaryTitle: { fontSize: 22, fontWeight: '800', color: '#111827', marginTop: 16, marginBottom: 28 },
  summaryStatsRow: { flexDirection: 'row', gap: 28, marginBottom: 8 },
  summaryStat: { alignItems: 'center' },
  summaryValue: { fontSize: 22, fontWeight: '800', color: '#111827', fontVariant: ['tabular-nums'] },
  summaryLabel: { fontSize: 11, fontWeight: '600', color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 4 },

  summaryFormBlock: { paddingHorizontal: 24, paddingBottom: 32 },
  summaryCaptionInput: {
    backgroundColor: '#F3F4F6', borderRadius: 12, padding: 14, fontSize: 14,
    color: '#111827', minHeight: 60, marginBottom: 12, textAlignVertical: 'top',
  },
  summaryPhotoBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: '#F3F4F6', borderRadius: 12, padding: 14, marginBottom: 16, minHeight: 56,
  },
  summaryPhotoBtnText: { fontSize: 13, color: '#6B7280', fontWeight: '500' },
  summaryPhotoPreview: { width: '100%', height: 140, borderRadius: 10 },
  savedPhotoPreview: { width: 220, height: 140, borderRadius: 10, marginTop: 8, marginBottom: 8 },

  shareBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: '#2563EB', borderRadius: 12, paddingVertical: 15, paddingHorizontal: 40, marginTop: 8,
  },

  primaryBtn: { backgroundColor: '#10B981', borderRadius: 12, paddingVertical: 15, paddingHorizontal: 40, alignItems: 'center' },
  primaryBtnText: { color: '#FFF', fontSize: 15, fontWeight: '700' },
  textLink: { marginTop: 16, padding: 8 },
  textLinkText: { color: '#9CA3AF', fontWeight: '600', fontSize: 13 },
});
