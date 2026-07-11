import { useState } from 'react';
import { View, Image, ScrollView, Text, StyleSheet, Dimensions, NativeSyntheticEvent, NativeScrollEvent } from 'react-native';
import { supabase } from '../config/supabase';

const SCREEN_WIDTH = Dimensions.get('window').width;

interface Props {
  /** Storage paths (bucket "building-photos"), in display order. */
  paths: string[];
  height?: number;
  borderRadius?: number;
  /** Width of each page — defaults to the screen width minus the caller's
   * horizontal padding (32 = 16 on each side, matching every screen that
   * uses this so far). Pass an explicit value if a card uses different
   * padding. */
  width?: number;
}

/** Instagram-style photo post: a single full-width image when there's just
 * one, or a horizontal snap-scrolling gallery with a "n / total" counter
 * pill when there are more (up to 6, enforced where photos are picked —
 * see PhotoGridPicker.tsx). Used anywhere a climbs.photo_paths gallery is
 * rendered — the feed, and a user's public profile posts. */
export default function PhotoGallery({ paths, height = 180, borderRadius = 12, width = SCREEN_WIDTH - 32 }: Props) {
  const [page, setPage] = useState(0);

  if (paths.length === 0) return null;

  const urlFor = (path: string) => supabase.storage.from('building-photos').getPublicUrl(path).data.publicUrl;

  if (paths.length === 1) {
    return <Image source={{ uri: urlFor(paths[0]) }} style={[styles.single, { height, borderRadius, width }]} />;
  }

  const onScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    setPage(Math.round(e.nativeEvent.contentOffset.x / width));
  };

  return (
    <View style={{ width, height }}>
      <ScrollView
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onScrollEnd}
        style={{ borderRadius, overflow: 'hidden' }}
      >
        {paths.map((p, i) => (
          <Image key={i} source={{ uri: urlFor(p) }} style={{ width, height, backgroundColor: '#F3F4F6' }} />
        ))}
      </ScrollView>
      <View style={styles.countPill}>
        <Text style={styles.countPillText}>{page + 1} / {paths.length}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  single: { marginTop: 0, backgroundColor: '#F3F4F6' },
  countPill: {
    position: 'absolute', bottom: 8, right: 8,
    backgroundColor: 'rgba(17,24,39,0.65)', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3,
  },
  countPillText: { color: '#FFF', fontSize: 11, fontWeight: '700' },
});
