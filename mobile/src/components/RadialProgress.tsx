import { View, StyleSheet } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

interface Props {
  /** 0–1 fraction complete. Values above 1 are clamped (visually capped, the ring never overdraws). */
  progress: number;
  size?: number;
  strokeWidth?: number;
  color: string;
  trackColor: string;
  /** Centered content — typically a number + tiny label, rendered on top of the ring. */
  children?: React.ReactNode;
}

/** Apple-Watch-style radial progress ring, built on react-native-svg (no chart lib). */
export default function RadialProgress({ progress, size = 92, strokeWidth = 10, color, trackColor, children }: Props) {
  const clamped = Math.max(0, Math.min(1, progress));
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - clamped);
  const center = size / 2;

  return (
    <View style={[styles.wrap, { width: size, height: size }]}>
      <Svg width={size} height={size}>
        <Circle
          cx={center}
          cy={center}
          r={radius}
          stroke={trackColor}
          strokeWidth={strokeWidth}
          fill="none"
        />
        <Circle
          cx={center}
          cy={center}
          r={radius}
          stroke={color}
          strokeWidth={strokeWidth}
          fill="none"
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={dashOffset}
          strokeLinecap="round"
          // Start the arc at 12 o'clock instead of svg's default 3 o'clock.
          rotation={-90}
          origin={`${center}, ${center}`}
        />
      </Svg>
      <View style={styles.center} pointerEvents="none">
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center' },
  center: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
});
