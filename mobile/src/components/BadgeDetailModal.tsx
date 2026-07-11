import { View, Text, Modal, TouchableOpacity, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import MedalBadge, { medalEmblemFor } from './MedalBadge';
import { medalColorFor } from '../utils/medalColor';
import type { BadgeDef } from '../types';

/** Terse, Strava-style date: "Jul 11, 2026" — no "on", no full month name. */
function formatAchievedDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

interface Props {
  badge: BadgeDef | null;
  earned: boolean;
  earnedAt?: string;
  isFeatured?: boolean;
  /** Omit to hide the "set as featured" action (e.g. viewing someone else's profile) */
  onSetFeatured?: () => void;
  onClose: () => void;
  isDark?: boolean;
}

export default function BadgeDetailModal({ badge, earned, earnedAt, isFeatured, onSetFeatured, onClose, isDark = false }: Props) {
  if (!badge) return null;
  const isMystery = badge.hidden && !earned;

  return (
    <Modal visible={!!badge} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity style={[styles.card, isDark && { backgroundColor: '#1F2937' }]} activeOpacity={1}>
          {/* Same medal the badge shelf shows, so the "logo" is consistent
              when you tap in. Locked/mystery just desaturate + dim it. */}
          <View style={{ marginBottom: 16, opacity: earned ? 1 : 0.4 }}>
            {isMystery ? (
              <View style={[styles.mysteryDisc, isDark && { backgroundColor: '#374151' }]}>
                <Ionicons name="help" size={34} color="#9CA3AF" />
              </View>
            ) : (
              <MedalBadge
                color={earned ? medalColorFor(badge) : '#B0B7C3'}
                emblem={medalEmblemFor(badge.icon, badge.key, badge.resets === 'monthly')}
                iconName={badge.icon}
                size={72}
              />
            )}
          </View>

          <Text style={[styles.name, isDark && { color: '#F9FAFB' }]}>{isMystery ? '???' : badge.name}</Text>

          {earned ? (
            <>
              <View style={styles.earnedPill}>
                <Ionicons name="checkmark-circle" size={14} color="#10B981" />
                <Text style={styles.earnedPillText}>
                  {earnedAt ? formatAchievedDate(earnedAt) : 'Achieved'}
                </Text>
              </View>
              <Text style={[styles.desc, isDark && { color: '#9CA3AF' }]}>{badge.description}</Text>
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
              <Text style={[styles.desc, isDark && { color: '#9CA3AF' }]}>
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
  mysteryDisc: { width: 72, height: 72, borderRadius: 36, backgroundColor: '#F3F4F6', alignItems: 'center', justifyContent: 'center' },
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
