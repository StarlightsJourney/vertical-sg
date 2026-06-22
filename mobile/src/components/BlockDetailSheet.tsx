import { View, Text, Modal, TouchableOpacity, StyleSheet, Platform, ScrollView } from 'react-native';
import * as Linking from 'expo-linking';
import type { Block } from '../types';

const BOTTOM_INSET = Platform.OS === 'android' ? 32 : 0;

interface Props {
  block: Block | null;
  distanceKm: number | null;
  onClose: () => void;
  visible: boolean;
}

function getTier(storeys: number) {
  if (storeys <= 10) return { label: 'Low-rise', color: '#4A90D9', bg: '#EFF6FF' };
  if (storeys <= 20) return { label: 'Mid-rise', color: '#FF9500', bg: '#FFF7ED' };
  if (storeys <= 30) return { label: 'High-rise', color: '#FF3B30', bg: '#FEF2F2' };
  return { label: 'Sky-high', color: '#8B0000', bg: '#FEF2F2' };
}

export default function BlockDetailSheet({ block, distanceKm, onClose, visible }: Props) {
  if (!block) return null;

  const tier = getTier(block.storeys);

  const handleDirections = () => {
    if (block.lat != null && block.lng != null) {
      Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${block.lat},${block.lng}`);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <TouchableOpacity style={styles.backdropTouch} activeOpacity={1} onPress={onClose} />
        <View style={styles.sheet}>
          <ScrollView style={styles.scroll} bounces={false} showsVerticalScrollIndicator={false}>
            {/* Drag handle */}
            <View style={styles.handle} />

            {/* Height badge — most important info */}
            <View style={[styles.heightBadge, { backgroundColor: tier.bg, borderColor: tier.color }]}>
              <Text style={[styles.heightValue, { color: tier.color }]}>{block.storeys}</Text>
              <Text style={styles.heightUnit}>storeys</Text>
              <Text style={[styles.heightTag, { color: tier.color }]}>{tier.label}</Text>
            </View>

            {/* Address */}
            <Text style={styles.address}>Blk {block.blk_no}</Text>
            <Text style={styles.street}>{block.street}</Text>
            {block.town && <Text style={styles.town}>{block.town}</Text>}

            {/* Quick stats */}
            <View style={styles.stats}>
              <View style={styles.stat}>
                <Text style={styles.statValue}>{block.est_height_m}m</Text>
                <Text style={styles.statLabel}>Height</Text>
              </View>
              {distanceKm != null && (
                <View style={styles.stat}>
                  <Text style={styles.statValue}>
                    {distanceKm < 1 ? `${Math.round(distanceKm * 1000)}m` : `${distanceKm.toFixed(1)}km`}
                  </Text>
                  <Text style={styles.statLabel}>Away</Text>
                </View>
              )}
              {block.year_completed && (
                <View style={styles.stat}>
                  <Text style={styles.statValue}>{block.year_completed}</Text>
                  <Text style={styles.statLabel}>Built</Text>
                </View>
              )}
            </View>

            {/* Directions button */}
            {block.lat != null && block.lng != null ? (
              <TouchableOpacity style={styles.directionsBtn} onPress={handleDirections} activeOpacity={0.8}>
                <Text style={styles.directionsText}>Get Directions</Text>
                <Text style={styles.directionsSub}>Open in Google Maps</Text>
              </TouchableOpacity>
            ) : (
              <Text style={styles.noLocation}>Location unavailable</Text>
            )}

            {/* Close */}
            <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
              <Text style={styles.closeBtnText}>Close</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  backdropTouch: { flex: 1 },
  sheet: {
    maxHeight: '55%',
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    ...Platform.select({ ios: { shadowColor: '#000', shadowOffset: { width: 0, height: -4 }, shadowOpacity: 0.12, shadowRadius: 12 }, android: { elevation: 16 } }),
  },
  scroll: { paddingHorizontal: 24, paddingBottom: 24 + BOTTOM_INSET },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: '#E5E7EB', alignSelf: 'center', marginTop: 12, marginBottom: 20 },

  heightBadge: {
    flexDirection: 'row', alignItems: 'baseline', alignSelf: 'flex-start',
    paddingHorizontal: 16, paddingVertical: 12, borderRadius: 16,
    borderWidth: 2, marginBottom: 16,
  },
  heightValue: { fontSize: 42, fontWeight: '800', lineHeight: 46 },
  heightUnit: { fontSize: 14, color: '#6B7280', marginLeft: 6, fontWeight: '500' },
  heightTag: { fontSize: 13, fontWeight: '700', marginLeft: 12, textTransform: 'uppercase', letterSpacing: 0.5 },

  address: { fontSize: 22, fontWeight: '700', color: '#111827', lineHeight: 28 },
  street: { fontSize: 16, color: '#374151', marginTop: 2 },
  town: { fontSize: 14, color: '#9CA3AF', marginTop: 4, marginBottom: 4 },

  stats: { flexDirection: 'row', marginTop: 20, marginBottom: 8, gap: 24 },
  stat: {},
  statValue: { fontSize: 18, fontWeight: '700', color: '#111827' },
  statLabel: { fontSize: 12, color: '#9CA3AF', marginTop: 2, fontWeight: '500', textTransform: 'uppercase', letterSpacing: 0.5 },

  directionsBtn: { backgroundColor: '#2563EB', borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginTop: 20 },
  directionsText: { fontSize: 16, fontWeight: '700', color: '#FFFFFF' },
  directionsSub: { fontSize: 12, color: 'rgba(255,255,255,0.7)', marginTop: 2 },

  noLocation: { fontSize: 14, color: '#9CA3AF', textAlign: 'center', paddingVertical: 24, fontStyle: 'italic' },

  closeBtn: { alignItems: 'center', paddingVertical: 16, marginTop: 4 },
  closeBtnText: { fontSize: 14, color: '#9CA3AF', fontWeight: '600' },
});
