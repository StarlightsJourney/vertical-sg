import { useState, useCallback } from 'react';
import { StatusBar } from 'expo-status-bar';
import AnimatedSplash from './src/components/AnimatedSplash';
import MapScreen from './src/screens/MapScreen';

export default function App() {
  const [splashDone, setSplashDone] = useState(false);

  const handleSplashFinish = useCallback(() => {
    setSplashDone(true);
  }, []);

  // Native splash (app.json) prevents blank screen on cold start.
  // AnimatedSplash picks up seamlessly and transitions to the main app.
  return (
    <>
      <StatusBar style="dark" />
      <MapScreen />
      {!splashDone && <AnimatedSplash onFinish={handleSplashFinish} />}
    </>
  );
}
