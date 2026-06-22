import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  Modal,
  Alert,
} from 'react-native';
import {
  Map as MapView,
  Camera,
  GeoJSONSource,
  Layer,
  UserLocation,
  type MapRef,
  type CameraRef,
} from '@maplibre/maplibre-react-native';
import { useLocation } from '../hooks/useLocation';
import { fetchBlocksInBounds } from '../services/blocks';
import type { Block, BoundsRect, ClimbLog } from '../types';
import BlockDetailSheet from '../components/BlockDetailSheet';
import SearchScreen from '../components/SearchScreen';
import storage from '../utils/storage';

// Light (default) and dark map styles for day/night auto-switching
// eslint-disable-next-line @typescript-eslint/no-require-imports
const LIGHT_STYLE = require('../../assets/map-style.json');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const DARK_STYLE = require('../../assets/map-style-dark.json');

// eslint-disable-next-line @typescript-eslint/no-require-imports
const WATER_COOLERS_RAW: Array<{ name: string; lat: number; lng: number; status: string; level: string; temperature: string; operator: string }> = require('../../assets/water-coolers.json');

const WATER_COOLER_GEOJSON: GeoJSON.FeatureCollection = {
  type: 'FeatureCollection',
  features: WATER_COOLERS_RAW.map((wc) => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [wc.lng, wc.lat] as [number, number] },
    properties: { name: wc.name, status: wc.status, level: wc.level, temperature: wc.temperature, operator: wc.operator },
  })),
};

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
  { label: '31–39', color: '#8B0000' },
  { label: '40+', color: '#7C3AED' },
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
  const [minFilter, setMinFilter] = useState(21);
  const [pulseOn, setPulseOn] = useState(true);
  const [searchVisible, setSearchVisible] = useState(false);
  const [alertVisible, setAlertVisible] = useState(false);
  const [recentBlocks, setRecentBlocks] = useState<Block[]>([]);
  const [starredIds, setStarredIds] = useState<Set<string>>(new Set());
  const [climbCounts, setClimbCounts] = useState<Map<string, number>>(new Map());
  const [climbHistory, setClimbHistory] = useState<ClimbLog[]>([]);
  const [tapY, setTapY] = useState<number>(0);

  // Auto-detect day/night based on local time
  const [isDark, setIsDark] = useState(() => {
    const hour = new Date().getHours();
    return hour < 6 || hour >= 19; // dark mode 7pm-6am
  });

  // Sync ref with state
  blocksRef.current = blocks;

  // Build GeoJSON FeatureCollection from blocks for the map source
  const geojson = useMemo((): GeoJSON.FeatureCollection => ({
    type: 'FeatureCollection',
    features: blocks
      .filter((b) => b.lat != null && b.lng != null)
      .filter((b) => minFilter === 0 || (b.storeys != null && b.storeys >= minFilter))
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
          climbed: climbCounts.has(b.block_id),
        },
      })),
  }), [blocks, minFilter, climbCounts]);

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
        setTapY(point[1]);
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
    setTapY(0);
  }, []);

  const handleToggleStar = useCallback((block: Block) => {
    setStarredIds((prev) => {
      const next = new Set(prev);
      if (next.has(block.block_id)) next.delete(block.block_id);
      else next.add(block.block_id);
      storage.setItem('starred_blocks', JSON.stringify([...next]));
      return next;
    });
  }, []);

  const handleLogClimb = useCallback((block: Block, qty: number) => {
    const timestamp = new Date().toISOString();
    const promises: Promise<void>[] = [];
    for (let i = 0; i < qty; i++) {
      promises.push(storage.addClimb({
        block_id: block.block_id,
        blk_no: block.blk_no,
        street: block.street,
        storeys: block.storeys,
        climbedAt: timestamp,
      }));
    }
    Promise.all(promises).then(() => {
      setClimbCounts((prev) => {
        const next = new Map(prev);
        next.set(block.block_id, (next.get(block.block_id) || 0) + qty);
        return next;
      });
      // Refresh climb history
      storage.getClimbHistory().then(setClimbHistory);
    });
  }, []);

  const handleSelectSearchBlock = useCallback((block: Block) => {
    setSearchVisible(false);
    setSelectedBlock(block);
    if (block.lat != null && block.lng != null) {
      cameraRef.current?.flyTo({ center: [block.lng, block.lat], zoom: 16, duration: 800 });
    }
    setRecentBlocks((prev) => {
      const filtered = prev.filter((b) => b.block_id !== block.block_id);
      return [block, ...filtered].slice(0, 10);
    });
    if (block.lat != null && block.lng != null && location.latitude) {
      setSelectedBlockDist(haversineKm(location.latitude, location.longitude, block.lat, block.lng));
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
        try { setStarredIds(new Set(JSON.parse(val))); } catch {}
      }
    });
  }, []);

  // Load climb history on mount
  useEffect(() => {
    storage.getClimbHistory().then((history) => {
      setClimbHistory(history);
      const counts = new Map<string, number>();
      history.forEach((c) => {
        counts.set(c.block_id, (counts.get(c.block_id) || 0) + 1);
      });
      setClimbCounts(counts);
    });
  }, []);

  // Check time every 60 seconds for day/night auto-switching
  useEffect(() => {
    const timer = setInterval(() => {
      const hour = new Date().getHours();
      setIsDark(hour < 6 || hour >= 19);
    }, 60000);
    return () => clearInterval(timer);
  }, []);

  // Pulse timer for user location ring
  useEffect(() => {
    const timer = setInterval(() => {
      setPulseOn((prev) => !prev);
    }, 1500);
    return () => clearInterval(timer);
  }, []);

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={styles.map}
        mapStyle={isDark ? DARK_STYLE : LIGHT_STYLE}
        logo={false}
        compass={false}
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
                'circle-radius': pulseOn ? 18 : 22,
                'circle-color': '#14B8A6',
                'circle-opacity': pulseOn ? 0.3 : 0.1,
                'circle-stroke-width': 2,
                'circle-stroke-color': '#14B8A6',
                'circle-stroke-opacity': 0.5,
              }}
            />
            {/* Inner dot */}
            <Layer id="user-location-dot" source="user-location" type="circle"
              paint={{
                'circle-radius': 8,
                'circle-color': '#14B8A6',
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
                '#8B0000', // 31-39: dark red
                40,
                '#7C3AED', // 40+: purple
              ],
              'circle-radius': [
                'step',
                ['get', 'storeys'],
                4,   // 1-10
                11,
                6,   // 11-20
                21,
                9,  // 21-30
                31,
                12, // 31-39
                40,
                15, // 40+
              ],
              'circle-stroke-width': [
                'case',
                ['get', 'climbed'],
                3,
                1.5,
              ],
              'circle-stroke-color': [
                'case',
                ['get', 'climbed'],
                '#F59E0B',
                '#ffffff',
              ],
              'circle-opacity': 0.85,
            }}
          />
        </GeoJSONSource>

        {/* Water cooler markers — small dots colored by verification status */}
        <GeoJSONSource id="water-coolers" data={WATER_COOLER_GEOJSON}>
          <Layer
            id="water-cooler-pins"
            source="water-coolers"
            type="circle"
            minzoom={14}
            paint={{
              'circle-radius': 5,
              'circle-color': [
                'match',
                ['get', 'status'],
                'verified', '#0288D1',
                'unverified', '#A52714',
                'ticketed', '#F57C00',
                '#9E9E9E',
              ],
              'circle-opacity': 0.8,
              'circle-stroke-width': 1.5,
              'circle-stroke-color': '#FFFFFF',
            }}
          />
        </GeoJSONSource>
      </MapView>

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

      {/* Filter chips — manual storeys filter at top-left */}
      <View style={styles.filterChips}>
        {[40, 31, 21, 0].map(floor => (
          <TouchableOpacity
            key={floor}
            style={[styles.filterChip, minFilter === floor && styles.filterChipActive]}
            onPress={() => setMinFilter(floor)}
            activeOpacity={0.7}
          >
            <Text style={[styles.filterChipText, minFilter === floor && styles.filterChipTextActive]}>
              {floor === 0 ? 'All' : `${floor}+`}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Height legend */}
      <View style={[styles.legend, { backgroundColor: isDark ? 'rgba(30,30,30,0.88)' : 'rgba(255,255,255,0.88)' }]}>
        {HEIGHT_TIERS.map((t) => (
          <View key={t.label} style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: t.color }]} />
            <Text style={[styles.legendLabel, { color: isDark ? '#D1D5DB' : '#374151' }]}>{t.label}</Text>
          </View>
        ))}
      </View>

      {/* Bottom bar */}
      <View style={[styles.bottomBar, { backgroundColor: isDark ? 'rgba(30,30,30,0.95)' : 'rgba(255,255,255,0.95)' }]}>
        {/* Search input — tapping opens SearchScreen */}
        <TouchableOpacity
          style={[styles.searchInput, { backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : '#F3F4F6' }]}
          onPress={() => setSearchVisible(true)}
          activeOpacity={0.8}
        >
          <Text style={styles.searchIcon}>⌕</Text>
          <Text style={styles.searchPlaceholder}>Search blocks...</Text>
        </TouchableOpacity>

        {/* Location button */}
        <TouchableOpacity
          style={styles.locBtn}
          onPress={() => {
            cameraRef.current?.easeTo({
              center: cameraCenter,
              zoom: 15,
              duration: 500,
            });
          }}
          activeOpacity={0.7}
        >
          <Text style={styles.locIcon}>⊕</Text>
        </TouchableOpacity>
      </View>

      {/* Alert/Report button — Waze-style flag, above search bar */}
      <TouchableOpacity
        style={[styles.alertBtn, { backgroundColor: isDark ? '#333' : '#FFFFFF' }]}
        onPress={() => setAlertVisible(true)}
        activeOpacity={0.8}
      >
        <Text style={styles.alertBtnText}>⚑</Text>
      </TouchableOpacity>

      {/* Block Detail Sheet overlay */}
      <BlockDetailSheet
        block={selectedBlock}
        distanceKm={selectedBlockDist}
        onClose={handleCloseDetail}
        onLogClimb={handleLogClimb}
        tapY={tapY}
      />

      {/* Search screen */}
      <SearchScreen
        visible={searchVisible}
        onClose={() => setSearchVisible(false)}
        onSelectBlock={handleSelectSearchBlock}
        recentBlocks={recentBlocks}
        starredBlockIds={starredIds}
        onToggleStar={handleToggleStar}
        isDark={isDark}
        climbHistory={climbHistory}
      />

      {/* Alert/Report modal */}
      <Modal visible={alertVisible} transparent animationType="fade" onRequestClose={() => setAlertVisible(false)}>
        <TouchableOpacity style={StyleSheet.absoluteFill} onPress={() => setAlertVisible(false)} activeOpacity={1}>
          <View style={styles.alertModal}>
            <Text style={[styles.alertTitle, { color: isDark ? '#F9FAFB' : '#111827' }]}>Report nearby...</Text>
            {['Water Cooler', 'Toilet', 'Food / Shop', 'Hazard / Alert', 'Other'].map((item) => (
              <TouchableOpacity
                key={item}
                style={[styles.alertOption, { borderBottomColor: isDark ? '#374151' : '#F3F4F6' }]}
                onPress={async () => {
                  const existing = await storage.getItem('reports');
                  const existingReports: Array<{ type: string; lat: number; lng: number; at: string }> = existing ? JSON.parse(existing) : [];
                  existingReports.push({
                    type: item,
                    lat: location.latitude ?? 0,
                    lng: location.longitude ?? 0,
                    at: new Date().toISOString(),
                  });
                  await storage.setItem('reports', JSON.stringify(existingReports));
                  setAlertVisible(false);
                  Alert.alert('Reported', `"${item}" logged at your location.`);
                }}
              >
                <Text style={[styles.alertOptionText, { color: isDark ? '#D1D5DB' : '#374151' }]}>{item}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>
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
    top: 52,
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
  // Filter chips — vertical column at top-left
  filterChips: {
    position: 'absolute',
    top: 52,
    left: 12,
    zIndex: 10,
    gap: 6,
  },
  filterChip: {
    paddingVertical: 5,
    paddingHorizontal: 12,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.85)',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.1)',
  },
  filterChipActive: {
    backgroundColor: '#8B0000',
    borderColor: '#8B0000',
  },
  filterChipText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#374151',
  },
  filterChipTextActive: {
    color: '#FFFFFF',
  },

  // Bottom bar
  bottomBar: {
    position: 'absolute',
    bottom: 60,
    left: 16,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 16,
    paddingVertical: 10,
    paddingHorizontal: 12,
    zIndex: 10,
    elevation: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
  },
  searchInput: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
    marginRight: 10,
  },
  searchIcon: {
    fontSize: 18,
    color: '#9CA3AF',
    marginRight: 8,
  },
  searchPlaceholder: {
    fontSize: 15,
    color: '#9CA3AF',
    flex: 1,
  },
  locBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#2563EB',
    justifyContent: 'center',
    alignItems: 'center',
  },
  locIcon: {
    fontSize: 20,
    color: '#FFFFFF',
    fontWeight: '300',
  },

  // Height legend
  legend: {
    position: 'absolute',
    top: 52,
    right: 16,
    flexDirection: 'row',
    borderRadius: 20,
    paddingVertical: 6,
    paddingHorizontal: 10,
    zIndex: 10,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 4,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 4,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 4,
  },
  legendLabel: {
    fontSize: 11,
    fontWeight: '600',
  },

  // Alert button — floating above search bar
  alertBtn: {
    position: 'absolute',
    bottom: 88,
    right: 16,
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
  },
  alertBtnText: {
    fontSize: 18,
  },

  // Alert modal
  alertModal: {
    position: 'absolute',
    bottom: 140,
    right: 16,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 4,
    minWidth: 180,
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
  },
  alertTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#111827',
    paddingHorizontal: 12,
    paddingBottom: 8,
    marginBottom: 4,
  },
  alertOption: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#F3F4F6',
  },
  alertOptionText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#374151',
  },
});
