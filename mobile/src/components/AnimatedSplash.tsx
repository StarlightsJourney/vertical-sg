import { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';

interface AnimatedSplashProps {
  onFinish: () => void;
}

const TIERS = ['#4A90D9', '#FF9500', '#FF3B30', '#8B0000', '#7C3AED'];

/**
 * Animated loading screen — 5 colored bars ascend like stair steps,
 * the app name fades in, then everything fades out to the main screen.
 * Total duration: ~2s. No external image dependency.
 */
export default function AnimatedSplash({ onFinish }: AnimatedSplashProps) {
  const fadeOut = useRef(new Animated.Value(1)).current;
  const titleOpacity = useRef(new Animated.Value(0)).current;
  const barHeights = useRef(TIERS.map(() => new Animated.Value(0))).current;

  useEffect(() => {
    // Stagger the bars rising upward
    const barAnimations = barHeights.map((bar, i) =>
      Animated.timing(bar, {
        toValue: 1,
        duration: 600,
        delay: i * 120,
        useNativeDriver: false,
      }),
    );

    Animated.sequence([
      // Phase 1: bars rise in sequence
      Animated.parallel(barAnimations),
      // Phase 2: title fades in
      Animated.timing(titleOpacity, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }),
      // Phase 3: hold
      Animated.delay(500),
      // Phase 4: everything fades out
      Animated.timing(fadeOut, {
        toValue: 0,
        duration: 400,
        useNativeDriver: true,
      }),
    ]).start(onFinish);
  }, []);

  return (
    <Animated.View style={[styles.container, { opacity: fadeOut }]}>
      {/* Stair bars */}
      <View style={styles.barsRow}>
        {TIERS.map((color, i) => (
          <Animated.View
            key={color}
            style={[
              styles.bar,
              {
                backgroundColor: color,
                height: barHeights[i].interpolate({
                  inputRange: [0, 1],
                  outputRange: [4, 80 + i * 16],
                }),
              },
            ]}
          />
        ))}
      </View>

      {/* App name */}
      <Animated.View style={[styles.titleWrap, { opacity: titleOpacity }]}>
        <Text style={styles.title}>Vertical</Text>
        <Text style={styles.subtitle}>Find your next climb</Text>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFill,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 999,
  },
  barsRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    marginBottom: 32,
    height: 120,
  },
  bar: {
    width: 28,
    borderRadius: 4,
  },
  titleWrap: {
    alignItems: 'center',
  },
  title: {
    fontSize: 32,
    fontWeight: '800',
    color: '#111827',
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 14,
    color: '#6B7280',
    marginTop: 4,
    fontWeight: '500',
  },
});
