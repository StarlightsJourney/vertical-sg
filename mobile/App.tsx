import { StatusBar } from 'expo-status-bar';
import React from 'react';
import MapScreen from './src/screens/MapScreen';

export default function App() {
  return (
    <>
      <StatusBar style="dark" />
      <MapScreen />
    </>
  );
}
