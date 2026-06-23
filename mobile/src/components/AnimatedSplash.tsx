import { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';

interface AnimatedSplashProps {
  onFinish: () => void;
}

const TIERS = ['#4A90D9', '#FF9500', '#FF3B30', '#8B0000', '#7C3AED'];
const BAR_MAX = [48, 72, 96, 120, 144];

/** Animated splash — 5 bars scale up from bottom with native driver (60fps). */
export default function AnimatedSplash({ onFinish }: AnimatedSplashProps) {
  const fadeOut = useRef(new Animated.Value(1)).current;
  const titleOpacity = useRef(new Animated.Value(0)).current;
  // scaleY: 0→1, native-driver compatible, bars grow from bottom
  const scales = useRef(BAR_MAX.map(() => new Animated.Value(0))).current;

  useEffect(() => {
    Animated.sequence([
      Animated.parallel(
        scales.map((s, i) =>
          Animated.timing(s, {
            toValue: 1,
            duration: 400,
            delay: i * 40,
            useNativeDriver: true,
          }),
        ),
      ),
      Animated.timing(titleOpacity, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }),
      Animated.delay(600),
      Animated.timing(fadeOut, {
        toValue: 0,
        duration: 600,
        useNativeDriver: true,
      }),
    ]).start(onFinish);
  }, []);

  return (
    <Animated.View style={[styles.container, { opacity: fadeOut }]}>
      <View style={styles.barsRow}>
        {TIERS.map((color, i) => (
          <View key={color} style={[styles.barWrap, { height: BAR_MAX[i] }]}>
            <Animated.View
              style={[
                styles.bar,
                {
                  backgroundColor: color,
                  transform: [{ scaleY: Animated.add(0.001, scales[i]) }],
                },
              ]}
            />
          </View>
        ))}
      </View>
      <Animated.View style={[styles.titleWrap, { opacity: titleOpacity }]}>
        <Text style={styles.title}>Vertical</Text>
        <Text style={styles.subtitle}>Find your next climb</Text>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 9999,
    elevation: 9999,
  },
  barsRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    marginBottom: 28,
  },
  barWrap: {
    width: 28,
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  bar: {
    width: 28,
    height: 200, // taller than any wrap — clipped by overflow: hidden
    borderRadius: 4,
    transformOrigin: 'bottom',
  },
  titleWrap: { alignItems: 'center' },
  title: { fontSize: 32, fontWeight: '800', color: '#111827', letterSpacing: -0.5 },
  subtitle: { fontSize: 14, color: '#6B7280', marginTop: 4, fontWeight: '500' },
});
