import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
} from 'react-native';
import storage from '../utils/storage';
import {
  Map,
  Camera,
  GeoJSONSource,
  Layer,
  UserLocation,
  type MapRef,
  type CameraRef,
} from '@maplibre/maplibre-react-native';
import { useLocation } from '../hooks/useLocation';
import { fetchBlocksInBounds } from '../services/blocks';
import type { Block, BoundsRect } from '../types';
import BlockDetailSheet from '../components/BlockDetailSheet';
import SearchScreen from '../components/SearchScreen';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const MAP_STYLE = require('../../assets/map-style.json');

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
  const blocksRef = useRef<Block[]>([]);
  const zoomRef = useRef(13);
  const boundsRef = useRef<BoundsRect | null>(null);

  const [blocks, setBlocks] = useState<Block[]>([]);
  const [selectedBlock, setSelectedBlock] = useState<Block | null>(null);
  const [selectedBlockDist, setSelectedBlockDist] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tallOnly, setTallOnly] = useState(true);
  const [searchVisible, setSearchVisible] = useState(false);
  const [recentBlocks, setRecentBlocks] = useState<Block[]>([]);
  const [starredIds, setStarredIds] = useState<Set<string>>(new Set());

  // Auto-detect day/night based on local time
  const [isDark] = useState(false); // dark mode disabled until style is fixed

  // Sync ref with state
  blocksRef.current = blocks;

  // Build GeoJSON FeatureCollection from blocks for the map source
  const geojson = useMemo((): GeoJSON.FeatureCollection => ({
    type: 'FeatureCollection',
    features: blocks
      .filter((b) => b.lat != null && b.lng != null)
      .filter((b) => !tallOnly || (b.storeys != null && b.storeys >= 21))
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
  }), [blocks, tallOnly]);

  const userLocationGeojson = useMemo((): GeoJSON.FeatureCollection | null => {
    if (location.loading || !location.latitude) return null;
    return {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [location.longitude, location.latitude] },
        properties: {},
      }],
    };
  }, [location.latitude, location.longitude, location.loading]);

  // Fetch blocks within visible map bounds
  const fetchBounds = useCallback(
    async (
      b: BoundsRect,
    ) => {
      setLoading(true);
      setError(null);
      try {
        const data = await fetchBlocksInBounds({
          minLat: b.sw[1],
          minLng: b.sw[0],
          maxLat: b.ne[1],
          maxLng: b.ne[0],
          sortBy: 'storeys',
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

      // Debounce: wait 300ms after last camera movement
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      debounceTimer.current = setTimeout(() => {
        if (boundsRef.current) {
          fetchBounds(boundsRef.current);
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
        // Add to recents
        setRecentBlocks((prev) => {
          const filtered = prev.filter((b) => b.block_id !== block.block_id);
          return [block, ...filtered].slice(0, 10);
        });
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

  const handleToggleStar = useCallback(async (block: Block) => {
    setStarredIds((prev) => {
      const next = new Set(prev);
      if (next.has(block.block_id)) {
        next.delete(block.block_id);
      } else {
        next.add(block.block_id);
      }
      storage.setItem('starred_blocks', JSON.stringify([...next]));
      return next;
    });
  }, []);

  const handleSelectSearchBlock = useCallback((block: Block) => {
    setSearchVisible(false);
    setSelectedBlock(block);
    // Fly to the block
    if (block.lat != null && block.lng != null) {
      cameraRef.current?.flyTo({
        center: [block.lng, block.lat],
        zoom: 16,
        duration: 800,
      });
    }
    // Add to recents
    setRecentBlocks((prev) => {
      const filtered = prev.filter((b) => b.block_id !== block.block_id);
      return [block, ...filtered].slice(0, 10);
    });
    // Compute distance
    if (block.lat != null && block.lng != null && location.latitude) {
      const km = haversineKm(
        location.latitude, location.longitude,
        block.lat, block.lng,
      );
      setSelectedBlockDist(km);
    }
  }, [location.latitude, location.longitude]);

  // Camera initial position [lng, lat]
  const cameraCenter: [number, number] = [
    location.longitude,
    location.latitude,
  ];

  // Fetch blocks when location is ready
  useEffect(() => {
    if (location.loading) return;
    if (boundsRef.current) {
      fetchBounds(boundsRef.current);
    } else {
      fetchBounds(SG_BOUNDS);
    }
  }, [location.loading, fetchBounds]);

  // Cleanup debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, []);

  // Load starred blocks from storage on mount
  useEffect(() => {
    storage.getItem('starred_blocks').then((val) => {
      if (val) {
        try {
          const ids: string[] = JSON.parse(val);
          setStarredIds(new Set(ids));
        } catch {}
      }
    });
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
          minZoom={10}
          maxBounds={[103.5, 1.15, 104.1, 1.5]}
          duration={500}
        />

        <UserLocation />

        {userLocationGeojson && (
          <GeoJSONSource id="user-location" data={userLocationGeojson}>
            {/* Outer pulsing ring */}
            <Layer id="user-location-ring" source="user-location" type="circle"
              paint={{
                'circle-radius': 18,
                'circle-color': '#3B82F6',
                'circle-opacity': 0.25,
                'circle-stroke-width': 2,
                'circle-stroke-color': '#3B82F6',
                'circle-stroke-opacity': 0.5,
              }}
            />
            {/* Inner dot */}
            <Layer id="user-location-dot" source="user-location" type="circle"
              paint={{
                'circle-radius': 8,
                'circle-color': '#3B82F6',
                'circle-stroke-width': 3,
                'circle-stroke-color': '#FFFFFF',
              }}
            />
          </GeoJSONSource>
        )}

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
                6,   // 1-10
                11,
                8,   // 11-20
                21,
                10,  // 21-30
                31,
                13,  // 31+
              ],
              'circle-stroke-width': 1.5,
              'circle-stroke-color': '#ffffff',
              'circle-opacity': 0.85,
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
        style={[styles.myLocationBtn, { backgroundColor: isDark ? '#333' : '#FFFFFF' }]}
        onPress={() => {
          cameraRef.current?.easeTo({
            center: cameraCenter,
            zoom: 15,
            duration: 500,
          });
        }}
        activeOpacity={0.8}
      >
        <Text style={[styles.myLocationBtnText, { color: isDark ? '#60A5FA' : '#2563EB' }]}>◎</Text>
      </TouchableOpacity>

      {/* Search button */}
      <TouchableOpacity
        style={styles.searchBtn}
        onPress={() => setSearchVisible(true)}
        activeOpacity={0.8}
      >
        <Text style={styles.searchBtnText}>🔍</Text>
      </TouchableOpacity>

      {/* Height legend */}
      <View style={[styles.legend, { backgroundColor: isDark ? 'rgba(30,30,30,0.92)' : 'rgba(255,255,255,0.92)' }]}>
        <Text style={[styles.legendTitle, { color: isDark ? '#9CA3AF' : '#6B7280' }]}>Height</Text>
        {HEIGHT_TIERS.map((t) => (
          <View key={t.label} style={styles.legendRow}>
            <View style={[styles.legendDot, { backgroundColor: t.color }]} />
            <Text style={[styles.legendLabel, { color: isDark ? '#E5E7EB' : '#374151' }]}>{t.label} floors</Text>
          </View>
        ))}
      </View>

      {/* 21+ floors toggle */}
      <TouchableOpacity
        style={[styles.filterToggle, { backgroundColor: tallOnly ? '#8B0000' : (isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.7)') }]}
        onPress={() => setTallOnly(!tallOnly)}
        activeOpacity={0.8}
      >
        <Text style={styles.filterToggleText}>
          {tallOnly ? '21+ only' : 'All blocks'}
        </Text>
      </TouchableOpacity>

      {/* Block Detail Sheet overlay */}
      <BlockDetailSheet
        block={selectedBlock}
        distanceKm={selectedBlockDist}
        onClose={handleCloseDetail}
      />

      <SearchScreen
        visible={searchVisible}
        onClose={() => setSearchVisible(false)}
        onSelectBlock={handleSelectSearchBlock}
        recentBlocks={recentBlocks}
        starredBlockIds={starredIds}
        onToggleStar={handleToggleStar}
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
  filterToggle: {
    position: 'absolute',
    top: 284,
    right: 16,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 20,
    zIndex: 10,
  },
  filterToggleText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },

  // My Location button
  myLocationBtn: {
    position: 'absolute',
    bottom: 40,
    left: 16,
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

  // Search button
  searchBtn: {
    position: 'absolute',
    bottom: 40,
    right: 16,
    width: 44,
    height: 44,
    borderRadius: 22,
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
  searchBtnText: {
    fontSize: 20,
  },

  // Height legend
  legend: {
    position: 'absolute',
    top: 180,
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
