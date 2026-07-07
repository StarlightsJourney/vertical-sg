import { useEffect, useRef, useState } from 'react';
import { GeoJSONSource, Layer } from '@maplibre/maplibre-react-native';

interface Props {
  longitude: number;
  latitude: number;
}

/**
 * Pulsing ring at the user's location. Isolated into its own component so the
 * ~60fps animation loop only re-renders this small subtree, not the whole
 * map screen (markers, filters, etc.) on every tick. Uses requestAnimationFrame
 * instead of setInterval — rAF is tied to the display refresh and self-corrects
 * for drift, whereas a fixed-delay setInterval visibly stutters whenever the
 * JS thread is busy with anything else (which a full-screen re-render was).
 */
export default function UserLocationRing({ longitude, latitude }: Props) {
  const [pulsePhase, setPulsePhase] = useState(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const start = Date.now();
    const tick = () => {
      setPulsePhase(((Date.now() - start) / 1500) * Math.PI * 2);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const pulseOpacity = 0.15 + 0.15 * Math.sin(pulsePhase);
  const pulseRadius = 18 + 4 * Math.sin(pulsePhase);

  const geojson: GeoJSON.FeatureCollection = {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [longitude, latitude] },
      properties: {},
    }],
  };

  return (
    <GeoJSONSource id="user-location" data={geojson}>
      <Layer id="user-location-ring" source="user-location" type="circle"
        paint={{
          'circle-radius': pulseRadius,
          'circle-color': '#14B8A6',
          'circle-opacity': pulseOpacity,
          'circle-stroke-width': 2,
          'circle-stroke-color': '#14B8A6',
          'circle-stroke-opacity': 0.5,
        }}
      />
      <Layer id="user-location-dot" source="user-location" type="circle"
        paint={{
          'circle-radius': 8,
          'circle-color': '#14B8A6',
          'circle-stroke-width': 3,
          'circle-stroke-color': '#FFFFFF',
        }}
      />
    </GeoJSONSource>
  );
}
