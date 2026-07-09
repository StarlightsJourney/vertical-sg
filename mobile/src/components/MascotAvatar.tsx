import { View, Image, StyleSheet } from 'react-native';

interface Props {
  skinIdx: number;
  size?: number;
  /** Real profile photo URL — when set, renders this instead of the illustrated mascot skin. */
  photoUri?: string | null;
}

// Five simple ape/monkey skins — plain View shapes (no SVG/image dependency),
// distinguished by body color and ear/face proportions. Same visual language
// as the onboarding mascot ("Klimber"), just picked as a personal skin.
const SKINS = [
  { body: '#7C3AED', cheek: '#A78BFA', earSize: 14 },   // Violet — the default Klimber
  { body: '#4A90D9', cheek: '#8AB8E8', earSize: 16 },   // Blue — bigger ears
  { body: '#FF9500', cheek: '#FFB84D', earSize: 12 },   // Orange — smaller ears
  { body: '#FF3B30', cheek: '#FF7A70', earSize: 14 },   // Red
  { body: '#10B981', cheek: '#5EEAB8', earSize: 15 },   // Green
];

export default function MascotAvatar({ skinIdx, size = 64, photoUri }: Props) {
  if (photoUri) {
    return <Image source={{ uri: photoUri }} style={{ width: size, height: size, borderRadius: size / 2 }} />;
  }

  const skin = SKINS[skinIdx % SKINS.length];
  const scale = size / 64;

  return (
    <View style={[styles.wrap, { width: size, height: size }]}>
      {/* Ears */}
      <View style={[
        styles.ear, styles.earLeft,
        { width: skin.earSize * scale, height: skin.earSize * scale, borderRadius: (skin.earSize * scale) / 2, backgroundColor: skin.body },
      ]} />
      <View style={[
        styles.ear, styles.earRight,
        { width: skin.earSize * scale, height: skin.earSize * scale, borderRadius: (skin.earSize * scale) / 2, backgroundColor: skin.body },
      ]} />
      {/* Face */}
      <View style={[styles.face, { width: size * 0.82, height: size * 0.82, borderRadius: (size * 0.82) / 2, backgroundColor: skin.body }]}>
        <View style={[styles.cheek, { left: size * 0.1, width: size * 0.16, height: size * 0.11, borderRadius: size * 0.08, backgroundColor: skin.cheek }]} />
        <View style={[styles.cheek, { right: size * 0.1, width: size * 0.16, height: size * 0.11, borderRadius: size * 0.08, backgroundColor: skin.cheek }]} />
        <View style={styles.eyesRow}>
          <View style={[styles.eye, { width: size * 0.1, height: size * 0.1, borderRadius: size * 0.05 }]} />
          <View style={[styles.eye, { width: size * 0.1, height: size * 0.1, borderRadius: size * 0.05 }]} />
        </View>
        <View style={[styles.smile, { width: size * 0.28, height: size * 0.14, borderBottomLeftRadius: size * 0.14, borderBottomRightRadius: size * 0.14 }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center' },
  ear: { position: 'absolute', top: '8%' },
  earLeft: { left: '2%' },
  earRight: { right: '2%' },
  face: { alignItems: 'center', justifyContent: 'center' },
  cheek: { position: 'absolute', top: '46%', opacity: 0.6 },
  eyesRow: { flexDirection: 'row', gap: 10, marginBottom: 6 },
  eye: { backgroundColor: '#12161A' },
  smile: { borderWidth: 2, borderColor: '#12161A', borderTopWidth: 0, backgroundColor: 'transparent' },
});
