import { View, Text, Modal, TouchableOpacity, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import type { BadgeDef } from '../types';

interface Props {
  badge: BadgeDef | null;
  earned: boolean;
  earnedAt?: string;
  isFeatured?: boolean;
  /** Omit to hide the "set as featured" action (e.g. viewing someone else's profile) */
  onSetFeatured?: () => void;
  onClose: () => void;
}

export default function BadgeDetailModal({ badge, earned, earnedAt, isFeatured, onSetFeatured, onClose }: Props) {
  if (!badge) return null;
  const isMystery = badge.hidden && !earned;

  return (
    <Modal visible={!!badge} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity style={styles.card} activeOpacity={1}>
          <View style={[styles.iconCircle, earned && styles.iconCircleEarned]}>
            <Ionicons
              name={isMystery ? 'help-outline' : (badge.icon as any)}
              size={36}
              color={earned ? '#60A5FA' : '#D1D5DB'}
            />
          </View>

          <Text style={styles.name}>{isMystery ? '???' : badge.name}</Text>

          {earned ? (
            <>
              <View style={styles.earnedPill}>
                <Ionicons name="checkmark-circle" size={14} color="#10B981" />
                <Text style={styles.earnedPillText}>
                  Achieved{earnedAt ? ` on ${new Date(earnedAt).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}` : ''}
                </Text>
              </View>
              <Text style={styles.desc}>{badge.description}</Text>
              {onSetFeatured && (
                <TouchableOpacity
                  style={[styles.featureBtn, isFeatured && styles.featureBtnActive]}
                  onPress={onSetFeatured}
                >
                  <Ionicons name={isFeatured ? 'star' : 'star-outline'} size={16} color={isFeatured ? '#FFF' : '#F59E0B'} />
                  <Text style={[styles.featureBtnText, isFeatured && { color: '#FFF' }]}>
                    {isFeatured ? 'Featured next to your name' : 'Feature next to your name'}
                  </Text>
                </TouchableOpacity>
              )}
            </>
          ) : (
            <>
              <Text style={styles.lockedLabel}>Not yet earned</Text>
              <Text style={styles.desc}>
                {isMystery ? 'A hidden badge — you\'ll find out how when you earn it.' : `How to earn it: ${badge.description}`}
              </Text>
            </>
          )}

          <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
            <Text style={styles.closeBtnText}>Close</Text>
          </TouchableOpacity>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', padding: 32 },
  card: { backgroundColor: '#FFFFFF', borderRadius: 20, padding: 24, width: '100%', maxWidth: 340, alignItems: 'center' },
  iconCircle: { width: 72, height: 72, borderRadius: 36, backgroundColor: '#F3F4F6', alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  iconCircleEarned: { backgroundColor: '#EFF6FF' },
  name: { fontSize: 19, fontWeight: '800', color: '#111827', marginBottom: 8, textAlign: 'center' },
  earnedPill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: 'rgba(16,185,129,0.1)', paddingVertical: 5, paddingHorizontal: 12, borderRadius: 12, marginBottom: 12,
  },
  earnedPillText: { fontSize: 12, fontWeight: '600', color: '#10B981' },
  lockedLabel: { fontSize: 12, fontWeight: '700', color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 },
  desc: { fontSize: 13.5, color: '#6B7280', textAlign: 'center', lineHeight: 19, marginBottom: 18 },
  featureBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    borderWidth: 1.5, borderColor: '#F59E0B', borderRadius: 12, paddingVertical: 10, paddingHorizontal: 16, marginBottom: 8,
  },
  featureBtnActive: { backgroundColor: '#F59E0B' },
  featureBtnText: { fontSize: 13, fontWeight: '700', color: '#F59E0B' },
  closeBtn: { marginTop: 8, paddingVertical: 8 },
  closeBtnText: { fontSize: 13, fontWeight: '600', color: '#9CA3AF' },
});
