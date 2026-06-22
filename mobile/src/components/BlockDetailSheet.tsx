import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import * as Linking from 'expo-linking';
import type { Block } from '../types';

interface Props {
  block: Block | null;
  distanceKm: number | null;
  onClose: () => void;
  onLogClimb?: (block: Block) => void;
  tapY?: number;
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

function formatYear(year: number | null): string {
  if (year == null) return '--';
  return String(year);
}

export default function BlockDetailSheet({ block, distanceKm, onClose, onLogClimb, tapY }: Props) {
  if (!block) return null;

  const tier = getTier(block.storeys);

  const handleDirections = () => {
    if (block.lat != null && block.lng != null) {
      Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${block.lat},${block.lng}`);
    }
  };

  const handleLogClimb = () => {
    onLogClimb?.(block);
  };

  return (
    <View style={styles.container}>
      {/* Invisible backdrop — tap to dismiss */}
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />

      {/* Card — positioned near the tapped pin */}
      <View style={[
        styles.cardWrapper,
        tapY != null && tapY > 0
          ? { top: Math.max(80, tapY - 160) }
          : { top: '30%' },
      ]}>
        <View style={styles.card}>
          {/* Colored header strip — 4px */}
          <View style={[styles.headerStrip, { backgroundColor: tier.color }]} />

          {/* Content */}
          <View style={styles.content}>
            {/* Row 1: Storeys (big) + address */}
            <View style={styles.topRow}>
              <View style={styles.storeyBadge}>
                <Text style={[styles.storeyValue, { color: tier.color }]}>{block.storeys}</Text>
                <Text style={styles.storeyLabel}>STOREYS</Text>
              </View>
              <View style={styles.addressBlock}>
                <Text style={styles.address} numberOfLines={1}>Blk {block.blk_no}</Text>
                <Text style={styles.street} numberOfLines={1}>{block.street}</Text>
                {block.town && <Text style={styles.town} numberOfLines={1}>{block.town}</Text>}
              </View>
            </View>

            {/* Row 2: Quick stats */}
            <View style={styles.statsRow}>
              <View style={styles.stat}>
                <Text style={styles.statValue}>{block.est_height_m}m</Text>
                <Text style={styles.statLabel}>Height</Text>
              </View>
              <View style={styles.stat}>
                <Text style={styles.statValue}>{formatDistance(distanceKm)}</Text>
                <Text style={styles.statLabel}>Away</Text>
              </View>
              <View style={styles.stat}>
                <Text style={styles.statValue}>{formatYear(block.year_completed)}</Text>
                <Text style={styles.statLabel}>Year</Text>
              </View>
            </View>

            {/* Actions row */}
            <View style={styles.actionsRow}>
              <TouchableOpacity
                style={styles.logBtn}
                onPress={handleLogClimb}
                activeOpacity={0.8}
              >
                <Text style={styles.logBtnText}>Log Climb</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.dirBtn}
                onPress={handleDirections}
                activeOpacity={0.8}
              >
                <Text style={styles.dirBtnText}>Directions</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { ...StyleSheet.absoluteFill, zIndex: 20 },
  backdrop: { ...StyleSheet.absoluteFill },
  cardWrapper: {
    position: 'absolute',
    left: 24,
    right: 24,
    alignItems: 'center',
  },
  card: {
    width: '100%',
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderRadius: 20,
    overflow: 'hidden',
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.2, shadowRadius: 16 },
      android: { elevation: 12 },
    }),
  },
  headerStrip: { height: 4, width: '100%' },
  content: { paddingHorizontal: 16, paddingVertical: 14 },
  topRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  storeyBadge: {
    backgroundColor: 'transparent',
    marginRight: 12,
    alignItems: 'center',
  },
  storeyValue: { fontSize: 34, fontWeight: '800', lineHeight: 36 },
  storeyLabel: { fontSize: 10, color: '#9CA3AF', marginTop: 1, letterSpacing: 0.5 },
  addressBlock: { flex: 1 },
  address: { fontSize: 15, fontWeight: '700', color: '#111827' },
  street: { fontSize: 13, color: '#6B7280', marginTop: 1 },
  town: { fontSize: 12, color: '#9CA3AF', marginTop: 1 },
  statsRow: { flexDirection: 'row', marginBottom: 12 },
  stat: { marginRight: 20 },
  statValue: { fontSize: 14, fontWeight: '700', color: '#111827' },
  statLabel: { fontSize: 10, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 1 },
  actionsRow: { flexDirection: 'row', gap: 8 },
  logBtn: {
    flex: 1, backgroundColor: '#10B981', borderRadius: 12,
    paddingVertical: 10, alignItems: 'center',
  },
  logBtnText: { fontSize: 13, fontWeight: '700', color: '#FFF' },
  dirBtn: {
    flex: 1, backgroundColor: '#2563EB', borderRadius: 12,
    paddingVertical: 10, alignItems: 'center',
  },
  dirBtnText: { fontSize: 13, fontWeight: '700', color: '#FFF' },
});
