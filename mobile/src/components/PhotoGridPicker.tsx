import { View, Text, TouchableOpacity, Image, ScrollView, StyleSheet, Alert } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as ImagePicker from 'expo-image-picker';
import { compressToBase64 } from '../utils/compressImage';

const MAX_DEFAULT = 6;

interface Props {
  /** Base64 strings (no data: prefix) for photos picked so far, in order. */
  photos: string[];
  onChange: (next: string[]) => void;
  max?: number;
  isDark?: boolean;
  /** Shown in the empty-state tile when no photos are attached yet. */
  emptyLabel: string;
  /** Empty-state tile reads as "required" (red accent) when true. */
  required?: boolean;
}

/** Shared multi-image picker used by both the climb tracker's post-climb
 * summary and the Social feed composer — up to `max` photos (default 6),
 * addable via camera (one at a time) or library (multi-select up to the
 * remaining slots), each removable via the "x" on its thumbnail. Video is
 * intentionally out of scope here: expo-image-picker can select video, but
 * compressing it needs a native module this app doesn't have yet, and
 * adding one would require another EAS dev-client rebuild (see the
 * react-native-svg/expo-linear-gradient incident) — worth doing as its own
 * scoped change, not folded into this. */
export default function PhotoGridPicker({ photos, onChange, max = MAX_DEFAULT, isDark = false, emptyLabel, required = false }: Props) {
  const remaining = max - photos.length;

  const pickFromCamera = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Access needed', 'Enable camera access in Settings to add a photo.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ quality: 0.8, base64: true });
    const asset = result.assets?.[0];
    if (!result.canceled && asset?.base64 && asset.uri && remaining > 0) {
      onChange([...photos, await compressToBase64(asset.uri, asset.base64)]);
    }
  };

  const pickFromLibrary = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Access needed', 'Enable photo library access in Settings to add photos.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      quality: 0.8,
      base64: true,
      allowsMultipleSelection: remaining > 1,
      selectionLimit: remaining,
    });
    if (!result.canceled && result.assets?.length) {
      const slice = result.assets.slice(0, remaining);
      const picked = await Promise.all(
        slice.map((a) => (a.base64 && a.uri ? compressToBase64(a.uri, a.base64) : Promise.resolve(a.base64 ?? null))),
      );
      onChange([...photos, ...picked.filter((b): b is string => !!b)]);
    }
  };

  const openPicker = () => {
    Alert.alert('Add Photo', '', [
      { text: 'Take Photo', onPress: pickFromCamera },
      { text: 'Choose from Library', onPress: pickFromLibrary },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const removeAt = (idx: number) => onChange(photos.filter((_, i) => i !== idx));

  if (photos.length === 0) {
    return (
      <TouchableOpacity
        style={[styles.emptyBtn, required && styles.emptyBtnRequired, isDark && { backgroundColor: '#111827' }]}
        onPress={openPicker}
      >
        <Ionicons name="camera-outline" size={20} color={required ? '#EF4444' : (isDark ? '#9CA3AF' : '#6B7280')} />
        <Text style={[styles.emptyBtnText, required && styles.emptyBtnTextRequired, isDark && { color: '#D1D5DB' }]}>{emptyLabel}</Text>
      </TouchableOpacity>
    );
  }

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
      {photos.map((b64, i) => (
        <View key={i} style={styles.thumbWrap}>
          <Image source={{ uri: `data:image/jpeg;base64,${b64}` }} style={styles.thumb} />
          <TouchableOpacity style={styles.removeBtn} onPress={() => removeAt(i)} hitSlop={6}>
            <Ionicons name="close" size={12} color="#FFF" />
          </TouchableOpacity>
        </View>
      ))}
      {remaining > 0 && (
        <TouchableOpacity style={[styles.addTile, isDark && { backgroundColor: '#111827' }]} onPress={openPicker}>
          <Ionicons name="add" size={22} color={isDark ? '#9CA3AF' : '#6B7280'} />
        </TouchableOpacity>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  emptyBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: '#F3F4F6', borderRadius: 12, padding: 14, minHeight: 56,
  },
  emptyBtnRequired: { backgroundColor: '#FEF2F2' },
  emptyBtnText: { fontSize: 13, color: '#6B7280', fontWeight: '500' },
  emptyBtnTextRequired: { color: '#EF4444' },
  row: { gap: 8, paddingVertical: 2 },
  thumbWrap: { position: 'relative' },
  thumb: { width: 72, height: 72, borderRadius: 10, backgroundColor: '#E5E7EB' },
  removeBtn: {
    position: 'absolute', top: -6, right: -6, width: 20, height: 20, borderRadius: 10,
    backgroundColor: 'rgba(17,24,39,0.85)', alignItems: 'center', justifyContent: 'center',
  },
  addTile: {
    width: 72, height: 72, borderRadius: 10, backgroundColor: '#F3F4F6',
    alignItems: 'center', justifyContent: 'center',
  },
});
