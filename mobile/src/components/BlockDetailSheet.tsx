import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import * as Linking from 'expo-linking';
import type { Block } from '../types';

interface Props {
  block: Block | null;
  distanceKm: number | null;
  onClose: () => void;
}

function getTier(storeys: number) {
  if (storeys <= 10) return { label: 'Low-rise', color: '#4A90D9' };
  if (storeys <= 20) return { label: 'Mid-rise', color: '#FF9500' };
  if (storeys <= 30) return { label: 'High-rise', color: '#FF3B30' };
  return { label: 'Sky-high', color: '#8B0000' };
}

export default function BlockDetailSheet({ block, distanceKm, onClose }: Props) {
  if (!block) return null;

  const tier = getTier(block.storeys);

  const handlePress = () => {
    if (block.lat != null && block.lng != null) {
      Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${block.lat},${block.lng}`);
    }
  };

  return (
    <View style={styles.container}>
      {/* Invisible backdrop — tap to dismiss */}
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />

      {/* Floating card */}
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

        {/* Directions hint */}
        <View style={styles.hint}>
          <Text style={styles.hintText}>Tap for directions</Text>
          <Text style={styles.hintArrow}>›</Text>
        </View>
      </TouchableOpacity>
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
    position: 'absolute',
    top: 60,
    left: 16,
    right: 16,
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
  hintArrow: {
    fontSize: 16,
    color: '#9CA3AF',
    fontWeight: '600',
  },
});
