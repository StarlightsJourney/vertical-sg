import { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as Linking from 'expo-linking';
import ClimbTrackerModal from './ClimbTrackerModal';
import type { Block } from '../types';

interface Props {
  block: Block | null;
  distanceKm: number | null;
  onLogClimb?: (block: Block, qty: number, partialFloors: number) => void;
  onViewDetails?: (block: Block) => void;
  tapY?: number;
  isDark?: boolean;
}

function getTier(storeys: number) {
  if (storeys <= 10) return { label: 'Low-rise', color: '#4A90D9' };
  if (storeys <= 20) return { label: 'Mid-rise', color: '#FF9500' };
  if (storeys <= 30) return { label: 'High-rise', color: '#FF3B30' };
  if (storeys <= 39) return { label: 'Sky-high', color: '#8B0000' };
  return { label: 'Super-tall', color: '#7C3AED' };
}

function formatDistance(km: number | null): string {
  if (km == null) return '--';
  return km < 1 ? `${Math.round(km * 1000)}m` : `${km.toFixed(1)}km`;
}

export default function BlockDetailSheet({ block, distanceKm, onLogClimb, onViewDetails, tapY, isDark = false }: Props) {
  const [climbing, setClimbing] = useState(false); // manual entry panel
  const [trackerVisible, setTrackerVisible] = useState(false); // live barometer tracker
  const [climbQty, setClimbQty] = useState(1);
  const [partialFloors, setPartialFloors] = useState(0);
  const [justLogged, setJustLogged] = useState(false);

  if (!block) return null;

  const tier = getTier(block.storeys);

  const handleDirections = () => {
    if (block.lat != null && block.lng != null) {
      Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${block.lat},${block.lng}`);
    }
  };

  const handleConfirmClimb = () => {
    // Logging a climb never requires an account — anonymous sessions already
    // have a real (if anonymous) user id, so climbs attach and sync fine.
    // Only Verify Height and Add Photo (in View Details) are gated behind sign-in.
    onLogClimb?.(block, climbQty, partialFloors);

    // Immediate visual confirmation — don't wait on the network round trip
    // (that's what made it feel unresponsive) to tell the user it registered.
    setJustLogged(true);
    setTimeout(() => {
      setJustLogged(false);
      setClimbing(false);
      setClimbQty(1);
      setPartialFloors(0);
    }, 1400);
  };

  const handleTrackerSave = (floorsClimbed: number) => {
    // floorsClimbed is a real barometer-measured total (always >= 1, see
    // ClimbTrackerModal's Save button) — split it into full sets + a partial
    // remainder the same way manual entry does, so it reconstructs identically.
    const qty = Math.floor(floorsClimbed / block.storeys);
    const partial = floorsClimbed % block.storeys;
    onLogClimb?.(block, qty, partial);
  };

  return (
    <View style={styles.container} pointerEvents="box-none">
      {/* Card — positioned near the tapped pin */}
      <View style={[
        styles.cardWrapper,
        tapY != null && tapY > 0
          ? { top: Math.max(80, tapY - 160) }
          : { top: '30%' },
      ]}>
        <View style={[styles.card, isDark && { backgroundColor: 'rgba(31,41,55,0.94)' }]}>
          <View style={styles.content}>
            {/* Top row: storey count + address + directions arrow */}
            <View style={styles.topRow}>
              <View style={[styles.storeyBadge, { backgroundColor: tier.color + '22' }]}>
                <Text style={[styles.storeyValue, { color: tier.color }]}>{block.storeys}</Text>
                <Text style={[styles.storeyLabel, isDark && { color: '#9CA3AF' }]}>floors</Text>
              </View>
              <View style={styles.addressBlock}>
                <View style={styles.addressRow}>
                  <Text style={[styles.address, isDark && { color: '#F9FAFB' }]}>Blk {block.blk_no}</Text>
                  <TouchableOpacity onPress={handleDirections} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <Ionicons name="navigate-outline" size={18} color="#2563EB" />
                  </TouchableOpacity>
                </View>
                <Text style={[styles.street, isDark && { color: '#D1D5DB' }]}>{block.street}</Text>
                {block.town && <Text style={[styles.town, isDark && { color: '#9CA3AF' }]}>{block.town}</Text>}
              </View>
            </View>

            {/* Row 2: Quick stats */}
            <View style={styles.statsRow}>
              <View style={styles.stat}>
                <Text style={[styles.statValue, isDark && { color: '#F9FAFB' }]}>{block.est_height_m}m</Text>
                <Text style={styles.statLabel}>Height</Text>
              </View>
              <View style={styles.stat}>
                <Text style={[styles.statValue, isDark && { color: '#F9FAFB' }]}>{formatDistance(distanceKm)}</Text>
                <Text style={styles.statLabel}>Away</Text>
              </View>
              {block.height_source === 'verified' && (
                <View style={[styles.stat, styles.verifiedStat]}>
                  <View style={styles.verifiedBadge}>
                    <Ionicons name="checkmark-circle" size={12} color="#10B981" />
                    <Text style={styles.verifiedText}>Verified</Text>
                  </View>
                </View>
              )}
            </View>

            {!climbing ? (
              /* Default state: glance + two actions. Verify Height lives in
                 View Details only now — this card is just the quick-glance view. */
              <View style={styles.actionRow}>
                <TouchableOpacity
                  style={styles.startBtn}
                  onPress={() => setTrackerVisible(true)}
                  activeOpacity={0.8}
                >
                  <Ionicons name="footsteps-outline" size={16} color="#FFF" />
                  <Text style={styles.startBtnText}>Start Climb</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.detailsBtn, isDark && { backgroundColor: 'rgba(37,99,235,0.18)' }]}
                  onPress={() => onViewDetails?.(block)}
                  activeOpacity={0.8}
                >
                  <Text style={styles.detailsBtnText}>View Details</Text>
                  <Ionicons name="chevron-forward" size={14} color="#2563EB" />
                </TouchableOpacity>
              </View>
            ) : (
              /* Expanded logging panel — only shown once you've committed to Start Climb */
              <View style={[styles.logPanel, isDark && { borderTopColor: '#374151' }]}>
                <View style={styles.qtyRow}>
                  <TouchableOpacity onPress={() => setClimbQty(Math.max(1, climbQty - 1))} activeOpacity={0.7}>
                    <Text style={[styles.qtyBtn, isDark && { backgroundColor: '#374151', color: '#F9FAFB' }]}>−</Text>
                  </TouchableOpacity>
                  <Text style={[styles.qtyValue, isDark && { color: '#F9FAFB' }]}>{climbQty}</Text>
                  <TouchableOpacity onPress={() => setClimbQty(climbQty + 1)} activeOpacity={0.7}>
                    <Text style={[styles.qtyBtn, isDark && { backgroundColor: '#374151', color: '#F9FAFB' }]}>+</Text>
                  </TouchableOpacity>
                  <Text style={[styles.qtyLabel, isDark && { color: '#D1D5DB' }]}>full sets</Text>
                </View>

                <View style={styles.partialRow}>
                  <TouchableOpacity
                    onPress={() => setPartialFloors(Math.max(0, partialFloors - 1))}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.partialBtn, isDark && { backgroundColor: '#374151', color: '#F9FAFB' }]}>−</Text>
                  </TouchableOpacity>
                  <Text style={[styles.partialValue, isDark && { color: '#F9FAFB' }]}>{partialFloors}</Text>
                  <TouchableOpacity
                    onPress={() => setPartialFloors(Math.min(block.storeys - 1, partialFloors + 1))}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.partialBtn, isDark && { backgroundColor: '#374151', color: '#F9FAFB' }]}>+</Text>
                  </TouchableOpacity>
                  <Text style={styles.partialLabel}>+ partial floors last set</Text>
                </View>

                <Text style={[styles.totalPreview, isDark && { color: '#F9FAFB' }]}>
                  Total: {climbQty * block.storeys + partialFloors} floors
                  {' '}(~{Math.round((climbQty * block.storeys + partialFloors) * 2.8)}m)
                </Text>

                <View style={styles.actionRow}>
                  <TouchableOpacity
                    style={[styles.cancelBtn, isDark && { backgroundColor: '#374151' }]}
                    onPress={() => { setClimbing(false); setClimbQty(1); setPartialFloors(0); }}
                    activeOpacity={0.8}
                    disabled={justLogged}
                  >
                    <Text style={[styles.cancelBtnText, isDark && { color: '#D1D5DB' }]}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.startBtn, justLogged && styles.startBtnConfirmed]}
                    onPress={handleConfirmClimb}
                    activeOpacity={0.8}
                    disabled={justLogged}
                  >
                    {justLogged ? (
                      <View style={styles.logBtnConfirmedRow}>
                        <Ionicons name="checkmark-circle" size={16} color="#FFF" />
                        <Text style={styles.startBtnText}>Logged!</Text>
                      </View>
                    ) : (
                      <Text style={styles.startBtnText}>Confirm Climb</Text>
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </View>
        </View>
      </View>

      <ClimbTrackerModal
        block={block}
        visible={trackerVisible}
        onClose={() => setTrackerVisible(false)}
        onSave={handleTrackerSave}
        onUseManualEntry={() => setClimbing(true)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { ...StyleSheet.absoluteFill, zIndex: 20 },
  cardWrapper: {
    position: 'absolute',
    left: 24,
    right: 24,
    alignItems: 'center',
  },
  card: {
    width: '100%',
    maxWidth: 320,
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderRadius: 20,
    overflow: 'hidden',
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.2, shadowRadius: 16 },
      android: { elevation: 12 },
    }),
  },
  content: { padding: 14 },
  topRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  storeyBadge: {
    marginRight: 12,
    alignItems: 'center',
    justifyContent: 'center',
    width: 64,
    height: 64,
    borderRadius: 32,
  },
  storeyValue: { fontSize: 24, fontWeight: '800', lineHeight: 26 },
  storeyLabel: { fontSize: 10, color: '#9CA3AF', marginTop: 1, letterSpacing: 0.5 },
  addressBlock: { flex: 1 },
  addressRow: { flexDirection: 'row', alignItems: 'center' },
  address: { fontSize: 14, fontWeight: '700', color: '#111827', flex: 1 },
  street: { fontSize: 12, color: '#6B7280', marginTop: 1 },
  town: { fontSize: 12, color: '#9CA3AF', marginTop: 1 },
  statsRow: { flexDirection: 'row', marginBottom: 12, flexWrap: 'wrap' },
  stat: { marginRight: 16 },
  statValue: { fontSize: 13, fontWeight: '700', color: '#111827' },
  statLabel: { fontSize: 9, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 1 },
  verifiedStat: { justifyContent: 'center' },
  verifiedBadge: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  verifiedText: { fontSize: 10, fontWeight: '700', color: '#10B981' },
  logPanel: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#E5E7EB',
    paddingTop: 12,
    marginTop: 2,
  },
  qtyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
    gap: 8,
  },
  qtyBtn: {
    fontSize: 22,
    fontWeight: '700',
    color: '#374151',
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#F3F4F6',
    textAlign: 'center',
    lineHeight: 32,
    overflow: 'hidden',
  },
  qtyValue: {
    fontSize: 20,
    fontWeight: '700',
    color: '#111827',
    minWidth: 30,
    textAlign: 'center',
  },
  qtyLabel: {
    fontSize: 13,
    color: '#6B7280',
    fontWeight: '500',
    marginLeft: 2,
  },
  partialRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
    gap: 6,
  },
  partialBtn: {
    fontSize: 16,
    fontWeight: '700',
    color: '#6B7280',
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#F3F4F6',
    textAlign: 'center',
    lineHeight: 24,
    overflow: 'hidden',
  },
  partialValue: {
    fontSize: 15,
    fontWeight: '700',
    color: '#374151',
    minWidth: 20,
    textAlign: 'center',
  },
  partialLabel: {
    fontSize: 11,
    color: '#9CA3AF',
    fontWeight: '500',
    marginLeft: 2,
  },
  totalPreview: {
    fontSize: 12,
    fontWeight: '600',
    color: '#111827',
    textAlign: 'center',
    marginBottom: 10,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 8,
  },
  startBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#10B981',
    borderRadius: 12,
    paddingVertical: 10,
  },
  startBtnConfirmed: {
    backgroundColor: '#059669',
  },
  logBtnConfirmedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  startBtnText: { fontSize: 14, fontWeight: '700', color: '#FFF' },
  cancelBtn: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#6B7280',
  },
  detailsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: '#EFF6FF',
  },
  detailsBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#2563EB',
  },
});
