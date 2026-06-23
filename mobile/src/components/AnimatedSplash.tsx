import { useEffect, useRef } from 'react';
import { View, Image, StyleSheet, Animated } from 'react-native';

interface AnimatedSplashProps {
  onFinish: () => void;
}

/**
 * Animated splash screen — logo fades in + scales up over 1.2s,
 * holds for 0.3s, then fades out over 0.5s. Total ~2s.
 *
 * Best practice: The native splash (app.json → splash) launches
 * instantly on cold start. This animated component picks up after
 * the native splash, creating a seamless branded reveal without
 * any blank white frame.
 */
export default function AnimatedSplash({ onFinish }: AnimatedSplashProps) {
  const opacity = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.85)).current;

  useEffect(() => {
    // Phase 1: fade in + scale up (1.2s)
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: 1200,
        useNativeDriver: true,
      }),
      Animated.spring(scale, {
        toValue: 1,
        friction: 8,
        tension: 40,
        useNativeDriver: true,
      }),
    ]).start(() => {
      // Phase 2: small delay then fade out (0.5s)
      setTimeout(() => {
        Animated.timing(opacity, {
          toValue: 0,
          duration: 500,
          useNativeDriver: true,
        }).start(onFinish);
      }, 300);
    });
  }, [opacity, scale, onFinish]);

  return (
    <View style={styles.container}>
      <Animated.View style={[styles.logoWrap, { opacity, transform: [{ scale }] }]}>
        <Image
          source={require('../../assets/splash-icon.png')}
          style={styles.logo}
          resizeMode="contain"
        />
      </Animated.View>
    </View>
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
  logoWrap: {
    width: 200,
    height: 200,
    justifyContent: 'center',
    alignItems: 'center',
  },
  logo: {
    width: 180,
    height: 180,
  },
});
