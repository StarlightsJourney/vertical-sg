import { useState, useEffect } from 'react';
import * as Location from 'expo-location';

const DEFAULT_LOCATION = { lat: 1.3521, lng: 103.8198 }; // Singapore centre

interface LocationState {
  latitude: number;
  longitude: number;
  permissionGranted: boolean;
  loading: boolean;
  error: string | null;
}

export function useLocation(): LocationState {
  const [state, setState] = useState<LocationState>({
    latitude: DEFAULT_LOCATION.lat,
    longitude: DEFAULT_LOCATION.lng,
    permissionGranted: false,
    loading: true,
    error: null,
  });

  useEffect(() => {
    let mounted = true;

    async function requestLocation() {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();

        if (!mounted) return;

        if (status !== 'granted') {
          setState((prev) => ({
            ...prev,
            permissionGranted: false,
            loading: false,
            error: 'Location permission denied. Using default location.',
          }));
          return;
        }

        const location = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });

        if (!mounted) return;

        setState({
          latitude: location.coords.latitude,
          longitude: location.coords.longitude,
          permissionGranted: true,
          loading: false,
          error: null,
        });
      } catch (err) {
        if (!mounted) return;
        setState((prev) => ({
          ...prev,
          loading: false,
          error:
            err instanceof Error ? err.message : 'Failed to get location',
        }));
      }
    }

    requestLocation();

    return () => {
      mounted = false;
    };
  }, []);

  return state;
}
