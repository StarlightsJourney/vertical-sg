import { useState } from 'react';
import { View, Image, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Path, Circle, Polygon, Defs, LinearGradient as SvgGradient, Stop } from 'react-native-svg';
import { wikimediaThumb } from '../utils/wikimediaThumb';

export type SceneryVariant = 'mountains' | 'skyline' | 'sunrise';

interface Props {
  variant: SceneryVariant;
  height?: number;
  borderRadius?: number;
  children?: React.ReactNode;
  /** Real photo URL (e.g. an openly-licensed Wikimedia Commons image) to use instead of the illustrated scene, when one exists for this specific place. Falls back to the vector illustration below if it fails to load. */
  photoUri?: string;
}

// Cover "photo" banner. When a real photoUri is given (a specific, real
// place — e.g. Bukit Timah Nature Reserve), that photo is used, with a dark
// gradient scrim for text legibility and a fallback to the illustration
// below if the remote image fails to load. Without a photoUri, falls back
// to a layered LinearGradient sky + hand-drawn SVG silhouette scene
// (react-native-svg) — not a real photograph, just a generic stand-in used
// where no specific real place applies (e.g. CTA banners, special-challenge
// cards).
export default function SceneryBanner({ variant, height = 150, borderRadius = 18, children, photoUri }: Props) {
  const [photoFailed, setPhotoFailed] = useState(false);
  const showPhoto = !!photoUri && !photoFailed;

  return (
    <View style={[styles.wrap, { height, borderRadius }]}>
      {showPhoto ? (
        <>
          <Image source={{ uri: wikimediaThumb(photoUri!, 960) }} style={StyleSheet.absoluteFill} resizeMode="cover" onError={() => setPhotoFailed(true)} />
          <LinearGradient colors={['rgba(0,0,0,0.05)', 'rgba(0,0,0,0.45)']} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }} style={StyleSheet.absoluteFill} />
        </>
      ) : (
        <>
      <LinearGradient colors={gradientFor(variant)} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }} style={StyleSheet.absoluteFill} />
      <Svg width="100%" height="100%" viewBox="0 0 400 150" preserveAspectRatio="xMidYMax slice" style={StyleSheet.absoluteFill}>
        <Defs>
          <SvgGradient id="peakShade" x1="0%" y1="0%" x2="0%" y2="100%">
            <Stop offset="0%" stopColor="#FFFFFF" stopOpacity={0.28} />
            <Stop offset="100%" stopColor="#FFFFFF" stopOpacity={0.06} />
          </SvgGradient>
        </Defs>
        {variant === 'mountains' && (
          <>
            <Circle cx={320} cy={38} r={22} fill="#FDE68A" opacity={0.9} />
            <Polygon points="0,150 70,60 130,110 190,40 260,110 320,55 400,120 400,150" fill="#0F172A" opacity={0.55} />
            <Polygon points="0,150 90,85 160,130 240,70 400,150" fill="url(#peakShade)" />
            <Polygon points="60,150 130,95 180,150" fill="#F8FAFC" opacity={0.85} />
            <Polygon points="220,150 260,100 300,150" fill="#F8FAFC" opacity={0.75} />
          </>
        )}
        {variant === 'skyline' && (
          <>
            <Circle cx={340} cy={30} r={16} fill="#FDE68A" opacity={0.85} />
            {[
              [10, 60, 34], [50, 40, 30], [86, 70, 26], [118, 25, 36],
              [160, 55, 28], [194, 15, 34], [234, 65, 30], [270, 35, 32],
              [308, 58, 26], [340, 20, 34], [378, 62, 22],
            ].map(([x, y, w], i) => (
              <Polygon key={i} points={`${x},150 ${x},${y} ${x + w},${y} ${x + w},150`} fill="#0F172A" opacity={0.5 + (i % 3) * 0.08} />
            ))}
          </>
        )}
        {variant === 'sunrise' && (
          <>
            <Circle cx={200} cy={95} r={40} fill="#FEF3C7" opacity={0.85} />
            <Path d="M0,120 C 60,90 120,140 180,110 C 240,80 300,130 400,100 L400,150 L0,150 Z" fill="#0F172A" opacity={0.4} />
            <Path d="M0,140 C 80,120 160,150 240,125 C 300,108 350,135 400,120 L400,150 L0,150 Z" fill="#0F172A" opacity={0.6} />
          </>
        )}
      </Svg>
        </>
      )}
      {children}
    </View>
  );
}

function gradientFor(variant: SceneryVariant): [string, string, ...string[]] {
  if (variant === 'mountains') return ['#1E3A5F', '#4A7BA6', '#8FB8D9'];
  if (variant === 'skyline') return ['#0F1E3D', '#2D3E6B', '#5B6FA8'];
  return ['#F97316', '#FB923C', '#FDE68A'];
}

const styles = StyleSheet.create({
  wrap: { overflow: 'hidden', position: 'relative' },
});
