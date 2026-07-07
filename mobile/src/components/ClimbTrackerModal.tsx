import { useState, useEffect, useRef, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Modal, ActivityIndicator } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Barometer } from 'expo-sensors';
import type { Block } from '../types';

interface Props {
  block: Block | null;
  visible: boolean;
  onClose: () => void;
  onSave: (floorsClimbed: number) => void;
  onUseManualEntry: () => void;
}

const METERS_PER_FLOOR = 2.8; // matches est_height_m = storeys * 2.8 elsewhere in the app
const MIN_DELTA_M = 0.1; // ignore barometer jitter below this per-sample noise floor

type Phase = 'checking' | 'unavailable' | 'tracking' | 'summary';

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function ClimbTrackerModal({ block, visible, onClose, onSave, onUseManualEntry }: Props) {
  const [phase, setPhase] = useState<Phase>('checking');
  const [elapsed, setElapsed] = useState(0);
  const [elevationGain, setElevationGain] = useState(0);

  const baselinePressure = useRef<number | null>(null);
  const lastAltitude = useRef(0);
  const totalGain = useRef(0);
  const startTime = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const subRef = useRef<ReturnType<typeof Barometer.addListener> | null>(null);

  const stopTracking = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    subRef.current?.remove();
    timerRef.current = null;
    subRef.current = null;
  }, []);

  useEffect(() => {
    if (!visible) return;

    let cancelled = false;
    setPhase('checking');
    setElapsed(0);
    setElevationGain(0);
    baselinePressure.current = null;
    lastAltitude.current = 0;
    totalGain.current = 0;

    (async () => {
      const available = await Barometer.isAvailableAsync();
      if (cancelled) return;

      if (!available) {
        setPhase('unavailable');
        return;
      }

      await Barometer.requestPermissionsAsync().catch(() => {});
      if (cancelled) return;

      Barometer.setUpdateInterval(1000);
      startTime.current = Date.now();

      subRef.current = Barometer.addListener(({ pressure }) => {
        if (baselinePressure.current == null) {
          baselinePressure.current = pressure;
          return;
        }
        // Barometric formula: altitude relative to the baseline pressure captured
        // at climb start. Only accumulate net upward movement — pressure noise
        // means small drops are normal mid-climb and shouldn't subtract from gain.
        const altitude = 44330 * (1 - Math.pow(pressure / baselinePressure.current, 1 / 5.255));
        const delta = altitude - lastAltitude.current;
        if (delta > MIN_DELTA_M) {
          totalGain.current += delta;
          setElevationGain(totalGain.current);
        }
        lastAltitude.current = altitude;
      });

      timerRef.current = setInterval(() => {
        setElapsed(Math.floor((Date.now() - startTime.current) / 1000));
      }, 1000);

      setPhase('tracking');
    })();

    return () => {
      cancelled = true;
      stopTracking();
    };
  }, [visible, stopTracking]);

  const handleStop = () => {
    stopTracking();
    setPhase('summary');
  };

  const handleClose = () => {
    stopTracking();
    onClose();
  };

  const floorsClimbed = Math.round(elevationGain / METERS_PER_FLOOR);

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
            <Text style={styles.unavailableTitle}>No barometer found</Text>
            <Text style={styles.unavailableText}>
              This device can't track elevation automatically. You can still log the climb by entering sets manually.
            </Text>
            <TouchableOpacity style={styles.primaryBtn} onPress={() => { handleClose(); onUseManualEntry(); }}>
              <Text style={styles.primaryBtnText}>Enter Manually</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.textLink} onPress={handleClose}>
              <Text style={styles.textLinkText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        )}

        {phase === 'tracking' && (
          <View style={styles.trackingWrap}>
            <View style={styles.trackingHeader}>
              <Text style={styles.trackingAddress}>Blk {block?.blk_no} {block?.street}</Text>
              <View style={styles.liveDot} />
            </View>

            <View style={styles.center}>
              <Text style={styles.elapsedTime}>{formatElapsed(elapsed)}</Text>
              <Text style={styles.elapsedLabel}>ELAPSED</Text>

              <View style={styles.metricRow}>
                <View style={styles.metric}>
                  <Text style={styles.metricValue}>{elevationGain.toFixed(1)}m</Text>
                  <Text style={styles.metricLabel}>Elevation Gain</Text>
                </View>
                <View style={styles.metric}>
                  <Text style={styles.metricValue}>{floorsClimbed}</Text>
                  <Text style={styles.metricLabel}>Floors (est.)</Text>
                </View>
              </View>
            </View>

            <TouchableOpacity style={styles.stopBtn} onPress={handleStop} activeOpacity={0.8}>
              <View style={styles.stopBtnInner} />
            </TouchableOpacity>
            <Text style={styles.stopHint}>Tap to finish</Text>
          </View>
        )}

        {phase === 'summary' && (
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

            <TouchableOpacity
              style={styles.primaryBtn}
              onPress={() => { onSave(Math.max(1, floorsClimbed)); handleClose(); }}
            >
              <Text style={styles.primaryBtnText}>Save Climb</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.textLink} onPress={handleClose}>
              <Text style={styles.textLinkText}>Discard</Text>
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

  trackingWrap: { flex: 1, paddingTop: 56 },
  trackingHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 24 },
  trackingAddress: { fontSize: 14, fontWeight: '600', color: '#6B7280' },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#EF4444' },
  elapsedTime: { fontSize: 56, fontWeight: '800', color: '#111827', fontVariant: ['tabular-nums'] },
  elapsedLabel: { fontSize: 12, fontWeight: '700', color: '#9CA3AF', letterSpacing: 1, marginTop: 4, marginBottom: 32 },
  metricRow: { flexDirection: 'row', gap: 40 },
  metric: { alignItems: 'center' },
  metricValue: { fontSize: 28, fontWeight: '800', color: '#2563EB' },
  metricLabel: { fontSize: 11, fontWeight: '600', color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 4 },
  stopBtn: {
    width: 76, height: 76, borderRadius: 38, backgroundColor: '#FEE2E2',
    alignItems: 'center', justifyContent: 'center', alignSelf: 'center', marginBottom: 8,
  },
  stopBtnInner: { width: 28, height: 28, borderRadius: 6, backgroundColor: '#EF4444' },
  stopHint: { textAlign: 'center', fontSize: 12, color: '#9CA3AF', marginBottom: 48, fontWeight: '600' },

  summaryTitle: { fontSize: 22, fontWeight: '800', color: '#111827', marginTop: 16, marginBottom: 28 },
  summaryStatsRow: { flexDirection: 'row', gap: 28, marginBottom: 36 },
  summaryStat: { alignItems: 'center' },
  summaryValue: { fontSize: 22, fontWeight: '800', color: '#111827', fontVariant: ['tabular-nums'] },
  summaryLabel: { fontSize: 11, fontWeight: '600', color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 4 },

  primaryBtn: { backgroundColor: '#10B981', borderRadius: 12, paddingVertical: 15, paddingHorizontal: 40, alignItems: 'center' },
  primaryBtnText: { color: '#FFF', fontSize: 15, fontWeight: '700' },
  textLink: { marginTop: 16, padding: 8 },
  textLinkText: { color: '#9CA3AF', fontWeight: '600', fontSize: 13 },
});
