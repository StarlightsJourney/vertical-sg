import { useState, useCallback, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import Ionicons from '@expo/vector-icons/Ionicons';
import AnimatedSplash from './src/components/AnimatedSplash';
import MapScreen from './src/screens/MapScreen';
import SocialScreen from './src/screens/SocialScreen';
import ClimbsScreen from './src/screens/ClimbsScreen';
import ProfileScreen from './src/screens/ProfileScreen';

const TABS = [
  { key: 'social', label: 'Social', icon: 'people-outline' as const },
  { key: 'climbs', label: 'My Climbs', icon: 'trending-up-outline' as const },
  { key: 'map', label: 'Map', icon: 'map-outline' as const },
  { key: 'profile', label: 'Profile', icon: 'person-outline' as const },
];

export default function App() {
  const [splashDone, setSplashDone] = useState(false);
  const [activeTab, setActiveTab] = useState('map');
  const [isDark, setIsDark] = useState(() => {
    const h = new Date().getHours();
    return h < 6 || h >= 19;
  });

  const handleSplashFinish = useCallback(() => setSplashDone(true), []);

  useEffect(() => {
    const t = setInterval(() => {
      const h = new Date().getHours();
      setIsDark(h < 6 || h >= 19);
    }, 60000);
    return () => clearInterval(t);
  }, []);

  return (
    <>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <View style={styles.container}>
        <View style={styles.screen}>
          {activeTab === 'social' && <SocialScreen />}
          {activeTab === 'climbs' && <ClimbsScreen />}
          {activeTab === 'map' && <MapScreen isDark={isDark} />}
          {activeTab === 'profile' && <ProfileScreen />}
        </View>

        <View style={[styles.tabBar, { backgroundColor: isDark ? '#1F2937' : '#FFFFFF', borderTopColor: isDark ? '#374151' : '#F3F4F6' }]}>
          {TABS.map((tab) => {
            const active = activeTab === tab.key;
            return (
              <TouchableOpacity
                key={tab.key}
                style={styles.tab}
                onPress={() => setActiveTab(tab.key)}
                activeOpacity={0.7}
              >
                <Ionicons name={tab.icon} size={22} color={active ? '#60A5FA' : (isDark ? '#9CA3AF' : '#9CA3AF')} />
                <Text style={[styles.tabLabel, { color: active ? '#60A5FA' : (isDark ? '#9CA3AF' : '#9CA3AF') }]}>{tab.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
      {!splashDone && <AnimatedSplash onFinish={handleSplashFinish} />}
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  screen: { flex: 1 },
  tabBar: {
    flexDirection: 'row',
    borderTopWidth: 1,
    paddingBottom: Platform.OS === 'android' ? 36 : 6,
    paddingTop: 6,
  },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 4 },
  tabLabel: { fontSize: 10, fontWeight: '600', marginTop: 2 },
});
