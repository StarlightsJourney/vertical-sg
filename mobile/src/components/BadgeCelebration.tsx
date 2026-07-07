import { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated, TouchableOpacity } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { BADGE_DEFS } from '../types';

interface Props {
  badgeKeys: string[];
  onDismiss: () => void;
}

/** Pops up briefly right after a climb log reveals a newly-earned badge. */
export default function BadgeCelebration({ badgeKeys, onDismiss }: Props) {
  const slide = useRef(new Animated.Value(-120)).current;

  useEffect(() => {
    Animated.sequence([
      Animated.spring(slide, { toValue: 0, useNativeDriver: true, friction: 7 }),
      Animated.delay(2800),
      Animated.timing(slide, { toValue: -120, duration: 250, useNativeDriver: true }),
    ]).start(onDismiss);
  }, []);

  if (badgeKeys.length === 0) return null;
  const def = BADGE_DEFS.find((b) => b.key === badgeKeys[0]);
  if (!def) return null;

  return (
    <Animated.View style={[styles.wrap, { transform: [{ translateY: slide }] }]} pointerEvents="none">
      <TouchableOpacity style={styles.toast} activeOpacity={1} onPress={onDismiss}>
        <View style={styles.iconCircle}>
          <Ionicons name={def.icon as any} size={22} color="#F59E0B" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>New Badge!</Text>
          <Text style={styles.name}>{def.name}</Text>
        </View>
        {badgeKeys.length > 1 && (
          <View style={styles.extraBadge}>
            <Text style={styles.extraBadgeText}>+{badgeKeys.length - 1}</Text>
          </View>
        )}
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    top: 50,
    left: 16,
    right: 16,
    zIndex: 50,
  },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#111827',
    borderRadius: 16,
    padding: 14,
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
  },
  iconCircle: {
    width: 42, height: 42, borderRadius: 21,
    backgroundColor: 'rgba(245,158,11,0.15)',
    alignItems: 'center', justifyContent: 'center',
  },
  title: { fontSize: 11, fontWeight: '700', color: '#F59E0B', textTransform: 'uppercase', letterSpacing: 0.5 },
  name: { fontSize: 15, fontWeight: '800', color: '#FFFFFF', marginTop: 2 },
  extraBadge: {
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  extraBadgeText: { fontSize: 12, fontWeight: '700', color: '#FFF' },
});
