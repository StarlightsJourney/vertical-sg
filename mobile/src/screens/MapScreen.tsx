import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  TextInput,
  Modal,
  Alert,
} from 'react-native';
import {
  Map as MapView,
  Camera,
  GeoJSONSource,
  Layer,
  Marker,
  type MapRef,
  type CameraRef,
} from '@maplibre/maplibre-react-native';
import { useLocation } from '../hooks/useLocation';
import { fetchBlocksInBounds } from '../services/blocks';
import type { Block, BoundsRect, ClimbLog } from '../types';
import BlockDetailSheet from '../components/BlockDetailSheet';
import SearchScreen from '../components/SearchScreen';
import Ionicons from '@expo/vector-icons/Ionicons';
import storage from '../utils/storage';
import * as Linking from 'expo-linking';

// Light (default) and dark map styles for day/night auto-switching
// eslint-disable-next-line @typescript-eslint/no-require-imports
const LIGHT_STYLE = require('../../assets/map-style.json');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const DARK_STYLE = require('../../assets/map-style-dark.json');

// eslint-disable-next-line @typescript-eslint/no-require-imports
const WATER_COOLERS_RAW: Array<{ name: string; lat: number; lng: number; status: string; level: string; temperature: string; operator: string }> = require('../../assets/water-coolers.json');
const AMENITIES_RAW: Array<{ name: string; lat: number; lng: number; type: string; category: string }> = require('../../assets/amenities.json');

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

const FILTER_OPTIONS = [
  { value: 21, label: '21+' },
  { value: 31, label: '31+' },
  { value: 40, label: '40+' },
  { value: 0, label: 'All' },
] as const;

const FILTER_COLORS: Record<number, string> = { 21: '#FF3B30', 31: '#8B0000', 40: '#7C3AED', 0: '#6B7280' };

export default function MapScreen({ isDark: isDarkProp }: { isDark?: boolean }) {
  const location = useLocation();
  const mapRef = useRef<MapRef>(null);
  const cameraRef = useRef<CameraRef>(null);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const blocksRef = useRef<Block[]>([]);
  const zoomRef = useRef(13);
  const boundsRef = useRef<BoundsRect | null>(null);
  const prevBoundsRef = useRef<BoundsRect | null>(null);

  const [blocks, setBlocks] = useState<Block[]>([]);
  const [selectedBlock, setSelectedBlock] = useState<Block | null>(null);
  const [selectedBlockDist, setSelectedBlockDist] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [minFilter, setMinFilter] = useState(21);
  const [zoom, setZoom] = useState(13);
  const [pulsePhase, setPulsePhase] = useState(0);
  const [searchVisible, setSearchVisible] = useState(false);
  const [alertVisible, setAlertVisible] = useState(false);
  const [placementType, setPlacementType] = useState<string | null>(null);
  const [placementCenter, setPlacementCenter] = useState<[number, number]>([103.8198, 1.3521]);
  const [descModalVisible, setDescModalVisible] = useState(false);
  const [descText, setDescText] = useState('');
  const [pendingReports, setPendingReports] = useState<Array<{ name: string; lat: number; lng: number; type: string; desc: string; at: string; status: string }>>([]);
  const [recentBlocks, setRecentBlocks] = useState<Block[]>([]);
  const [starredIds, setStarredIds] = useState<Set<string>>(new Set());
  const [climbCounts, setClimbCounts] = useState<Map<string, number>>(new Map());
  const [climbHistory, setClimbHistory] = useState<ClimbLog[]>([]);
  const [tapY, setTapY] = useState<number>(0);
  const [selectedWaterCooler, setSelectedWaterCooler] = useState<{
    name: string;
    type: string;
    lat: number;
    lng: number;
  } | null>(null);

  // Use prop if provided (from App.tsx tab bar), otherwise auto-detect
  const isDark = isDarkProp ?? (() => {
    const hour = new Date().getHours();
    return hour < 6 || hour >= 19;
  })();

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
      if (ev.center) setPlacementCenter(ev.center as [number, number]);
      if (typeof zoom === 'number') {
        zoomRef.current = zoom;
        setZoom(zoom);
      }

      // Debounce: wait 600ms after last camera movement
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      debounceTimer.current = setTimeout(() => {
        if (boundsRef.current) {
          const cur = boundsRef.current;
          const prev = prevBoundsRef.current;
          const threshold = 0.003; // ~300m
          if (prev &&
            Math.abs(prev.ne[0] - cur.ne[0]) < threshold &&
            Math.abs(prev.ne[1] - cur.ne[1]) < threshold &&
            Math.abs(prev.sw[0] - cur.sw[0]) < threshold &&
            Math.abs(prev.sw[1] - cur.sw[1]) < threshold) {
            return; // Not enough movement — skip fetch
          }
          prevBoundsRef.current = cur;
          fetchBounds(cur);
        }
      }, 600);
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
        setSelectedWaterCooler(null); // deselect any water cooler
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
    } else if (props.water_type) {
      setSelectedWaterCooler({
        name: props.name,
        type: props.water_type,
        lat: props.lat,
        lng: props.lng,
      });
      setSelectedBlock(null); // deselect any building
    }
  }, [location.latitude, location.longitude]);

  const handleCloseDetail = useCallback(() => {
    setSelectedBlock(null);
    setSelectedBlockDist(null);
    setSelectedWaterCooler(null);
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

  // Load pending reports + starred blocks from storage on mount
  useEffect(() => {
    storage.getItem('pending_reports').then((val) => {
      if (val) { try { setPendingReports(JSON.parse(val)); } catch {} }
    });
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

  // Smooth pulse for user location ring using sine wave
  useEffect(() => {
    const start = Date.now();
    const timer = setInterval(() => {
      setPulsePhase((Date.now() - start) / 1500 * Math.PI * 2);
    }, 50);
    return () => clearInterval(timer);
  }, []);

  // Compute pulse values for smooth location ring animation
  const pulseOpacity = 0.15 + 0.15 * Math.sin(pulsePhase);
  const pulseRadius = 18 + 4 * Math.sin(pulsePhase);

  // Cycling filter: find current index and label
  const currentFilterIdx = FILTER_OPTIONS.findIndex(f => f.value === minFilter);
  const currentLabel = FILTER_OPTIONS[currentFilterIdx]?.label ?? '21+';

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
        onRegionIsChanging={() => {
          if (selectedBlock) handleCloseDetail();
          if (selectedWaterCooler) setSelectedWaterCooler(null);
        }}
      >
        <Camera
          ref={cameraRef}
          center={cameraCenter}
          zoom={13}
          minZoom={10}
          maxBounds={[103.5, 1.15, 104.1, 1.5]}
          duration={500}
        />

        {/* Water cooler icons — Marker components (fixed sizes = smooth) */}
        {zoom >= 13 && WATER_COOLERS_RAW.filter(wc => wc.lat && wc.lng).map((wc, i) => (
          <Marker key={`wc-${i}`} lngLat={[wc.lng, wc.lat]} anchor="center"
            onPress={() => setSelectedWaterCooler({ name: wc.name, type: wc.status, lat: wc.lat, lng: wc.lng })}>
            <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: isDark ? 'rgba(30,30,30,0.9)' : '#FFFFFF', justifyContent: 'center', alignItems: 'center', elevation: 3 }}>
              <Ionicons name="water-outline" size={14} color={wc.status === 'verified' ? '#06B6D4' : wc.status === 'unverified' ? '#EC4899' : '#06B6D4'} />
            </View>
          </Marker>
        ))}

        {/* Amenity icons — Marker components (toilets, shops) */}
        {zoom >= 13 && AMENITIES_RAW.filter(a => a.lat && a.lng).map((a, i) => {
          const iconName = a.type === 'toilet' ? 'male-female-outline' : 'cafe-outline';
          const iconColor = a.type === 'toilet' ? '#8B5CF6' : '#F59E0B';
          return (
          <Marker key={`am-${i}`} lngLat={[a.lng, a.lat]} anchor="center"
            onPress={() => setSelectedWaterCooler({ name: a.name, type: a.type, lat: a.lat, lng: a.lng })}>
            <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: isDark ? 'rgba(30,30,30,0.9)' : '#FFFFFF', justifyContent: 'center', alignItems: 'center', elevation: 3 }}>
              <Ionicons name={iconName as any} size={14} color={iconColor} />
            </View>
          </Marker>
        )})}

        {/* Pending report icons — Marker components, gray */}
        {zoom >= 13 && pendingReports.filter(r => r.lat && r.lng).map((r, i) => {
          const pIcon = r.type === 'Toilet' ? 'male-female-outline' : r.type === 'Food / Shop' ? 'cafe-outline' : 'water-outline';
          return (
          <Marker key={`pending-${i}`} lngLat={[r.lng, r.lat]} anchor="center"
            onPress={() => setSelectedWaterCooler({ name: r.name, type: `unverified-${r.type}`, lat: r.lat, lng: r.lng })}>
            <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: isDark ? 'rgba(30,30,30,0.8)' : 'rgba(255,255,255,0.8)', justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: '#9CA3AF' }}>
              <Ionicons name={pIcon as any} size={14} color="#9CA3AF" />
            </View>
          </Marker>
        )})}

        {userLocationGeojson && (
          <GeoJSONSource id="user-location" data={userLocationGeojson}>
            {/* Outer pulsing ring */}
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
              'circle-radius': 5,
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

      {/* Single cycling filter toggle at top-left */}
      <TouchableOpacity
        style={[styles.filterToggle, { backgroundColor: FILTER_COLORS[minFilter] || '#6B7280' }]}
        onPress={() => {
          const next = (currentFilterIdx + 1) % FILTER_OPTIONS.length;
          setMinFilter(FILTER_OPTIONS[next].value);
        }}
        activeOpacity={0.8}
      >
        <Text style={styles.filterToggleText}>{currentLabel}</Text>
      </TouchableOpacity>

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
          <Ionicons name="search" size={18} color="#9CA3AF" style={{ marginRight: 8 }} />
          <Text style={styles.searchPlaceholder}>Search blocks...</Text>
        </TouchableOpacity>

        {/* Alert/report button — PLUS icon, distinct from location */}
        <TouchableOpacity
          style={styles.alertBtn}
          onPress={() => setAlertVisible(true)}
          activeOpacity={0.7}
        >
          <Ionicons name="add-circle" size={22} color="#FFFFFF" />
        </TouchableOpacity>

        {/* Location button — BLUE, separate */}
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
          <Ionicons name="locate" size={22} color="#FFFFFF" />
        </TouchableOpacity>
      </View>

      {/* Placement mode: crosshair + confirm */}
      {placementType && (
        <>
          {/* Crosshair — thin lines */}
          <View style={styles.crosshair} pointerEvents="none">
            <View style={styles.crosshairLineH} />
            <View style={styles.crosshairLineV} />
          </View>
          {/* Confirm / Cancel buttons */}
          <View style={styles.placementBar}>
            <Text style={styles.placementLabel}>Place {placementType}</Text>
            <View style={styles.placementButtons}>
              <TouchableOpacity style={styles.placementCancel} onPress={() => setPlacementType(null)}>
                <Text style={styles.placementCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.placementConfirm} onPress={() => setDescModalVisible(true)}>
                <Text style={styles.placementConfirmText}>Confirm Location</Text>
              </TouchableOpacity>
            </View>
          </View>
        </>
      )}

      {/* Description modal */}
      <Modal visible={descModalVisible} transparent animationType="fade">
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' }}>
          <View style={{ backgroundColor: '#FFF', borderRadius: 16, padding: 24, width: '85%', maxWidth: 360 }}>
            <Text style={{ fontSize: 18, fontWeight: '700', color: '#111827', marginBottom: 8 }}>
              New {placementType}
            </Text>
            <Text style={{ fontSize: 13, color: '#6B7280', marginBottom: 16 }}>
              This will appear as unverified until confirmed by the community.
            </Text>
            <TextInput
              style={{ backgroundColor: '#F3F4F6', borderRadius: 10, padding: 14, fontSize: 14, color: '#111827', marginBottom: 16 }}
              placeholder='e.g. "Level 1 void deck, near lift B"'
              placeholderTextColor="#9CA3AF"
              value={descText}
              onChangeText={setDescText}
              maxLength={120}
            />
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <TouchableOpacity
                style={{ flex: 1, padding: 14, borderRadius: 12, backgroundColor: '#F3F4F6', alignItems: 'center' }}
                onPress={() => { setDescModalVisible(false); setDescText(''); }}
              >
                <Text style={{ fontWeight: '600', color: '#6B7280' }}>Skip</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={{ flex: 2, padding: 14, borderRadius: 12, backgroundColor: '#2563EB', alignItems: 'center' }}
                onPress={async () => {
                  const [lng, lat] = placementCenter;
                  const newReport = {
                    name: descText ? `${placementType}: ${descText.slice(0, 40)}` : (placementType ?? ''),
                    lat, lng,
                    type: placementType!,
                    desc: descText,
                    at: new Date().toISOString(),
                    status: 'pending',
                  };
                  // Store locally
                  const existing = await storage.getItem('pending_reports');
                  const reports: typeof pendingReports = existing ? JSON.parse(existing) : [];
                  reports.push(newReport);
                  await storage.setItem('pending_reports', JSON.stringify(reports));
                  setPendingReports(reports);
                  setPlacementType(null);
                  setDescModalVisible(false);
                  setDescText('');
                  Alert.alert('Reported', `${placementType} submitted as unverified. Visible immediately.`);
                }}
              >
                <Text style={{ fontWeight: '700', color: '#FFF' }}>Submit</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Block Detail Sheet overlay */}
      <BlockDetailSheet
        block={selectedBlock}
        distanceKm={selectedBlockDist}
        onLogClimb={handleLogClimb}
        tapY={tapY}
      />

      {/* Amenity info card — tiny, near tap, doesn't block panning */}
      {selectedWaterCooler && (
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 20 }} pointerEvents="box-none">
          <View style={{
            position: 'absolute',
            top: Math.max(60, (tapY || 300) - 80),
            left: '50%',
            transform: [{ translateX: -100 }],
            width: 200,
            backgroundColor: 'rgba(255,255,255,0.92)',
            borderRadius: 12,
            padding: 10,
            alignItems: 'center',
            elevation: 6,
          }}>
            <Text style={{ fontSize: 11, fontWeight: '600', color:
              selectedWaterCooler.type?.startsWith('unverified-') ? '#F59E0B' :
              selectedWaterCooler.type === 'toilet' ? '#8B5CF6' :
              selectedWaterCooler.type === 'shop' ? '#F59E0B' :
              selectedWaterCooler.type === 'verified' ? '#06B6D4' :
              selectedWaterCooler.type === 'unverified' ? '#EC4899' : '#F59E0B'
            }}>
              {selectedWaterCooler.type?.startsWith('unverified-') ? `✗ Unverified ${selectedWaterCooler.type.replace('unverified-', '')}` :
               selectedWaterCooler.type === 'toilet' ? 'Toilet' :
               selectedWaterCooler.type === 'shop' ? 'Food / Shop' :
               selectedWaterCooler.type === 'verified' ? '✓ Verified Water Cooler' :
               selectedWaterCooler.type === 'unverified' ? '✗ Unverified Water Cooler' : 'Water Cooler'}
            </Text>
            {selectedWaterCooler.name && (
              <Text style={{ fontSize: 10, color: '#6B7280', marginTop: 4, textAlign: 'center' }} numberOfLines={2}>
                {selectedWaterCooler.name}
              </Text>
            )}
            <TouchableOpacity style={{ marginTop: 6 }}
              onPress={() => {
                const { lat, lng } = selectedWaterCooler;
                if (lat && lng) {
                  Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`);
                }
              }}>
              <Text style={{ fontSize: 11, color: '#2563EB', fontWeight: '600' }}>Get Directions ↗</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

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

      {/* Alert/Report modal — centered icon grid */}
      <Modal visible={alertVisible} transparent animationType="fade" onRequestClose={() => setAlertVisible(false)}>
        <TouchableOpacity style={styles.alertBackdrop} onPress={() => setAlertVisible(false)} activeOpacity={1}>
          <View style={[styles.alertGrid, isDark && { backgroundColor: '#1F2937' }]}>
            <Text style={[styles.alertGridTitle, isDark && { color: '#F9FAFB' }]}>Report nearby...</Text>
            <View style={styles.alertGridItems}>
              {[
                { icon: 'water-outline', label: 'Water Cooler', color: '#06B6D4' },
                { icon: 'male-female-outline', label: 'Toilet', color: '#8B5CF6' },
                { icon: 'cafe-outline', label: 'Food / Shop', color: '#F59E0B' },
              ].map((item) => (
                <TouchableOpacity
                  key={item.label}
                  style={[styles.alertGridItem, { backgroundColor: item.color + (isDark ? '1F' : '15') }]}
                  onPress={() => {
                    setAlertVisible(false);
                    setPlacementType(item.label);
                  }}
                >
                  <Ionicons name={item.icon as any} size={26} color={item.color} />
                  <Text style={[styles.alertGridLabel, isDark && { color: '#D1D5DB' }]}>{item.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
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
  // Single cycling filter toggle at top-left
  filterToggle: {
    position: 'absolute',
    top: 52,
    left: 16,
    zIndex: 10,
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 16,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
  },
  filterToggleText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
  },

  // Bottom bar
  bottomBar: {
    position: 'absolute',
    bottom: 8,
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

  // Alert button — in bottom bar, amber to distinguish from blue location button
  alertBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#F59E0B',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
  },

  // Alert/report modal — centered icon grid
  alertBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  alertGrid: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 24,
    width: '80%',
    maxWidth: 320,
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
  },
  alertGridTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111827',
    textAlign: 'center',
    marginBottom: 20,
  },
  alertGridItems: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 12,
  },
  alertGridItem: {
    width: 90,
    alignItems: 'center',
    paddingVertical: 12,
    borderRadius: 12,
  },
  alertGridLabel: {
    fontSize: 11,
    color: '#6B7280',
    textAlign: 'center',
    fontWeight: '500',
  },

  // Placement mode
  crosshair: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    width: 28,
    height: 28,
    marginLeft: -14,
    marginTop: -14,
    zIndex: 15,
    justifyContent: 'center',
    alignItems: 'center',
  },
  crosshairLineH: {
    position: 'absolute',
    width: 24,
    height: 2,
    backgroundColor: '#EF4444',
    borderRadius: 1,
  },
  crosshairLineV: {
    position: 'absolute',
    width: 2,
    height: 24,
    backgroundColor: '#EF4444',
    borderRadius: 1,
  },
  placementBar: {
    position: 'absolute',
    top: 90,
    left: 16,
    right: 16,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 14,
    zIndex: 15,
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
  },
  placementLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 10,
    textAlign: 'center',
  },
  placementButtons: {
    flexDirection: 'row',
    gap: 10,
  },
  placementCancel: {
    flex: 1,
    padding: 12,
    borderRadius: 10,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
  },
  placementCancelText: {
    fontWeight: '600',
    color: '#6B7280',
    fontSize: 14,
  },
  placementConfirm: {
    flex: 1,
    padding: 12,
    borderRadius: 10,
    backgroundColor: '#2563EB',
    alignItems: 'center',
  },
  placementConfirmText: {
    fontWeight: '700',
    color: '#FFFFFF',
    fontSize: 14,
  },
});
