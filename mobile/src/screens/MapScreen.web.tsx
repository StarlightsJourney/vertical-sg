import { View, Text, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

// Web-only stand-in for MapScreen. @maplibre/maplibre-react-native wraps the
// native iOS/Android MapLibre SDKs directly — there's no web build of it, so
// importing the real MapScreen (and its native map view) on web would crash
// the bundle. Metro/react-native-web automatically prefers this .web.tsx
// file over MapScreen.tsx when bundling for the web platform, so the native
// import never happens there. Same reason climb tracking (barometer/step
// counter) isn't available here either — those are native sensors too.
export default function MapScreen({ isDark }: { isDark?: boolean; onNavigateToSocial?: () => void }) {
  return (
    <View style={[styles.container, isDark && { backgroundColor: '#111827' }]}>
      <Ionicons name="map-outline" size={48} color={isDark ? '#4B5563' : '#D1D5DB'} />
      <Text style={[styles.title, isDark && { color: '#F9FAFB' }]}>Map isn't available in the browser</Text>
      <Text style={[styles.body, isDark && { color: '#9CA3AF' }]}>
        The map and climb tracker use native device features (MapLibre, barometer, step counter) that only work on
        a phone. Open this tab on the Android dev client to use it.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F9FAFB',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
  },
  title: { fontSize: 17, fontWeight: '800', color: '#111827', marginTop: 16, marginBottom: 8, textAlign: 'center' },
  body: { fontSize: 13.5, color: '#6B7280', textAlign: 'center', lineHeight: 20 },
});
