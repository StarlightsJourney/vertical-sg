import { useState, useCallback, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform, PanResponder, type GestureResponderEvent } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import Ionicons from '@expo/vector-icons/Ionicons';
import AnimatedSplash from './src/components/AnimatedSplash';
import OnboardingScreen from './src/screens/OnboardingScreen';
import MapScreen from './src/screens/MapScreen';
import SocialScreen from './src/screens/SocialScreen';
import GroupsScreen from './src/screens/GroupsScreen';
import ProfileScreen from './src/screens/ProfileScreen';
import { AuthProvider } from './src/contexts/AuthContext';
import storage from './src/utils/storage';

// Phase 2a: 4-tab layout (My Climbs merged into Profile)
// Order: Social — Map — Groups — Profile (Map is center anchor)
const TABS = [
  { key: 'social', label: 'Social', icon: 'people-outline' as const, index: 0 },
  { key: 'map', label: 'Map', icon: 'map-outline' as const, index: 1 },
  { key: 'groups', label: 'Groups', icon: 'flag-outline' as const, index: 2 },
  { key: 'profile', label: 'Profile', icon: 'person-outline' as const, index: 3 },
];

const TABS_BY_INDEX = ['social', 'map', 'groups', 'profile'] as const;
const SWIPE_DISTANCE_THRESHOLD = 60; // px horizontal drag to trigger tab change

export default function App() {
  const [splashDone, setSplashDone] = useState(false);
  const [onboardingDone, setOnboardingDone] = useState<boolean | null>(null);
  const [activeTab, setActiveTab] = useState('map');
  const [visitedTabs, setVisitedTabs] = useState<Set<string>>(() => new Set(['map']));

  useEffect(() => {
    storage.getItem('onboarding_completed').then((val) => setOnboardingDone(val === 'true'));
  }, []);

  const handleOnboardingComplete = useCallback(() => setOnboardingDone(true), []);

  const goToTab = useCallback((tab: string) => {
    setActiveTab(tab);
    setVisitedTabs((prev) => (prev.has(tab) ? prev : new Set(prev).add(tab)));
  }, []);

  // Appearance: 'auto' follows time of day (night hours = dark), or the user
  // can pin it to 'light'/'dark' from Settings. Persisted across launches.
  const [themeMode, setThemeMode] = useState<'light' | 'dark' | 'auto'>('auto');
  const [isDark, setIsDark] = useState(() => {
    const h = new Date().getHours();
    return h < 6 || h >= 19;
  });

  useEffect(() => {
    storage.getItem('theme_mode').then((val) => {
      if (val === 'light' || val === 'dark' || val === 'auto') setThemeMode(val);
    });
  }, []);

  const handleSetThemeMode = useCallback((mode: 'light' | 'dark' | 'auto') => {
    setThemeMode(mode);
    storage.setItem('theme_mode', mode);
  }, []);

  const handleSplashFinish = useCallback(() => setSplashDone(true), []);

  useEffect(() => {
    if (themeMode !== 'auto') {
      setIsDark(themeMode === 'dark');
      return;
    }
    const applyAuto = () => {
      const h = new Date().getHours();
      setIsDark(h < 6 || h >= 19);
    };
    applyAuto();
    const t = setInterval(applyAuto, 60000);
    return () => clearInterval(t);
  }, [themeMode]);

  // Edge-swipe gesture handling for tab switching
  // Leftmost ~10% → swipe right → Social. Rightmost ~10% → swipe left → Profile.
  // Center ~80% → pass through to map panning.
  const screenWidth = useRef(0);
  const touchStartX = useRef(0);
  const touchStartTab = useRef('map');

  // PanResponder is created once (below) via useRef, so its callbacks close
  // over whatever `activeTab` was on the FIRST render forever — they never
  // see tab changes. This ref is kept in sync on every render instead, and
  // the callbacks read *this* rather than the stale `activeTab` variable.
  const activeTabRef = useRef(activeTab);
  activeTabRef.current = activeTab;

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (evt: GestureResponderEvent, gestureState) => {
        // Only capture if:
        // 1. Significant horizontal movement (not vertical scroll)
        // 2. Touch started near an edge (edge swipe) or we're on Map tab (dead zone logic)
        const dx = Math.abs(gestureState.dx);
        const dy = Math.abs(gestureState.dy);
        if (dx < 10 || dx < dy) return false;

        const touchX = evt.nativeEvent.pageX;
        const edgeWidth = screenWidth.current * 0.1;
        const isNearLeftEdge = touchX < edgeWidth;
        const isNearRightEdge = touchX > screenWidth.current - edgeWidth;

        // On Map tab, only edge swipes trigger tab change (center pans map)
        // On other tabs, any horizontal swipe can trigger
        if (activeTabRef.current === 'map') {
          return isNearLeftEdge || isNearRightEdge;
        }
        return true;
      },
      onPanResponderGrant: (evt: GestureResponderEvent) => {
        touchStartX.current = evt.nativeEvent.pageX;
        touchStartTab.current = activeTabRef.current;
      },
      onPanResponderRelease: (_, gestureState) => {
        const dx = gestureState.dx;
        const currentIdx = TABS.findIndex(t => t.key === touchStartTab.current);

        if (dx < -SWIPE_DISTANCE_THRESHOLD) {
          // Swipe left → next tab
          const nextIdx = Math.min(currentIdx + 1, TABS_BY_INDEX.length - 1);
          goToTab(TABS_BY_INDEX[nextIdx]);
        } else if (dx > SWIPE_DISTANCE_THRESHOLD) {
          // Swipe right → previous tab
          const prevIdx = Math.max(currentIdx - 1, 0);
          goToTab(TABS_BY_INDEX[prevIdx]);
        }
      },
    }),
  ).current;

  return (
    <AuthProvider>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      {/* Nothing heavy mounts until the splash finishes — MapScreen's native
          map view + location/blocks fetching used to start immediately
          alongside the splash animation and visibly competed with it. */}
      {splashDone && onboardingDone === false && (
        <OnboardingScreen onComplete={handleOnboardingComplete} />
      )}
      {splashDone && onboardingDone && (
        <View
          style={styles.container}
          onLayout={(e) => { screenWidth.current = e.nativeEvent.layout.width; }}
          {...panResponder.panHandlers}
        >
          {/* Each tab mounts the first time it's visited, then stays mounted
              (hidden via display:none rather than unmounted) so switching
              back doesn't re-fetch/re-render from scratch. Tabs never visited
              don't mount at all, so cold launch only pays for Map. */}
          {visitedTabs.has('social') && (
            <View style={[styles.screen, activeTab !== 'social' && styles.hidden]}>
              <SocialScreen isDark={isDark} onNavigateToProfile={() => goToTab('profile')} onNavigateToGroups={() => goToTab('groups')} />
            </View>
          )}
          {visitedTabs.has('map') && (
            <View style={[styles.screen, activeTab !== 'map' && styles.hidden]}>
              <MapScreen isDark={isDark} />
            </View>
          )}
          {visitedTabs.has('groups') && (
            <View style={[styles.screen, activeTab !== 'groups' && styles.hidden]}>
              <GroupsScreen isDark={isDark} />
            </View>
          )}
          {visitedTabs.has('profile') && (
            <View style={[styles.screen, activeTab !== 'profile' && styles.hidden]}>
              <ProfileScreen isDark={isDark} themeMode={themeMode} onSetThemeMode={handleSetThemeMode} />
            </View>
          )}

          <View style={[styles.tabBar, { backgroundColor: isDark ? '#1F2937' : '#FFFFFF', borderTopColor: isDark ? '#374151' : '#F3F4F6' }]}>
            {TABS.map((tab) => {
              const active = activeTab === tab.key;
              return (
                <TouchableOpacity
                  key={tab.key}
                  style={styles.tab}
                  onPress={() => goToTab(tab.key)}
                  activeOpacity={0.7}
                >
                  <Ionicons name={tab.icon} size={22} color={active ? '#60A5FA' : (isDark ? '#9CA3AF' : '#9CA3AF')} />
                  <Text style={[styles.tabLabel, { color: active ? '#60A5FA' : (isDark ? '#9CA3AF' : '#9CA3AF') }]}>{tab.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      )}
      {!splashDone && <AnimatedSplash onFinish={handleSplashFinish} />}
    </AuthProvider>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  screen: { flex: 1 },
  hidden: { display: 'none' },
  tabBar: {
    flexDirection: 'row',
    borderTopWidth: 1,
    paddingBottom: Platform.OS === 'android' ? 36 : 6,
    paddingTop: 6,
  },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 4 },
  tabLabel: { fontSize: 10, fontWeight: '600', marginTop: 2 },
});
