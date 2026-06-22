import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
} from 'react-native';
import {
  Map,
  Camera,
  GeoJSONSource,
  Layer,
  type MapRef,
  type CameraRef,
} from '@maplibre/maplibre-react-native';
import { useLocation } from '../hooks/useLocation';
import { fetchNearbyBlocks, fetchBlocksInBounds } from '../services/blocks';
import type { Block, SortMode, BoundsRect } from '../types';
import BlockDetailSheet from '../components/BlockDetailSheet';

// Liberty style with 3D buildings (fill-extrusion) removed.
// Fill-extrusion uses depth buffering which covers 2D circle layers.
// Text labels (symbol) also removed — no font server needed.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const MAP_STYLE = require('../../assets/map-style.json');
const RADIUS_PRESETS = [1000, 3000, 5000];

// Default Singapore bounds for initial fetch before map camera settles
const SG_BOUNDS: BoundsRect = { sw: [103.6, 1.2], ne: [104.0, 1.48] };

export default function MapScreen() {
  const location = useLocation();
  const mapRef = useRef<MapRef>(null);
  const cameraRef = useRef<CameraRef>(null);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sortByRef = useRef<SortMode>('storeys');
  const blocksRef = useRef<Block[]>([]);
  const zoomRef = useRef(13);
  const boundsRef = useRef<BoundsRect | null>(null);

  const [blocks, setBlocks] = useState<Block[]>([]);
  const [selectedBlock, setSelectedBlock] = useState<Block | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<SortMode>('storeys');
  const [radius, setRadius] = useState(5000);

  // Sync refs with state
  sortByRef.current = sortBy;
  blocksRef.current = blocks;

  // Build GeoJSON FeatureCollection from blocks for the map source
  const geojson = useMemo((): GeoJSON.FeatureCollection => ({
    type: 'FeatureCollection',
    features: blocks
      .filter((b) => b.lat != null && b.lng != null)
      .map((b) => ({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [b.lng!, b.lat!] as [number, number],
        },
        properties: {
          block_id: b.block_id,
          storeys: b.storeys,
          est_height_m: b.est_height_m,
          height_source: b.height_source,
          town: b.town,
          street: b.street,
          year_completed: b.year_completed,
          total_dwelling_units: b.total_dwelling_units,
        },
      })),
  }), [blocks]);

  // Fetch nearby blocks (used when "Nearest" sort is active)
  const fetchNearby = useCallback(async () => {
    if (location.loading) return;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchNearbyBlocks({
        lat: location.latitude,
        lng: location.longitude,
        radius,
        sortBy,
      });
      setBlocks(data);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to load blocks',
      );
    } finally {
      setLoading(false);
    }
  }, [location.latitude, location.longitude, location.loading, radius, sortBy]);

  // Fetch blocks within visible map bounds (used when "Tallest" sort is active)
  const fetchBounds = useCallback(
    async (
      b: BoundsRect,
      sort: SortMode,
    ) => {
      setLoading(true);
      setError(null);
      try {
        const data = await fetchBlocksInBounds({
          minLat: b.sw[1],
          minLng: b.sw[0],
          maxLat: b.ne[1],
          maxLng: b.ne[0],
          sortBy: sort,
        });
        setBlocks(data);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : 'Failed to load blocks',
        );
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  // Debounced handler for map region changes: track bounds/zoom, fetch blocks
  const handleRegionDidChange = useCallback(
    (event: any) => {
      const ev = event.nativeEvent ?? event;
      const boundsArr = ev.bounds;
      const zoom = ev.zoom;

      if (boundsArr) {
        boundsRef.current = {
          sw: [boundsArr[0], boundsArr[1]],
          ne: [boundsArr[2], boundsArr[3]],
        };
      }
      if (typeof zoom === 'number') {
        zoomRef.current = zoom;
      }

      // Don't fetch in "Nearest" mode
      if (sortByRef.current === 'distance') return;

      // Debounce: wait 300ms after last camera movement
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      debounceTimer.current = setTimeout(() => {
        if (sortByRef.current === 'distance') return;
        if (boundsRef.current) {
          fetchBounds(boundsRef.current, sortByRef.current);
        }
      }, 300);
    },
    [fetchBounds],
  );

  // Handle tap on map: clusters zoom in, individual points show detail sheet
  const handleMapPress = useCallback(async (event: { nativeEvent: { point: [number, number]; features?: GeoJSON.Feature[] } }) => {
    const point = event.nativeEvent?.point;
    if (!point) return;

    const features = await mapRef.current?.queryRenderedFeatures(point);
    if (!features || features.length === 0) return;

    const feature = features[0];
    const props = feature.properties ?? {};

    if (props.cluster) {
      // Tapped a cluster — zoom in by 2 levels
      const coords = (feature.geometry as GeoJSON.Point).coordinates;
      cameraRef.current?.easeTo({
        center: coords as [number, number],
        zoom: zoomRef.current + 2,
        duration: 300,
      });
    } else if (props.block_id) {
      // Tapped an individual block — show detail sheet
      const block = blocksRef.current.find(
        (b) => b.block_id === props.block_id,
      );
      if (block) setSelectedBlock(block);
    }
  }, []);

  const handleCloseDetail = useCallback(() => {
    setSelectedBlock(null);
  }, []);

  // Camera initial position [lng, lat]
  const cameraCenter: [number, number] = [
    location.longitude,
    location.latitude,
  ];

  // Fetch data when sort mode, radius, or location availability changes
  useEffect(() => {
    if (location.loading) return;

    if (sortBy === 'distance') {
      fetchNearby();
    } else {
      // Fetch bounds using current bounds or fall back to default SG bounds
      if (boundsRef.current) {
        fetchBounds(boundsRef.current, sortBy);
      } else {
        fetchBounds(SG_BOUNDS, sortBy);
      }
    }
  }, [sortBy, radius, location.loading, fetchNearby, fetchBounds]);

  // Cleanup debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, []);

  return (
    <View style={styles.container}>
      <Map
        ref={mapRef}
        style={styles.map}
        mapStyle={MAP_STYLE}
        logo={false}
        onPress={handleMapPress}
        onRegionDidChange={handleRegionDidChange}
      >
        <Camera
          ref={cameraRef}
          center={cameraCenter}
          zoom={13}
          duration={500}
        />

        <GeoJSONSource
          id="blocks"
          data={geojson}
          cluster
          clusterRadius={50}
          clusterMaxZoom={14}
        >
          {/* Cluster background circles */}
          <Layer
            id="clusters-bg"
            source="blocks"
            type="circle"
            filter={['has', 'point_count']}
            paint={{
              'circle-color': '#2563EB',
              'circle-radius': 18,
              'circle-opacity': 0.9,
              'circle-stroke-width': 2,
              'circle-stroke-color': '#ffffff',
            }}
          />

          {/* Cluster count labels */}
          <Layer
            id="clusters"
            source="blocks"
            type="symbol"
            filter={['has', 'point_count']}
            layout={{
              'text-field': ['get', 'point_count'],
              'text-size': 14,
              'text-ignore-placement': true,
              'text-allow-overlap': true,
            }}
            paint={{ 'text-color': '#ffffff' }}
          />

          {/* Individual block points — coloured circles by height tier */}
          <Layer
            id="unclustered-points"
            source="blocks"
            type="circle"
            filter={['!', ['has', 'point_count']]}
            paint={{
              'circle-color': [
                'step',
                ['get', 'storeys'],
                '#4A90D9', // 1-10: blue
                11,
                '#FF9500', // 11-20: orange
                21,
                '#FF3B30', // 21-30: red
                31,
                '#8B0000', // 31+: dark red
              ],
              'circle-radius': [
                'step',
                ['get', 'storeys'],
                7,  // 1-10
                11,
                9,  // 11-20
                21,
                11, // 21-30
                31,
                13, // 31+
              ],
              'circle-stroke-width': 1.5,
              'circle-stroke-color': '#ffffff',
            }}
          />
        </GeoJSONSource>
      </Map>

      {/* Error banner */}
      {error && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      {/* Loading overlay */}
      {loading && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color="#FFFFFF" />
        </View>
      )}

      {/* Controls bar */}
      <View style={styles.controlsContainer}>
        <View style={styles.controlsRow}>
          <View style={styles.sortGroup}>
            <TouchableOpacity
              style={[
                styles.sortButton,
                sortBy === 'storeys' && styles.sortButtonActive,
              ]}
              onPress={() => setSortBy('storeys')}
            >
              <Text
                style={[
                  styles.sortButtonText,
                  sortBy === 'storeys' && styles.sortButtonTextActive,
                ]}
              >
                Tallest
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.sortButton,
                sortBy === 'distance' && styles.sortButtonActive,
              ]}
              onPress={() => setSortBy('distance')}
            >
              <Text
                style={[
                  styles.sortButtonText,
                  sortBy === 'distance' && styles.sortButtonTextActive,
                ]}
              >
                Nearest
              </Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.radiusLabel}>{radius / 1000}km</Text>
        </View>
        <View style={styles.radiusRow}>
          {RADIUS_PRESETS.map((r) => (
            <TouchableOpacity
              key={r}
              style={[
                styles.radiusButton,
                radius === r && styles.radiusButtonActive,
              ]}
              onPress={() => setRadius(r)}
            >
              <Text
                style={[
                  styles.radiusButtonText,
                  radius === r && styles.radiusButtonTextActive,
                ]}
              >
                {r / 1000}km
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Block Detail Sheet overlay */}
      <BlockDetailSheet
        block={selectedBlock}
        onClose={handleCloseDetail}
        visible={selectedBlock !== null}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  map: {
    flex: 1,
  },
  errorBanner: {
    position: 'absolute',
    top: 60,
    left: 16,
    right: 16,
    backgroundColor: 'rgba(255, 59, 48, 0.9)',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    zIndex: 10,
  },
  errorText: {
    color: '#FFFFFF',
    fontSize: 13,
    textAlign: 'center',
    fontWeight: '500',
  },
  loadingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  },
  controlsContainer: {
    position: 'absolute',
    bottom: 40,
    left: 16,
    right: 16,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 16,
    zIndex: 10,
  },
  controlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  sortGroup: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  sortButton: {
    paddingVertical: 6,
    paddingHorizontal: 16,
    borderRadius: 20,
    marginRight: 8,
  },
  sortButtonActive: {
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
  },
  sortButtonText: {
    color: '#AAAAAA',
    fontSize: 14,
    fontWeight: '600',
  },
  sortButtonTextActive: {
    color: '#FFFFFF',
  },
  radiusLabel: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
    marginLeft: 'auto',
  },
  radiusRow: {
    flexDirection: 'row',
  },
  radiusButton: {
    paddingVertical: 4,
    paddingHorizontal: 12,
    borderRadius: 12,
    marginRight: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.3)',
  },
  radiusButtonActive: {
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    borderColor: '#FFFFFF',
  },
  radiusButtonText: {
    color: '#CCCCCC',
    fontSize: 12,
    fontWeight: '500',
  },
  radiusButtonTextActive: {
    color: '#FFFFFF',
  },
});
