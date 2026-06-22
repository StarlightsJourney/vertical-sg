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
  return { label: 'Super-tall', color: '#7C3AED', bg: '#F5F3FF' };
}

export default function BlockDetailSheet({ block, distanceKm, onClose, onLogClimb, tapY }: Props) {
  if (!block) return null;

  const tier = getTier(block.storeys);

  const handlePress = () => {
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
          ? { justifyContent: 'flex-start', paddingTop: Math.max(60, tapY - 180) }
          : { justifyContent: 'center' },
      ]}>
      <TouchableOpacity style={styles.card} activeOpacity={0.9} onPress={handlePress}>
        {/* Colored header strip */}
        <View style={[styles.header, { backgroundColor: tier.color }]}>
          <View style={styles.headerContent}>
            <Text style={styles.headerTitle}>Blk {block.blk_no}</Text>
            <Text style={styles.headerSubtitle} numberOfLines={1}>{block.street}</Text>
            {block.town && <Text style={styles.headerTown}>{block.town}</Text>}
          </View>
          {/* Storey count badge */}
          <View style={styles.storeyBadge}>
            <Text style={styles.storeyValue}>{block.storeys}</Text>
            <Text style={styles.storeyLabel}>floors</Text>
          </View>
        </View>

        {/* Info row */}
        <View style={styles.infoRow}>
          <View style={styles.infoItem}>
            <Text style={styles.infoValue}>{block.est_height_m}m</Text>
            <Text style={styles.infoLabel}>Height</Text>
          </View>
          {distanceKm != null && (
            <View style={styles.infoItem}>
              <Text style={styles.infoValue}>
                {distanceKm < 1 ? `${Math.round(distanceKm * 1000)}m` : `${distanceKm.toFixed(1)}km`}
              </Text>
              <Text style={styles.infoLabel}>Away</Text>
            </View>
          )}
          <View style={styles.infoItem}>
            <Text style={styles.infoValue}>{tier.label}</Text>
            <Text style={styles.infoLabel}>Tier</Text>
          </View>
        </View>

        {/* Log a Climb button */}
        <TouchableOpacity
          style={[styles.logBtn, { backgroundColor: tier.color }]}
          onPress={handleLogClimb}
          activeOpacity={0.8}
        >
          <Text style={styles.logBtnText}>Log a Climb</Text>
          <Text style={styles.logBtnSub}>+{block.storeys} floors</Text>
        </TouchableOpacity>

        {/* Directions hint */}
        <View style={styles.hint}>
          <Text style={styles.hintText}>Tap for directions</Text>
          <Text style={styles.hintArrow}>›</Text>
        </View>
      </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 20,
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
  },
  card: {
    width: '100%',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    overflow: 'hidden',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.2,
        shadowRadius: 16,
      },
      android: {
        elevation: 12,
      },
    }),
  },
  cardWrapper: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 16,
  },
  headerContent: {
    flex: 1,
    marginRight: 12,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  headerSubtitle: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.85)',
    marginTop: 2,
  },
  headerTown: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.6)',
    marginTop: 2,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  storeyBadge: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 14,
    alignItems: 'center',
    minWidth: 56,
  },
  storeyValue: {
    fontSize: 28,
    fontWeight: '800',
    color: '#FFFFFF',
    lineHeight: 30,
  },
  storeyLabel: {
    fontSize: 10,
    color: 'rgba(255,255,255,0.7)',
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  infoRow: {
    flexDirection: 'row',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#F3F4F6',
  },
  infoItem: {
    marginRight: 28,
  },
  infoValue: {
    fontSize: 15,
    fontWeight: '700',
    color: '#111827',
  },
  infoLabel: {
    fontSize: 11,
    color: '#9CA3AF',
    fontWeight: '500',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 1,
  },
  hint: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#F3F4F6',
  },
  hintText: {
    fontSize: 12,
    color: '#9CA3AF',
    fontWeight: '500',
    marginRight: 4,
  },
  logBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: 16,
    marginTop: 10,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
  },
  logBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  logBtnSub: {
    fontSize: 13,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.85)',
  },
  hintArrow: {
    fontSize: 16,
    color: '#9CA3AF',
    fontWeight: '600',
  },
});
