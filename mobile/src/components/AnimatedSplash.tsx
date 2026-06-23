import { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';

interface AnimatedSplashProps {
  onFinish: () => void;
}

const TIERS = ['#4A90D9', '#FF9500', '#FF3B30', '#8B0000', '#7C3AED'];

export default function AnimatedSplash({ onFinish }: AnimatedSplashProps) {
  const fadeOut = useRef(new Animated.Value(1)).current;
  const titleOpacity = useRef(new Animated.Value(0)).current;

  // Each bar scales up from the bottom using transform (native-driver friendly)
  const barScales = useRef(TIERS.map(() => new Animated.Value(0.05))).current;

  useEffect(() => {
    Animated.sequence([
      // Bars rise in sequence using native driver (transform, not height)
      Animated.parallel(
        barScales.map((bar, i) =>
          Animated.spring(bar, {
            toValue: 1,
            friction: 6,
            tension: 60,
            delay: i * 80,
            useNativeDriver: true,
          }),
        ),
      ),
      // Title fades in
      Animated.timing(titleOpacity, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }),
      // Hold
      Animated.delay(500),
      // Everything fades out
      Animated.timing(fadeOut, {
        toValue: 0,
        duration: 400,
        useNativeDriver: true,
      }),
    ]).start(onFinish);
  }, []);

  return (
    <Animated.View style={[styles.container, { opacity: fadeOut }]}>
      {/* Stair bars — animated with scaleY from bottom */}
      <View style={styles.barsRow}>
        {TIERS.map((color, i) => (
          <View key={color} style={styles.barWrap}>
            <Animated.View
              style={[
                styles.bar,
                {
                  backgroundColor: color,
                  transform: [{ scaleY: barScales[i] }],
                },
              ]}
            />
          </View>
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
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
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
    height: 100,
    marginBottom: 28,
  },
  barWrap: {
    width: 28,
    height: 100,
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  bar: {
    width: 28,
    height: 100,
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
