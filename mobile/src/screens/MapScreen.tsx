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

/** Haversine distance in km between two lat/lng points. */
function haversineKm(
  lat1: number, lng1: number,
  lat2: number, lng2: number,
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const HEIGHT_TIERS = [
  { label: '1–10', color: '#4A90D9' },
  { label: '11–20', color: '#FF9500' },
  { label: '21–30', color: '#FF3B30' },
  { label: '31+', color: '#8B0000' },
] as const;

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
  const [selectedBlockDist, setSelectedBlockDist] = useState<number | null>(null);
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

  // Handle tap on map: show block detail sheet for tapped pin
  const handleMapPress = useCallback(async (event: any) => {
    const point = event.nativeEvent?.point;
    if (!point) return;

    const features = await mapRef.current?.queryRenderedFeatures(point);
    if (!features || features.length === 0) return;

    const props = features[0].properties ?? {};
    if (props.block_id) {
      const block = blocksRef.current.find(
        (b) => b.block_id === props.block_id,
      );
      if (block) {
        setSelectedBlock(block);
        // Compute distance from user location
        if (block.lat != null && block.lng != null && location.latitude) {
          const km = haversineKm(
            location.latitude, location.longitude,
            block.lat, block.lng,
          );
          setSelectedBlockDist(km);
        } else {
          setSelectedBlockDist(null);
        }
      }
    }
  }, [location.latitude, location.longitude]);

  const handleCloseDetail = useCallback(() => {
    setSelectedBlock(null);
    setSelectedBlockDist(null);
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
        >
          {/* Individual block pins — coloured circles by height tier */}
          <Layer
            id="block-pins"
            source="blocks"
            type="circle"
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
                10,  // 1-10
                11,
                12,  // 11-20
                21,
                15,  // 21-30
                31,
                18,  // 31+
              ],
              'circle-stroke-width': 2,
              'circle-stroke-color': '#ffffff',
              'circle-opacity': 0.9,
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

      {/* My Location button */}
      <TouchableOpacity
        style={styles.myLocationBtn}
        onPress={() => {
          cameraRef.current?.easeTo({
            center: cameraCenter,
            zoom: 15,
            duration: 500,
          });
        }}
        activeOpacity={0.8}
      >
        <Text style={styles.myLocationBtnText}>◎</Text>
      </TouchableOpacity>

      {/* Height legend */}
      <View style={styles.legend}>
        <Text style={styles.legendTitle}>Height</Text>
        {HEIGHT_TIERS.map((t) => (
          <View key={t.label} style={styles.legendRow}>
            <View style={[styles.legendDot, { backgroundColor: t.color }]} />
            <Text style={styles.legendLabel}>{t.label} floors</Text>
          </View>
        ))}
      </View>

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
        distanceKm={selectedBlockDist}
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

  // My Location button
  myLocationBtn: {
    position: 'absolute',
    top: 60,
    right: 16,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
  },
  myLocationBtnText: {
    fontSize: 20,
    color: '#2563EB',
  },

  // Height legend
  legend: {
    position: 'absolute',
    top: 110,
    right: 16,
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
    zIndex: 10,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 4,
  },
  legendTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: '#6B7280',
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 8,
  },
  legendLabel: {
    fontSize: 12,
    color: '#374151',
    fontWeight: '500',
  },
});
