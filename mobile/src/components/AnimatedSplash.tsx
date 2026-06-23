import { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';

interface AnimatedSplashProps {
  onFinish: () => void;
}

const TIERS = ['#4A90D9', '#FF9500', '#FF3B30', '#8B0000', '#7C3AED'];

/**
 * Animated splash — pin logo + 5 rising bars + app name.
 * White opaque screen, no map UI visible underneath. ~2s total.
 */
export default function AnimatedSplash({ onFinish }: AnimatedSplashProps) {
  const fadeOut = useRef(new Animated.Value(1)).current;
  const logoOpacity = useRef(new Animated.Value(0)).current;
  const titleOpacity = useRef(new Animated.Value(0)).current;
  const barHeights = useRef(TIERS.map(() => new Animated.Value(0))).current;

  useEffect(() => {
    Animated.sequence([
      // Logo fades in
      Animated.timing(logoOpacity, {
        toValue: 1,
        duration: 400,
        useNativeDriver: true,
      }),
      // Bars rise
      Animated.parallel(
        barHeights.map((bar, i) =>
          Animated.timing(bar, {
            toValue: 1,
            duration: 500,
            delay: i * 100,
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
      Animated.delay(400),
      // Fade out
      Animated.timing(fadeOut, {
        toValue: 0,
        duration: 400,
        useNativeDriver: true,
      }),
    ]).start(onFinish);
  }, []);

  return (
    <Animated.View style={[styles.container, { opacity: fadeOut }]}>
      {/* Pin logo */}
      <Animated.Image
        source={require('../../assets/splash-icon.png')}
        style={[styles.logo, { opacity: logoOpacity }]}
        resizeMode="contain"
      />

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
                  outputRange: [4, 64 + i * 12],
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
  logo: {
    width: 160,
    height: 80,
    marginBottom: 24,
  },
  barsRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    marginBottom: 28,
    height: 100,
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
