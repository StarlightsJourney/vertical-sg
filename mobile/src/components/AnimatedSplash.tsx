import { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated, Easing } from 'react-native';

interface AnimatedSplashProps {
  onFinish: () => void;
}

const TIERS = ['#4A90D9', '#FF9500', '#FF3B30', '#8B0000', '#7C3AED'];
const BAR_MAX = [48, 72, 96, 120, 144];

export default function AnimatedSplash({ onFinish }: AnimatedSplashProps) {
  const fadeOut = useRef(new Animated.Value(1)).current;
  const titleOpacity = useRef(new Animated.Value(0)).current;
  const barHeights = useRef(BAR_MAX.map(() => new Animated.Value(0))).current;

  useEffect(() => {
    Animated.sequence([
      // Bars rise immediately, tight stagger, smooth ease-out
      Animated.parallel(
        barHeights.map((bar, i) =>
          Animated.timing(bar, {
            toValue: BAR_MAX[i],
            duration: 450,
            delay: i * 50,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: false,
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
      Animated.delay(600),
      // Fade out
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
          <Animated.View
            key={color}
            style={[styles.bar, { backgroundColor: color, height: barHeights[i] }]}
          />
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
    height: 150,
    marginBottom: 28,
  },
  bar: {
    width: 28,
    borderRadius: 4,
  },
  titleWrap: { alignItems: 'center' },
  title: { fontSize: 32, fontWeight: '800', color: '#111827', letterSpacing: -0.5 },
  subtitle: { fontSize: 14, color: '#6B7280', marginTop: 4, fontWeight: '500' },
});
