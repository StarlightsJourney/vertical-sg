import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useState, useCallback } from 'react';
import { StatusBar } from 'expo-status-bar';
import AnimatedSplash from './src/components/AnimatedSplash';
import MapScreen from './src/screens/MapScreen';
import SocialScreen from './src/screens/SocialScreen';
import ClimbsScreen from './src/screens/ClimbsScreen';
import ProfileScreen from './src/screens/ProfileScreen';

const Tab = createBottomTabNavigator();

export default function App() {
  const [splashDone, setSplashDone] = useState(false);
  const handleSplashFinish = useCallback(() => setSplashDone(true), []);

  return (
    <>
      <StatusBar style="dark" />
      <NavigationContainer>
        <Tab.Navigator
          screenOptions={({ route }) => ({
            headerShown: false,
            tabBarIcon: ({ color, size }) => {
              const icons: Record<string, keyof typeof Ionicons.glyphMap> = {
                Social: 'people-outline',
                'My Climbs': 'trending-up-outline',
                Map: 'map-outline',
                Profile: 'person-outline',
              };
              return <Ionicons name={icons[route.name]} size={size} color={color} />;
            },
            tabBarActiveTintColor: '#2563EB',
            tabBarInactiveTintColor: '#9CA3AF',
            tabBarStyle: {
              backgroundColor: '#FFFFFF',
              borderTopColor: '#F3F4F6',
              paddingBottom: 4,
              height: 56,
            },
            tabBarLabelStyle: {
              fontSize: 11,
              fontWeight: '600',
            },
          })}
        >
          <Tab.Screen name="Social" component={SocialScreen} />
          <Tab.Screen name="My Climbs" component={ClimbsScreen} />
          <Tab.Screen name="Map" component={MapScreen} />
          <Tab.Screen name="Profile" component={ProfileScreen} />
        </Tab.Navigator>
      </NavigationContainer>
      {!splashDone && <AnimatedSplash onFinish={handleSplashFinish} />}
    </>
  );
}
